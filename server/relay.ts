import { createServer as createHttp, type Server } from 'node:http';
import { createServer as createHttps } from 'node:https';
import { randomBytes, randomInt } from 'node:crypto';
import { upgrade, textFrame, type WebSocketPeer } from './websocket.ts';
import { NET, CLAIMS, MATCH, packState, parseClient, roomTag, type ClientMessage, type Member, type ServerMessage, type WorldRef } from '../src/netProtocol.ts';

/**
 * VOIDFORGE relay: lobbies plus per-sector rooms. It never simulates the game; each client runs its
 * own model and the relay forwards ship state to the other clients in the same sector (the room key
 * is the sector's world seed). That keeps the per-player cost small, which is what lets one relay aim
 * at many concurrent players. Lobbies hold up to NET.maxLobby pilots sharing the host's world.
 */
type Client = { at?: { x: number; y: number }; /** Last reported ship state was destroyed: such a pilot's game is not simulating, so it never runs a room. */ dead?: boolean; profile?: { home: string; power: number }; id: string; name: string; peer: WebSocketPeer; room?: string; world?: WorldRef; owner?: boolean; joined: number; lobby?: Lobby; tokens: number; refilled: number; dropped: number };
/** A sector room: its pilots, who runs its enemies, and rock claim leases (rock id -> holder and expiry). */
type Room = { clients: Set<Client>; authority?: Client; claims: Map<number, { holder: Client; until: number }> };
type Lobby = { code: string; host: Client; members: Set<Client>; open?: boolean };
export type RelayOptions = { port?: number; host?: string; tls?: { cert: string | Buffer; key: string | Buffer }; origins?: string[] };
export type RelayStats = { clients: number; rooms: number; lobbies: number; messagesIn: number; framesOut: number; bytesOut: number; skipped: number; uptime: number; rssMb: number; cpuMs: number };
export type Relay = { server: Server; port: number; close(): Promise<void>; stats(): RelayStats };

/** Origins allowed to open a socket: the live site and local development by default. */
export const DEFAULT_ORIGINS = ['https://n4styn8.github.io', 'http://localhost', 'http://127.0.0.1'];
export function originAllowed(origin: string | undefined, allowed: string[]) {
  if (!origin) return true; // Non-browser clients (tests, tools) send no Origin.
  return allowed.some(a => origin === a || (a.startsWith('http://localhost') || a.startsWith('http://127.0.0.1')) && origin.startsWith(a + ':'));
}

export function startRelay(options: RelayOptions = {}): Promise<Relay> {
  const clients = new Set<Client>(), rooms = new Map<string, Room>(), lobbies = new Map<string, Lobby>();
  let joins = 0;
  // Totals since start, for /stats and load tests.
  const counters = { messagesIn: 0, framesOut: 0, bytesOut: 0, skipped: 0 }, started = Date.now();
  const stats = (): RelayStats => { const cpu = process.cpuUsage(); return { clients: clients.size, rooms: rooms.size, lobbies: lobbies.size, ...counters, uptime: Math.round((Date.now() - started) / 1000), rssMb: Math.round(process.memoryUsage().rss / 1048576), cpuMs: Math.round((cpu.user + cpu.system) / 1000) }; };
  /** Writes one pre-built frame to each recipient. Replaceable traffic (ship state) skips clients with a backed-up socket. */
  const broadcast = (recipients: Iterable<Client>, text: string, replaceable = false) => {
    let frame: Buffer | undefined;
    for (const other of recipients) {
      if (replaceable && other.peer.backlog > NET.backlog) { counters.skipped++; continue; }
      frame ??= textFrame(text); other.peer.sendFrame(frame); counters.framesOut++; counters.bytesOut += frame.length;
    }
  };
  const allowed = options.origins ?? DEFAULT_ORIGINS;
  const send = (c: Client, m: ServerMessage) => { const frame = textFrame(JSON.stringify(m)); c.peer.sendFrame(frame); counters.framesOut++; counters.bytesOut += frame.length; };
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
    room.authority = choice;
    if (choice) for (const c of room.clients) send(c, { t: 'room', authority: choice.id, members: room.clients.size });
    void key;
  }
  function leaveRoom(c: Client) {
    if (!c.room) return;
    const key = c.room, room = rooms.get(key);
    c.room = undefined;
    if (!room) return;
    room.clients.delete(c);
    for (const [id, claim] of room.claims) if (claim.holder === c) room.claims.delete(id);
    if (!room.clients.size) { rooms.delete(key); return; }
    for (const other of room.clients) send(other, { t: 'gone', id: c.id });
    elect(key, room);
  }
  function leaveLobby(c: Client, reason: string, notify = true) {
    const lobby = c.lobby; if (!lobby) return;
    lobby.members.delete(c); c.lobby = undefined;
    if (notify) send(c, { t: 'left-lobby', reason });
    if (!lobby.members.size) { lobbies.delete(lobby.code); return; }
    if (lobby.host === c) lobby.host = lobby.members.values().next().value!;
    announce(lobby);
    for (const m of lobby.members) if (m.room) { const room = rooms.get(m.room); if (room) elect(m.room, room); }
  }
  function handle(c: Client, m: ClientMessage) {
    switch (m.t) {
      case 'hello':
        if (m.v !== NET.version) { send(c, { t: 'error', message: 'This game version does not match the relay. Reload the page.' }); c.peer.close(4000); return; }
        c.name = m.name; if (c.lobby) announce(c.lobby); return;
      case 'create': {
        leaveLobby(c, 'You started a new lobby.', false);
        const lobby: Lobby = { code: newCode(), host: c, members: new Set([c]), open: m.open };
        lobbies.set(lobby.code, lobby); c.lobby = lobby; announce(lobby); return;
      }
      case 'join': {
        const lobby = lobbies.get(m.code);
        if (!lobby) { send(c, { t: 'error', message: `No lobby with code ${m.code || '(empty)'}.` }); return; }
        if (lobby === c.lobby) { announce(lobby); return; }
        if (lobby.members.size >= NET.maxLobby) { send(c, { t: 'error', message: 'That lobby is full.' }); return; }
        leaveLobby(c, 'You joined another lobby.', false);
        lobby.members.add(c); c.lobby = lobby; announce(lobby); return;
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
        if (c.room !== m.world.seed) {
          leaveRoom(c); c.room = m.world.seed; c.joined = ++joins; c.owner = owner;
          let room = rooms.get(c.room); if (!room) rooms.set(c.room, room = { clients: new Set(), claims: new Map() });
          room.clients.add(c); elect(c.room, room);
        } else if (c.owner !== owner) { c.owner = owner; elect(c.room, rooms.get(c.room)!); }
        c.world = m.world;
        if (c.lobby?.host === c) announce(c.lobby);
        return;
      }
      case 'state': {
        if (!c.room) return;
        c.at = { x: m.s.x, y: m.s.y };
        if (Boolean(m.s.dead) !== Boolean(c.dead)) { c.dead = Boolean(m.s.dead) || undefined; const room = rooms.get(c.room); if (room) elect(c.room, room); }
        // Interest management: only pilots near enough to see or chart this ship get its state.
        const near = [...rooms.get(c.room)?.clients ?? []].filter(other => other !== c && (!other.at || Math.abs(other.at.x - m.s.x) < NET.interest && Math.abs(other.at.y - m.s.y) < NET.interest));
        broadcast(near, JSON.stringify({ t: 'state', id: c.id, name: m.s.blocks ? c.name : undefined, r: roomTag(c.room), s: packState(m.s) }), true);
        return;
      }
      case 'cast': {
        if (!c.room) return;
        broadcast([...rooms.get(c.room)?.clients ?? []].filter(other => other !== c), JSON.stringify({ t: 'cast', from: c.id, r: roomTag(c.room), k: m.k, d: m.d } satisfies ServerMessage));
        return;
      }
      case 'direct': {
        if (!c.room) return;
        const target = [...rooms.get(c.room)?.clients ?? []].find(other => other.id === m.to && other !== c);
        if (target) send(target, { t: 'direct', from: c.id, r: roomTag(c.room), k: m.k, d: m.d }); else send(c, { t: 'undelivered', to: m.to, k: m.k });
        return;
      }
      case 'claim': {
        const room = c.room ? rooms.get(c.room) : undefined; if (!room) return;
        const now = Date.now(), ok: number[] = [], denied: number[] = [];
        for (const id of m.ids) {
          const claim = room.claims.get(id);
          if (!claim || claim.holder === c || claim.until <= now || !room.clients.has(claim.holder)) { room.claims.set(id, { holder: c, until: now + CLAIMS.lease }); ok.push(id); } else denied.push(id);
        }
        if (room.claims.size > 4096) for (const [id, claim] of room.claims) if (claim.until <= now) room.claims.delete(id);
        send(c, { t: 'claims', ok, denied, lease: CLAIMS.lease });
        return;
      }
    }
  }
  /** Token bucket: drops messages over the rate and closes clients that keep flooding. */
  function admit(c: Client) {
    const now = Date.now();
    c.tokens = Math.min(NET.burst, c.tokens + (now - c.refilled) / 1000 * NET.maxRate); c.refilled = now;
    if (c.tokens >= 1) { c.tokens--; c.dropped = Math.max(0, c.dropped - 1); return true; }
    if (++c.dropped > NET.maxRate * NET.abuse) c.peer.close(1008);
    return false;
  }

  const listener = (request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => {
    if (request.url === '/stats') { response.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); response.end(JSON.stringify(stats())); return; }
    response.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
    response.end(`VOIDFORGE relay v${NET.version}: ${clients.size} online, ${rooms.size} sectors, ${lobbies.size} lobbies\n`);
  };
  const server = options.tls ? createHttps(options.tls, listener) : createHttp(listener);
  server.on('upgrade', (request, socket) => {
    const peer = upgrade(request, socket, NET.maxMessage, origin => originAllowed(origin, allowed)); if (!peer) return;
    const c: Client = { id: randomBytes(6).toString('hex'), name: 'Pilot', peer, joined: 0, tokens: NET.burst, refilled: Date.now(), dropped: 0 };
    clients.add(c);
    peer.onmessage = text => { counters.messagesIn++; if (!admit(c)) return; const m = parseClient(text); if (m) handle(c, m); };
    peer.onclose = () => { clients.delete(c); leaveRoom(c); leaveLobby(c, '', false); };
    send(c, { t: 'welcome', id: c.id });
  });
  const keepAlive = setInterval(() => { for (const c of clients) { if (!c.peer.alive) { c.peer.close(1001); continue; } c.peer.alive = false; c.peer.ping(); } }, NET.ping * 1000);
  keepAlive.unref();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 8787, options.host ?? '0.0.0.0', () => {
      const address = server.address(), port = typeof address === 'object' && address ? address.port : options.port ?? 8787;
      resolve({ server, port, stats,
        close: () => new Promise(done => { clearInterval(keepAlive); for (const c of clients) c.peer.close(1001); server.close(() => done()); }) });
    });
  });
}
