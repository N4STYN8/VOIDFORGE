import { ENEMIES, RESOURCES, type Resource } from './data.ts';
import { cleanName, readWorld, type ServerMessage, type WorldRef } from './netProtocol.ts';

/**
 * Admin console protocol, shared by the relay (server/admin.ts), the admin page (src/admin) and the game
 * client (src/adminControl.ts). No Node, DOM or Phaser imports.
 *
 * Admin page -> relay: `AdminRequest` (validated by `parseAdmin`). Relay -> admin page: `AdminServerMessage`.
 * Relay -> game client: `{t:'admin', ref, c: AdminCommand}`; the client answers `{t:'admin-ack', ref, ok}`.
 * The relay never simulates: anything that changes a game is an AdminCommand run by that pilot's client.
 */
export const ADMIN = {
  maxSockets: 4, rate: 20, maxWatch: 3, castBytes: 98304, resultTimeout: 5000, logSize: 200,
  sessionMs: 12 * 3600 * 1000, lockFailures: 5, lockMs: 15 * 60 * 1000, maxSpawn: 12, maxDelta: 100000,
  maxText: 200, maxAck: 12000, overviewMs: 1000, kickMinutes: 2,
} as const;

export type ResourceDelta = Partial<Record<Resource, number>>;
export type CargoTarget = 'cargo' | 'stored' | { outpost: number };
export type BroadcastTarget = { all: true } | { lobby: string } | { pilot: string } | { room: string };

/** Commands a game client carries out on its own model. */
export type AdminCommand =
  | { op: 'notice'; text: string }
  | { op: 'teleport'; x: number; y: number; world?: WorldRef; cell?: [number, number] }
  | { op: 'spawn'; kind: string; count: number; x: number; y: number }
  | { op: 'clear' }
  | { op: 'evict'; reason: string }
  | { op: 'inspect' }
  | { op: 'cargo'; target: CargoTarget; delta: ResourceDelta }
  | { op: 'station'; index: number; unlocked: boolean }
  | { op: 'structure'; outpost: number; structure?: number; action: 'repair' | 'upgrade' | 'destroy' }
  | { op: 'rename'; name: string };

type Ref = { ref: number };
export type AdminRequest = Ref & (
  | { t: 'watch'; rooms: string[] }
  | { t: 'kick'; id: string; reason?: string }
  | { t: 'ban'; id?: string; ip?: string; minutes: number; reason?: string }
  | { t: 'unban'; ip: string }
  | { t: 'rename'; id: string; name: string }
  | { t: 'disband'; code: string }
  | { t: 'remove'; code: string; id: string }
  | { t: 'lobby-open'; code: string; open: boolean }
  | { t: 'lock'; seed: string; locked: boolean }
  | { t: 'broadcast'; to: BroadcastTarget; text: string }
  | { t: 'teleport'; id: string; x: number; y: number; world?: WorldRef; cell?: [number, number] }
  | { t: 'spawn'; seed: string; kind: string; count: number; x: number; y: number }
  | { t: 'clear'; seed: string }
  | { t: 'evict'; seed: string }
  | { t: 'inspect'; id: string }
  | { t: 'cargo'; id: string; target: CargoTarget; delta: ResourceDelta }
  | { t: 'station'; id: string; index: number; unlocked: boolean }
  | { t: 'structure'; id: string; outpost: number; structure?: number; action: 'repair' | 'upgrade' | 'destroy' });

export type AdminPilot = {
  id: string; name: string; ip: string; room?: string; world?: WorldRef; lobby?: string; authority: boolean; owner?: boolean;
  at?: { x: number; y: number }; angle?: number; dead?: boolean; profile?: { home: string; power: number };
  /** Connected since (epoch ms), messages per second over the last few seconds, keep-alive round trip (ms). */
  since: number; rate: number; ping?: number;
};
export type AdminLobby = { code: string; host: string; hostName: string; members: { id: string; name: string }[]; open: boolean };
export type AdminRoom = { seed: string; world?: WorldRef; authority?: string; members: number; locked: boolean; watched: boolean };
export type BanEntry = { ip: string; until: number; reason: string; name: string; at: number };
export type AuditEntry = { at: number; action: string; target: string; detail?: string };

export type AdminServerMessage =
  | { t: 'overview'; pilots: AdminPilot[]; lobbies: AdminLobby[]; rooms: AdminRoom[]; bans: BanEntry[]; stats: Record<string, number> }
  /** A tapped message from a watched room: the same shape players receive (state unfiltered by distance). */
  | { t: 'obs'; r: string; m: ServerMessage }
  | { t: 'report'; id: string; ref: number; data: unknown }
  | { t: 'result'; ref: number; ok: boolean; message?: string }
  | { t: 'log'; entries: AuditEntry[] };

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const int = (n: unknown): n is number => Number.isSafeInteger(n);
const str = (s: unknown, max = 200): s is string => typeof s === 'string' && s.length > 0 && s.length <= max;
const id = (s: unknown): s is string => str(s, 32);
const words = (s: unknown) => typeof s === 'string' ? s.trim().slice(0, ADMIN.maxText) : '';
const ACTIONS = ['repair', 'upgrade', 'destroy'] as const;

function readDelta(v: unknown): ResourceDelta | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return;
  const out: ResourceDelta = {};
  for (const [k, n] of Object.entries(v)) {
    if (!(k in RESOURCES) || !finite(n) || Math.abs(n) > ADMIN.maxDelta) return;
    out[k as Resource] = n;
  }
  return Object.keys(out).length ? out : undefined;
}
function readTarget(v: unknown): CargoTarget | undefined {
  if (v === 'cargo' || v === 'stored') return v;
  if (v && typeof v === 'object' && int((v as { outpost: unknown }).outpost)) return { outpost: (v as { outpost: number }).outpost };
}
function readTeleport(m: Record<string, unknown>): Pick<Extract<AdminCommand, { op: 'teleport' }>, 'x' | 'y' | 'world' | 'cell'> | undefined {
  if (!finite(m.x) || !finite(m.y)) return;
  const out: { x: number; y: number; world?: WorldRef; cell?: [number, number] } = { x: m.x, y: m.y };
  if (m.world !== undefined) { const w = readWorld(m.world); if (!w) return; out.world = w; }
  if (m.cell !== undefined) { const c = m.cell; if (!Array.isArray(c) || c.length !== 2 || !c.every(int)) return; out.cell = [c[0], c[1]]; }
  if (out.world && out.cell) return;
  return out;
}
const isEnemy = (k: unknown): k is string => typeof k === 'string' && Object.prototype.hasOwnProperty.call(ENEMIES, k);

/** Validates a command arriving at a game client. */
export function readAdminCommand(v: unknown): AdminCommand | undefined {
  if (!v || typeof v !== 'object') return;
  const m = v as Record<string, unknown>;
  switch (m.op) {
    case 'notice': { const text = words(m.text); return text ? { op: 'notice', text } : undefined; }
    case 'teleport': { const t = readTeleport(m); return t && { op: 'teleport', ...t }; }
    case 'spawn': return isEnemy(m.kind) && int(m.count) && m.count >= 1 && m.count <= ADMIN.maxSpawn && finite(m.x) && finite(m.y) ? { op: 'spawn', kind: m.kind, count: m.count, x: m.x, y: m.y } : undefined;
    case 'clear': return { op: 'clear' };
    case 'evict': return { op: 'evict', reason: words(m.reason) || 'An admin sent you home.' };
    case 'inspect': return { op: 'inspect' };
    case 'cargo': { const target = readTarget(m.target), delta = readDelta(m.delta); return target && delta ? { op: 'cargo', target, delta } : undefined; }
    case 'station': return int(m.index) && m.index >= 0 && typeof m.unlocked === 'boolean' ? { op: 'station', index: m.index, unlocked: m.unlocked } : undefined;
    case 'structure': return int(m.outpost) && (m.structure === undefined || int(m.structure)) && ACTIONS.includes(m.action as typeof ACTIONS[number]) ? { op: 'structure', outpost: m.outpost, structure: m.structure as number | undefined, action: m.action as typeof ACTIONS[number] } : undefined;
    case 'rename': return typeof m.name === 'string' && m.name.trim() ? { op: 'rename', name: cleanName(m.name) } : undefined;
  }
}

function readBroadcast(v: unknown): BroadcastTarget | undefined {
  const m = v as Record<string, unknown>;
  if (!m || typeof m !== 'object') return;
  if (m.all === true) return { all: true };
  if (id(m.lobby)) return { lobby: m.lobby };
  if (id(m.pilot)) return { pilot: m.pilot };
  if (str(m.room)) return { room: m.room };
}

/** Validates a request from the admin page. Anything malformed is undefined. */
export function parseAdmin(raw: string): AdminRequest | undefined {
  let m: Record<string, unknown>;
  try { m = JSON.parse(raw); } catch { return; }
  if (!m || typeof m !== 'object' || !int(m.ref)) return;
  const ref = m.ref;
  const reason = m.reason === undefined ? undefined : words(m.reason) || undefined;
  switch (m.t) {
    case 'watch': return Array.isArray(m.rooms) && m.rooms.length <= ADMIN.maxWatch && m.rooms.every(r => str(r)) ? { t: 'watch', ref, rooms: m.rooms as string[] } : undefined;
    case 'kick': return id(m.id) ? { t: 'kick', ref, id: m.id, reason } : undefined;
    case 'ban': return (id(m.id) || str(m.ip, 64)) && finite(m.minutes) && m.minutes > 0 && m.minutes <= 525600 ? { t: 'ban', ref, id: id(m.id) ? m.id : undefined, ip: str(m.ip, 64) ? m.ip : undefined, minutes: m.minutes, reason } : undefined;
    case 'unban': return str(m.ip, 64) ? { t: 'unban', ref, ip: m.ip } : undefined;
    case 'rename': return id(m.id) && typeof m.name === 'string' && m.name.trim() ? { t: 'rename', ref, id: m.id, name: cleanName(m.name) } : undefined;
    case 'disband': return id(m.code) ? { t: 'disband', ref, code: m.code } : undefined;
    case 'remove': return id(m.code) && id(m.id) ? { t: 'remove', ref, code: m.code, id: m.id } : undefined;
    case 'lobby-open': return id(m.code) && typeof m.open === 'boolean' ? { t: 'lobby-open', ref, code: m.code, open: m.open } : undefined;
    case 'lock': return str(m.seed) && typeof m.locked === 'boolean' ? { t: 'lock', ref, seed: m.seed, locked: m.locked } : undefined;
    case 'broadcast': { const to = readBroadcast(m.to); return to && typeof m.text === 'string' && m.text.trim() && m.text.length <= ADMIN.maxText ? { t: 'broadcast', ref, to, text: m.text.trim() } : undefined; }
    case 'teleport': { const t = id(m.id) ? readTeleport(m) : undefined; return t && { t: 'teleport', ref, id: m.id as string, ...t }; }
    case 'spawn': {
      const c = str(m.seed) ? readAdminCommand({ ...m, op: 'spawn' }) : undefined;
      return c?.op === 'spawn' ? { t: 'spawn', ref, seed: m.seed as string, kind: c.kind, count: c.count, x: c.x, y: c.y } : undefined;
    }
    case 'clear': return str(m.seed) ? { t: 'clear', ref, seed: m.seed } : undefined;
    case 'evict': return str(m.seed) ? { t: 'evict', ref, seed: m.seed } : undefined;
    case 'inspect': return id(m.id) ? { t: 'inspect', ref, id: m.id } : undefined;
    case 'cargo': { const c = id(m.id) ? readAdminCommand({ ...m, op: 'cargo' }) : undefined; return c?.op === 'cargo' ? { t: 'cargo', ref, id: m.id as string, target: c.target, delta: c.delta } : undefined; }
    case 'station': { const c = id(m.id) ? readAdminCommand({ ...m, op: 'station' }) : undefined; return c?.op === 'station' ? { t: 'station', ref, id: m.id as string, index: c.index, unlocked: c.unlocked } : undefined; }
    case 'structure': { const c = id(m.id) ? readAdminCommand({ ...m, op: 'structure' }) : undefined; return c?.op === 'structure' ? { t: 'structure', ref, id: m.id as string, outpost: c.outpost, structure: c.structure, action: c.action } : undefined; }
  }
}
