import { OUTPOST, STRUCTURES, STRUCTURE_LEVELS, STRUCTURE_SPECIAL, DRONES, type StructureKind, type Resource, type TurretDefinition } from './data.ts';

// Player-built outposts: pure data and grid helpers, independent of Phaser and the DOM.
// Structures occupy square cells of the world construction grid (OUTPOST.cell world units,
// aligned to world coordinates 0,0), so a cell index is just floor(world / cell).

export type Structure = { id: number; kind: StructureKind; cx: number; cy: number; rot: number; level: number; health: number; /** 0-1; below 1 the block is still under construction and does nothing. */ progress: number;
  /** Turret state: facing (radians), seconds until it may fire, seconds until it looks for a target again, current target id. */ angle?: number; cooldown?: number; scan?: number; target?: number;
  /** Gatling ramp (0-1), seconds since it last fired, and shots fired (for every-Nth-shot specials). */ ramp?: number; quiet?: number; shots?: number };
export type Outpost = { id: number; name: string; /** Cell of the Outpost Core, the structural anchor. */ cx: number; cy: number; structures: Structure[]; /** Bumped whenever the outpost's appearance changes, so its baked sprite is redrawn only then. */ revision: number;
  /** Battery charge shared by the outpost's turrets. */ energy?: number; /** Minerals held in the outpost's storage. */ stored?: Record<Resource, number>; /** True while a turret wanted to fire but the battery was too low. */ shortage?: boolean; drones?: Drone[];
  /** Shield pool and seconds until it may recharge again. */ shield?: number; shieldDelay?: number;
  /** Heat from turret fire; turrets stop while `overheated`. */ heat?: number; overheated?: boolean; purgeCooldown?: number;
  /** Command Network (level-5 core): seconds of boost left and cooldown. */ command?: number; commandCooldown?: number;
  /** Fractional iron owed by automatic repairs. */ repairDebt?: number;
  /** Seconds the ship has been away (capped), seconds until the next raid, raids that happened while away, and raid warning countdown. */ away?: number; settle?: number; raidTimer?: number; pendingRaids?: number; raidWarning?: number;
  /** One-line summary of what happened while the ship was away. */ report?: string };
/** A mining drone. `hangar` is the id of its Drone Hangar block; it carries `load` units of a single `ore`. */
export type Drone = { id: number; hangar: number; x: number; y: number; angle: number; state: 'idle' | 'outbound' | 'mining' | 'returning'; target?: number; ore?: Resource; load: number; timer: number; /** Trips since the last service. */ trips?: number; /** Where its mining beam currently touches the rock. */ beam?: Point };
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
/** One drawn station module: a single block, or a square of `size` cells of the same finished kind drawn as one large module. */
export type StationModule = { kind: StructureKind; cx: number; cy: number; size: number; level: number; rot: number; id: number };
export type StationLayout = { modules: StationModule[]; /** Outermost blocks, which carry blinking navigation lights. */ beacons: Structure[] };
const layouts = new WeakMap<Outpost, { stamp: string; layout: StationLayout }>();
/**
 * Groups finished blocks for drawing (appearance only). Scanning top-left to bottom-right, a block of a
 * mergeable kind claims the largest square of unclaimed, finished blocks of its kind it starts, so
 * the result depends only on the block positions and is the same every time.
 */
export function stationLayout(outpost: Outpost): StationLayout {
  const stamp = `${outpost.revision}:${outpost.structures.length}`, cached = layouts.get(outpost);
  if (cached?.stamp === stamp) return cached.layout;
  const claimed = new Set<number>(), modules: StationModule[] = [];
  const order = [...outpost.structures].sort((a, b) => a.cy - b.cy || a.cx - b.cx);
  for (const s of order) {
    if (claimed.has(s.id)) continue;
    let size = 1, level = s.level;
    if (s.progress >= 1 && OUTPOST.merge.includes(s.kind)) {
      for (let n = OUTPOST.maxMerge; n >= 2; n--) {
        const square: Structure[] = [];
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const t = structureIn(outpost, s.cx + i, s.cy + j); if (t && t.kind === s.kind && t.progress >= 1 && !claimed.has(t.id)) square.push(t); }
        if (square.length === n * n) { size = n; level = Math.min(...square.map(t => t.level)); for (const t of square) claimed.add(t.id); break; }
      }
    }
    claimed.add(s.id); modules.push({ kind: s.kind, cx: s.cx, cy: s.cy, size, level, rot: s.rot, id: s.id });
  }
  const b = bounds(outpost), beacons: Structure[] = [];
  const pick = (test: (s: Structure) => boolean) => { const s = order.find(test); if (s && !beacons.includes(s)) beacons.push(s); };
  pick(s => s.cy === b.minY); pick(s => s.cx === b.maxX); pick(s => s.cy === b.maxY); pick(s => s.cx === b.minX);
  const layout = { modules, beacons }; layouts.set(outpost, { stamp, layout });
  return layout;
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
const lv = (s: { level: number }) => Math.max(1, Math.min(OUTPOST.maxLevel, s.level)) - 1;
export const maxHealth = (s: Structure) => Math.round(STRUCTURES[s.kind].health * STRUCTURE_LEVELS.health[lv(s)]);
/** A block's turret with its level applied: more damage per level, slightly more range, same energy and heat. */
export function turretOf(s: Pick<Structure, 'kind' | 'level'>): TurretDefinition | undefined {
  const base = STRUCTURES[s.kind].turret; if (!base) return undefined;
  return { ...base, damage: Math.round(base.damage * STRUCTURE_LEVELS.damage[lv(s)]), range: Math.round(base.range * (1 + lv(s) * 0.04)) };
}
export const dronesOf = (s: Pick<Structure, 'kind' | 'level'>) => STRUCTURES[s.kind].drones ? STRUCTURE_LEVELS.drones[lv(s)] : 0;
/** Output-type stat (power, battery, storage, shield, cooling, repair) at this block's level. */
export const outputOf = (s: Pick<Structure, 'level'>, base: number | undefined) => (base ?? 0) * STRUCTURE_LEVELS.output[lv(s)];
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

export type OutpostStats = {
  generation: number; /** Extra generation from level-5 reactors while the battery is low. */ overdrive: number; energyCapacity: number; storageCapacity: number;
  /** Energy per second if every turret fired continuously. */ peakDemand: number; turrets: number;
  shieldCapacity: number; shieldRegen: number; cooling: number; heatCapacity: number; repair: number; /** Fraction added to turret range. */ radar: number; radarLevel: number;
  upgrades: boolean; fabrication: boolean; droneService: boolean; refit: boolean; drones: number; rapidService: boolean; command: boolean; purge: boolean; reflect: boolean;
};
const statCache = new WeakMap<Outpost, { stamp: string; stats: OutpostStats }>();
/** Totals from finished blocks at their levels; recomputed only when the outpost changes. */
export function outpostStats(outpost: Outpost): OutpostStats {
  const stamp = `${outpost.revision}:${outpost.structures.length}`, cached = statCache.get(outpost);
  if (cached?.stamp === stamp) return cached.stats;
  const stats: OutpostStats = { generation: 0, overdrive: 0, energyCapacity: 0, storageCapacity: 0, peakDemand: 0, turrets: 0, shieldCapacity: 0, shieldRegen: 0, cooling: 0, heatCapacity: 0, repair: 0, radar: 0, radarLevel: 0,
    upgrades: false, fabrication: false, droneService: false, refit: false, drones: 0, rapidService: false, command: false, purge: false, reflect: false };
  for (const s of outpost.structures) {
    if (s.progress < 1) continue;
    const def = STRUCTURES[s.kind], top = s.level >= OUTPOST.maxLevel, turret = turretOf(s);
    stats.generation += outputOf(s, def.generation); if (top && s.kind === 'reactor') stats.overdrive += outputOf(s, def.generation);
    stats.energyCapacity += outputOf(s, def.energyCapacity); stats.storageCapacity += outputOf(s, def.storage) * (top && s.kind === 'storage' ? 1 + STRUCTURE_SPECIAL.compression : 1);
    stats.shieldCapacity += outputOf(s, def.shield); stats.shieldRegen += outputOf(s, def.shieldRegen); stats.cooling += outputOf(s, def.cooling); stats.heatCapacity += outputOf(s, def.heatCapacity); stats.repair += outputOf(s, def.repair);
    if (def.radar) { stats.radar = Math.max(stats.radar, top ? STRUCTURE_SPECIAL.radar : def.radar); stats.radarLevel = Math.max(stats.radarLevel, s.level); }
    if (def.upgrades) { stats.upgrades = true; stats.fabrication ||= top; }
    if (def.droneService) { stats.droneService = true; stats.refit ||= top; }
    stats.drones += dronesOf(s);
    if (turret) { stats.turrets++; stats.peakDemand += turret.energy / turret.cooldown; }
    if (top) { stats.rapidService ||= s.kind === 'dockingStation'; stats.command ||= s.kind === 'outpostCore'; stats.purge ||= s.kind === 'coolingUnit'; stats.reflect ||= s.kind === 'shieldGenerator'; }
  }
  stats.storageCapacity = Math.round(stats.storageCapacity);
  statCache.set(outpost, { stamp, stats });
  return stats;
}
/** True when a finished shield generator covers this cell. */
export function shielded(outpost: Outpost, s: Structure) {
  return outpost.structures.some(g => g.progress >= 1 && STRUCTURES[g.kind].shieldRadius !== undefined && Math.max(Math.abs(g.cx - s.cx), Math.abs(g.cy - s.cy)) <= STRUCTURES[g.kind].shieldRadius!);
}
/** Rough worth of an outpost to raiders: stored minerals plus a little per block. */
export const outpostValue = (outpost: Outpost) => storedTotal(outpost) + outpost.structures.length * 6;
/** Sustained damage per second of all finished turrets. */
export const turretDps = (outpost: Outpost) => outpost.structures.reduce((n, s) => { const t = s.progress >= 1 ? turretOf(s) : undefined; return n + (t ? t.damage / t.cooldown : 0); }, 0);
export const droneTripsBeforeService = (stats: OutpostStats) => DRONES.serviceEvery * (stats.refit ? STRUCTURE_SPECIAL.refit : 1);
export const emptyStore = (): Record<Resource, number> => ({ iron: 0, copper: 0, crystal: 0, ice: 0, radioactive: 0 });
export const storedTotal = (outpost: Outpost) => Object.values(outpost.stored ?? {}).reduce((a, b) => a + b, 0);
