import { CHUNK_SIZE, createWorld, generateChunk, type WorldSpec } from '../world.ts';
import { decodeBumps, decodeEnemies, decodeLook, decodePilotShots, decodeRocks, decodeShots, type EnemyRow, type PilotLook, type RockState } from '../shared.ts';
import type { Asteroid } from '../mining.ts';

/**
 * What the admin page knows about a sector: its generated geography (from the seed, exactly as the game
 * builds it) plus the live traffic the relay copies to a watching admin (enemies, shots, rock changes and
 * pilot looks). Presentation only: nothing here feeds back into any game.
 */
const SPEC_CACHE = 6, CHUNK_CACHE = 900;
const specs = new Map<string, WorldSpec | null>();
const chunks = new Map<string, Asteroid[]>();

/** The seed's world spec, cached (a few seeds at a time). Null if the seed cannot be generated. */
export function specFor(seed: string): WorldSpec | null {
  if (specs.has(seed)) { const s = specs.get(seed)!; specs.delete(seed); specs.set(seed, s); return s; }
  let spec: WorldSpec | null = null;
  try { spec = createWorld(seed); } catch { spec = null; }
  specs.set(seed, spec);
  while (specs.size > SPEC_CACHE) specs.delete(specs.keys().next().value!);
  return spec;
}
/** Generated rocks of one chunk, or undefined if not built yet and `budget` is spent (chunks are built a few per frame). */
export function chunkRocks(seed: string, cx: number, cy: number, budget: { left: number }): Asteroid[] | undefined {
  const key = `${seed}|${cx},${cy}`, hit = chunks.get(key);
  if (hit) return hit;
  if (budget.left <= 0) return;
  budget.left--;
  const spec = specFor(seed);
  const rocks = spec ? generateChunk(spec, cx, cy) : [];
  if (spec && cx === Math.floor(spec.bases[0].x / CHUNK_SIZE) && cy === Math.floor(spec.bases[0].y / CHUNK_SIZE)) rocks.push(...spec.starter);
  chunks.set(key, rocks);
  while (chunks.size > CHUNK_CACHE) chunks.delete(chunks.keys().next().value!);
  return rocks;
}

export type LiveEnemy = { row: EnemyRow; x: number; y: number; px: number; py: number; t: number };
export type LiveShot = { x: number; y: number; vx: number; vy: number; life: number; t: number; enemy: boolean; beam?: { ex: number; ey: number } };
export type SectorLive = { enemies: Map<number, LiveEnemy>; enemiesAt: number; shots: LiveShot[]; rocks: Map<number, RockState>; looks: Map<string, { look: PilotLook; t: number }> };
const live = new Map<string, SectorLive>();
export function liveFor(seed: string): SectorLive {
  let s = live.get(seed);
  if (!s) live.set(seed, s = { enemies: new Map(), enemiesAt: 0, shots: [], rocks: new Map(), looks: new Map() });
  return s;
}
const MAX_SHOTS = 400;
function applyEnemies(s: SectorLive, rows: EnemyRow[], t: number) {
  const next = new Map<number, LiveEnemy>();
  for (const row of rows) { const old = s.enemies.get(row[0]); next.set(row[0], { row, x: row[2], y: row[3], px: old ? old.x : row[2], py: old ? old.y : row[3], t }); }
  s.enemies = next; s.enemiesAt = t;
}
const pushShot = (s: SectorLive, shot: LiveShot) => { s.shots.push(shot); if (s.shots.length > MAX_SHOTS) s.shots.splice(0, s.shots.length - MAX_SHOTS); };
/** Applies one tapped `cast` (rocks, enemies, shots or a batched fx frame) from a watched sector. */
export function applyCast(seed: string, from: string, kind: string, data: unknown, t: number) {
  const s = liveFor(seed);
  const rock = (r: RockState) => { const old = s.rocks.get(r.id); s.rocks.set(r.id, old && !r.gone ? { ...old, ...r } : r); };
  if (kind === 'rocks') for (const r of decodeRocks(data)) rock(r);
  if (kind === 'enemies') applyEnemies(s, decodeEnemies(data), t);
  if (kind === 'shots') for (const shot of decodeShots(data)) pushShot(s, 'beam' in shot ? { x: shot.x, y: shot.y, vx: 0, vy: 0, life: 0.15, t, enemy: true, beam: { ex: shot.ex, ey: shot.ey } } : { x: shot.x, y: shot.y, vx: shot.vx, vy: shot.vy, life: shot.life, t, enemy: true });
  if (kind !== 'fx' || !data || typeof data !== 'object') return;
  const fx = data as Record<string, unknown>;
  const look = decodeLook(fx.l); if (look) s.looks.set(from, { look, t });
  for (const p of decodePilotShots(fx.p)) pushShot(s, { x: p.x, y: p.y, vx: p.vx, vy: p.vy, life: p.life, t, enemy: false });
  for (const shot of decodeShots(fx.e)) pushShot(s, 'beam' in shot ? { x: shot.x, y: shot.y, vx: 0, vy: 0, life: 0.15, t, enemy: true, beam: { ex: shot.ex, ey: shot.ey } } : { x: shot.x, y: shot.y, vx: shot.vx, vy: shot.vy, life: shot.life, t, enemy: true });
  for (const [id, x, y, vx, vy] of decodeBumps(fx.b)) rock({ id, x, y, vx, vy } as RockState);
  for (const r of decodeRocks(fx.r)) rock(r);
  // Newer clients carry enemies inside fx (`n`); older ones use the separate enemies cast.
  if (Array.isArray(fx.n)) applyEnemies(s, decodeEnemies(fx.n), t);
}
/** Drops expired shots and stale looks. */
export function pruneLive(t: number) {
  for (const s of live.values()) {
    s.shots = s.shots.filter(shot => t - shot.t < shot.life);
    for (const [id, l] of s.looks) if (t - l.t > 0.5) s.looks.delete(id);
  }
}
