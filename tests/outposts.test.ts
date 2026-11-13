import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureModel } from './fixtures.ts';
import { GameModel } from '../src/model.ts';
import { MODULES, OUTPOST, STRUCTURES, MAX_MODULE_LEVEL, type Resource } from '../src/data.ts';
import { ABILITIES } from '../src/abilityConfig.ts';
import { cellOf, cellCenter, structureAt, connectedIds, neighbourMask, outpostRadius, wear } from '../src/outposts.ts';

const idle = { x: 0, y: 0, aim: { x: 0, y: 0 }, fire: false, mine: false, dock: false };
const rich = { iron: 5000, copper: 5000, crystal: 5000, ice: 5000, radioactive: 5000 };
/** A ship in open space with a Build module of the given level and plenty of carried cargo. */
function builderShip(level = 1) {
  const m = fixtureModel(); m.asteroids = []; m.enemies = []; m.squads = [];
  m.coreLevel = 5; m.modules = [{ x: 1, y: 0, kind: 'builder', level, cooldown: 0, integrity: 999 }];
  m.cargoOverride = 1e9; m.cargo = { ...rich }; m.player.x = 9000; m.player.y = 9000; m.player.vx = 0; m.player.vy = 0;
  m.update(0.01, idle); m.energy = m.maxEnergy;
  return m;
}
const cell = (m: GameModel, dx = 0, dy = 3) => ({ cx: cellOf(m.player.x) + dx, cy: cellOf(m.player.y) + dy });

test('the Build module is a five-level ship module that needs Core level 4', () => {
  assert.equal(MODULES.builder.levels.length, MAX_MODULE_LEVEL); assert.equal(ABILITIES.builder.name, 'Industrial Fabricator');
  const stats = MODULES.builder.levels;
  assert.ok(stats[1].buildRange! > stats[0].buildRange! && stats[1].buildSpeed! > stats[0].buildSpeed!);
  assert.ok(stats[2].buildDiscount! > 0 && !stats[1].buildDiscount); assert.ok(stats[3].buildSpeed! > stats[2].buildSpeed!);
  const m = fixtureModel(); m.stored = { ...rich }; m.modules = [];
  for (let level = 1; level < OUTPOST.coreLevel; level++) {
    assert.equal(m.coreLevel, level); assert.match(m.buildError('builder', 1, 0) ?? '', /Core level 4/); assert.equal(m.installModule('builder', 1, 0), false);
    assert.ok(m.upgradeModule(0, 0));
  }
  assert.equal(m.buildError('builder', 1, 0), undefined); assert.ok(m.installModule('builder', 1, 0));
  assert.equal(m.modules.filter(x => x.kind === 'builder').length, 1); assert.equal(m.builder?.level, 1); assert.equal(m.builder?.range, stats[0].buildRange);
});

test('Build Mode needs an intact Build module and energy; losing it keeps existing outposts', () => {
  const none = fixtureModel(); assert.match(none.buildModeError ?? '', /Install a Build module/); assert.equal(none.placeStructure('outpostCore', 500, 500), false);
  const m = builderShip(), at = cell(m);
  assert.equal(m.buildModeError, undefined); assert.ok(m.placeStructure('outpostCore', at.cx, at.cy)); assert.equal(m.outposts.length, 1);
  m.modules[0].integrity = 0; assert.match(m.buildModeError ?? '', /disabled/); assert.equal(m.placeStructure('wall', at.cx + 1, at.cy), false);
  m.modules = []; m.update(0.05, idle); assert.equal(m.outposts.length, 1); assert.equal(m.outposts[0].structures.length, 1);
  const tired = builderShip(); tired.energy = 0; assert.match(tired.buildModeError ?? '', /energy/);
});

test('blocks snap to the world grid, need a core first, must connect, and never overlap or build on obstacles', () => {
  const m = builderShip(), at = cell(m);
  assert.match(m.placeError('wall', at.cx, at.cy) ?? '', /Outpost Core first/);
  assert.equal(m.placeError('outpostCore', at.cx, at.cy), undefined);
  const before = { ...m.cargo }, energy = m.energy; assert.ok(m.placeStructure('outpostCore', at.cx, at.cy));
  for (const ore of Object.keys(before) as Resource[]) assert.equal(before[ore] - m.cargo[ore], STRUCTURES.outpostCore.cost[ore]);
  assert.equal(energy - m.energy, OUTPOST.energyPerBlock);
  const outpost = m.outposts[0], core = outpost.structures[0];
  // Grid alignment: a cell covers exactly cell-size world units starting at a multiple of the cell size.
  assert.equal(cellCenter(core.cx) % OUTPOST.cell, OUTPOST.cell / 2); assert.equal(cellOf(cellCenter(core.cx) - 7.9), core.cx); assert.equal(cellOf(cellCenter(core.cx) + 7.9), core.cx); assert.equal(cellOf(-1), -1);
  assert.match(m.placeError('wall', at.cx, at.cy) ?? '', /already built/);
  assert.match(m.placeError('wall', at.cx + 2, at.cy) ?? '', /touch an existing/);
  assert.match(m.placeError('outpostCore', at.cx + 6, at.cy) ?? '', /another outpost core/);
  assert.ok(m.placeStructure('wall', at.cx + 1, at.cy)); assert.ok(m.placeStructure('reinforcedWall', at.cx + 2, at.cy)); assert.ok(m.placeStructure('wall', at.cx + 1, at.cy + 1));
  assert.equal(outpost.structures.length, 4); assert.equal(structureAt(m.outposts, at.cx + 2, at.cy)?.structure.kind, 'reinforcedWall');
  assert.equal(neighbourMask(outpost, outpost.structures[1]), 1 | 2 | 4);
  // Obstacles and limits.
  m.asteroids = [{ id: 1, x: cellCenter(at.cx), y: cellCenter(at.cy - 1), vx: 0, vy: 0, radius: 20, ore: 'iron', amount: 10, health: 10 }];
  assert.match(m.placeError('wall', at.cx, at.cy - 1) ?? '', /asteroid/); m.asteroids = [];
  m.enemies = [{ id: 2, x: cellCenter(at.cx - 1), y: cellCenter(at.cy), health: 10, cooldown: 99, angle: 0, disabledFor: 99 }];
  assert.match(m.placeError('wall', at.cx - 1, at.cy) ?? '', /ship is in the way/i); m.enemies = [];
  assert.match(m.placeError('wall', cellOf(m.player.x), cellOf(m.player.y)) ?? '', /touch|ship/i);
  assert.match(m.placeError('wall', at.cx, at.cy + 40) ?? '', /range/);
  m.cargo = { iron: 0, copper: 0, crystal: 0, ice: 0, radioactive: 0 }; assert.match(m.placeError('wall', at.cx - 1, at.cy) ?? '', /Not enough carried iron/);
  const station = fixtureModel(); station.coreLevel = 5; station.modules = [{ x: 1, y: 0, kind: 'builder', level: 1, cooldown: 0, integrity: 99 }]; station.cargoOverride = 1e9; station.cargo = { ...rich };
  assert.match(station.placeError('outpostCore', cellOf(station.player.x), cellOf(station.player.y) + 3) ?? '', /station/);
});

test('higher Build module levels build faster, further and cheaper', () => {
  const basic = builderShip(1), expert = builderShip(5), a = cell(basic), b = cell(expert);
  assert.ok(expert.builder!.range > basic.builder!.range);
  assert.equal(expert.structureCost('wall').iron, Math.ceil(STRUCTURES.wall.cost.iron * (1 - MODULES.builder.levels[4].buildDiscount! / 100)));
  assert.equal(basic.structureCost('wall').iron, STRUCTURES.wall.cost.iron);
  basic.placeStructure('outpostCore', a.cx, a.cy); expert.placeStructure('outpostCore', b.cx, b.cy);
  for (let i = 0; i < 20; i++) { basic.update(0.05, idle); expert.update(0.05, idle); }
  assert.ok(expert.outposts[0].structures[0].progress > basic.outposts[0].structures[0].progress * 2.5);
  assert.ok(basic.outposts[0].structures[0].progress < 1);
  const revision = basic.outposts[0].revision;
  for (let i = 0; i < 200; i++) basic.update(0.05, idle);
  assert.equal(basic.outposts[0].structures[0].progress, 1); assert.equal(basic.outposts[0].revision, revision + 1);
});

test('hostile fire damages finished blocks; destroyed blocks drop whatever they held, and losing the core ends the outpost', () => {
  const m = builderShip(5), at = cell(m);
  m.placeStructure('outpostCore', at.cx, at.cy);
  for (const dx of [1, 2, 3]) m.placeStructure('wall', at.cx + dx, at.cy);
  for (let i = 0; i < 120; i++) m.update(0.05, idle);
  const outpost = m.outposts[0], [core, w1, w2, w3] = outpost.structures;
  assert.ok(outpost.structures.every(s => s.progress === 1)); assert.equal(connectedIds(outpost).size, 4);
  // A hostile shot is stopped by the wall; the player's own shot passes over it.
  m.modules = []; m.bullets = [{ id: 50, x: cellCenter(w3.cx) + 60, y: cellCenter(w3.cy), vx: -600, vy: 0, life: 1, enemy: true, damage: 30 }, { id: 51, x: cellCenter(w3.cx) + 60, y: cellCenter(w3.cy) + 16, vx: -600, vy: 0, life: 1, enemy: false, damage: 30 }];
  for (let i = 0; i < 4; i++) m.update(0.05, idle);
  assert.equal(w3.health, STRUCTURES.wall.health - 30); assert.equal(m.bullets.some(b => b.enemy), false);
  const revision = outpost.revision; m.damageStructure(outpost, w3, STRUCTURES.wall.health * 0.5); assert.ok(wear(w3) >= 2); assert.ok(outpost.revision > revision);
  // Destroying the middle wall also drops the walls beyond it.
  m.damageStructure(outpost, w1, 9999);
  assert.deepEqual(outpost.structures.map(s => s.id), [core.id]); assert.equal(structureAt(m.outposts, w2.cx, w2.cy), undefined);
  m.damageStructure(outpost, core, 9999); assert.equal(m.outposts.length, 0); assert.match(m.message, /destroyed/);
});

test('outposts save and load exactly, stay independent, and keep arrivals out', () => {
  const m = builderShip(2), a = cell(m);
  m.placeStructure('outpostCore', a.cx, a.cy); m.placeStructure('wall', a.cx + 1, a.cy); m.placeStructure('reinforcedWall', a.cx, a.cy + 1);
  m.player.x += OUTPOST.coreSpacing + 200; m.update(0.05, idle); m.energy = m.maxEnergy;
  const b = cell(m); assert.ok(m.placeStructure('outpostCore', b.cx, b.cy)); assert.ok(m.placeStructure('wall', b.cx - 1, b.cy));
  assert.equal(m.outposts.length, 2); assert.notEqual(m.outposts[0].name, m.outposts[1].name);
  m.damageStructure(m.outposts[0], m.outposts[0].structures[1], 40);
  for (let i = 0; i < 10; i++) m.update(0.05, idle);
  const cargo = { ...m.cargo }, saved = JSON.parse(JSON.stringify(m.toSave())), restored = GameModel.fromSave(saved);
  assert.deepEqual(restored.outposts, m.outposts);
  // Nothing is duplicated: carried cargo plus any overflow pickups still equals what was carried (the fixture's oversized hold is not saved).
  for (const ore of Object.keys(cargo) as Resource[]) assert.equal(restored.cargo[ore] + restored.drops.filter(d => d.ore === ore).reduce((n, d) => n + d.amount, 0), cargo[ore]);
  assert.equal(restored.outposts.reduce((n, o) => n + o.structures.length, 0), 5);
  const again = GameModel.fromSave(JSON.parse(JSON.stringify(restored.toSave()))); assert.deepEqual(again.outposts, m.outposts);
  assert.ok(outpostRadius(m.outposts[0]) >= OUTPOST.cell * 2);
  // Old saves without outposts still load.
  delete saved.outposts; assert.deepEqual(GameModel.fromSave(saved).outposts, []);
});

test('the level-5 Industrial Fabricator repairs nearby blocks from carried iron and energy, never for free', () => {
  const m = builderShip(5), at = cell(m);
  m.placeStructure('outpostCore', at.cx, at.cy); m.placeStructure('wall', at.cx + 1, at.cy);
  for (let i = 0; i < 80; i++) m.update(0.05, idle);
  const outpost = m.outposts[0], wall = outpost.structures[1]; m.damageStructure(outpost, wall, 100);
  const iron = m.cargo.iron; m.energy = m.maxEnergy;
  for (let i = 0; i < 40; i++) m.update(0.05, idle);
  const repaired = wall.health - (STRUCTURES.wall.health - 100);
  assert.ok(repaired > 30); assert.ok(m.cargo.iron < iron); assert.ok(iron - m.cargo.iron >= Math.floor(repaired * OUTPOST.fabricator.ironPerHp) - 1);
  m.cargo.iron = 0; const stuck = wall.health; for (let i = 0; i < 40; i++) m.update(0.05, idle);
  assert.ok(wall.health - stuck < 13);
  const low = builderShip(4), c = cell(low); low.placeStructure('outpostCore', c.cx, c.cy); for (let i = 0; i < 80; i++) low.update(0.05, idle);
  low.damageStructure(low.outposts[0], low.outposts[0].structures[0], 100); const held = low.outposts[0].structures[0].health;
  for (let i = 0; i < 40; i++) low.update(0.05, idle); assert.equal(low.outposts[0].structures[0].health, held);
});
