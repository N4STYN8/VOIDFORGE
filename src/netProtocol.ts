/**
 * Wire protocol shared by the browser client (src/net.ts) and the relay (server/relay.ts).
 * Plain JSON text frames. No Phaser, DOM or Node imports, so both sides and the tests can use it.
 *
 * Rooms are sectors: a client tells the relay which sector world it is in (`sector`), and the relay
 * forwards ship `state` only to the other clients in that same sector. Lobbies are separate: a lobby
 * is a party of up to NET.maxLobby pilots that share the host's world, joined with a short code.
 */
export const NET = {
  version: 1,
  /** Ship state messages per second sent by each client. */
  stateHz: 10,
  /** Largest accepted text frame, in bytes. */
  maxMessage: 16384,
  /** Messages per second allowed per client (token bucket); `abuse` times that closes the socket. */
  maxRate: 30, burst: 60, abuse: 4,
  codeLength: 6, codeAlphabet: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
  maxLobby: 8, maxName: 24, maxSeed: 200,
  /** Remote ships are drawn this many seconds in the past so they move smoothly between updates. */
  interpolationDelay: 0.15,
  /** A remote ship with no update for this many seconds is removed. */
  peerTimeout: 5,
  /** Seconds between keep-alive pings from the relay. */
  ping: 20,
  defaultRelay: 'wss://voidforge.2dq.us',
  /** Relay forwards ship state only to pilots this close to the sender (world units); far ships are off every screen and radar. */
  interest: 7000,
  /** Ship state for a client whose socket has this many unsent bytes is skipped (the next update replaces it). */
  backlog: 256 * 1024,
} as const;

/** One ship block: equipment kind, grid x, grid y, level. The core is included at 0,0. */
export type ShipBlock = [kind: string, x: number, y: number, level: number];
export type ShipState = { x: number; y: number; vx: number; vy: number; angle: number; health: number; maxHealth: number; paint: number; dead?: boolean; thrust?: boolean; blocks?: ShipBlock[] };
/** A sector world: the grid owner's home seed, grid position, and that sector's own world seed (the room key). */
export type WorldRef = { home: string; x: number; y: number; seed: string; spot?: [number, number] };
/** `spot` is where the sender was when it entered that sector, so lobby members following the host arrive near it. */
export type Member = { id: string; name: string; host: boolean };
/** One open lobby in the public list: its code, host name, member count and the host's progression score (to find similar pilots). */
export type LobbySummary = { code: string; host: string; members: number; power?: number };

export type ClientMessage =
  | { t: 'hello'; v: number; name: string }
  /** `open` lobbies appear in the public list; private ones are joined only by code or invite link. */
  | { t: 'create'; open?: boolean }
  | { t: 'join'; code: string }
  /** The lobby host makes it open (listed) or private. */
  | { t: 'open'; open: boolean }
  /** Asks for the open lobby list and the online pilot count. */
  | { t: 'lobbies' }
  /** Lobby-wide data, wherever the members are: to one member (`to`) or all the others. */
  | { t: 'party'; to?: string; k: PartyKind; d: unknown }
  | { t: 'leave' }
  | { t: 'sector'; world: WorldRef; owner?: boolean }
  | { t: 'state'; s: ShipState }
  /** Shared-sector data for everyone else in the room (stage 3): rock changes, the authority's enemies and enemy shots. */
  | { t: 'cast'; k: CastKind; d: unknown }
  /** Shared-sector data for one pilot in the same room: hits on the authority's enemies, loot for the pilot who made a kill. */
  | { t: 'direct'; to: string; k: DirectKind; d: unknown }
  /** Rock claim leases: only the holder may change a rock, so two pilots never mine the same ore. */
  | { t: 'claim'; ids: number[] }
  /** Matchmaking (stage 5): this pilot's home sector seed and progression score. */
  | { t: 'profile'; home: string; power: number }
  /** Ask for an online pilot of similar progression to be the next sector, excluding homes already linked. */
  | { t: 'match'; exclude: string[] };

export type ServerMessage =
  | { t: 'welcome'; id: string }
  | { t: 'lobby'; code: string; host: string; members: Member[]; world: WorldRef | null; open?: boolean }
  | { t: 'lobbies'; online: number; list: LobbySummary[] }
  | { t: 'party'; from: string; k: PartyKind; d: unknown }
  /** A `party` message to a pilot who is no longer in the sender's lobby. */
  | { t: 'party-undelivered'; to: string; k: PartyKind }
  | { t: 'left-lobby'; reason: string }
  /** `name` rides only on updates that carry the block layout (every couple of seconds), to keep frames small. */
  | { t: 'state'; id: string; name?: string; r: string; s: ShipState }
  | { t: 'gone'; id: string }
  | { t: 'error'; message: string }
  /** Who runs enemies in this sector, and how many pilots are in it. */
  | { t: 'room'; authority: string; members: number }
  | { t: 'cast'; from: string; r: string; k: CastKind; d: unknown }
  | { t: 'direct'; from: string; r: string; k: DirectKind; d: unknown }
  | { t: 'claims'; ok: number[]; denied: number[]; lease: number }
  /** A `direct` message whose recipient is not in the sender's room any more. */
  | { t: 'undelivered'; to: string; k: DirectKind }
  | { t: 'match'; world: WorldRef | null; name?: string };
/** Neighbours are matched only within this progression ratio (larger score / smaller score). */
export const MATCH = { maxRatio: 1.75, wait: 1500 };
/** `fx` batches a pilot's frame traffic (own shots, bumped and changed rocks, and the authority's enemy fire and clock) into one message. */
export type CastKind = 'rocks' | 'enemies' | 'shots' | 'pvp' | 'fx';
/** `world-req` asks the sector authority for its copy of the sector; `world` carries it back in chunks. */
export type DirectKind = 'hit' | 'loot' | 'pvp-hit' | 'pvp-loot' | 'world-req' | 'world';
/** Lobby resource sharing: `pool` announces shared deposits, `take` asks a member for minerals, `give` sends them (or declines with none). */
export type PartyKind = 'pool' | 'take' | 'give';
const PARTY: readonly string[] = ['pool', 'take', 'give'];
const CASTS: readonly string[] = ['rocks', 'enemies', 'shots', 'pvp', 'fx'], DIRECTS: readonly string[] = ['hit', 'loot', 'pvp-hit', 'pvp-loot', 'world-req', 'world'];
/** Most rock ids one claim message may ask for, and how long a lease lasts (milliseconds). */
export const CLAIMS = { batch: 16, lease: 2500 };

/** Short tag of a room (sector seed) carried on forwarded state, so a client drops updates from a room it just left. FNV-1a. */
export function roomTag(seed: string) { let h = 0x811c9dc5; for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36); }
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const text = (s: unknown, max: number): s is string => typeof s === 'string' && s.length > 0 && s.length <= max;
export const cleanName = (name: string) => name.replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, NET.maxName) || 'Pilot';
export const normalizeCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, NET.codeLength);

function readWorld(w: unknown): WorldRef | undefined {
  const v = w as WorldRef;
  if (!v || !text(v.home, NET.maxSeed) || !text(v.seed, NET.maxSeed) || !Number.isSafeInteger(v.x) || !Number.isSafeInteger(v.y)) return;
  const world: WorldRef = { home: v.home, x: v.x, y: v.y, seed: v.seed };
  if (Array.isArray(v.spot) && v.spot.length === 2 && v.spot.every(finite)) world.spot = [v.spot[0], v.spot[1]];
  return world;
}
/**
 * Ship state on the wire: a fixed-order array, about 40% smaller than an object with key names:
 * [x, y, vx, vy, angle, health, maxHealth, paint, flags (1 dead, 2 thrust), blocks?]. Readers also accept the object form.
 */
export type PackedState = (number | ShipBlock[])[];
export function packState(s: ShipState): PackedState {
  const packed: PackedState = [s.x, s.y, s.vx, s.vy, s.angle, s.health, s.maxHealth, s.paint, (s.dead ? 1 : 0) | (s.thrust ? 2 : 0)];
  if (s.blocks) packed.push(s.blocks);
  return packed;
}
function readState(s: unknown): ShipState | undefined {
  if (Array.isArray(s)) {
    if (s.length < 9 || s.length > 10) return;
    const [x, y, vx, vy, angle, health, maxHealth, paint, flags, blocks] = s as number[];
    return readState({ x, y, vx, vy, angle, health, maxHealth, paint, dead: (flags & 1) === 1, thrust: (flags & 2) === 2, blocks: blocks as unknown as ShipBlock[] | undefined });
  }
  const v = s as ShipState;
  if (!v || ![v.x, v.y, v.vx, v.vy, v.angle, v.health, v.maxHealth].every(finite) || !Number.isInteger(v.paint)) return;
  const state: ShipState = { x: v.x, y: v.y, vx: v.vx, vy: v.vy, angle: v.angle, health: v.health, maxHealth: v.maxHealth, paint: v.paint };
  if (v.dead) state.dead = true;
  if (v.thrust) state.thrust = true;
  if (v.blocks !== undefined) {
    if (!Array.isArray(v.blocks) || v.blocks.length > 400 || !v.blocks.every(b => Array.isArray(b) && b.length === 4 && text(b[0], 16) && Number.isInteger(b[1]) && Number.isInteger(b[2]) && Number.isInteger(b[3]))) return;
    state.blocks = v.blocks.map(b => [b[0], b[1], b[2], b[3]]);
  }
  return state;
}

/** Validates a client message on the relay. Anything malformed is undefined and ignored. */
export function parseClient(raw: string): ClientMessage | undefined {
  let m: Record<string, unknown>;
  try { m = JSON.parse(raw); } catch { return; }
  if (!m || typeof m !== 'object') return;
  switch (m.t) {
    case 'hello': return Number.isInteger(m.v) && typeof m.name === 'string' ? { t: 'hello', v: m.v as number, name: cleanName(m.name) } : undefined;
    case 'create': return { t: 'create', open: m.open === true || undefined };
    case 'open': return typeof m.open === 'boolean' ? { t: 'open', open: m.open } : undefined;
    case 'lobbies': return { t: 'lobbies' };
    case 'party': return typeof m.k === 'string' && PARTY.includes(m.k) && (m.to === undefined || typeof m.to === 'string') && m.d !== undefined ? { t: 'party', to: m.to as string | undefined, k: m.k as PartyKind, d: m.d } : undefined;
    case 'leave': return { t: 'leave' };
    case 'join': return typeof m.code === 'string' ? { t: 'join', code: normalizeCode(m.code) } : undefined;
    case 'sector': { const world = readWorld(m.world); return world && { t: 'sector', world, owner: m.owner === true || undefined }; }
    case 'state': { const s = readState(m.s); return s && { t: 'state', s }; }
    case 'cast': return typeof m.k === 'string' && CASTS.includes(m.k) && m.d !== undefined ? { t: 'cast', k: m.k as CastKind, d: m.d } : undefined;
    case 'direct': return typeof m.k === 'string' && DIRECTS.includes(m.k) && typeof m.to === 'string' && m.d !== undefined ? { t: 'direct', to: m.to, k: m.k as DirectKind, d: m.d } : undefined;
    case 'profile': return typeof m.home === 'string' && m.home.length > 0 && m.home.length <= NET.maxSeed && finite(m.power) && m.power >= 0 ? { t: 'profile', home: m.home, power: m.power } : undefined;
    case 'match': return Array.isArray(m.exclude) && m.exclude.length <= 64 && m.exclude.every(h => typeof h === 'string') ? { t: 'match', exclude: m.exclude as string[] } : undefined;
    case 'claim': return Array.isArray(m.ids) && m.ids.length <= CLAIMS.batch && m.ids.every(id => Number.isSafeInteger(id)) ? { t: 'claim', ids: m.ids as number[] } : undefined;
  }
}

/** Validates a relay message in the browser. */
export function parseServer(raw: string): ServerMessage | undefined {
  let m: Record<string, unknown>;
  try { m = JSON.parse(raw); } catch { return; }
  if (!m || typeof m !== 'object') return;
  switch (m.t) {
    case 'welcome': return typeof m.id === 'string' ? { t: 'welcome', id: m.id } : undefined;
    case 'gone': return typeof m.id === 'string' ? { t: 'gone', id: m.id } : undefined;
    case 'error': return typeof m.message === 'string' ? { t: 'error', message: m.message } : undefined;
    case 'left-lobby': return typeof m.reason === 'string' ? { t: 'left-lobby', reason: m.reason } : undefined;
    case 'state': { const s = readState(m.s); return s && typeof m.id === 'string' && (m.name === undefined || typeof m.name === 'string') && typeof m.r === 'string' ? { t: 'state', id: m.id, name: typeof m.name === 'string' ? cleanName(m.name) : undefined, r: m.r, s } : undefined; }
    case 'room': return typeof m.authority === 'string' && Number.isInteger(m.members) ? { t: 'room', authority: m.authority, members: m.members as number } : undefined;
    case 'cast': return typeof m.from === 'string' && typeof m.r === 'string' && typeof m.k === 'string' && CASTS.includes(m.k) ? { t: 'cast', from: m.from, r: m.r, k: m.k as CastKind, d: m.d } : undefined;
    case 'direct': return typeof m.from === 'string' && typeof m.r === 'string' && typeof m.k === 'string' && DIRECTS.includes(m.k) ? { t: 'direct', from: m.from, r: m.r, k: m.k as DirectKind, d: m.d } : undefined;
    case 'match': return m.world === null ? { t: 'match', world: null } : (() => { const world = readWorld(m.world); return world ? { t: 'match', world, name: typeof m.name === 'string' ? cleanName(m.name) : undefined } as ServerMessage : undefined; })();
    case 'undelivered': return typeof m.to === 'string' && typeof m.k === 'string' && DIRECTS.includes(m.k) ? { t: 'undelivered', to: m.to, k: m.k as DirectKind } : undefined;
    case 'claims': { const ids = (v: unknown) => Array.isArray(v) && v.every(id => Number.isSafeInteger(id)); return ids(m.ok) && ids(m.denied) && Number.isFinite(m.lease) ? { t: 'claims', ok: m.ok as number[], denied: m.denied as number[], lease: m.lease as number } : undefined; }
    case 'lobby': {
      if (typeof m.code !== 'string' || typeof m.host !== 'string' || !Array.isArray(m.members)) return;
      const members = (m.members as Member[]).filter(p => p && typeof p.id === 'string' && typeof p.name === 'string').map(p => ({ id: p.id, name: cleanName(p.name), host: Boolean(p.host) }));
      return { t: 'lobby', code: m.code, host: m.host, members, world: m.world === null ? null : readWorld(m.world) ?? null, open: m.open === true || undefined };
    }
    case 'party': return typeof m.from === 'string' && typeof m.k === 'string' && PARTY.includes(m.k) ? { t: 'party', from: m.from, k: m.k as PartyKind, d: m.d } : undefined;
    case 'party-undelivered': return typeof m.to === 'string' && typeof m.k === 'string' && PARTY.includes(m.k) ? { t: 'party-undelivered', to: m.to, k: m.k as PartyKind } : undefined;
    case 'lobbies': {
      if (!Number.isInteger(m.online) || !Array.isArray(m.list)) return;
      const list = (m.list as LobbySummary[]).slice(0, 100).filter(l => l && typeof l.code === 'string' && typeof l.host === 'string' && Number.isInteger(l.members)).map(l => ({ code: normalizeCode(l.code), host: cleanName(l.host), members: l.members, power: finite(l.power) ? l.power : undefined }));
      return { t: 'lobbies', online: m.online as number, list };
    }
  }
}
