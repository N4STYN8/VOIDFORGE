import { NET, MATCH, packState, parseServer, roomTag, type CastKind, type ClientMessage, type DirectKind, type LobbySummary, type Member, type ShipBlock, type ShipState, type WorldRef } from './netProtocol.ts';
import { ClaimBook } from './shared.ts';

/**
 * Browser side of the relay connection. No Phaser or DOM beyond WebSocket; time is passed in (seconds),
 * so it can be driven from tests. The game keeps running offline whatever happens here.
 */
export type LobbyInfo = { code: string; host: string; members: Member[]; world: WorldRef | null; open?: boolean };
/** Seconds between reconnect attempts while staying online: doubling from the first, up to the last. */
export const RECONNECT = { first: 2, max: 30 };
export type Peer = { id: string; name: string; samples: { at: number; s: ShipState }[]; blocks: ShipBlock[] };
export type PeerPose = ShipState & { id: string; name: string; blocks: ShipBlock[] };
export type NetStatus = 'offline' | 'connecting' | 'online' | 'error';
type SocketLike = { readyState: number; send(text: string): void; close(): void; addEventListener(type: string, listener: (event: { data?: unknown }) => void): void };

export class NetClient {
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
  /** Who runs enemies in this sector and how many pilots are here; undefined until the relay says. */
  room?: { authority: string; members: number };
  /** Rock claim leases held from the relay. */
  claims = new ClaimBook();
  /** True when this sector is shared with at least one other pilot. */
  get sharing() { return this.connected && (this.room?.members ?? 0) > 1; }
  get authority() { return this.room?.authority === this.id; }
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
  constructor(open: (url: string) => SocketLike = url => new WebSocket(url) as unknown as SocketLike) { this.open = open; }

  get connected() { return this.status === 'online'; }
  get inLobby() { return Boolean(this.lobby); }
  get isHost() { return Boolean(this.lobby && this.lobby.host === this.id); }

  connect(url: string, name: string) {
    this.name = name;
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
  requestLobbies() { if (this.connected) this.raw({ t: 'lobbies' }); }
  join(code: string) { this.send({ t: 'join', code }); }
  leave() { if (this.lobby) this.send({ t: 'leave' }); }

  /** Which sector world the ship is in (`owner` when it is the pilot's own sector). Changing it clears the previous room's ships, claims and authority. */
  setSector(world: WorldRef, owner = false) {
    if (this.sector && this.sector.seed === world.seed && this.sector.x === world.x && this.sector.y === world.y && this.sector.home === world.home && this.owner === owner) return;
    if (this.sector?.seed !== world.seed) { this.peers.clear(); this.claims.clear(); this.room = undefined; }
    this.sector = { ...world }; this.owner = owner;
    if (this.connected) this.raw({ t: 'sector', world: this.sector, owner: owner || undefined });
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
  cast(kind: CastKind, data: unknown) { if (this.sharing) this.raw({ t: 'cast', k: kind, d: data }); }
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
    this.socket?.readyState === 1 && this.socket.send(JSON.stringify({ t: 'state', s: packState(s) }));
  }
  /** Remote ships drawn NET.interpolationDelay in the past, blended between the two samples around that time. */
  poses(now: number): PeerPose[] {
    const result: PeerPose[] = [], target = now - NET.interpolationDelay;
    for (const [id, peer] of this.peers) {
      const samples = peer.samples, last = samples[samples.length - 1];
      if (!last || now - last.at > NET.peerTimeout) { this.peers.delete(id); continue; }
      let s = last.s;
      const after = samples.findIndex(sample => sample.at >= target);
      if (after > 0) {
        const a = samples[after - 1], b = samples[after], t = (target - a.at) / Math.max(1e-6, b.at - a.at);
        let turn = b.s.angle - a.s.angle; turn = Math.atan2(Math.sin(turn), Math.cos(turn));
        s = { ...b.s, x: a.s.x + (b.s.x - a.s.x) * t, y: a.s.y + (b.s.y - a.s.y) * t, angle: a.s.angle + turn * t };
      } else if (after < 0) {
        const ahead = Math.min(0.25, target - last.at);
        if (ahead > 0) s = { ...last.s, x: last.s.x + last.s.vx * ahead, y: last.s.y + last.s.vy * ahead };
      } else s = samples[0].s;
      result.push({ ...s, id, name: peer.name, blocks: peer.blocks });
    }
    return result;
  }
  /** Feeds a relay message; public so tests can drive the client without a socket. */
  receive(raw: string, now = performance.now() / 1000) {
    const m = parseServer(raw); if (!m) return;
    switch (m.t) {
      case 'welcome': this.id = m.id; this.status = 'online'; this.retryDelay = RECONNECT.first; this.setNote('Online.'); this.raw({ t: 'lobbies' }); return;
      case 'lobbies': this.lobbyList = m.list; this.online = m.online; this.onLobbies(); return;
      case 'error': this.setNote(m.message); return;
      case 'gone': this.peers.delete(m.id); return;
      case 'room': this.room = { authority: m.authority, members: m.members }; return;
      case 'claims': this.claims.grant(m.ok, m.denied, m.lease, now); return;
      case 'undelivered': this.onUndelivered(m.to, m.k); return;
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
        peer.samples.push({ at: now, s: m.s }); if (peer.samples.length > 8) peer.samples.shift();
        return;
      }
    }
  }
  private send(m: ClientMessage) { if (this.connected) this.raw(m); else this.pending.push(m); }
  private raw(m: ClientMessage) {
    if (!this.socket || this.socket.readyState !== 1) return;
    // The relay closes a connection that sends an oversized frame, so never send one.
    const text = JSON.stringify(m);
    if (text.length > NET.maxMessage / 4 && new TextEncoder().encode(text).length > NET.maxMessage - 16) { this.oversized++; return; }
    this.socket.send(text);
  }
  /** Messages dropped locally because they were too large to send. */
  oversized = 0;
  private dropped(text: string) {
    const had = this.lobby;
    this.status = 'offline'; this.socket = undefined; this.id = undefined; this.lobby = undefined; this.peers.clear(); this.pending = []; this.room = undefined; this.claims.clear(); this.profileSent = ''; this.matchWaiting?.(null);
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
