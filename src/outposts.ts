import { OUTPOST, STRUCTURES, type StructureKind, type Resource } from './data.ts';

// Player-built outposts: pure data and grid helpers, independent of Phaser and the DOM.
// Structures occupy square cells of the world construction grid (OUTPOST.cell world units,
// aligned to world coordinates 0,0), so a cell index is just floor(world / cell).

export type Structure = { id: number; kind: StructureKind; cx: number; cy: number; rot: number; level: number; health: number; /** 0-1; below 1 the block is still under construction and does nothing. */ progress: number;
  /** Turret state: facing (radians), seconds until it may fire, seconds until it looks for a target again, current target id. */ angle?: number; cooldown?: number; scan?: number; target?: number };
export type Outpost = { id: number; name: string; /** Cell of the Outpost Core, the structural anchor. */ cx: number; cy: number; structures: Structure[]; /** Bumped whenever the outpost's appearance changes, so its baked sprite is redrawn only then. */ revision: number;
  /** Battery charge shared by the outpost's turrets. */ energy?: number; /** Minerals held in the outpost's storage. */ stored?: Record<Resource, number>; /** True while a turret wanted to fire but the battery was too low. */ shortage?: boolean };
type Point = { x: number; y: number };

export const cellOf = (world: number) => Math.floor(world / OUTPOST.cell);
export const cellCenter = (cell: number) => (cell + 0.5) * OUTPOST.cell;
const key = (cx: number, cy: number) => `${cx},${cy}`;
export const NEIGHBOURS: [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1]];

// Cell lookup per outpost, rebuilt only when the structure list changes length or revision.
const indexes = new WeakMap<Outpost, { stamp: string; cells: Map<string, Structure> }>();
function cells(outpost: Outpost) {
  const stamp = `${outpost.revision}:${outpost.structures.length}`;
  let entry = indexes.get(outpost);
  if (!entry || entry.stamp !== stamp) { entry = { stamp, cells: new Map(outpost.structures.map(s => [key(s.cx, s.cy), s])) }; indexes.set(outpost, entry); }
  return entry.cells;
}
export const structureIn = (outpost: Outpost, cx: number, cy: number) => cells(outpost).get(key(cx, cy));
export function structureAt(outposts: Outpost[], cx: number, cy: number) {
  for (const outpost of outposts) {
    if (Math.abs(cx - outpost.cx) > OUTPOST.radius || Math.abs(cy - outpost.cy) > OUTPOST.radius) continue;
    const structure = structureIn(outpost, cx, cy);
    if (structure) return { outpost, structure };
  }
  return undefined;
}
/** The outpost a new block at this cell would join: it must touch an existing block and lie inside the core's construction area. */
export function outpostFor(outposts: Outpost[], cx: number, cy: number) {
  return outposts.find(outpost => Math.abs(cx - outpost.cx) <= OUTPOST.radius && Math.abs(cy - outpost.cy) <= OUTPOST.radius && NEIGHBOURS.some(([dx, dy]) => structureIn(outpost, cx + dx, cy + dy)));
}
export const core = (outpost: Outpost) => structureIn(outpost, outpost.cx, outpost.cy);
/** Ids of every structure joined to the core through side-by-side blocks. */
export function connectedIds(outpost: Outpost) {
  const start = core(outpost), seen = new Set<number>();
  if (!start) return seen;
  const queue = [start]; seen.add(start.id);
  while (queue.length) {
    const s = queue.pop()!;
    for (const [dx, dy] of NEIGHBOURS) { const next = structureIn(outpost, s.cx + dx, s.cy + dy); if (next && !seen.has(next.id)) { seen.add(next.id); queue.push(next); } }
  }
  return seen;
}
/** Bitmask of occupied neighbours (1 east, 2 south, 4 west, 8 north) used to join walls visually. */
export function neighbourMask(outpost: Outpost, s: Structure) {
  return NEIGHBOURS.reduce((mask, [dx, dy], i) => structureIn(outpost, s.cx + dx, s.cy + dy) ? mask | (1 << i) : mask, 0);
}
export function bounds(outpost: Outpost) {
  let minX = outpost.cx, maxX = outpost.cx, minY = outpost.cy, maxY = outpost.cy;
  for (const s of outpost.structures) { minX = Math.min(minX, s.cx); maxX = Math.max(maxX, s.cx); minY = Math.min(minY, s.cy); maxY = Math.max(maxY, s.cy); }
  return { minX, maxX, minY, maxY };
}
export const outpostCenter = (outpost: Outpost): Point => ({ x: cellCenter(outpost.cx), y: cellCenter(outpost.cy) });
/** World radius that covers every block; used to keep asteroid and enemy arrivals out of outposts. */
export function outpostRadius(outpost: Outpost) {
  const b = bounds(outpost), reach = Math.max(outpost.cx - b.minX, b.maxX - outpost.cx, outpost.cy - b.minY, b.maxY - outpost.cy) + 1;
  return reach * OUTPOST.cell * Math.SQRT2;
}
export const maxHealth = (s: Structure) => STRUCTURES[s.kind].health;
/** 0 (intact) to 3 (nearly destroyed); the sprite shows more wear at each step. */
export const wear = (s: Structure) => Math.min(3, Math.floor((1 - Math.max(0, s.health) / maxHealth(s)) * 4));
/** First structure a straight shot from `from` to `to` passes through, sampled every half cell. */
export function structureOnSegment(outposts: Outpost[], from: Point, to: Point) {
  const length = Math.hypot(to.x - from.x, to.y - from.y), steps = Math.max(1, Math.ceil(length / (OUTPOST.cell / 2)));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, x = from.x + (to.x - from.x) * t, y = from.y + (to.y - from.y) * t, hit = structureAt(outposts, cellOf(x), cellOf(y));
    if (hit && hit.structure.progress >= 1) return { ...hit, point: { x, y } };
  }
  return undefined;
}

export type OutpostStats = { generation: number; energyCapacity: number; storageCapacity: number; /** Energy per second if every turret fired continuously. */ peakDemand: number; turrets: number };
const statCache = new WeakMap<Outpost, { stamp: string; stats: OutpostStats }>();
/** Power and storage totals from finished blocks; recomputed only when the outpost changes. */
export function outpostStats(outpost: Outpost): OutpostStats {
  const stamp = `${outpost.revision}:${outpost.structures.length}`, cached = statCache.get(outpost);
  if (cached?.stamp === stamp) return cached.stats;
  const stats: OutpostStats = { generation: 0, energyCapacity: 0, storageCapacity: 0, peakDemand: 0, turrets: 0 };
  for (const s of outpost.structures) {
    if (s.progress < 1) continue;
    const def = STRUCTURES[s.kind];
    stats.generation += def.generation ?? 0; stats.energyCapacity += def.energyCapacity ?? 0; stats.storageCapacity += def.storage ?? 0;
    if (def.turret) { stats.turrets++; stats.peakDemand += def.turret.energy / def.turret.cooldown; }
  }
  statCache.set(outpost, { stamp, stats });
  return stats;
}
export const emptyStore = (): Record<Resource, number> => ({ iron: 0, copper: 0, crystal: 0, ice: 0, radioactive: 0 });
export const storedTotal = (outpost: Outpost) => Object.values(outpost.stored ?? {}).reduce((a, b) => a + b, 0);
