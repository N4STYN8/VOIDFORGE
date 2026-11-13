import { ENEMIES, RESOURCES, type EnemyKind, type Resource } from './data.ts';
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
export type SharedShot = { x: number; y: number; vx: number; vy: number; life: number; damage: number; weapon?: string; homing?: number; rocket?: boolean; splash?: number }
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
};
export function sharedSector(role: SharedSector['role'], mayChangeRock: (id: number) => boolean): SharedSector {
  return { role, targets: [], mayChangeRock, changedRocks: new Set(), shots: [], hits: [], loot: [], allies: new Set(), pvpHits: [] };
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

/** Compact enemy row: id, kind, x, y, angle, health, maxHealth, shield, state, parent. */
export type EnemyRow = [number, string, number, number, number, number, number, number, string, number];
export function encodeEnemies(enemies: { id: number; kind?: EnemyKind; x: number; y: number; angle: number; health: number; maxHealth?: number; shield?: number; state?: string; parent?: number }[]): EnemyRow[] {
  // Whole units and centiradians: enemies are eased between updates, so finer values only cost bandwidth.
  return enemies.filter(e => e.health > 0).slice(0, 96).map(e => [e.id, e.kind ?? 'raider', Math.round(e.x), Math.round(e.y), round(e.angle, 2), Math.ceil(e.health), Math.round(e.maxHealth ?? ENEMIES[e.kind ?? 'raider'].health), Math.round(e.shield ?? 0), e.state ?? 'patrol', e.parent ?? -1]);
}
export function decodeEnemies(d: unknown): EnemyRow[] {
  if (!Array.isArray(d)) return [];
  return d.slice(0, 96).filter((r): r is EnemyRow => Array.isArray(r) && r.length === 10 && Number.isSafeInteger(r[0]) && typeof r[1] === 'string' && r[1] in ENEMIES && [r[2], r[3], r[4], r[5], r[6], r[7], r[9]].every(num) && typeof r[8] === 'string');
}

export function decodeShots(d: unknown): SharedShot[] {
  if (!Array.isArray(d)) return [];
  return d.slice(0, 64).filter((s): s is SharedShot => s && (s.beam === true ? [s.x, s.y, s.ex, s.ey, s.damage].every(num) : [s.x, s.y, s.vx, s.vy, s.life, s.damage].every(num) && s.life > 0 && s.life < 20))
    .map(s => ({ ...s, damage: Math.max(0, Math.min(400, s.damage)) }));
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
