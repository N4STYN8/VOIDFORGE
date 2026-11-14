import type {CrewClientState,CrewResult} from './crewProtocol.ts';
import { NET, MATCH, packState, parseServer, roomTag, type CastKind, type ClientMessage, type DirectKind, type LobbySummary, type Member, type PartyKind, type ShipBlock, type ShipState, type WorldRef } from './netProtocol.ts';
import type { AdminCommand } from './adminProtocol.ts';
import { ClaimBook } from './shared.ts';

/**
 * Browser side of the relay connection. No Phaser or DOM beyond WebSocket; time is passed in (seconds),
 * so it can be driven from tests. The game keeps running offline whatever happens here.
 */
export type LobbyInfo = { code: string; host: string; members: Member[]; world: WorldRef | null; open?: boolean };
/** Seconds between reconnect attempts while staying online: doubling from the first, up to the last. */
export const RECONNECT = { first: 2, max: 30 };
/**
 * Remote ship drawing. Ships are drawn `delay` seconds in the past, where `delay` adapts per pilot to how
 * irregularly their updates arrive (`base` + `jitter` x measured jitter, within `min`..`max`). Past the newest
 * sample the pose is carried forward on its velocity and turn rate (at most `ahead` seconds); when a new sample
 * changes where the ship should be, the jump is eased out over about `smooth` seconds instead of snapping.
 */
export const INTERP = { base: 0.035, jitter: 2.5, min: 0.04, max: NET.interpolationDelay, ahead: 0.25, smooth: 0.1, maxTurn: 8 };
/**
 * Round-trip measurement: the client times the relay's reply to a `lobbies` request (one every `every` seconds),
 * which needs no relay change. `weight` is how much each new sample moves the smoothed value.
 */
export const PING = { every: 5, weight: 0.3, stale: 10 };
/**
 * This client's own count of what it sends, kept a little under the relay's limit (NET.maxRate, burst NET.burst).
 * Regular traffic always goes; optional early sends (an fx flush right after firing, hits right after landing them)
 * go only while at least `reserve` messages are spare, so the relay never throttles this pilot.
 */
export const BUDGET = { rate: NET.maxRate - 4, burst: 24, reserve: 6 };
type PoseError = { x: number; y: number; angle: number; at: number };
export type Peer = { id: string; name: string; samples: { at: number; s: ShipState }[]; blocks: ShipBlock[]; /** Smoothed seconds between updates, and jitter around that. */ gap?: number; jitter?: number; error?: PoseError };
export type PeerPose = ShipState & { id: string; name: string; blocks: ShipBlock[] };
export type NetStatus = 'offline' | 'connecting' | 'online' | 'error';
type SocketLike = { readyState: number; send(text: string): void; close(): void; addEventListener(type: string, listener: (event: { data?: unknown }) => void): void };

export class NetClient {
  modularPvp=false;
  private modularQueue:ClientMessage[]=[];private modularSending=false;
  private modularParts?:{requestId:string;total:number;parts:(string|undefined)[];bytes:number};
  private flushModular(){if(this.modularSending)return;this.modularSending=true;const flush=()=>{if(!this.connected){this.modularQueue=[];this.modularSending=false;return;}let sent=0;while(this.modularQueue.length&&this.spare()>=BUDGET.reserve&&sent++<2)this.raw(this.modularQueue.shift()!);if(this.modularQueue.length)setTimeout(flush,100);else this.modularSending=false;};flush();}

  private modularWaiting=new Map<string,{resolve:(data:unknown)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  modularRequest(action:'sync'|'ack',data:unknown):Promise<unknown>{
    if(!this.connected||!this.modularPvp)return Promise.reject(Error('Modular PvP relay unavailable.'));
    const requestId=globalThis.crypto.randomUUID();
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.modularWaiting.delete(requestId);reject(Error('Combat ledger response pending.'));},30000);this.modularWaiting.set(requestId,{resolve,reject,timer});const payload=JSON.stringify(data);if(payload.length>3000){const total=Math.ceil(payload.length/3000);if(total>512){clearTimeout(timer);this.modularWaiting.delete(requestId);reject(Error('Combat manifest exceeds the transfer byte budget.'));return;}for(let index=0;index<total;index++)this.modularQueue.push({t:'modular-part',requestId,action,index,total,data:payload.slice(index*3000,(index+1)*3000)});this.flushModular();}else if(!this.raw({t:'modular',requestId,action,data})){clearTimeout(timer);this.modularWaiting.delete(requestId);reject(Error('Combat ledger disconnected.'));}});
  }
  crewSupported=false;crewState?:CrewClientState;pilotId?:string;
  onCrewState:()=>void=()=>{};onCrewIdentity:()=>void=()=>{};
  private credentialKey='';private credential?:string;
  private crewParts?:{id:string;total:number;parts:(string|undefined)[];bytes:number;at:number};
  private crewWaiting=new Map<string,{resolve:(result:CrewResult)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  crewRequest(action:string,data:unknown={},requestId:string=globalThis.crypto?.randomUUID?.()??`crew-${Date.now()}-${Math.random().toString(36).slice(2)}`):Promise<CrewResult>{
    if(!this.connected||!this.crewSupported||!this.pilotId)return Promise.reject(Error('Crew service is unavailable. Reconnect to a crew-enabled relay.'));
    const waiting=this.crewWaiting.get(requestId);if(waiting)return Promise.reject(Error('This request is already pending.'));
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.crewWaiting.delete(requestId);reject(Error('Crew request timed out; outcome is unknown. Retry with the same request ID.'));},15000);this.crewWaiting.set(requestId,{resolve,reject,timer});if(!this.raw({t:'crew',requestId,action,data})){clearTimeout(timer);this.crewWaiting.delete(requestId);reject(Error('Disconnected; outcome is unknown. Retry with the same request ID.'));}});
  }

  status: NetStatus = 'offline';
  note = '';
  id?: string;
  lobby?: LobbyInfo;
  peers = new Map<string, Peer>();
  /** Called when the lobby's world (the host's sector) changes, or the lobby ends (null). */
  onLobbyWorld: (world: WorldRef | null, lobby?: LobbyInfo) => void = () => {};
  onNote: (text: string) => void = () => {};
  /** The open lobby list and online pilot count, from the last `requestLobbies`. */
  lobbyList: LobbySummary[] = [];
  online = 0;
  onLobbies: () => void = () => {};
  /** Shared-sector traffic from other pilots in this room (already filtered to the current room). */
  onCast: (from: string, kind: CastKind, data: unknown) => void = () => {};
  onDirect: (from: string, kind: DirectKind, data: unknown) => void = () => {};
  onUndelivered: (to: string, kind: DirectKind) => void = () => {};
  /** Lobby-wide messages (resource sharing), from members in any sector. */
  onParty: (from: string, kind: PartyKind, data: unknown) => void = () => {};
  onPartyUndelivered: (to: string, kind: PartyKind) => void = () => {};
  /** A relay admin's command (src/adminControl.ts); answer it with `adminAck`. */
  onAdmin: (ref: number, command: AdminCommand) => void = () => {};
  /** A pilot left this sector (or went offline). */
  onGone: (id: string) => void = () => {};
  /** Who runs enemies in this sector and how many pilots are here; undefined until the relay says. */
  room?: { authority: string; members: number; watched?: boolean };
  /** Rock claim leases held from the relay. */
  claims = new ClaimBook();
  /** True when this sector is shared with at least one other pilot. */
  get sharing() { return this.connected && (this.room?.members ?? 0) > 1; }
  get authority() { return this.room?.authority === this.id; }
  /** Alone in a sector an admin is watching: the game sends a presentation-only feed (src/sharedLink.ts) but keeps single-player rules. */
  get observed() { return this.connected && !this.sharing && Boolean(this.room?.watched) && this.authority; }
  /** Seed of the sector world this client last reported (its room). */
  get sectorSeed() { return this.sector?.seed; }
  private socket?: SocketLike;
  private pending: ClientMessage[] = [];
  private sector?: WorldRef;
  private lastState = -Infinity;
  private lastBlocks = '';
  private lastBlocksAt = -Infinity;
  private name = 'Pilot';
  private open: (url: string) => SocketLike;
  /** Seconds, for ping and the send budget (tests may replace it). */
  clock = () => performance.now() / 1000;
  /** Smoothed round trip to the relay in seconds; undefined until measured. */
  rtt?: number;
  private pingAsked: number[] = [];
  private lastPing = -Infinity;
  private tokens: number = BUDGET.burst;
  private refilled = -Infinity;
  constructor(open: (url: string) => SocketLike = url => new WebSocket(url) as unknown as SocketLike) { this.open = open; }

  get connected() { return this.status === 'online'; }
  get inLobby() { return Boolean(this.lobby); }
  get isHost() { return Boolean(this.lobby && this.lobby.host === this.id); }

  connect(url: string, name: string) {
    this.name = name;
    try{this.credentialKey=`voidforge.crew.identity:${new URL(url).origin}`;this.credential=localStorage.getItem(this.credentialKey)??undefined;}catch{/* Storage can be unavailable. */}
    if (this.socket && this.status !== 'error' && this.status !== 'offline') return;
    this.status = 'connecting'; this.setNote(`Connecting to ${url}…`);
    let socket: SocketLike;
    try { socket = this.open(url); } catch { this.status = 'error'; this.setNote('Could not open a connection to the relay.'); return; }
    this.socket = socket;
    socket.addEventListener('open', () => {
      if (this.socket !== socket) return;
      this.raw({ t: 'hello', v: NET.version, name: this.name });
      if (this.sector) this.raw({ t: 'sector', world: this.sector, owner: this.owner || undefined });
      for (const m of this.pending.splice(0)) this.raw(m);
    });
    socket.addEventListener('message', event => { if (this.socket === socket) this.receive(String(event.data)); });
    socket.addEventListener('close', () => { if (this.socket === socket) this.dropped(this.status === 'online' ? 'Disconnected from the relay.' : 'Could not reach the relay.'); });
    socket.addEventListener('error', () => { if (this.socket === socket && this.status === 'connecting') this.status = 'error'; });
  }
  disconnect() { const socket = this.socket; this.socket = undefined; socket?.close(); this.dropped('Offline.'); }
  /**
   * Stays connected: connects now and, whenever the connection drops, tries again after RECONNECT.first
   * seconds, doubling up to RECONNECT.max. `goOffline` stops that.
   */
  stayOnline(url: string, name: string) {
    this.keepOnline = { url }; this.retryDelay = RECONNECT.first; clearTimeout(this.retryTimer);
    this.connect(url, name);
  }
  goOffline() { this.keepOnline = undefined; clearTimeout(this.retryTimer); this.disconnect(); this.setNote('Playing offline.'); }
  get staysOnline() { return Boolean(this.keepOnline); }
  private keepOnline?: { url: string };
  private retryDelay: number = RECONNECT.first;
  private retryTimer?: ReturnType<typeof setTimeout>;
  /** Changes the pilot name other players see. */
  rename(name: string) { this.name = name; if (this.connected) this.raw({ t: 'hello', v: NET.version, name }); }
  get pilotName() { return this.name; }
  /** `open` lobbies are listed for everyone to join; private ones only by code or invite link. */
  create(open = true) { this.send({ t: 'create', open: open || undefined }); }
  setOpen(open: boolean) { if (this.isHost) this.raw({ t: 'open', open }); }
  requestLobbies() { if (this.connected) this.askLobbies(); }
  /** Sends a `lobbies` request and remembers when, so the reply also measures the round trip. */
  private askLobbies() { const at = this.clock(); if (this.raw({ t: 'lobbies' })) { this.pingAsked.push(at); this.lastPing = at; if (this.pingAsked.length > 8) this.pingAsked.shift(); } }
  /** Call every frame: keeps the round-trip measurement fresh (one small request every PING.every seconds). */
  heartbeat(now = this.clock()) { if (this.connected && now - this.lastPing >= PING.every) this.askLobbies(); }
  /** Round trip in whole milliseconds, or undefined while offline or not yet measured. */
  get pingMs() { return this.connected && this.rtt !== undefined ? Math.round(this.rtt * 1000) : undefined; }
  /** Messages this client could still send right now without nearing the relay's limit. */
  spare(now = this.clock()) { this.refill(now); return this.tokens; }
  private refill(now: number) {
    if (this.refilled === -Infinity) this.refilled = now;
    this.tokens = Math.min(BUDGET.burst, this.tokens + Math.max(0, now - this.refilled) * BUDGET.rate); this.refilled = now;
  }
  private spend() { this.refill(this.clock()); this.tokens = Math.max(-BUDGET.burst, this.tokens - 1); }
  /** Sends to one lobby member, or (no `to`) all the others. Returns false when not in a lobby. */
  party(to: string | undefined, kind: PartyKind, data: unknown) { if (!this.connected || !this.lobby) return false; this.raw({ t: 'party', to, k: kind, d: data }); return true; }
  join(code: string) { this.send({ t: 'join', code }); }
  /** Answers a relay admin command (broadcast notices use ref 0 and need no answer). */
  adminAck(ref: number, ok: boolean, message?: string, data?: unknown) { if (ref && this.connected) this.raw({ t: 'admin-ack', ref, ok, message, data }); }
  leave() { if (this.lobby) this.send({ t: 'leave' }); }

  /** Which sector world the ship is in (`owner` when it is the pilot's own sector). Changing it clears the previous room's ships, claims and authority. */
  setSector(world: WorldRef, owner = false) {
    if (this.sector && this.sector.seed === world.seed && this.sector.x === world.x && this.sector.y === world.y && this.sector.home === world.home && this.owner === owner) return;
    if (this.sector?.seed !== world.seed) { this.peers.clear(); this.claims.clear(); this.room = undefined; }
    this.sector = { ...world }; this.owner = owner;
    // Sent as soon as the socket is open (raw() waits for that), not only after `welcome`: a sector set in between would otherwise never reach the relay.
    this.raw({ t: 'sector', world: this.sector, owner: owner || undefined });
  }
  private owner = false;
  private profileSent = '';
  private matchWaiting?: (found: { world: WorldRef; name?: string } | null) => void;
  /** Tells the relay this pilot's home and progression, when either changes. */
  profile(home: string, power: number) {
    const key = `${home}|${power}`; if (!this.connected || key === this.profileSent) return;
    this.profileSent = key; this.raw({ t: 'profile', home, power });
  }
  /** Asks for a similar online pilot's home sector; resolves null offline, on no match, or after MATCH.wait. */
  match(exclude: string[], wait = MATCH.wait): Promise<{ world: WorldRef; name?: string } | null> {
    if (!this.connected) return Promise.resolve(null);
    this.matchWaiting?.(null);
    return new Promise(resolve => {
      const timer = setTimeout(() => { if (this.matchWaiting === done) this.matchWaiting = undefined; resolve(null); }, wait);
      const done = (found: { world: WorldRef; name?: string } | null) => { clearTimeout(timer); this.matchWaiting = undefined; resolve(found); };
      this.matchWaiting = done;
      this.raw({ t: 'match', exclude: exclude.slice(0, 64) });
    });
  }
  cast(kind: CastKind, data: unknown) { if (this.sharing || this.observed) this.raw({ t: 'cast', k: kind, d: data }); }
  direct(to: string, kind: DirectKind, data: unknown) { if (this.sharing) this.raw({ t: 'direct', to, k: kind, d: data }); }
  /** Sends queued claim requests; call once per frame while sharing. */
  flushClaims() { if (!this.sharing) return; const ids = this.claims.take(); if (ids.length) this.raw({ t: 'claim', ids }); }
  /** Sends ship state at NET.stateHz; the block layout only when it changes or every two seconds. */
  sendState(now: number, state: ShipState) {
    if (!this.connected || !this.sector || now - this.lastState < 1 / NET.stateHz) return;
    this.lastState = now;
    // Rounded on the wire: a tenth of a unit and a thousandth of a radian are below what anyone can see.
    const r = (n: number, k = 10) => Math.round(n * k) / k;
    const s: ShipState = { ...state, x: r(state.x), y: r(state.y), vx: r(state.vx), vy: r(state.vy), angle: r(state.angle, 1000), health: r(state.health), maxHealth: r(state.maxHealth) }, blocks = JSON.stringify(state.blocks ?? []);
    if (blocks !== this.lastBlocks || now - this.lastBlocksAt > 2) { this.lastBlocks = blocks; this.lastBlocksAt = now; } else delete s.blocks;
    if (this.socket?.readyState === 1) { this.spend(); this.socket.send(JSON.stringify({ t: 'state', s: packState(s) })); }
  }
  /** How far in the past this pilot's ship is drawn: adapts to how regularly its updates arrive. */
  delayFor(peer: Peer) { return Math.min(INTERP.max, Math.max(INTERP.min, INTERP.base + INTERP.jitter * (peer.jitter ?? 0.02))); }
  /**
   * Where each remote ship is drawn now: `delayFor` seconds in the past, blended between the two samples around
   * that time, or carried forward on its velocity (and turn rate) past the newest one, plus what is left of the
   * last correction (see INTERP).
   */
  poses(now: number): PeerPose[] {
    const result: PeerPose[] = [];
    for (const [id, peer] of this.peers) {
      const last = peer.samples[peer.samples.length - 1];
      if (!last || now - last.at > NET.peerTimeout) { this.peers.delete(id); continue; }
      const s = this.rawPose(peer, now), e = this.errorAt(peer, now);
      if (e) { s.x += e.x; s.y += e.y; s.angle += e.angle; }
      result.push({ ...s, id, name: peer.name, blocks: peer.blocks });
    }
    return result;
  }
  /** One remote ship's drawn pose, if known. */
  pose(id: string, now: number) { return this.poses(now).find(p => p.id === id); }
  private rawPose(peer: Peer, now: number): ShipState {
    const samples = peer.samples, last = samples[samples.length - 1], target = now - this.delayFor(peer);
    const after = samples.findIndex(sample => sample.at >= target);
    if (after > 0) {
      const a = samples[after - 1], b = samples[after], t = (target - a.at) / Math.max(1e-6, b.at - a.at);
      let turn = b.s.angle - a.s.angle; turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      return { ...b.s, x: a.s.x + (b.s.x - a.s.x) * t, y: a.s.y + (b.s.y - a.s.y) * t, angle: a.s.angle + turn * t };
    }
    if (after === 0) return { ...samples[0].s };
    const ahead = Math.min(INTERP.ahead, target - last.at), prev = samples[samples.length - 2];
    if (ahead <= 0) return { ...last.s };
    // Turn rate from the last two samples, so a turning ship keeps turning instead of freezing its heading.
    let spin = 0;
    if (prev && last.at > prev.at) { const turn = last.s.angle - prev.s.angle; spin = Math.max(-INTERP.maxTurn, Math.min(INTERP.maxTurn, Math.atan2(Math.sin(turn), Math.cos(turn)) / (last.at - prev.at))); }
    return { ...last.s, x: last.s.x + last.s.vx * ahead, y: last.s.y + last.s.vy * ahead, angle: last.s.angle + spin * ahead };
  }
  /** What is left of the last correction at `now` (it fades out over about INTERP.smooth seconds). */
  private errorAt(peer: Peer, now: number) {
    const e = peer.error; if (!e) return;
    const k = Math.exp(-Math.max(0, now - e.at) / INTERP.smooth);
    if (k < 0.01) { peer.error = undefined; return; }
    return { x: e.x * k, y: e.y * k, angle: e.angle * k };
  }
  /** Feeds a relay message; public so tests can drive the client without a socket. */
  receive(raw: string, now = performance.now() / 1000) {
    const m = parseServer(raw); if (!m) return;
    switch (m.t) {
      case 'modular-result-part': {if(!this.modularWaiting.has(m.requestId))return;if(!this.modularParts||this.modularParts.requestId!==m.requestId)this.modularParts={requestId:m.requestId,total:m.total,parts:new Array(m.total),bytes:0};const p=this.modularParts;if(p.total!==m.total)return;if(p.parts[m.index]===undefined){p.parts[m.index]=m.data;p.bytes+=m.data.length;}if(p.bytes>1536000){this.modularParts=undefined;return;}if(p.parts.filter(v=>v!==undefined).length===m.total){this.modularParts=undefined;this.receive(p.parts.join(''),now);}return;}
      case 'modular-result': {const wait=this.modularWaiting.get(m.requestId);if(wait){clearTimeout(wait.timer);this.modularWaiting.delete(m.requestId);if(m.ok)wait.resolve(m.data);else wait.reject(Error(m.error??'Combat request rejected.'));}return;}
      case 'welcome': this.modularPvp=m.modularPvp===1;this.id = m.id; this.status = 'online'; this.retryDelay = RECONNECT.first; this.setNote('Online.'); this.askLobbies();this.crewSupported=m.crewProtocol===1;if(this.crewSupported)this.raw({t:'crew-auth',credential:this.credential});this.onCrewState();return;
      case 'crew-identity': this.pilotId=m.pilotId;this.credential=m.credential;try{localStorage.setItem(this.credentialKey,m.credential);}catch{/* Keep identity in memory when storage is disabled. */}this.onCrewIdentity();return;
      case 'crew-state-part': {
        if(m.total<1||m.total>256||m.index<0||m.index>=m.total||m.data.length>9000)return;
        if(!this.crewParts||this.crewParts.id!==m.transferId||now-this.crewParts.at>30)this.crewParts={id:m.transferId,total:m.total,parts:new Array(m.total),bytes:0,at:now};
        const transfer=this.crewParts;if(transfer.total!==m.total)return;if(transfer.parts[m.index]===undefined){transfer.parts[m.index]=m.data;transfer.bytes+=new TextEncoder().encode(m.data).length;}
        if(transfer.bytes>2*1024*1024){this.crewParts=undefined;return;}if(transfer.parts.filter(p=>p!==undefined).length===m.total){this.crewParts=undefined;try{this.receive(JSON.stringify({t:'crew-state',state:JSON.parse(transfer.parts.join(''))}),now);}catch{/* Reject incomplete/invalid snapshots. */}}return;
      }
      case 'crew-state': this.crewState=m.state;this.pilotId=m.state.pilotId;this.onCrewState();return;
      case 'crew-result': {const waiting=this.crewWaiting.get(m.requestId);if(waiting){clearTimeout(waiting.timer);this.crewWaiting.delete(m.requestId);waiting.resolve(m);}return;}

      case 'lobbies': {
        // The relay answers requests in order, so this reply belongs to the oldest one still waiting.
        const asked = this.pingAsked.shift(), at = this.clock();
        if (asked !== undefined && at - asked < PING.stale) { const sample = at - asked; this.rtt = this.rtt === undefined ? sample : this.rtt + (sample - this.rtt) * PING.weight; }
        this.lobbyList = m.list; this.online = m.online; this.onLobbies(); return;
      }
      case 'error': this.setNote(m.message); return;
      case 'gone': this.peers.delete(m.id); this.onGone(m.id); return;
      case 'room': this.room = { authority: m.authority, members: m.members, watched: m.watched }; return;
      case 'claims': this.claims.grant(m.ok, m.denied, m.lease, now); return;
      case 'undelivered': this.onUndelivered(m.to, m.k); return;
      case 'party': this.onParty(m.from, m.k, m.d); return;
      case 'party-undelivered': this.onPartyUndelivered(m.to, m.k); return;
      case 'admin': this.onAdmin(m.ref, m.c); return;
      case 'match': this.matchWaiting?.(m.world ? { world: m.world, name: m.name } : null); return;
      case 'cast': if (this.sector && m.r === roomTag(this.sector.seed)) this.onCast(m.from, m.k, m.d); return;
      case 'direct': if (this.sector && m.r === roomTag(this.sector.seed)) this.onDirect(m.from, m.k, m.d); return;
      case 'left-lobby': { const had = this.lobby; this.lobby = undefined; if (m.reason) this.setNote(m.reason); if (had) this.onLobbyWorld(null); return; }
      case 'lobby': {
        const before = this.lobby?.world?.seed, first = !this.lobby || this.lobby.code !== m.code;
        this.lobby = { code: m.code, host: m.host, members: m.members, world: m.world, open: m.open };
        if (first) this.setNote(m.host === this.id ? `Lobby ${m.code} created. Share the invite link.` : `Joined lobby ${m.code}.`);
        if (m.world && (first || m.world.seed !== before)) this.onLobbyWorld(m.world, this.lobby);
        return;
      }
      case 'state': {
        if (!this.sector || m.r !== roomTag(this.sector.seed)) return; // Sent before we changed sector.
        let peer = this.peers.get(m.id);
        if (!peer) { peer = { id: m.id, name: m.name ?? 'Pilot', samples: [], blocks: [] }; this.peers.set(m.id, peer); }
        if (m.name) peer.name = m.name; if (m.s.blocks) peer.blocks = m.s.blocks;
        const prior = peer.samples[peer.samples.length - 1];
        // Where the ship was drawn just before this sample, so the change it makes is eased in rather than snapped.
        const before = prior ? this.rawPose(peer, now) : undefined, left = this.errorAt(peer, now);
        if (prior) {
          // Arrival rhythm: how far apart updates come and how irregular that is, for the adaptive delay.
          const gap = now - prior.at;
          if (gap > 0 && gap < 1) { peer.gap = peer.gap === undefined ? gap : peer.gap + (gap - peer.gap) * 0.1; peer.jitter = peer.jitter === undefined ? 0.02 : peer.jitter + (Math.abs(gap - peer.gap) - peer.jitter) * 0.1; }
        }
        peer.samples.push({ at: now, s: m.s }); if (peer.samples.length > 8) peer.samples.shift();
        if (before) {
          const after = this.rawPose(peer, now);
          let turn = before.angle + (left?.angle ?? 0) - after.angle; turn = Math.atan2(Math.sin(turn), Math.cos(turn));
          const dx = before.x + (left?.x ?? 0) - after.x, dy = before.y + (left?.y ?? 0) - after.y;
          // A big jump (respawn, sector entry) is not smoothed: the ship really is somewhere else.
          peer.error = Math.hypot(dx, dy) < 300 ? { x: dx, y: dy, angle: turn, at: now } : undefined;
        }
        return;
      }
    }
  }
  private send(m: ClientMessage) { if (this.connected) this.raw(m); else this.pending.push(m); }
  private raw(m: ClientMessage) {
    if (!this.socket || this.socket.readyState !== 1) return false;
    // The relay closes a connection that sends an oversized frame, so never send one.
    const text = JSON.stringify(m);
    if (text.length > NET.maxMessage / 4 && new TextEncoder().encode(text).length > NET.maxMessage - 16) { this.oversized++; return false; }
    this.spend(); this.socket.send(text); return true;
  }
  /** Messages dropped locally because they were too large to send. */
  oversized = 0;
  private dropped(text: string) {
    this.modularPvp=false;this.modularQueue=[];this.modularParts=undefined;for(const w of this.modularWaiting.values()){clearTimeout(w.timer);w.reject(Error('Combat transport disconnected; receipt status unknown.'));}this.modularWaiting.clear();
    this.crewParts=undefined;this.crewSupported=false;this.crewState=undefined;this.pilotId=undefined;for(const [requestId,w]of this.crewWaiting){clearTimeout(w.timer);w.reject(Error('Disconnected; outcome is unknown. Retry with the same request ID.'));}this.crewWaiting.clear();this.onCrewState();
    const had = this.lobby;
    this.status = 'offline'; this.socket = undefined; this.id = undefined; this.lobby = undefined; this.peers.clear(); this.pending = []; this.pingAsked = []; this.lastPing = -Infinity; this.room = undefined; this.claims.clear(); this.profileSent = ''; this.matchWaiting?.(null);
    if (this.keepOnline && text !== 'Offline.') {
      // Staying online: try again shortly, backing off while the relay is unreachable.
      const url = this.keepOnline.url, delay = this.retryDelay; this.retryDelay = Math.min(RECONNECT.max, delay * 2);
      clearTimeout(this.retryTimer); this.retryTimer = setTimeout(() => { if (this.keepOnline && this.status !== 'online' && this.status !== 'connecting') this.connect(url, this.name); }, delay * 1000);
      text += ` Retrying in ${delay}s.`;
    }
    this.setNote(text);
    if (had) this.onLobbyWorld(null);
  }
  private setNote(text: string) { this.note = text; this.onNote(text); }
}

/**
 * Relay address. `?relay=` is for local testing and only accepts a relay on this computer, so a crafted
 * invite link cannot send a pilot's name and position to an unknown server. Otherwise the hosted relay.
 */
export function relayUrl(search: string) {
  const param = new URLSearchParams(search).get('relay');
  return param && /^wss?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(param) ? param : NET.defaultRelay;
}
export function inviteLink(origin: string, pathname: string, code: string) { return `${origin}${pathname}?join=${encodeURIComponent(code)}`; }
