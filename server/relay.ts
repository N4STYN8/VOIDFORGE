import {CrewStore} from './crewStore.ts';
import {applyCrewEconomy} from './crewEconomy.ts';
import {CrewOutposts} from './crewOutposts.ts';
import {decodeRocks,decodeEnemies,decodeShots,type RockState} from '../src/shared.ts';
import type {CrewCommandContext} from './crewStore.ts';
import type {ShipState} from '../src/netProtocol.ts';
import { createServer as createHttp, type Server } from 'node:http';
import { createServer as createHttps } from 'node:https';
import { randomBytes, randomInt } from 'node:crypto';
import { upgrade, textFrame, type WebSocketPeer } from './websocket.ts';
import { createAdmin, clientIp, type Admin, type AdminOptions, type AdminSocket, type CommandResult, type RelayHooks } from './admin.ts';
import { NET, CLAIMS, MATCH, packState, parseClient, roomTag, type ClientMessage, type Member, type ServerMessage, type WorldRef } from '../src/netProtocol.ts';
import { ADMIN, type AdminCommand, type AdminEvent, type AdminPilot } from '../src/adminProtocol.ts';

/**
 * VOIDFORGE relay: lobbies plus per-sector rooms. It never simulates the game; each client runs its
 * own model and the relay forwards ship state to the other clients in the same sector (the room key
 * is the sector's world seed). That keeps the per-player cost small, which is what lets one relay aim
 * at many concurrent players. Lobbies hold up to NET.maxLobby pilots sharing the host's world.
 *
 * The optional admin console (server/admin.ts) reads and acts on this state through `RelayHooks`; admin
 * sockets that watch a sector get a copy of its traffic (`tap`), bounded so watching cannot stall the relay.
 */
type Client = {
  pilotId?:string;ship?:ShipState;
  at?: { x: number; y: number }; angle?: number;
  /** Last reported ship state was destroyed: such a pilot's game is not simulating, so it never runs a room. */ dead?: boolean;
  profile?: { home: string; power: number }; id: string; name: string; peer: WebSocketPeer; room?: string; world?: WorldRef; owner?: boolean;
  joined: number; lobby?: Lobby; tokens: number; refilled: number; dropped: number;
  /** Address (behind the proxy when trusted), connect time, and message-rate window for the admin console. */
  ip: string; since: number; msgs: number; rateAt: number; rate: number;
  /** Activity feed state: first hello seen, flood window, recent death times. */
  greeted?: boolean; floodAt?: number; floodCount?: number; flooded?: boolean; deaths?: number[]; deathsAlerted?: number;
  /** Token bucket for this pilot's ordinary activity events (alerts always pass). */ evTokens?: number; evAt?: number;
};
/** Alert thresholds for the admin activity feed. */
const ALERTS = { events: 20, eventsPerSecond: 1, floodWindow: 10000, floodDrops: 30, deaths: 5, deathWindow: 120000, joinBurst: 5, joinWindow: 60000, retryEvery: 60000 };
/** A sector room: its pilots, who runs its enemies, and rock claim leases (rock id -> holder and expiry). */
type Room = { clients: Set<Client>; authority?: Client; claims: Map<number, { holder: Client; until: number }> };
type Lobby = { code: string; host: Client; members: Set<Client>; open?: boolean };
export type RelayOptions = { port?: number; host?: string; tls?: { cert: string | Buffer; key: string | Buffer }; origins?: string[]; admin?: AdminOptions;crewFile?:string };
export type RelayStats = { clients: number; rooms: number; lobbies: number; messagesIn: number; framesOut: number; bytesOut: number; skipped: number; obsDropped: number; admins: number; uptime: number; rssMb: number; cpuMs: number };
export type Relay = { server: Server; port: number; close(): Promise<void>; stats(): RelayStats };

/** Origins allowed to open a socket: the live site and local development by default. */
export const DEFAULT_ORIGINS = ['https://n4styn8.github.io', 'http://localhost', 'http://127.0.0.1'];
export function originAllowed(origin: string | undefined, allowed: string[]) {
  if (!origin) return true; // Non-browser clients (tests, tools) send no Origin.
  return allowed.some(a => origin === a || (a.startsWith('http://localhost') || a.startsWith('http://127.0.0.1')) && origin.startsWith(a + ':'));
}

/** Only bounded finite rock geometry enters server-owned crew simulation. */
export function crewRockPatches(raw:unknown){return decodeRocks(raw).filter(p=>{if(p.gone)return true;if(p.amount!>1e6||p.radius!<=0||p.radius!>512||Math.abs(p.vx!)>10000||Math.abs(p.vy!)>10000)return false;const g=p.geometry;if(!g)return true;const n=g.angles?.length;return Number.isFinite(g.seed)&&Number.isFinite(g.baseRadius)&&g.baseRadius>0&&g.baseRadius<=512&&Number.isFinite(g.originalArea)&&g.originalArea>0&&Number.isFinite(g.revision)&&Number.isInteger(n)&&n>=10&&n<=16&&[g.angles,g.originalRadii,g.radii].every(a=>Array.isArray(a)&&a.length===n&&a.every(v=>Number.isFinite(v)&&v>=0&&v<=512))&&Array.isArray(g.vertices)&&g.vertices.length===n&&g.vertices.every(v=>v&&Number.isFinite(v.x)&&Number.isFinite(v.y)&&Math.abs(v.x)<=512&&Math.abs(v.y)<=512);});}

export function startRelay(options: RelayOptions = {}): Promise<Relay> {
  const clients = new Set<Client>(), rooms = new Map<string, Room>(), lobbies = new Map<string, Lobby>();
  let joins = 0;
  const rockCache=new Map<string,Map<number,RockState>>(),crewClaims=new Map<string,{crewId:string;until:number}>();
  let pendingCrewEffects:(()=>void)[]=[];
  const flushCrewEffects=()=>{const effects=pendingCrewEffects;pendingCrewEffects=[];for(const apply of effects)apply();};
  const outpostService=new CrewOutposts({
    claimRock:(crewId,world,id)=>{const room=rooms.get(world.seed),claim=room?.claims.get(id),now=Date.now();if(claim&&claim.until>now)return false;const key=world.seed+':'+id,held=crewClaims.get(key);if(held&&held.crewId!==crewId&&held.until>now)return false;crewClaims.set(key,{crewId,until:now+CLAIMS.lease});return true;},
    readRock:(world,id)=>rockCache.get(world.seed)?.get(id),
    onRock:(world,patch)=>{pendingCrewEffects.push(()=>{let cache=rockCache.get(world.seed);if(!cache)rockCache.set(world.seed,cache=new Map());cache.set(patch.id,patch);const room=rooms.get(world.seed);if(room)for(const c of room.clients)send(c,{t:'cast',from:'crew-server',r:roomTag(world.seed),k:'rocks',d:[patch]});});},
    onEnemyHit:(world,id,damage)=>{pendingCrewEffects.push(()=>{const authority=rooms.get(world.seed)?.authority;if(authority)send(authority,{t:'direct',from:'crew-server',r:roomTag(world.seed),k:'hit',d:[{enemyId:id,damage}]});});}
  });
  const crewStore=new CrewStore({path:options.crewFile,command:(crew,pilotId,action,data,context)=>{
    if(action.startsWith('outpost-'))return outpostService.command(crew,pilotId,action,data,context);
    const result=applyCrewEconomy(crew,pilotId,action,data,context);if(result===undefined)throw Error('Unknown crew action.');return result;
  },view:(crew,context)=>outpostService.view(crew,context)});

  // Totals since start, for /stats and load tests.
  const counters = { messagesIn: 0, framesOut: 0, bytesOut: 0, skipped: 0, obsDropped: 0 }, started = Date.now();
  /** Admin observers by sector seed, the sectors an admin locked, and per-room observer cast budgets. */
  const watchers = new Map<string, Set<AdminSocket>>(), locked = new Set<string>(), castBudget = new Map<string, { start: number; bytes: number }>();
  /** Admin commands awaiting the pilot's ack. */
  const pending = new Map<number, { client: Client; resolve: (r: CommandResult) => void; timer: ReturnType<typeof setTimeout> }>();
  let refs = 0, warnedProxy = false;
  /** Records an activity event about a pilot; ordinary ones are rate limited per pilot so one client cannot flood the feed. */
  const pilotEvent = (c: Client, e: Omit<AdminEvent, 'at'>) => {
    if (!e.alert) {
      const t = Date.now(); c.evTokens = Math.min(ALERTS.events, (c.evTokens ?? ALERTS.events) + (t - (c.evAt ?? t)) / 1000 * ALERTS.eventsPerSecond); c.evAt = t;
      if (c.evTokens < 1) return; c.evTokens--;
    }
    admin.event(e);
  };
  /** Alert bookkeeping by address: recent connection times and when each alert last fired. Pruned as it grows. */
  const joinTimes = new Map<string, number[]>(), burstAlerted = new Map<string, number>(), retried = new Map<string, number>();
  const now = options.admin?.now ?? Date.now;
  const stats = (): RelayStats => { const cpu = process.cpuUsage(); return { clients: clients.size, rooms: rooms.size, lobbies: lobbies.size, ...counters, admins: admin?.sockets.size ?? 0, uptime: Math.round((Date.now() - started) / 1000), rssMb: Math.round(process.memoryUsage().rss / 1048576), cpuMs: Math.round((cpu.user + cpu.system) / 1000) }; };
  const publicStats = () => { const { obsDropped: _o, admins: _a, ...rest } = stats(); return rest; };
  /** Writes one pre-built frame to each recipient. Replaceable traffic (ship state) skips clients with a backed-up socket. */
  const broadcast = (recipients: Iterable<Client>, text: string, replaceable = false) => {
    let frame: Buffer | undefined;
    for (const other of recipients) {
      if (replaceable && other.peer.backlog > NET.backlog) { counters.skipped++; continue; }
      frame ??= textFrame(text); other.peer.sendFrame(frame); counters.framesOut++; counters.bytesOut += frame.length;
    }
  };
  /** Copies a room message to the admins watching that sector. Costs one map lookup when nobody watches. */
  const tap = (seed: string, text: string, replaceable = false) => {
    const set = watchers.get(seed); if (!set?.size) return;
    let frame: Buffer | undefined;
    for (const s of set) {
      if (replaceable && s.peer.backlog > NET.backlog) { counters.obsDropped++; continue; }
      frame ??= textFrame(`{"t":"obs","r":${JSON.stringify(seed)},"m":${text}}`); s.peer.sendFrame(frame);
    }
  };
  const allowed = options.origins ?? DEFAULT_ORIGINS;
  const send = (c: Client, m: ServerMessage) => { const frame = textFrame(JSON.stringify(m)); c.peer.sendFrame(frame); counters.framesOut++; counters.bytesOut += frame.length; };
  const crewContext=(c:Client):Partial<CrewCommandContext>=>({world:c.world,ship:c.ship});
  function announceCrews(){const online=[...clients].filter(c=>c.pilotId).map(c=>({pilotId:c.pilotId!,name:c.name,socketId:c.id}));for(const c of clients)if(c.pilotId){const state=crewStore.snapshot(c.pilotId,online,crewContext(c));const data=JSON.stringify(state);if(Buffer.byteLength(data)<NET.maxMessage-100)send(c,{t:'crew-state',state});else{const total=Math.ceil(data.length/3000),transferId=randomBytes(8).toString('hex');if(total>256){delete state.outpostView;send(c,{t:'crew-state',state});continue;}for(let index=0;index<total;index++)send(c,{t:'crew-state-part',transferId,index,total,data:data.slice(index*3000,(index+1)*3000)});}}}
  const members = (lobby: Lobby): Member[] => [...lobby.members].map(c => ({ id: c.id, name: c.name, host: c === lobby.host }));
  const announce = (lobby: Lobby) => { const m: ServerMessage = { t: 'lobby', code: lobby.code, host: lobby.host.id, members: members(lobby), world: lobby.host.world ?? null, open: lobby.open || undefined }; for (const c of lobby.members) send(c, m); };
  const newCode = () => { for (;;) { let code = ''; for (let i = 0; i < NET.codeLength; i++) code += NET.codeAlphabet[randomInt(NET.codeAlphabet.length)]; if (!lobbies.has(code)) return code; } };

  /**
   * The pilot who runs enemies in a room: the sector's owner if present, else the lobby host, else whoever
   * arrived first, choosing among pilots whose ship is not destroyed (a destroyed ship's game stops
   * simulating). Announced to the room whenever it or the head count changes.
   */
  function elect(key: string, room: Room) {
    const all = [...room.clients].sort((a, b) => a.joined - b.joined), live = all.filter(c => !c.dead), list = live.length ? live : all;
    const choice = list.find(c => c.owner) ?? list.find(c => c.lobby?.host === c && c.lobby.members.size > 1 && list.some(o => o !== c && o.lobby === c.lobby)) ?? list[0];
    if (choice && room.authority !== choice) pilotEvent(choice, { kind: 'authority', id: choice.id, name: choice.name, seed: key });
    room.authority = choice;
    announceRoom(key);
  }
  /** Tells a room who runs it, how many pilots are in it, and whether an admin watches it (a lone pilot then sends an observer feed). */
  function announceRoom(key: string) {
    const room = rooms.get(key); if (!room?.authority) return;
    const m: ServerMessage = { t: 'room', authority: room.authority.id, members: room.clients.size, watched: watchers.get(key)?.size ? true : undefined };
    for (const c of room.clients) send(c, m);
    tap(key, JSON.stringify(m));
  }
  /** Re-announces rooms whose watched state changed while `change` ran. */
  function rewatch(seeds: Iterable<string>, change: () => void) {
    const all = [...new Set(seeds)], was = all.map(seed => Boolean(watchers.get(seed)?.size));
    change();
    all.forEach((seed, i) => { if (Boolean(watchers.get(seed)?.size) !== was[i]) announceRoom(seed); });
  }
  function leaveRoom(c: Client) {
    if (!c.room) return;
    const key = c.room, room = rooms.get(key);
    c.room = undefined;
    if (!room) return;
    room.clients.delete(c);
    for (const [id, claim] of room.claims) if (claim.holder === c) room.claims.delete(id);
    const gone: ServerMessage = { t: 'gone', id: c.id };
    tap(key, JSON.stringify(gone));
    if (!room.clients.size) { rooms.delete(key); castBudget.delete(key); return; }
    for (const other of room.clients) send(other, gone);
    elect(key, room);
  }
  function leaveLobby(c: Client, reason: string, notify = true) {
    const lobby = c.lobby; if (!lobby) return;
    lobby.members.delete(c); c.lobby = undefined;
    pilotEvent(c, { kind: 'lobby', id: c.id, name: c.name, code: lobby.code, detail: lobby.members.size ? 'left' : 'left; lobby closed' });
    if (notify) send(c, { t: 'left-lobby', reason });
    if (!lobby.members.size) { lobbies.delete(lobby.code); return; }
    if (lobby.host === c) lobby.host = lobby.members.values().next().value!;
    announce(lobby);
    for (const m of lobby.members) if (m.room) { const room = rooms.get(m.room); if (room) elect(m.room, room); }
  }

  /** Sends an admin command to a pilot; resolves with its ack, or `no response` (old client, stalled tab) after the timeout. */
  function command(c: Client, cmd: AdminCommand): Promise<CommandResult> {
    const ref = ++refs;
    return new Promise(resolve => {
      const timer = setTimeout(() => { pending.delete(ref); resolve({ ok: false, message: 'no response' }); }, options.admin?.resultTimeout ?? ADMIN.resultTimeout);
      timer.unref?.();
      pending.set(ref, { client: c, resolve, timer });
      send(c, { t: 'admin', ref, c: cmd });
    });
  }
  /** A guest sent out of the host's sector leaves the lobby, so the lobby world does not pull them straight back. */
  function releaseGuest(c: Client, toSeed?: string) {
    const lobby = c.lobby;
    if (lobby && lobby.host !== c && lobby.host.room !== toSeed) leaveLobby(c, 'Removed from the lobby by an admin.');
  }
  const unwatch = (socket: AdminSocket) => {
    for (const seed of socket.watching) { const set = watchers.get(seed); set?.delete(socket); if (set && !set.size) watchers.delete(seed); }
    socket.watching.clear();
  };
  const byId = (id: string) => { for (const c of clients) if (c.id === id) return c; };
  const evictFrom = (seed: string, reason: string) => {
    const room = rooms.get(seed);
    const targets = [...room?.clients ?? []].filter(c => !c.owner);
    return Promise.all(targets.map(c => { releaseGuest(c); return command(c, { op: 'evict', reason }); })).then(results => results.filter(r => r.ok).length);
  };
  const rateOf = (c: Client) => {
    const t = Date.now(), elapsed = t - c.rateAt;
    if (elapsed >= 2000) { c.rate = Math.round(c.msgs * 10000 / elapsed) / 10; c.msgs = 0; c.rateAt = t; }
    return c.rate;
  };

  const hooks: RelayHooks = {
    overview() {
      const pilots: AdminPilot[] = [...clients].map(c => ({
        id: c.id, name: c.name, ip: c.ip, room: c.room, world: c.world, lobby: c.lobby?.code, authority: Boolean(c.room && rooms.get(c.room)?.authority === c), owner: c.owner || undefined,
        at: c.at, angle: c.angle, dead: c.dead, profile: c.profile, since: c.since, rate: rateOf(c), ping: c.peer.rtt,
      }));
      const lobbyList = [...lobbies.values()].map(l => ({ code: l.code, host: l.host.id, hostName: l.host.name, members: [...l.members].map(m => ({ id: m.id, name: m.name })), open: Boolean(l.open) }));
      const roomList = [...rooms.entries()].map(([seed, room]) => ({ seed, world: [...room.clients].find(c => c.world?.seed === seed)?.world, authority: room.authority?.id, members: room.clients.size, locked: locked.has(seed), watched: Boolean(watchers.get(seed)?.size) }));
      for (const seed of locked) if (!rooms.has(seed)) roomList.push({ seed, world: undefined, authority: undefined, members: 0, locked: true, watched: Boolean(watchers.get(seed)?.size) });
      return { pilots, lobbies: lobbyList, rooms: roomList, stats: stats() as unknown as Record<string, number> };
    },
    pilot(id) { const c = byId(id); return c && { ip: c.ip, name: c.name }; },
    dropIp(ip, reason) { let n = 0; for (const c of [...clients]) if (c.ip === ip) { send(c, { t: 'error', message: reason }); c.peer.close(4001); n++; } return n; },
    kick(id, reason) { const c = byId(id); if (!c) return 'That pilot is not online.'; send(c, { t: 'error', message: reason }); c.peer.close(4001); },
    rename(id, name) {
      const c = byId(id); if (!c) return 'That pilot is not online.';
      c.name = name; if (c.lobby) announce(c.lobby);
      void command(c, { op: 'rename', name });
    },
    disband(code) {
      const lobby = lobbies.get(code); if (!lobby) return 'No such lobby.';
      for (const m of [...lobby.members]) leaveLobby(m, 'An admin closed this lobby.');
      lobbies.delete(code);
    },
    remove(code, id) {
      const lobby = lobbies.get(code), c = byId(id);
      if (!lobby || !c || c.lobby !== lobby) return 'That pilot is not in that lobby.';
      leaveLobby(c, 'An admin removed you from the lobby.');
    },
    setOpen(code, open) { const lobby = lobbies.get(code); if (!lobby) return 'No such lobby.'; lobby.open = open || undefined; announce(lobby); },
    lock(seed, lock) {
      if (lock) { locked.add(seed); void evictFrom(seed, 'An admin locked this sector.'); } else locked.delete(seed);
    },
    broadcast(to, text) {
      const recipients = 'all' in to ? [...clients] : 'lobby' in to ? [...lobbies.get(to.lobby)?.members ?? []] : 'pilot' in to ? [byId(to.pilot)].filter((c): c is Client => Boolean(c)) : [...rooms.get(to.room)?.clients ?? []];
      broadcast(recipients, JSON.stringify({ t: 'admin', ref: 0, c: { op: 'notice', text } } satisfies ServerMessage));
      return recipients.length;
    },
    command(id, cmd) {
      const c = byId(id); if (!c) return Promise.resolve({ ok: false, message: 'That pilot is not online.' });
      if (cmd.op === 'teleport' && (cmd.world || cmd.cell)) releaseGuest(c, cmd.world?.seed);
      if (cmd.op === 'evict') releaseGuest(c);
      return command(c, cmd);
    },
    authorityOf(seed) { return rooms.get(seed)?.authority?.id; },
    pilotDetail(id) { const c = byId(id); return c && { blocks: c.ship?.blocks, paint: c.ship?.paint }; },
    evict: evictFrom,
    watch(socket, seeds) {
      const next = seeds.slice(0, ADMIN.maxWatch);
      rewatch([...socket.watching, ...next], () => {
        unwatch(socket);
        for (const seed of next) { let set = watchers.get(seed); if (!set) watchers.set(seed, set = new Set()); set.add(socket); socket.watching.add(seed); }
      });
    },
    release(socket) { rewatch([...socket.watching], () => unwatch(socket)); },
  };
  const admin: Admin = createAdmin({ ...options.admin }, hooks);

  function handle(c: Client, m: ClientMessage) {
    switch (m.t) {
      case 'crew-auth': {try{const identity=crewStore.authenticate(m.credential,c.name);c.pilotId=identity.pilotId;send(c,{t:'crew-identity',...identity});announceCrews();}catch(error){send(c,{t:'error',message:error instanceof Error?error.message:'Crew authentication failed.'});}return;}
      case 'crew': {pendingCrewEffects=[];try{
        if(m.action==='outpost-sync'){
          const crew=c.pilotId?crewStore.crewOf(c.pilotId):undefined;if(!crew){send(c,{t:'crew-result',requestId:m.requestId,ok:false,error:'Join a crew first.'});return;}
          if(c.room&&c.world&&c.ship&&rooms.get(c.room)?.authority===c){const data=m.data as {rocks?:unknown};let cache=rockCache.get(c.room);if(!cache)rockCache.set(c.room,cache=new Map());for(const patch of crewRockPatches(data?.rocks).slice(0,12)){if(patch.gone||patch.amount!>1e6||patch.radius!>512||Math.hypot(patch.x!-c.ship.x,patch.y!-c.ship.y)>2500||cache.has(patch.id))continue;cache.set(patch.id,patch);}}
          send(c,{t:'crew-result',requestId:m.requestId,ok:true});announceCrews();return;
        }
const result=c.pilotId?crewStore.execute(c.pilotId,m.requestId,m.action,m.data,crewContext(c)):{requestId:m.requestId,ok:false,error:'Authenticate your crew identity first.'};send(c,{t:'crew-result',...result});if(result.ok){flushCrewEffects();announceCrews();}else pendingCrewEffects=[];}catch{pendingCrewEffects=[];send(c,{t:'error',message:'Crew persistence unavailable; outcome unknown. Retry the same request after reconnecting.'});}return;}

      case 'hello':
        if (m.v !== NET.version) { send(c, { t: 'error', message: 'This game version does not match the relay. Reload the page.' }); c.peer.close(4000); return; }
        if (!c.greeted) { c.greeted = true; pilotEvent(c, { kind: 'join', id: c.id, name: m.name, ip: c.ip }); }
        else if (c.name !== m.name) pilotEvent(c, { kind: 'rename', id: c.id, name: m.name, detail: `was ${c.name}` });
        c.name = m.name; if (c.lobby) announce(c.lobby); return;
      case 'create': {
        leaveLobby(c, 'You started a new lobby.', false);
        const lobby: Lobby = { code: newCode(), host: c, members: new Set([c]), open: m.open };
        lobbies.set(lobby.code, lobby); c.lobby = lobby; announce(lobby); pilotEvent(c, { kind: 'lobby', id: c.id, name: c.name, code: lobby.code, detail: 'created' }); return;
      }
      case 'join': {
        const lobby = lobbies.get(m.code);
        if (!lobby) { send(c, { t: 'error', message: `No lobby with code ${m.code || '(empty)'}.` }); return; }
        if (lobby === c.lobby) { announce(lobby); return; }
        if (lobby.members.size >= NET.maxLobby) { send(c, { t: 'error', message: 'That lobby is full.' }); return; }
        leaveLobby(c, 'You joined another lobby.', false);
        lobby.members.add(c); c.lobby = lobby; announce(lobby); pilotEvent(c, { kind: 'lobby', id: c.id, name: c.name, code: lobby.code, detail: 'joined' }); return;
      }
      case 'leave': leaveLobby(c, 'You left the lobby.'); return;
      case 'open': if (c.lobby?.host === c) { c.lobby.open = m.open || undefined; announce(c.lobby); } return;
      case 'lobbies': {
        // Open lobbies with room, the fullest first: the public list players browse to find a group.
        const list = [...lobbies.values()].filter(l => l.open && l.members.size < NET.maxLobby).sort((a, b) => b.members.size - a.members.size).slice(0, 50)
          .map(l => ({ code: l.code, host: l.host.name, members: l.members.size, power: l.host.profile?.power }));
        send(c, { t: 'lobbies', online: clients.size, list }); return;
      }
      case 'profile': c.profile = { home: m.home, power: m.power }; return;
      case 'match': {
        // The online pilot nearest in progression (within MATCH.maxRatio) becomes the asker's next sector.
        const mine = c.profile; if (!mine) { send(c, { t: 'match', world: null }); return; }
        const ratio = (a: number, b: number) => Math.max(a, b, 1) / Math.max(1, Math.min(a, b));
        const choices = [...clients].filter(o => o !== c && o.profile && o.profile.home !== mine.home && !m.exclude.includes(o.profile.home) && ratio(o.profile.power, mine.power) <= MATCH.maxRatio)
          .sort((a, b) => ratio(a.profile!.power, mine.power) - ratio(b.profile!.power, mine.power));
        const best = choices[0];
        send(c, best ? { t: 'match', world: { home: best.profile!.home, x: 0, y: 0, seed: best.profile!.home }, name: best.name } : { t: 'match', world: null });
        return;
      }
      case 'sector': {
        const owner = Boolean(m.owner);
        // A sector an admin locked admits only its owner; anyone else is sent home by their own client.
        if (locked.has(m.world.seed) && !owner) {
          leaveRoom(c); c.world = m.world; c.owner = false;
          releaseGuest(c);
          void command(c, { op: 'evict', reason: 'This sector is locked.' });
          return;
        }
        if (c.room !== m.world.seed) {
          leaveRoom(c); c.room = m.world.seed; c.joined = ++joins; c.owner = owner;
          pilotEvent(c, { kind: 'sector', id: c.id, name: c.name, seed: m.world.seed });
          let room = rooms.get(c.room); if (!room) rooms.set(c.room, room = { clients: new Set(), claims: new Map() });
          room.clients.add(c); elect(c.room, room);
        } else if (c.owner !== owner) { c.owner = owner; elect(c.room, rooms.get(c.room)!); }
        c.world = m.world;if(c.pilotId)announceCrews();
        if (c.lobby?.host === c) announce(c.lobby);
        return;
      }
      case 'state': {
        if (!c.room) return;
        c.at = { x: m.s.x, y: m.s.y }; c.angle = m.s.angle;c.ship={...m.s,blocks:m.s.blocks??c.ship?.blocks};
        if (Boolean(m.s.dead) !== Boolean(c.dead)) {
          c.dead = Boolean(m.s.dead) || undefined; const room = rooms.get(c.room); if (room) elect(c.room, room);
          if (c.dead) {
            const t = Date.now(); c.deaths = [...(c.deaths ?? []).filter(d => t - d < ALERTS.deathWindow), t].slice(-ALERTS.deaths);
            pilotEvent(c, { kind: 'died', id: c.id, name: c.name, seed: c.room });
            if (c.deaths.length >= ALERTS.deaths && t - (c.deathsAlerted ?? 0) > ALERTS.deathWindow) { c.deathsAlerted = t; pilotEvent(c, { kind: 'deaths', id: c.id, name: c.name, seed: c.room, detail: `${c.deaths.length} deaths in 2 minutes`, alert: true }); }
          } else pilotEvent(c, { kind: 'respawn', id: c.id, name: c.name, seed: c.room });
        }
        // Interest management: only pilots near enough to see or chart this ship get its state.
        const near = [...rooms.get(c.room)?.clients ?? []].filter(other => other !== c && (!other.at || Math.abs(other.at.x - m.s.x) < NET.interest && Math.abs(other.at.y - m.s.y) < NET.interest));
        const text = JSON.stringify({ t: 'state', id: c.id, name: m.s.blocks ? c.name : undefined, r: roomTag(c.room), s: packState(m.s) });
        broadcast(near, text, true);
        tap(c.room, text, true);
        return;
      }
      case 'cast': {
        if (!c.room) return;
        const frame=m.d as Record<string,unknown>;
        const patches=m.k==='rocks'?crewRockPatches(m.d):m.k==='fx'?crewRockPatches(frame?.r):[];
        if(patches.length){let cache=rockCache.get(c.room);if(!cache)rockCache.set(c.room,cache=new Map());for(const patch of patches){const lock=crewClaims.get(c.room+':'+patch.id);if(lock&&lock.until>Date.now())continue;cache.set(patch.id,patch);}if(cache.size>5000)for(const id of [...cache.keys()].slice(0,cache.size-5000))cache.delete(id);}
        if(rooms.get(c.room)?.authority===c&&c.world&&(m.k==='fx'||m.k==='enemies'||m.k==='shots'))crewStore.inspectCrews(crew=>{if(crew.outposts?.length)outpostService.ingestCombat(crew,c.world!,{enemies:m.k==='enemies'?decodeEnemies(m.d):m.k==='fx'?decodeEnemies(frame?.n):undefined,shots:m.k==='shots'?decodeShots(m.d):m.k==='fx'?decodeShots(frame?.e):undefined});});

        const text = JSON.stringify({ t: 'cast', from: c.id, r: roomTag(c.room), k: m.k, d: m.d } satisfies ServerMessage);
        broadcast([...rooms.get(c.room)?.clients ?? []].filter(other => other !== c), text);
        if (watchers.get(c.room)?.size) {
          // Observer copies of casts are capped per room so a busy sector cannot flood an admin socket.
          const t = Date.now(), budget = castBudget.get(c.room) ?? { start: t, bytes: 0 };
          if (t - budget.start >= 1000) { budget.start = t; budget.bytes = 0; }
          castBudget.set(c.room, budget);
          if (budget.bytes + text.length > ADMIN.castBytes) counters.obsDropped++;
          else { budget.bytes += text.length; tap(c.room, text, true); }
        }
        return;
      }
      case 'direct': {
        if (!c.room) return;
        const target = [...rooms.get(c.room)?.clients ?? []].find(other => other.id === m.to && other !== c);
        if(target&&m.k==='pvp-hit'&&crewStore.sameCrew(c.pilotId,target.pilotId))return;
        if (target) send(target, { t: 'direct', from: c.id, r: roomTag(c.room), k: m.k, d: m.d }); else send(c, { t: 'undelivered', to: m.to, k: m.k });
        return;
      }
      case 'party': {
        // Lobby-wide messages reach members in any sector; the relay never looks inside them.
        const lobby = c.lobby;
        if (!lobby) { if (m.to) send(c, { t: 'party-undelivered', to: m.to, k: m.k }); return; }
        const out: ServerMessage = { t: 'party', from: c.id, k: m.k, d: m.d };
        if (m.to) { const target = [...lobby.members].find(other => other.id === m.to && other !== c); if (target) send(target, out); else send(c, { t: 'party-undelivered', to: m.to, k: m.k }); }
        else for (const other of lobby.members) if (other !== c) send(other, out);
        return;
      }
      case 'claim': {
        const room = c.room ? rooms.get(c.room) : undefined; if (!room) return;
        const t = Date.now(), ok: number[] = [], denied: number[] = [];
        for (const id of m.ids) {
          const claim = room.claims.get(id);
          if((crewClaims.get(c.room!+':'+id)?.until??0)>t){denied.push(id);continue;}
          if (!claim || claim.holder === c || claim.until <= t || !room.clients.has(claim.holder)) { room.claims.set(id, { holder: c, until: t + CLAIMS.lease }); ok.push(id); } else denied.push(id);
        }
        if (room.claims.size > 4096) for (const [id, claim] of room.claims) if (claim.until <= t) room.claims.delete(id);
        send(c, { t: 'claims', ok, denied, lease: CLAIMS.lease });
        return;
      }
      case 'admin-ack': {
        // Only the pilot a command went to may answer it; stray or replayed acks are dropped.
        const entry = pending.get(m.ref);
        if (!entry || entry.client !== c) return;
        pending.delete(m.ref); clearTimeout(entry.timer);
        entry.resolve({ ok: m.ok, message: m.message, data: m.data });
        return;
      }
    }
  }
  /** Token bucket: drops messages over the rate and closes clients that keep flooding. */
  function admit(c: Client) {
    const t = Date.now();
    c.tokens = Math.min(NET.burst, c.tokens + (t - c.refilled) / 1000 * NET.maxRate); c.refilled = t;
    if (c.tokens >= 1) { c.tokens--; c.dropped = Math.max(0, c.dropped - 1); return true; }
    if (t - (c.floodAt ?? 0) > ALERTS.floodWindow) { c.floodAt = t; c.floodCount = 0; c.flooded = false; }
    if (++c.floodCount! > ALERTS.floodDrops && !c.flooded) { c.flooded = true; pilotEvent(c, { kind: 'flood', id: c.id, name: c.name, ip: c.ip, detail: 'sending faster than the rate limit', alert: true }); }
    if (++c.dropped > NET.maxRate * NET.abuse) c.peer.close(1008);
    return false;
  }

  const listener = (request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => {
    if (admin.handleHttp(request, response)) return;
    if (request.url === '/stats') { response.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); response.end(JSON.stringify(publicStats())); return; }
    response.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
    response.end(`VOIDFORGE relay v${NET.version}: ${clients.size} online, ${rooms.size} sectors, ${lobbies.size} lobbies\n`);
  };
  const server = options.tls ? createHttps(options.tls, listener) : createHttp(listener);
  server.on('upgrade', (request, socket) => {
    if (admin.handleUpgrade(request, socket)) return;
    const ip = clientIp(request, Boolean(options.admin?.trustProxy));
    if (!options.admin?.trustProxy && !warnedProxy && request.headers['x-forwarded-for'] && (ip === '127.0.0.1' || ip === '::1')) { warnedProxy = true; console.warn('[relay] Connections arrive through a proxy but TRUST_PROXY is not set: every player shows as a local address, so admin bans are refused. Set TRUST_PROXY=1.'); }
    if (admin.bans.isBanned(ip)) {
      const t = Date.now(); if (t - (retried.get(ip) ?? 0) > ALERTS.retryEvery) { retried.set(ip, t); admin.event({ kind: 'banned-retry', ip, detail: 'a banned address tried to connect', alert: true }); }
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return; }
    const peer = upgrade(request, socket, NET.maxMessage, origin => originAllowed(origin, allowed)); if (!peer) return;
    const t = Date.now();
    const c: Client = { id: randomBytes(6).toString('hex'), name: 'Pilot', peer, joined: 0, tokens: NET.burst, refilled: t, dropped: 0, ip, since: now(), msgs: 0, rateAt: t, rate: 0 };
    clients.add(c);
    const joinsHere = [...(joinTimes.get(ip) ?? []).filter(j => t - j < ALERTS.joinWindow), t].slice(-(ALERTS.joinBurst + 1)); joinTimes.set(ip, joinsHere);
    if (joinsHere.length > ALERTS.joinBurst && t - (burstAlerted.get(ip) ?? 0) > ALERTS.joinWindow) { burstAlerted.set(ip, t); admin.event({ kind: 'join-burst', ip, detail: `${joinsHere.length} connections in a minute`, alert: true }); }
    if (joinTimes.size > 5000) for (const [k, v] of joinTimes) if (!v.some(j => t - j < ALERTS.joinWindow)) { joinTimes.delete(k); burstAlerted.delete(k); }
    if (retried.size > 5000) retried.clear();
    peer.onmessage = text => { counters.messagesIn++; c.msgs++; if (!admit(c)) return; const m = parseClient(text); if (m) handle(c, m); };
    peer.onclose = () => {
      if (c.greeted) pilotEvent(c, { kind: 'leave', id: c.id, name: c.name, ip: c.ip });
      clients.delete(c); leaveRoom(c); leaveLobby(c, '', false);if(c.pilotId)announceCrews();
      for (const [ref, entry] of pending) if (entry.client === c) { pending.delete(ref); clearTimeout(entry.timer); entry.resolve({ ok: false, message: 'The pilot disconnected.' }); }
    };
    send(c, { t: 'welcome', id: c.id,crewProtocol:1 });
    peer.ping();
  });
  const keepAlive = setInterval(() => { for (const c of clients) { if (!c.peer.alive) { c.peer.close(1001); continue; } c.peer.alive = false; c.peer.ping(); } }, NET.ping * 1000);
  keepAlive.unref();
  const crewTick=setInterval(()=>{pendingCrewEffects=[];try{const changed=crewStore.systemUpdate(crews=>{let changed=false;for(const crew of crews)if(crew.outposts?.length){const contexts=[...clients].filter(c=>c.pilotId&&crew.members.some(m=>m.pilotId===c.pilotId)).map(c=>({pilotId:c.pilotId!,...crewContext(c)}));changed=outpostService.tick(crew,.5,contexts)||changed;}return changed;});if(changed){flushCrewEffects();announceCrews();}else pendingCrewEffects=[];const now=Date.now();for(const[key,claim]of crewClaims)if(claim.until<now)crewClaims.delete(key);}catch(error){pendingCrewEffects=[];console.error('Crew automation update failed:',error instanceof Error?error.message:'unknown');}},500);crewTick.unref();

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 8787, options.host ?? '0.0.0.0', () => {
      const address = server.address(), port = typeof address === 'object' && address ? address.port : options.port ?? 8787;
      resolve({ server, port, stats,
        close: () => new Promise(done => { clearInterval(keepAlive);clearInterval(crewTick); admin.close(); for (const c of clients) c.peer.close(1001); server.close(() => done()); server.closeIdleConnections?.(); }) });
    });
  });
}
