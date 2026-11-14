import { ENEMIES, RESOURCES, STRUCTURES, type EnemyKind, type Resource } from './data.ts';
import type { Asteroid } from './mining.ts';
import { CLAIMS } from './netProtocol.ts';

/**
 * Shared-sector state (stage 3): pure encoders/decoders for what pilots in one sector exchange, and the
 * client-side rock claim book. No Phaser, DOM or sockets.
 *
 * Rules: one pilot per sector (the relay's room authority) runs the enemies; the others mirror them and
 * send their weapon hits to it. Any pilot may change a rock, but only while holding the relay's claim
 * lease on it, so two pilots never remove the same ore. Pickups are personal: each pilot's drops exist
 * only in their own world, and a kill's loot is sent to the pilot whose hit destroyed the enemy.
 */
export type SharedTarget = { id: string; x: number; y: number; vx: number; vy: number; dead?: boolean; radius?: number };
export type PvpHit = { to: string; damage: number };
export type SharedHit = { enemyId: number; damage: number; pierce?: boolean };
export type SharedLoot = { to: string; drops: { ore: Resource; amount: number; x: number; y: number }[] };
/** `a` is how many seconds the shot had already flown when it was sent; receivers fast-forward it by that plus the network delay. */
export type SharedShot = { x: number; y: number; vx: number; vy: number; life: number; damage: number; weapon?: string; homing?: number; rocket?: boolean; splash?: number; a?: number }
  | { beam: true; x: number; y: number; ex: number; ey: number; damage: number };
/** Hooks a GameModel uses while sharing a sector. Undefined in single-player, which then behaves exactly as before. */
export type SharedSector = {
  role: 'authority' | 'follower';
  /** Other pilots here that the authority's enemies may hunt. */
  targets: SharedTarget[];
  /** True if this pilot may change that rock now (holds a claim lease). */
  mayChangeRock(id: number): boolean;
  /** Filled during update, drained and sent by the scene. */
  changedRocks: Set<number>;
  shots: SharedShot[];
  hits: SharedHit[];
  loot: SharedLoot[];
  /** Lobby members here: allies never damage each other. */
  allies: Set<string>;
  /** Hits this pilot's shots landed on other pilots, sent to each victim. */
  pvpHits: PvpHit[];
  /** Set when another pilot destroyed this ship: its carried cargo, sent to them once. */
  pvpLoot?: { to: string; cargo: Partial<Record<Resource, number>>; sent?: boolean; returned?: boolean };
  /** Rocks this pilot's ship knocked (motion only): sent so others see the rock move. No claim needed, no ore changes. */
  bumpedRocks: Set<number>;
};
export function sharedSector(role: SharedSector['role'], mayChangeRock: (id: number) => boolean): SharedSector {
  return { role, targets: [], mayChangeRock, changedRocks: new Set(), shots: [], hits: [], loot: [], allies: new Set(), pvpHits: [], bumpedRocks: new Set() };
}

const num = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const round = (n: number, digits = 1) => Math.round(n * 10 ** digits) / 10 ** digits;
const isResource = (v: unknown): v is Resource => typeof v === 'string' && v in RESOURCES;

/** A rock as sent after it changes; `gone` when destroyed. Geometry radii travel so dents match everywhere. */
export type RockState = { id: number; gone?: true; x?: number; y?: number; vx?: number; vy?: number; amount?: number; health?: number; radius?: number; geometry?: Asteroid['geometry'] };
export function encodeRock(a: Asteroid | undefined, id: number): RockState {
  if (!a || a.amount <= 0) return { id, gone: true };
  return { id, x: round(a.x), y: round(a.y), vx: round(a.vx, 2), vy: round(a.vy, 2), amount: a.amount, health: round(a.health, 3), radius: round(a.radius, 2), geometry: a.geometry && structuredClone(a.geometry) };
}
export function decodeRocks(d: unknown): RockState[] {
  if (!Array.isArray(d)) return [];
  return d.slice(0, 64).filter((r): r is RockState => r && Number.isSafeInteger(r.id) && (r.gone === true || [r.x, r.y, r.vx, r.vy, r.amount, r.health, r.radius].every(num) && r.amount >= 0));
}

/**
 * Compact enemy row: id, kind, x, y, angle, health, maxHealth, shield, state, parent, vx, vy. Followers carry
 * each enemy forward on its velocity between updates (dead reckoning). Rows from older clients have no velocity
 * (10 entries) and decode with vx = vy = 0.
 */
export type EnemyRow = [number, string, number, number, number, number, number, number, string, number, number, number];
export function encodeEnemies(enemies: { id: number; kind?: EnemyKind; x: number; y: number; angle: number; health: number; maxHealth?: number; shield?: number; state?: string; parent?: number; vx?: number; vy?: number }[]): EnemyRow[] {
  // Whole units and centiradians: enemies are carried forward between updates, so finer values only cost bandwidth.
  return enemies.filter(e => e.health > 0).slice(0, 96).map(e => [e.id, e.kind ?? 'raider', Math.round(e.x), Math.round(e.y), round(e.angle, 2), Math.ceil(e.health), Math.round(e.maxHealth ?? ENEMIES[e.kind ?? 'raider'].health), Math.round(e.shield ?? 0), e.state ?? 'patrol', e.parent ?? -1, Math.round(e.vx ?? 0), Math.round(e.vy ?? 0)]);
}
export function decodeEnemies(d: unknown): EnemyRow[] {
  if (!Array.isArray(d)) return [];
  return d.slice(0, 96).filter(r => Array.isArray(r) && (r.length === 10 || r.length === 12) && Number.isSafeInteger(r[0]) && typeof r[1] === 'string' && r[1] in ENEMIES && [r[2], r[3], r[4], r[5], r[6], r[7], r[9]].every(num) && typeof r[8] === 'string' && (r.length === 10 || [r[10], r[11]].every(v => num(v) && Math.abs(v) < 5000)))
    .map(r => (r.length === 12 ? r : [...r, 0, 0]) as EnemyRow);
}
/** Enemy ids the authority removed (destroyed or despawned) since its last message: followers drop them at once. */
export function decodeIds(d: unknown): number[] {
  return Array.isArray(d) ? d.slice(0, 128).filter(id => Number.isSafeInteger(id)) : [];
}
/**
 * Seconds to carry something received forward: how old it already was when sent plus the one-way network
 * delay, never more than `max` (so a stalled connection does not throw things far ahead).
 */
export function leadTime(age: number | undefined, oneWay: number, max = 0.3) {
  const lead = (Number.isFinite(age) ? age as number : 0) + (Number.isFinite(oneWay) ? oneWay : 0);
  return Math.max(0, Math.min(max, lead));
}

/** A rock's motion after a bump: id, x, y, vx, vy. */
export type BumpRow = [number, number, number, number, number];
export function encodeBump(a: Asteroid): BumpRow { return [a.id, round(a.x), round(a.y), round(a.vx, 2), round(a.vy, 2)]; }
export function decodeBumps(d: unknown): BumpRow[] {
  if (!Array.isArray(d)) return [];
  return d.slice(0, 64).filter((r): r is BumpRow => Array.isArray(r) && r.length === 5 && Number.isSafeInteger(r[0]) && r.slice(1).every(num) && Math.abs(r[3]) < 2000 && Math.abs(r[4]) < 2000);
}
/**
 * Another pilot's own shot: drawn and stopped by rocks here, but it never damages anything in this simulation (the
 * shooter's own simulation decides hits). `o` is where it was relative to the shooter's ship when picked up, so a
 * receiver can launch it from where it draws that ship: the shot then leaves the visible gun at once instead of
 * appearing ahead of a ship that is drawn slightly in the past.
 */
export type PilotShot = { x: number; y: number; vx: number; vy: number; life: number; weapon?: string; level?: number; rocket?: boolean; o?: [number, number] };
export function encodePilotShot(b: PilotShot, ship?: { x: number; y: number }): PilotShot {
  const shot: PilotShot = { x: round(b.x), y: round(b.y), vx: round(b.vx), vy: round(b.vy), life: round(b.life, 2), weapon: b.weapon, level: b.level, rocket: b.rocket || undefined };
  if (ship) shot.o = [round(b.x - ship.x), round(b.y - ship.y)];
  return shot;
}
export function decodePilotShots(d: unknown): PilotShot[] {
  if (!Array.isArray(d)) return [];
  return d.slice(0, 64).filter((s): s is PilotShot => s && [s.x, s.y, s.vx, s.vy, s.life].every(num) && s.life > 0 && s.life < 20 && (s.weapon === undefined || typeof s.weapon === 'string') && (s.level === undefined || Number.isInteger(s.level)))
    .map(s => {
      const shot: PilotShot = { x: s.x, y: s.y, vx: s.vx, vy: s.vy, life: s.life, weapon: s.weapon, level: s.level, rocket: s.rocket === true || undefined };
      if (Array.isArray(s.o) && s.o.length === 2 && s.o.every(num) && Math.abs(s.o[0]) < 600 && Math.abs(s.o[1]) < 600) shot.o = [s.o[0], s.o[1]];
      return shot;
    });
}

/**
 * How another pilot's ship looks right now beyond its hull: shield charge and active mining/tractor beams.
 * A beam row is the source's offset from the ship centre, the target point, the module level and target id;
 * receivers draw it from their interpolated view of that ship, so the beam stays attached to it.
 */
export type BeamRow = [dx: number, dy: number, tx: number, ty: number, level: number, target: number];
export type PilotLook = { s?: [shield: number, max: number]; m?: BeamRow[]; t?: BeamRow[] };
type Link = { from: { x: number; y: number }; to: { x: number; y: number }; level: number; targetId: number };
export function encodeLook(ship: { x: number; y: number }, shield: number, maxShield: number, mining: Link[], tractor: Link[]): PilotLook | undefined {
  const row = (l: Link): BeamRow => [round(l.from.x - ship.x), round(l.from.y - ship.y), round(l.to.x), round(l.to.y), l.level, l.targetId];
  const look: PilotLook = {};
  if (maxShield > 0 && shield > 0) look.s = [Math.round(shield), Math.round(maxShield)];
  if (mining.length) look.m = mining.slice(0, 12).map(row);
  if (tractor.length) look.t = tractor.slice(0, 12).map(row);
  return look.s || look.m || look.t ? look : undefined;
}
export function decodeLook(d: unknown): PilotLook | undefined {
  if (!d || typeof d !== 'object') return;
  const v = d as Record<string, unknown>, look: PilotLook = {};
  const beams = (b: unknown) => Array.isArray(b) ? b.slice(0, 12).filter((r): r is BeamRow => Array.isArray(r) && r.length === 6 && r.every(num) && Math.abs(r[0]) < 400 && Math.abs(r[1]) < 400 && Number.isInteger(r[4]) && r[4] >= 1 && r[4] <= 5) : undefined;
  if (Array.isArray(v.s) && v.s.length === 2 && v.s.every(num) && (v.s[1] as number) > 0) look.s = [Math.max(0, Math.min(v.s[0] as number, v.s[1] as number)), v.s[1] as number];
  const m = beams(v.m), t = beams(v.t);
  if (m?.length) look.m = m; if (t?.length) look.t = t;
  return look;
}

export function decodeShots(d: unknown): SharedShot[] {
  if (!Array.isArray(d)) return [];
  return d.slice(0, 64).filter((s): s is SharedShot => s && (s.beam === true ? [s.x, s.y, s.ex, s.ey, s.damage].every(num) : [s.x, s.y, s.vx, s.vy, s.life, s.damage].every(num) && s.life > 0 && s.life < 20))
    .map(s => {
      const shot = { ...s, damage: Math.max(0, Math.min(400, s.damage)) };
      if ('a' in shot) { if (num(shot.a) && shot.a >= 0) shot.a = Math.min(1, shot.a); else delete shot.a; }
      return shot;
    });
}
export function decodeHits(d: unknown): SharedHit[] {
  if (!Array.isArray(d)) return [];
  return d.slice(0, 64).filter((h): h is SharedHit => h && Number.isSafeInteger(h.enemyId) && num(h.damage) && h.damage > 0).map(h => ({ enemyId: h.enemyId, damage: Math.min(2000, h.damage), pierce: h.pierce === true || undefined }));
}
export function decodePvpHit(d: unknown): number {
  const damage = (d as { damage?: unknown })?.damage;
  return num(damage) && damage > 0 ? Math.min(2000, damage) : 0;
}
export function decodeCargo(d: unknown): Partial<Record<Resource, number>> {
  const out: Partial<Record<Resource, number>> = {};
  if (!d || typeof d !== 'object') return out;
  for (const [ore, amount] of Object.entries(d)) if (isResource(ore) && Number.isInteger(amount) && (amount as number) > 0 && (amount as number) <= 100000) out[ore] = amount as number;
  return out;
}
export function decodeLoot(d: unknown): SharedLoot['drops'] {
  if (!Array.isArray(d)) return [];
  return d.slice(0, 16).filter(l => l && isResource(l.ore) && Number.isInteger(l.amount) && l.amount > 0 && l.amount <= 10000 && num(l.x) && num(l.y));
}

/**
 * Client-side view of the relay's rock leases. `has` answers immediately from leases already granted and
 * queues a request for anything else, so mining starts one round trip after the beam first touches a rock.
 */
export class ClaimBook {
  private leases = new Map<number, number>();
  private asked = new Map<number, number>();
  private queue = new Set<number>();
  has(id: number, now: number) {
    const until = this.leases.get(id);
    if (until !== undefined && until > now + 0.4) return true;
    if ((this.asked.get(id) ?? -Infinity) < now - 0.5) { this.queue.add(id); this.asked.set(id, now); }
    return until !== undefined && until > now;
  }
  /** Rock ids to request now (at most one message's worth). */
  take(): number[] { const ids = [...this.queue].slice(0, CLAIMS.batch); for (const id of ids) this.queue.delete(id); return ids; }
  grant(ok: number[], denied: number[], lease: number, now: number) {
    for (const id of ok) this.leases.set(id, now + lease / 1000 - 0.15);
    for (const id of denied) this.leases.delete(id);
    if (this.leases.size > 512) for (const [id, until] of this.leases) if (until < now) this.leases.delete(id);
  }
  clear() { this.leases.clear(); this.asked.clear(); this.queue.clear(); }
}

/**
 * Another pilot's outpost as shared in a sector, for show only: blocks relative to the core cell as
 * [kind index into `k`, dx, dy, rot, level, health, progress %]. Large outposts go in `m` parts of at most
 * OUTPOST_PART blocks; `v` is the owner's revision, so receivers re-bake its sprite only when it changes.
 * Nothing stored in an outpost (minerals, battery, drones) is ever sent, so nothing can be copied out of it.
 */
export type OutpostPart = { i: number; n: string; c: [number, number]; v: number; p: number; m: number; k: string[]; s: [number, number, number, number, number, number, number][]; sh?: number };
export const OUTPOST_PART = 400;
type SharedStructure = { kind: string; cx: number; cy: number; rot: number; level: number; health: number; progress: number };
export function encodeOutpost(o: { id: number; name: string; cx: number; cy: number; revision: number; shield?: number; structures: SharedStructure[] }, shieldFraction?: number): OutpostPart[] {
  const parts: OutpostPart[] = [], count = Math.max(1, Math.ceil(o.structures.length / OUTPOST_PART));
  for (let p = 0; p < count; p++) {
    const k: string[] = [], slice = o.structures.slice(p * OUTPOST_PART, (p + 1) * OUTPOST_PART);
    const s = slice.map(b => { let kind = k.indexOf(b.kind); if (kind < 0) kind = k.push(b.kind) - 1; return [kind, b.cx - o.cx, b.cy - o.cy, b.rot, b.level, Math.max(0, Math.round(b.health)), Math.round(Math.max(0, Math.min(1, b.progress)) * 100)] as OutpostPart['s'][number]; });
    const part: OutpostPart = { i: o.id, n: o.name.slice(0, 40), c: [o.cx, o.cy], v: o.revision, p, m: count, k, s };
    if (shieldFraction !== undefined && shieldFraction > 0) part.sh = round(Math.min(1, shieldFraction), 2);
    parts.push(part);
  }
  return parts;
}
const int = (n: unknown, max: number): n is number => Number.isInteger(n) && Math.abs(n as number) <= max;
export function decodeOutpostPart(d: unknown): OutpostPart | undefined {
  const v = d as OutpostPart;
  if (!v || typeof v !== 'object' || !Number.isSafeInteger(v.i) || typeof v.n !== 'string' || !Array.isArray(v.c) || v.c.length !== 2 || !v.c.every(c => int(c, 1e7)) || !Number.isSafeInteger(v.v)) return;
  if (!int(v.m, 16) || v.m < 1 || !int(v.p, 16) || v.p < 0 || v.p >= v.m || !Array.isArray(v.k) || v.k.length > 32 || !v.k.every(k => typeof k === 'string' && k in STRUCTURES) || !Array.isArray(v.s) || v.s.length > OUTPOST_PART) return;
  const s = v.s.filter(r => Array.isArray(r) && r.length === 7 && int(r[0], 31) && r[0] >= 0 && r[0] < v.k.length && int(r[1], 64) && int(r[2], 64) && int(r[3], 3) && int(r[4], 5) && r[4] >= 1 && int(r[5], 1e6) && r[5] >= 0 && int(r[6], 100) && r[6] >= 0);
  const part: OutpostPart = { i: v.i, n: v.n.slice(0, 40), c: [v.c[0], v.c[1]], v: v.v, p: v.p, m: v.m, k: [...v.k], s };
  if (num(v.sh) && v.sh > 0) part.sh = Math.min(1, v.sh);
  return part;
}
/** Builds a display copy of an outpost from all its parts (in any order). */
export function outpostFromParts(parts: OutpostPart[], id: number) {
  const first = parts[0];
  const structures = parts.flatMap(part => part.s.map(([kind, dx, dy, rot, level, health, progress]) => ({ kind: part.k[kind] as keyof typeof STRUCTURES, cx: first.c[0] + dx, cy: first.c[1] + dy, rot, level, health, progress: progress / 100 })))
    .map((s, n) => ({ id: n + 1, ...s }));
  return { id, name: first.n, cx: first.c[0], cy: first.c[1], structures, revision: first.v, energy: 0, drones: [], shield: first.sh };
}
