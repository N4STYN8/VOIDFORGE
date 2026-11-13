import { GameModel, PILOT_KEYS, type Galaxy, type GameSave, type Point, type SectorWorld } from './model.ts';
import { PVP, type Resource } from './data.ts';
import { SECTOR_STEPS, entryPoint, sectorKey, sectorSeed, type SectorDirection } from './sectorGrid.ts';
import type { WorldRef } from './netProtocol.ts';

/** How many other players' sectors a pilot keeps their own copy of. The oldest is dropped first. */
export const FOREIGN_LIMIT = 8;

/** The part of a save that stays in its sector when the pilot leaves. */
export function sectorWorld(save: GameSave): SectorWorld {
  const world: Record<string, unknown> = { ...save };
  for (const key of PILOT_KEYS) delete world[key];
  delete world.galaxy;
  return world as SectorWorld;
}
const generated = (seed: string) => sectorWorld(new GameModel(seed).toSave());
/** The station-side starting point of a sector world, used when there is nowhere better to arrive. */
function startPoint(world: SectorWorld): Point {
  const home = world.world.spec.bases[0], angle = world.world.spec.exitAngle;
  return { x: home.x + Math.cos(angle) * 130, y: home.y + Math.sin(angle) * 130 };
}
/** Lays the pilot's fields over a sector world and loads it. The ship arrives at rest and clear of rocks. */
function arrive(save: GameSave, target: SectorWorld, galaxy: Galaxy, at: Point): GameModel {
  const pilot = Object.fromEntries(PILOT_KEYS.map(k => [k, save[k]]));
  const next = GameModel.fromSave({ ...target, ...pilot, player: { ...save.player, x: at.x, y: at.y, vx: 0, vy: 0 }, id: Math.max(save.id, target.id), galaxy } as GameSave);
  next.clearArrival();
  return next;
}
/** Stores the sector being left: in the pilot's own grid, or among their copies of other players' sectors. */
function stash(galaxy: Galaxy, save: GameSave) {
  if (galaxy.away) {
    const foreign = galaxy.foreign ??= {};
    delete foreign[save.seed]; foreign[save.seed] = sectorWorld(save);
    for (const key of Object.keys(foreign).slice(0, Math.max(0, Object.keys(foreign).length - FOREIGN_LIMIT))) delete foreign[key];
  } else galaxy.sectors[sectorKey(galaxy.x, galaxy.y)] = sectorWorld(save);
}

/**
 * Moves the pilot through an edge into the neighbouring sector and returns the model for it.
 * The sector being left is stored whole in the pilot's galaxy record, so its ore depletion, outposts,
 * pickups and enemies are there on return. The pilot's ship, cargo, stored minerals and hangar travel
 * unchanged: nothing is created or deleted, only moved between the two world records.
 * The ship arrives at rest so it cannot carry full speed into an unseen rock. A sector never visited
 * before is generated from its grid seed, so the same neighbour always appears.
 */
export function travel(model: GameModel, direction: SectorDirection, neighbour?: { world: WorldRef; name?: string } | null): GameModel {
  if (model.galaxy.away) throw new Error('the lobby host leads sector travel');
  const save = model.toSave(), galaxy = structuredClone(model.galaxy), step = SECTOR_STEPS[direction];
  stash(galaxy, save);
  const x = galaxy.x + step.dx, y = galaxy.y + step.dy, key = sectorKey(x, y);
  // A never-visited cell can become a matched pilot's home sector; the link is kept so the cell never changes.
  if (neighbour && !galaxy.sectors[key] && !galaxy.links?.[key]) (galaxy.links ??= {})[key] = { home: neighbour.world.home, seed: neighbour.world.seed, name: neighbour.name };
  const link = galaxy.links?.[key];
  const target = galaxy.sectors[key] ?? generated(link?.seed ?? sectorSeed(galaxy.home, x, y));
  delete galaxy.sectors[key];
  const next = arrive(save, target, { ...galaxy, x, y }, entryPoint(direction, save.player));
  next.message = `Entered ${next.sectorName}.`;
  return next;
}

/**
 * Joins a lobby host's world: the pilot flies their own ship into the host's current sector, arriving
 * near `near` (the host's ship) when known. The pilot's own sector is stored and they return to the same
 * spot with `returnHome`. Their copy of the host's sector is kept, so ore they mine there stays mined.
 */
export function enterWorld(model: GameModel, world: WorldRef, near?: Point): GameModel {
  if (world.seed === model.seed) return model;
  const save = model.toSave(), galaxy = structuredClone(model.galaxy);
  const returnPoint = galaxy.away ? { x: galaxy.away.returnX, y: galaxy.away.returnY } : { x: save.player.x, y: save.player.y };
  stash(galaxy, save);
  galaxy.away = { home: world.home, x: world.x, y: world.y, seed: world.seed, returnX: returnPoint.x, returnY: returnPoint.y };
  const own = world.home === galaxy.home ? galaxy.sectors[sectorKey(world.x, world.y)] : undefined;
  const target = galaxy.foreign?.[world.seed] ?? own ?? generated(world.seed);
  if (galaxy.foreign) delete galaxy.foreign[world.seed];
  const next = arrive(save, target, galaxy, near ? { x: near.x + 140, y: near.y + 90 } : startPoint(target));
  next.message = `Joined the lobby world: ${next.sectorName}.`;
  return next;
}

/** Leaves a lobby host's world and flies the pilot back to where they left their own sector. */
export function returnHome(model: GameModel): GameModel {
  const away = model.galaxy.away; if (!away) return model;
  const save = model.toSave(), galaxy = structuredClone(model.galaxy);
  stash(galaxy, save);
  delete galaxy.away;
  const key = sectorKey(galaxy.x, galaxy.y), target = galaxy.sectors[key] ?? generated(sectorSeed(galaxy.home, galaxy.x, galaxy.y));
  delete galaxy.sectors[key];
  const next = arrive(save, target, galaxy, { x: away.returnX, y: away.returnY });
  next.message = `Back in your own ${next.sectorName.toLowerCase()}.`;
  return next;
}

/** Minerals a rebuild costs: per core level, plus crystal from core level 3. */
export function rebuildCost(coreLevel: number): Partial<Record<Resource, number>> {
  const cost: Partial<Record<Resource, number>> = { iron: PVP.rebuildPerCore.iron * coreLevel, copper: PVP.rebuildPerCore.copper * coreLevel };
  if (coreLevel >= 3) cost.crystal = PVP.rebuildRare.crystal * (coreLevel - 2);
  return cost;
}
/**
 * After another pilot destroyed the ship: rebuild it at the home station (home sector, first base), paying
 * `rebuildCost` from stored minerals as far as they go (never below zero). The wreck's sector is stored as usual.
 */
export function rebuildAtHome(model: GameModel): GameModel {
  if (!model.rebuildDue) return model;
  let next = model.galaxy.away ? returnHome(model) : model;
  if (next.galaxy.x !== 0 || next.galaxy.y !== 0) {
    const save = next.toSave(), galaxy = structuredClone(next.galaxy);
    stash(galaxy, save);
    const target = galaxy.sectors[sectorKey(0, 0)] ?? generated(galaxy.home);
    delete galaxy.sectors[sectorKey(0, 0)];
    next = arrive(save, target, { ...galaxy, x: 0, y: 0 }, startPoint(target));
  }
  const cost = rebuildCost(next.coreLevel), paid: string[] = [];
  for (const [ore, amount] of Object.entries(cost) as [Resource, number][]) { const take = Math.min(amount, next.stored[ore]); next.stored[ore] -= take; if (take) paid.push(`${take} ${ore}`); }
  const home = next.bases[0];
  next.rebuildDue = false;
  next.player = { ...next.player, x: home.x, y: home.y + 130, vx: 0, vy: 0, health: next.maxHealth, angle: -Math.PI / 2 };
  next.respawnState();
  next.message = `Ship rebuilt at ${home.name}${paid.length ? ` for ${paid.join(', ')}` : ' (no stored minerals to pay with)'}.`;
  return next;
}
/** True when this sector belongs to the pilot (their own grid cell, not a lobby world or a matched pilot's sector). */
export function ownsSector(model: GameModel) { return !model.galaxy.away && !model.galaxy.links?.[sectorKey(model.galaxy.x, model.galaxy.y)]; }
/** Progression score used to match neighbours: core level counts ten, plus every installed module level. */
export function progressionScore(model: Pick<GameModel, 'coreLevel' | 'modules'>) { return model.coreLevel * 10 + model.modules.reduce((sum, m) => sum + m.level, 0); }
/** Homes this pilot is already linked to, so matchmaking offers someone new. */
export function linkedHomes(model: GameModel) { return [...new Set(Object.values(model.galaxy.links ?? {}).map(l => l.home))]; }
/** The sector world this model is in, as the relay names it. */
export function worldRef(model: GameModel): WorldRef {
  const away = model.galaxy.away, link = model.galaxy.links?.[sectorKey(model.galaxy.x, model.galaxy.y)];
  if (!away && link) return { home: link.home, x: 0, y: 0, seed: model.seed };
  return away ? { home: away.home, x: away.x, y: away.y, seed: model.seed } : { home: model.galaxy.home, x: model.galaxy.x, y: model.galaxy.y, seed: model.seed };
}
