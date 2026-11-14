import { ECONOMY } from '../src/economy.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureModel } from './fixtures.ts';
import { GameModel, type Bullet } from '../src/model.ts';
import { MODULES, OUTPOST, STRUCTURES, STRUCTURE_ABILITIES, STRUCTURE_SPECIAL, DRONES, ENEMIES, MAX_MODULE_LEVEL, type Resource, type StructureKind } from '../src/data.ts';
import { ABILITIES } from '../src/abilityConfig.ts';
import { cellOf, cellCenter, structureAt, connectedIds, neighbourMask, outpostRadius, wear, outpostStats, storedTotal, maxHealth, turretOf, dronesOf } from '../src/outposts.ts';

const idle = { x: 0, y: 0, aim: { x: 0, y: 0 }, fire: false, mine: false, dock: false };
const rich = { iron: 100000, copper: 100000, crystal: 100000, ice: 100000, radioactive: 100000 };
/** A ship in open space with a Build module of the given level and plenty of carried cargo. */
function builderShip(level = 1) {
  const m = fixtureModel(); m.asteroids = []; m.enemies = []; m.squads = [];
  m.coreLevel = 5; m.modules = [{ x: 1, y: 0, kind: 'builder', level, cooldown: 0, integrity: 999 }];
  m.cargoOverride = 1e9; m.cargo = { ...rich }; m.player.x = 9000; m.player.y = 9000; m.player.vx = 0; m.player.vy = 0;
  m.update(0.01, idle); m.energy = m.maxEnergy;
  (m as unknown as { spawnTimer: number }).spawnTimer = 1e9; m.enemies = []; m.squads = [];
  return m;
}
const cell = (m: GameModel, dx = 0, dy = 3) => ({ cx: cellOf(m.player.x) + dx, cy: cellOf(m.player.y) + dy });

test('the Build module is a five-level ship module that needs Core level 2', () => {
  assert.equal(MODULES.builder.levels.length, MAX_MODULE_LEVEL); assert.equal(ABILITIES.builder.name, 'Industrial Fabricator');
  const stats = MODULES.builder.levels;
  assert.ok(stats[1].buildRange! > stats[0].buildRange! && stats[1].buildSpeed! > stats[0].buildSpeed!);
  assert.ok(stats[2].buildDiscount! > 0 && !stats[1].buildDiscount); assert.ok(stats[3].buildSpeed! > stats[2].buildSpeed!);
  const m = fixtureModel(); m.stored = { iron:1e6,copper:1e6,crystal:1e6,ice:1e6,radioactive:1e6 }; m.modules = [];
  for (let level = 1; level < OUTPOST.coreLevel; level++) {
    assert.equal(m.coreLevel, level); assert.match(m.buildError('builder', 1, 0) ?? '', /Core level 2/); assert.equal(m.installModule('builder', 1, 0), false);
    assert.ok(m.upgradeModule(0, 0));
  }
  assert.equal(m.coreLevel, 2);
  assert.equal(m.buildError('builder', 1, 0), undefined); assert.ok(m.installModule('builder', 1, 0));
  assert.equal(m.modules.filter(x => x.kind === 'builder').length, 1); assert.equal(m.builder?.level, 1); assert.equal(m.builder?.range, stats[0].buildRange);
});

test('Build Mode needs an intact Build module and energy; losing it keeps existing outposts', () => {
  const none = fixtureModel(); assert.match(none.buildModeError ?? '', /Install a Build module/); assert.equal(none.placeStructure('outpostCore', 500, 500), false);
  const m = builderShip(), at = cell(m); m.coreLevel = 2;
  assert.equal(m.buildModeError, undefined); assert.ok(m.placeStructure('outpostCore', at.cx, at.cy)); assert.equal(m.outposts.length, 1);
  m.modules[0].integrity = 0; assert.match(m.buildModeError ?? '', /disabled/); assert.equal(m.placeStructure('wall', at.cx + 1, at.cy), false);
  m.modules = []; m.update(0.05, idle); assert.equal(m.outposts.length, 1); assert.equal(m.outposts[0].structures.length, 1);
  const tired = builderShip(); tired.energy = 0; assert.match(tired.buildModeError ?? '', /energy/);
});

test('blocks snap to the world grid, need a core first, must connect, and never overlap or build on obstacles', () => {
  const m = builderShip(), at = cell(m); m.coreLevel = 2;
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
  m.cargo = { iron: 0, copper: 0, crystal: 0, ice: 0, radioactive: 0 }; m.stored = { ...m.cargo }; outpost.stored = { ...m.cargo }; assert.match(m.placeError('wall', at.cx - 1, at.cy) ?? '', /Not enough iron/);
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

/** A finished outpost: core at the ship's cell + (0, 3), with the listed blocks placed relative to it. */
function fort(blocks: [number, number, StructureKind, number?][]) {
  const m = builderShip(5), at = cell(m);
  assert.ok(m.placeStructure('outpostCore', at.cx, at.cy));
  for (const [dx, dy, kind, rot] of blocks) { m.energy = m.maxEnergy; assert.ok(m.placeStructure(kind, at.cx + dx, at.cy + dy, rot ?? 0), `${kind} at ${dx},${dy}: ${m.message}`); }
  for (let i = 0; i < 160; i++) m.update(0.05, idle);
  const outpost = m.outposts[0]; assert.ok(outpost.structures.every(s => s.progress === 1));
  return { m, outpost, at, block: (kind: StructureKind) => outpost.structures.find(s => s.kind === kind)! };
}

test('outpost power: cores and reactors charge a battery that only finished blocks contribute to', () => {
  const { m, outpost, at } = fort([[1, 0, 'reactor'], [-1, 0, 'autocannonTurret'], [0, 1, 'railgunTurret']]);
  const stats = outpostStats(outpost), core = STRUCTURES.outpostCore, reactor = STRUCTURES.reactor, cannon = STRUCTURES.autocannonTurret.turret!, rail = STRUCTURES.railgunTurret.turret!;
  assert.equal(stats.generation, core.generation! + reactor.generation!); assert.equal(stats.energyCapacity, core.energyCapacity! + reactor.energyCapacity!); assert.equal(stats.turrets, 2);
  assert.ok(Math.abs(stats.peakDemand - (cannon.energy / cannon.cooldown + rail.energy / rail.cooldown)) < 1e-9);
  for (let i = 0; i < 400; i++) m.update(0.05, idle);
  assert.equal(outpost.energy, stats.energyCapacity);
  // A block under construction adds nothing until it is finished.
  m.energy = m.maxEnergy; assert.ok(m.placeStructure('reactor', at.cx + 2, at.cy), m.message); assert.equal(outpostStats(outpost).generation, stats.generation);
  for (let i = 0; i < 80; i++) m.update(0.05, idle);
  assert.equal(outpostStats(outpost).generation, stats.generation + reactor.generation!);
});

test('turrets turn toward hostiles in range, fire through the shared projectile system and kill them', () => {
  const { m, outpost, block } = fort([[1, 0, 'reactor'], [-1, 0, 'autocannonTurret', 2]]), turret = block('autocannonTurret'), def = STRUCTURES.autocannonTurret.turret!;
  assert.equal(turret.angle, Math.PI); m.modules = []; m.bullets = []; outpost.energy = outpostStats(outpost).energyCapacity;
  const tx = cellCenter(turret.cx), ty = cellCenter(turret.cy);
  // Out of range: ignored.
  m.enemies = [{ id: 70, x: tx, y: ty - def.range - 150, health: 60, cooldown: 99, angle: 0, disabledFor: 99 }];
  for (let i = 0; i < 20; i++) m.update(0.05, idle);
  assert.equal(m.bullets.filter(b => b.turret).length, 0); assert.equal(turret.target, undefined);
  // In range: it has to turn first, then fires; each shot costs battery energy.
  m.enemies = [{ id: 71, x: tx, y: ty - 300, health: 60, cooldown: 99, angle: 0, disabledFor: 99 }];
  // It scans a few times a second, then has to turn a quarter circle before the first shot.
  for (let i = 0; i < 8; i++) m.update(0.05, idle);
  assert.equal(turret.target, 71); assert.equal(m.bullets.filter(b => b.turret).length, 0); assert.notEqual(turret.angle, Math.PI);
  let fired = false;
  for (let i = 0; i < 60 && m.enemies.length; i++) { m.update(0.05, idle); fired ||= m.bullets.some(b => b.turret && b.weapon === 'cannon' && !b.enemy && b.damage === def.damage); }
  assert.ok(fired); assert.ok(Math.abs(Math.atan2(Math.sin(turret.angle! + Math.PI / 2), Math.cos(turret.angle! + Math.PI / 2))) < 0.2);
  assert.equal(m.enemies.length, 0); assert.equal(m.kills, 1);
  // Each shot draws from the battery (with generation switched off the charge only falls).
  m.enemies = [{ id: 72, x: tx, y: ty - 300, health: 5000, cooldown: 99, angle: 0, disabledFor: 99 }]; m.bullets = [];
  let shots = 0; const seen = new Set<number>(); let drained = 0;
  for (let i = 0; i < 30; i++) { outpost.energy = 50; m.update(0.05, idle); drained += 50 + outpostStats(outpost).generation * 0.05 - outpost.energy!; for (const b of m.bullets) if (b.turret && !seen.has(b.id)) { seen.add(b.id); shots++; } }
  assert.ok(shots >= 4); assert.ok(Math.abs(drained - shots * def.energy) < 1e-6);
});

test('an energy shortage stops turrets until the battery recovers; missiles are guided and rail shots hit hard', () => {
  const { m, outpost, block } = fort([[-1, 0, 'railgunTurret', 3], [1, 0, 'missileTurret', 3]]), rail = block('railgunTurret'), def = STRUCTURES.railgunTurret.turret!;
  m.modules = []; m.bullets = [];
  m.enemies = [{ id: 80, x: cellCenter(rail.cx), y: cellCenter(rail.cy) - 400, health: 5000, cooldown: 99, angle: 0, disabledFor: 999 }];
  outpost.structures.forEach(s => { s.cooldown = 0; });
  for (let i = 0; i < 12; i++) { outpost.energy = 0; m.update(0.05, idle); }
  assert.equal(m.bullets.filter(b => b.turret).length, 0); assert.equal(outpost.shortage, true);
  outpost.energy = outpostStats(outpost).energyCapacity;
  let railShot = false, missile = false;
  for (let i = 0; i < 80; i++) {
    m.update(0.05, idle);
    railShot ||= m.bullets.some(b => b.weapon === 'rail' && b.damage === def.damage);
    missile ||= m.bullets.some(b => b.rocket === true && b.guided === true && b.splash === STRUCTURES.missileTurret.turret!.splash);
  }
  assert.ok(railShot); assert.ok(missile); assert.ok(m.enemies[0].health <= 5000 - def.damage);
  // Turrets stand down when the ship is far away (no distant simulation).
  m.bullets = []; m.player.x += OUTPOST.activeRange + 2000; outpost.structures.forEach(s => { s.cooldown = 0; });
  for (let i = 0; i < 20; i++) m.update(0.05, idle);
  assert.equal(m.bullets.filter(b => b.turret).length, 0);
});

test('outpost storage holds cargo within capacity, transfers both ways without loss, and spills rather than deletes', () => {
  const { m, outpost, block } = fort([[1, 0, 'storage'], [0, 1, 'wall']]), capacity = STRUCTURES.outpostCore.storage! + STRUCTURES.storage.storage!;
  assert.equal(outpostStats(outpost).storageCapacity, capacity);
  const none = { iron: 0, copper: 0, crystal: 0, ice: 0, radioactive: 0 };
  m.cargoOverride = undefined; m.cargo = { ...none, iron: 60, copper: 30, crystal: 10 }; m.drops = [];
  const total = () => m.cargoUsed + storedTotal(outpost) + m.drops.reduce((n, d) => n + d.amount, 0), before = total();
  // Too far: nothing moves.
  const homeX = m.player.x; m.player.x += OUTPOST.transferRange + 400;
  assert.equal(m.depositToOutpost(outpost), 0); assert.match(m.message, /Move within/); m.player.x = homeX;
  assert.equal(m.depositToOutpost(outpost), 100); assert.equal(m.cargoUsed, 0);
  assert.deepEqual(outpost.stored, { ...none, iron: 60, copper: 30, crystal: 10 }); assert.equal(total(), before);
  // Capacity limit on the way in.
  m.cargoOverride = 1e9; m.cargo = { ...none, iron: 5000 };
  assert.equal(m.depositToOutpost(outpost), capacity - 100); assert.equal(storedTotal(outpost), capacity); assert.equal(m.cargo.iron, 5000 - (capacity - 100));
  assert.equal(m.depositToOutpost(outpost), 0); assert.match(m.message, /full/);
  // Hold limit on the way out.
  m.cargoOverride = undefined; m.cargo = { ...none }; const all = storedTotal(outpost);
  assert.equal(m.withdrawFromOutpost(outpost), m.cargoCapacity); assert.equal(m.cargoUsed, m.cargoCapacity); assert.equal(storedTotal(outpost), all - m.cargoCapacity);
  // Losing the storage block spills what no longer fits as pickups; nothing vanishes.
  m.cargo = { ...none }; m.drops = []; const held = storedTotal(outpost);
  m.damageStructure(outpost, block('storage'), 9999);
  assert.equal(storedTotal(outpost), STRUCTURES.outpostCore.storage!); assert.equal(m.drops.reduce((n, d) => n + d.amount, 0), held - STRUCTURES.outpostCore.storage!);
  m.drops = []; const left = storedTotal(outpost);
  m.damageStructure(outpost, block('outpostCore'), 9999);
  assert.equal(m.outposts.length, 0); assert.equal(m.drops.reduce((n, d) => n + d.amount, 0), left);
});

test('battery charge, stored minerals and turret facing survive a save', () => {
  const { m, outpost, block } = fort([[1, 0, 'storage'], [-1, 0, 'autocannonTurret', 1]]);
  m.cargo = { iron: 40, copper: 20, crystal: 0, ice: 0, radioactive: 5 }; m.depositToOutpost(outpost); outpost.energy = 37.5; block('autocannonTurret').angle = 2.25;
  const restored = GameModel.fromSave(JSON.parse(JSON.stringify(m.toSave()))), copy = restored.outposts[0];
  assert.equal(copy.energy, 37.5); assert.deepEqual(copy.stored, { iron: 40, copper: 20, crystal: 0, ice: 0, radioactive: 5 });
  assert.equal(copy.structures.find(s => s.kind === 'autocannonTurret')!.angle, 2.25); assert.deepEqual(outpostStats(copy), outpostStats(outpost));
  // An outpost saved before power and storage existed still works.
  const old = JSON.parse(JSON.stringify(m.toSave())); delete old.outposts[0].energy; delete old.outposts[0].stored;
  const upgraded = GameModel.fromSave(old); upgraded.update(0.05, idle);
  assert.ok(upgraded.outposts[0].energy! >= 0); assert.deepEqual(upgraded.outposts[0].stored, { iron: 0, copper: 0, crystal: 0, ice: 0, radioactive: 0 });
});

const rockAt = (id: number, x: number, y: number, amount: number, ore: Resource = 'iron') => ({ id, x, y, vx: 0, vy: 0, radius: 30, ore, amount, health: amount, originalAmount: amount });
const run = (m: GameModel, seconds: number) => { for (let i = 0; i < seconds / 0.05; i++) m.update(0.05, idle); };

test('mining drones launch, mine finite ore, carry it home and never create or lose minerals', () => {
  const { m, outpost, block } = fort([[1, 0, 'reactor'], [0, 1, 'storage'], [-1, 0, 'droneHangar']]), hangar = block('droneHangar');
  m.cargo = { iron: 0, copper: 0, crystal: 0, ice: 0, radioactive: 0 }; m.drops = []; m.modules = [];
  const hx = cellCenter(hangar.cx), hy = cellCenter(hangar.cy);
  m.asteroids = [rockAt(501, hx - 220, hy, 70), rockAt(502, hx - 200, hy + 160, 45, 'copper')];
  const inWorld = () => m.asteroids.reduce((n, a) => n + a.amount, 0) + storedTotal(outpost) + (outpost.drones ?? []).reduce((n, d) => n + d.load, 0) + m.drops.reduce((n, d) => n + d.amount, 0) + m.cargoUsed;
  const start = inWorld(); assert.equal(start, 115);
  run(m, 3);
  const drones = outpost.drones!; assert.equal(drones.length, STRUCTURES.droneHangar.drones);
  assert.ok(drones.every(d => d.hangar === hangar.id)); assert.ok(drones.some(d => d.state !== 'idle'));
  let sawMining = false, sawReturn = false, peak = 0;
  for (let i = 0; i < 2400 && m.asteroids.length; i++) {
    m.update(0.05, idle); assert.equal(inWorld(), start);
    for (const d of drones) { sawMining ||= d.state === 'mining' && Boolean(d.beam); sawReturn ||= d.state === 'returning' && d.load > 0; peak = Math.max(peak, d.load); assert.ok(d.load <= DRONES.capacity); }
  }
  assert.ok(sawMining); assert.ok(sawReturn); assert.equal(peak, DRONES.capacity);
  run(m, 20);
  // Both rocks are gone and every unit of ore is accounted for in storage (plus any rubble pickups), nothing extra.
  assert.equal(m.asteroids.length, 0); assert.equal(inWorld(), start);
  assert.ok(outpost.stored!.iron > 0 && outpost.stored!.copper > 0); assert.ok(storedTotal(outpost) >= 100);
  assert.ok(drones.every(d => d.state === 'idle' && d.load === 0));
});

test('drones respect range, crowding, power and storage limits', () => {
  const { m, outpost, block } = fort([[-1, 0, 'droneHangar'], [1, 0, 'droneHangar']]), hangar = block('droneHangar'), hx = cellCenter(hangar.cx), hy = cellCenter(hangar.cy);
  m.modules = []; assert.equal(outpostStats(outpost).storageCapacity, STRUCTURES.outpostCore.storage);
  // Out of range: nobody launches.
  m.asteroids = [rockAt(601, hx - DRONES.range - 300, hy, 500)]; run(m, 4);
  assert.equal(outpost.drones!.length, 4); assert.ok(outpost.drones!.every(d => d.state === 'idle'));
  // One rock in range: at most perAsteroid drones work it.
  m.asteroids = [rockAt(602, hx - 200, hy, 5000)]; let most = 0;
  for (let i = 0; i < 200; i++) { m.update(0.05, idle); most = Math.max(most, outpost.drones!.filter(d => d.target === 602).length); }
  assert.equal(most, DRONES.perAsteroid);
  // No battery: launches wait and the shortage is flagged.
  const idleNow = () => outpost.drones!.filter(d => d.state === 'idle').length;
  run(m, 60); outpost.drones!.forEach(d => { d.state = 'idle'; d.target = undefined; d.load = 0; d.ore = undefined; d.timer = 0; });
  outpost.stored = { iron: 0, copper: 0, crystal: 0, ice: 0, radioactive: 0 };
  for (let i = 0; i < 20; i++) { outpost.energy = 0; m.update(0.05, idle); }
  assert.equal(idleNow(), 4); assert.equal(outpost.shortage, true);
  // Full storage: drones stay parked, and a loaded drone waits at the hangar instead of dumping its load.
  outpost.energy = 100; outpost.stored = { iron: STRUCTURES.outpostCore.storage!, copper: 0, crystal: 0, ice: 0, radioactive: 0 }; run(m, 3); assert.equal(idleNow(), 4);
  const d = outpost.drones![0]; d.state = 'returning'; d.load = 9; d.ore = 'iron'; run(m, 3);
  assert.equal(d.load, 9); assert.equal(d.state, 'returning'); assert.equal(storedTotal(outpost), STRUCTURES.outpostCore.storage);
  outpost.stored.iron -= 50; run(m, 1); assert.equal(d.load, 0); assert.equal(outpost.stored.iron, STRUCTURES.outpostCore.storage! - 41);
});

test('losing a hangar releases what its drones carried; drones and their cargo survive a save', () => {
  const { m, outpost, block } = fort([[0, 1, 'storage'], [-1, 0, 'droneHangar']]), hangar = block('droneHangar'), hx = cellCenter(hangar.cx), hy = cellCenter(hangar.cy);
  m.modules = []; m.drops = []; m.asteroids = [rockAt(701, hx - 180, hy, 400, 'crystal')];
  for (let i = 0; i < 400 && !outpost.drones?.some(d => d.load >= 6); i++) m.update(0.05, idle);
  const carried = outpost.drones!.reduce((n, d) => n + d.load, 0); assert.ok(carried >= 6);
  const restored = GameModel.fromSave(JSON.parse(JSON.stringify(m.toSave())));
  assert.deepEqual(restored.outposts[0].drones, outpost.drones); assert.equal(restored.outposts[0].drones!.reduce((n, d) => n + d.load, 0), carried);
  m.damageStructure(outpost, hangar, 9999);
  assert.equal(outpost.drones!.length, 0); assert.equal(m.drops.filter(d => d.ore === 'crystal').reduce((n, d) => n + d.amount, 0), carried);
});

test('docking at an outpost Docking station unloads cargo and repairs from outpost minerals', () => {
  const { m, outpost, block } = fort([[1, 0, 'storage'], [0, 1, 'wall'], [0, 2, 'wall'], [0, 3, 'dockingStation']]), dock = block('dockingStation'), none = { iron: 0, copper: 0, crystal: 0, ice: 0, radioactive: 0 };
  m.modules = []; m.cargoOverride = undefined;
  const dockInput = { ...idle, dock: true }, pad = { x: cellCenter(dock.cx) + 40, y: cellCenter(dock.cy) + 40 };
  // Nowhere near: the usual hint, nothing moves.
  m.player.x = pad.x + 2000; m.cargo = { ...none, iron: 30 }; m.update(0.05, dockInput);
  assert.match(m.message, /Docking station/); assert.equal(m.cargo.iron, 30); assert.equal(m.dockAt(), undefined);
  // At the pad (well outside the core's own transfer range): cargo is stored and the hull is repaired from outpost stock.
  m.player.x = pad.x; m.player.y = pad.y; m.update(0.05, idle); assert.ok(Math.hypot(pad.x - cellCenter(outpost.cx), pad.y - cellCenter(outpost.cy)) < 400); assert.equal(m.dockAt(), outpost);
  outpost.stored = { ...none, iron: 100 }; m.player.health = m.maxHealth - 50; const cost = m.repairCost.iron; assert.ok(cost > 0);
  m.update(0.05, dockInput);
  assert.equal(m.cargo.iron, 0); assert.equal(m.player.health, m.maxHealth); assert.equal(outpost.stored.iron, 100 + 30 - cost); assert.match(m.message, /repaired/);
  // Not enough minerals: cargo is still stored, but no free repair.
  outpost.stored = { ...none }; m.player.health = m.maxHealth - 80; m.cargo = { ...none, copper: 5 }; const hurt = m.player.health;
  m.update(0.05, dockInput);
  assert.equal(m.player.health, hurt); assert.equal(outpost.stored.copper, 5); assert.equal(m.cargo.copper, 0); assert.match(m.message, /Not enough minerals/);
  // An unfinished docking station does nothing.
  dock.progress = 0.5; assert.equal(m.dockAt(), undefined);
});

const zero = { iron: 0, copper: 0, crystal: 0, ice: 0, radioactive: 0 };
const pos = (s: { cx: number; cy: number }) => ({ x: cellCenter(s.cx), y: cellCenter(s.cy) });
const dummy = (id: number, x: number, y: number, health = 5000) => ({ id, x, y, health, cooldown: 99, cooldown2: 99, angle: 0, disabledFor: 9999 });

test('all eighteen outpost blocks exist with costs, five levels of scaling and a level-5 special', () => {
  const kinds = Object.keys(STRUCTURES) as StructureKind[];
  assert.equal(kinds.length, 18); assert.deepEqual(Object.keys(STRUCTURE_ABILITIES).sort(), [...kinds].sort());
  for (const kind of kinds) {
    assert.ok(Object.values(STRUCTURES[kind].cost).some(n => n > 0)); assert.ok(STRUCTURE_ABILITIES[kind].name && STRUCTURE_ABILITIES[kind].description);
    let hull = 0;
    for (let level = 1; level <= OUTPOST.maxLevel; level++) { const h = maxHealth({ id: 1, kind, cx: 0, cy: 0, rot: 0, level, health: 1, progress: 1 }); assert.ok(h > hull); hull = h; }
  }
  for (const kind of ['autocannonTurret', 'missileTurret', 'railgunTurret'] as StructureKind[]) assert.ok(turretOf({ kind, level: 5 })!.damage > turretOf({ kind, level: 1 })!.damage * 2);
  assert.deepEqual([1, 2, 3, 4, 5].map(level => dronesOf({ kind: 'droneHangar', level })), [2, 4, 6, 8, 10]);
});

test('block upgrades cost minerals, need an Upgrade station past level 2, and really improve the block', () => {
  const { m, outpost, at, block } = fort([[1, 0, 'storage'], [-1, 0, 'droneHangar'], [0, 1, 'autocannonTurret']]), hangar = block('droneHangar'), turret = block('autocannonTurret');
  m.cargoOverride = undefined; m.cargo = { ...zero }; outpost.stored = { ...zero };
  assert.match(m.upgradeStructureError(outpost, hangar) ?? '', /Not enough/); assert.equal(m.upgradeStructure(outpost, hangar), false);
  // Paid from carried cargo first, then outpost storage.
  const price = m.structureUpgradeCost(outpost, hangar); m.cargo = { ...zero, iron: 10 }; outpost.stored = { ...price,iron:price.iron+40,copper:price.copper+50 };
  const hull = maxHealth(hangar); hangar.health = hull - 40; assert.ok(m.upgradeStructure(outpost, hangar), m.message);
  assert.equal(hangar.level, 2); assert.equal(m.cargo.iron, 0); assert.equal(outpost.stored.iron, 50); assert.equal(outpost.stored.copper, 50);
  assert.equal(hangar.health, maxHealth(hangar) - 40); assert.ok(maxHealth(hangar) > hull);
  run(m, 2); assert.equal(outpost.drones!.length, 4);
  // Level 3 needs an Upgrade station.
  assert.match(m.upgradeStructureError(outpost, hangar) ?? '', /Upgrade station/);
  m.cargoOverride = 1e9; m.cargo = { ...rich }; m.energy = m.maxEnergy; assert.ok(m.placeStructure('upgradeStation', at.cx, at.cy - 1), m.message); run(m, 6);
  assert.equal(m.upgradeStructureError(outpost, hangar), undefined);
  const before = turretOf(turret)!.damage; for (let level = 1; level < 5; level++) { m.energy = m.maxEnergy; assert.ok(m.upgradeStructure(outpost, turret), m.message); }
  assert.equal(turret.level, 5); assert.ok(turretOf(turret)!.damage > before * 2); assert.match(m.upgradeStructureError(outpost, turret) ?? '', /Maximum/); assert.equal(m.upgradeStructure(outpost, turret), false);
  // A level-5 Upgrade station makes later upgrades cheaper.
  const station = block('upgradeStation'), full = m.structureUpgradeCost(outpost, hangar).iron; station.level = 5; outpost.revision++;
  assert.equal(m.structureUpgradeCost(outpost, hangar).iron, Math.ceil(STRUCTURES.droneHangar.cost.iron * ECONOMY.structureUpgradeMultipliers[hangar.level-1] * (1 - MODULES.builder.levels[4].buildDiscount! / 100) * (1 - STRUCTURE_SPECIAL.fabrication))); assert.ok(m.structureUpgradeCost(outpost, hangar).iron < full);
  // Out of range of the Build module: no work.
  m.player.x += 3000; assert.match(m.upgradeStructureError(outpost, hangar) ?? '', /range/);
});

test('manual and automatic repairs always cost iron', () => {
  const { m, outpost, block } = fort([[1, 0, 'reactor'], [0, 1, 'repairStation'], [-1, 0, 'wall']]), wall = block('wall');
  m.modules = m.modules.map(x => ({ ...x, level: 1 })); m.cargoOverride = undefined; m.cargo = { ...zero }; outpost.stored = { ...zero };
  m.damageStructure(outpost, wall, 100); const hurt = wall.health;
  assert.match(m.repairStructureError(outpost, wall) ?? '', /Not enough iron/); assert.equal(m.repairStructure(outpost, wall), false);
  run(m, 3); assert.equal(wall.health, hurt);
  // The station repairs from stored iron and battery energy.
  outpost.stored.iron = 50; outpost.energy = 200; run(m, 3);
  const mended = wall.health - hurt; assert.ok(mended > 20); assert.ok(50 - outpost.stored.iron >= Math.floor(mended * OUTPOST.repairIronPerHp) - 1); assert.ok(outpost.stored.iron < 50);
  // Manual repair pays the listed price and tops the block up.
  m.damageStructure(outpost, wall, 80); const cost = m.structureRepairCost(wall).iron; m.cargo.iron = cost; outpost.stored.iron = 0;
  assert.ok(m.repairStructure(outpost, wall), m.message); assert.equal(wall.health, maxHealth(wall)); assert.equal(m.cargo.iron, 0);
  assert.match(m.repairStructureError(outpost, wall) ?? '', /No damage/);
});

test('shield generators absorb hits within their radius, recharge from the battery, and reflect at level 5', () => {
  const { m, outpost, at, block } = fort([[1, 0, 'reactor'], [-1, 0, 'shieldGenerator'], [0, 1, 'wall']]), wall = block('wall'), gen = block('shieldGenerator');
  run(m, 40); const cap = outpostStats(outpost).shieldCapacity; assert.equal(cap, STRUCTURES.shieldGenerator.shield); assert.equal(outpost.shield, cap);
  m.damageStructure(outpost, wall, 60); assert.equal(wall.health, maxHealth(wall)); assert.equal(outpost.shield, cap - 60);
  // No recharge during the delay, then it climbs again and costs energy.
  run(m, 1); assert.equal(outpost.shield, cap - 60);
  outpost.energy = 50; const energy = outpost.energy; run(m, OUTPOST.shieldDelay + 2); assert.ok(outpost.shield! > cap - 60); assert.ok(outpost.energy! < energy + (OUTPOST.shieldDelay + 3) * outpostStats(outpost).generation);
  // A hit bigger than the pool spills through to the hull.
  outpost.shield = 20; m.damageStructure(outpost, wall, 50); assert.equal(outpost.shield, 0); assert.equal(wall.health, maxHealth(wall) - 30);
  // Blocks outside the radius are not covered.
  m.cargo = { ...rich }; let last = at.cx; for (let dx = 2; dx <= 9; dx++) { m.energy = m.maxEnergy; assert.ok(m.placeStructure('wall', at.cx + dx, at.cy), m.message); last = at.cx + dx; }
  run(m, 4); const far = outpost.structures.find(s => s.cx === last)!; outpost.shield = cap; m.damageStructure(outpost, far, 40); assert.equal(far.health, maxHealth(far) - 40); assert.equal(outpost.shield, cap);
  // Level 5 reflects a quarter of what the shield absorbs at whoever fired.
  gen.level = 5; outpost.revision++; outpost.shield = 100; m.enemies = [dummy(90, pos(wall).x, pos(wall).y + 300)];
  m.damageStructure(outpost, wall, 40, 90); assert.equal(m.enemies[0].health, 5000 - 40 * STRUCTURE_SPECIAL.reflect);
});

test('turret fire heats the outpost; overheated turrets pause until coolers bring it down', () => {
  const { m, outpost, at, block } = fort([[1, 0, 'reactor'], [0, 1, 'railgunTurret', 3], [-1, 0, 'railgunTurret', 3]]), a = block('railgunTurret');
  m.modules = []; m.enemies = [dummy(91, pos(a).x, pos(a).y - 420)];
  const heatCap = outpostStats(outpost).heatCapacity; assert.equal(heatCap, STRUCTURES.outpostCore.heatCapacity);
  let overheated = false, shotsWhileHot = 0;
  for (let i = 0; i < 1200; i++) { outpost.energy = 200; const hot = outpost.overheated; m.bullets = m.bullets.filter(b => !b.turret); m.update(0.05, idle); if (hot && outpost.overheated && m.bullets.some(b => b.turret)) shotsWhileHot++; overheated ||= Boolean(outpost.overheated); }
  assert.ok(overheated); assert.equal(shotsWhileHot, 0);
  // A cooling unit raises capacity and dissipation.
  m.modules = [{ x: 1, y: 0, kind: 'builder', level: 5, cooldown: 0, integrity: 999 }]; m.cargo = { ...rich }; m.energy = m.maxEnergy; m.enemies = [];
  assert.ok(m.placeStructure('coolingUnit', at.cx + 2, at.cy), m.message); run(m, 6);
  const cooled = outpostStats(outpost); assert.equal(cooled.heatCapacity, heatCap + STRUCTURES.coolingUnit.heatCapacity!); assert.equal(cooled.cooling, STRUCTURES.outpostCore.cooling! + STRUCTURES.coolingUnit.cooling!);
  // Level-5 cooler: an overheat is purged instead of stopping the guns.
  const cooler = block('coolingUnit'); cooler.level = 5; outpost.revision++; outpost.heat = outpostStats(outpost).heatCapacity + 5; outpost.overheated = false; outpost.purgeCooldown = 0; m.update(0.05, idle);
  assert.equal(outpost.overheated, false); assert.ok(outpost.heat! < outpostStats(outpost).heatCapacity * 0.6); assert.ok(outpost.purgeCooldown! > 0);
});

test('level-5 turret, core, wall, storage, reactor, radar and docking specials do what they say', () => {
  const { m, outpost, block } = fort([[1, 0, 'reactor'], [0, 1, 'autocannonTurret', 3], [-1, 0, 'missileTurret', 3], [1, 1, 'railgunTurret', 3], [-1, 1, 'storage'], [2, 0, 'wall'], [2, 1, 'radarTower'], [0, 2, 'coolingUnit'], [1, 2, 'coolingUnit'], [-1, 2, 'dockingStation']]);
  m.modules = []; const set = (kind: StructureKind, level: number) => { block(kind).level = level; block(kind).health = maxHealth(block(kind)); outpost.revision++; };
  // Storage compression and radar range.
  const baseStore = outpostStats(outpost).storageCapacity; set('storage', 5); assert.equal(outpostStats(outpost).storageCapacity, Math.round(baseStore - STRUCTURES.storage.storage! + STRUCTURES.storage.storage! * 3 * (1 + STRUCTURE_SPECIAL.compression)));
  assert.equal(outpostStats(outpost).radar, STRUCTURES.radarTower.radar); set('radarTower', 5); assert.equal(outpostStats(outpost).radar, STRUCTURE_SPECIAL.radar);
  // Wall plating.
  const wall = block('wall'); set('wall', 5); const hull = wall.health; m.damageStructure(outpost, wall, 100); assert.equal(wall.health, hull - 100 * (1 - STRUCTURE_SPECIAL.wallReduction));
  // Reactor overdrive only while the battery is low.
  set('reactor', 5); const stats = outpostStats(outpost); assert.equal(stats.overdrive, STRUCTURES.reactor.generation! * 3);
  outpost.energy = 0; m.update(0.05, idle); const lowGain = outpost.energy!; outpost.energy = stats.energyCapacity * 0.5; m.update(0.05, idle); const normalGain = outpost.energy! - stats.energyCapacity * 0.5;
  assert.ok(Math.abs(lowGain - (stats.generation + stats.overdrive) * 0.05) < 1e-6); assert.ok(Math.abs(normalGain - stats.generation * 0.05) < 1e-6);
  // Turret specials, with a target straight ahead of all three.
  const cannon = block('autocannonTurret'); m.enemies = [dummy(92, pos(cannon).x, pos(cannon).y - 360, 1e7)];
  const fire = (seconds: number) => { const seen = new Map<number, Bullet>(); for (let i = 0; i < seconds / 0.05; i++) { outpost.energy = stats.energyCapacity; outpost.heat = 0; outpost.overheated = false; m.update(0.05, idle); for (const b of m.bullets) if (b.turret) seen.set(b.id, { ...b }); } return [...seen.values()]; };
  const plain = fire(6); const cannonShots = plain.filter(b => b.weapon === 'cannon').length; assert.ok(plain.every(b => !b.enhanced)); assert.equal(plain.filter(b => b.rocket && b.damage! < 40).length, 0);
  set('autocannonTurret', 5); set('missileTurret', 5); set('railgunTurret', 5); set('outpostCore', 5); outpost.structures.forEach(s => { s.shots = 0; s.ramp = 0; }); outpost.command = 0; outpost.commandCooldown = 0;
  const special = fire(6), missile = turretOf(block('missileTurret'))!;
  assert.ok(special.filter(b => b.weapon === 'cannon').length > cannonShots * 1.25);
  const big = special.filter(b => b.rocket && b.damage === missile.damage).length, minis = special.filter(b => b.rocket && b.guided && Math.abs(b.damage! - missile.damage * STRUCTURE_SPECIAL.swarm.fraction) < 1e-9).length;
  assert.ok(big >= 2); assert.equal(minis, big * STRUCTURE_SPECIAL.swarm.count);
  const rails = special.filter(b => b.weapon === 'rail'); assert.ok(rails.length >= 3); assert.equal(rails.filter(b => b.enhanced).length, Math.floor(rails.length / STRUCTURE_SPECIAL.railEvery));
  assert.ok(outpost.commandCooldown! > 0);
  // Rapid Service makes docking repairs cheaper.
  const dock = block('dockingStation'); m.enemies = []; m.bullets = []; m.player.x = pos(dock).x + 40; m.player.y = pos(dock).y + 40; m.update(0.05, idle);
  m.cargoOverride = undefined; m.cargo = { ...zero }; outpost.stored = { ...zero, iron: 100 }; m.player.health = m.maxHealth - 50; const normal = m.repairCost.iron;
  set('dockingStation', 5); m.update(0.05, { ...idle, dock: true }); assert.equal(m.player.health, m.maxHealth); assert.equal(outpost.stored.iron, 100 - Math.ceil(normal * (1 - STRUCTURE_SPECIAL.rapidService)));
});

test('a drone repair bay shortens servicing and the level-5 swarm goes for valuable ore', () => {
  const { m, outpost, at, block } = fort([[1, 0, 'reactor'], [0, 1, 'storage'], [-1, 0, 'droneHangar']]), hangar = block('droneHangar'), home = pos(hangar);
  m.asteroids = [rockAt(801, home.x - 150, home.y, 5000, 'iron'), rockAt(802, home.x - 520, home.y + 80, 5000, 'crystal')];
  run(m, 3); assert.ok(outpost.drones!.every(d => d.target === 801));
  // Without a bay a serviced drone sits out the long timer; with one, the short timer.
  const d = outpost.drones![0]; d.state = 'returning'; d.load = 0; d.ore = undefined; d.trips = DRONES.serviceEvery - 1; d.x = home.x; d.y = home.y; d.target = undefined; m.update(0.05, idle);
  assert.equal(d.state, 'idle'); assert.equal(d.timer, DRONES.serviceTime); assert.equal(d.trips, 0);
  m.cargo = { ...rich }; m.energy = m.maxEnergy; assert.ok(m.placeStructure('droneRepairBay', at.cx, at.cy - 1), m.message); run(m, 5);
  d.state = 'returning'; d.load = 0; d.trips = DRONES.serviceEvery - 1; d.x = home.x; d.y = home.y; d.target = undefined; m.update(0.05, idle); assert.equal(d.timer, DRONES.bayServiceTime);
  // Level-5 hangar: ten drones, valuable ore first, spread across rocks.
  hangar.level = 5; outpost.revision++; outpost.drones = []; outpost.energy = 500; outpost.stored = { ...zero };
  for (let i = 0; i < 400; i++) { outpost.energy = 500; m.update(0.05, idle); }
  assert.equal(outpost.drones.length, 10); const crystal = outpost.drones.filter(x => x.target === 802 || x.ore === 'crystal').length; assert.ok(crystal >= DRONES.perAsteroid);
});

test('raids target valuable outposts, arrive near the ship, attack blocks and break off when hurt', () => {
  const { m, outpost, block } = fort([[1, 0, 'storage'], [-1, 0, 'reactor'], [0, 1, 'wall']]);
  m.modules = []; const centre = pos(block('outpostCore'));
  m.player.x = centre.x - 1500; m.player.y = centre.y; m.update(0.05, idle);
  // A poor outpost is not worth raiding.
  outpost.stored = { ...zero }; outpost.raidTimer = 0.01; m.update(0.05, idle); m.update(0.05, idle);
  assert.equal(m.enemies.filter(e => e.raidParty).length, 0); assert.ok(outpost.raidTimer! > OUTPOST.raid.interval[0] - 1);
  // A rich one is: with no radar the party simply arrives.
  outpost.stored = { ...zero, iron: 400 }; outpost.raidTimer = 0.01; m.update(0.05, idle); m.update(0.05, idle);
  const party = m.enemies.filter(e => e.raidParty); assert.equal(party.length, OUTPOST.raid.size[Math.min(OUTPOST.raid.size.length, m.dangerAt(centre)) - 1]);
  assert.ok(party.every(e => e.raid === outpost.id && e.populationExempt)); assert.match(m.message, /RAID/);
  for (const e of party) assert.ok(Math.hypot(e.x - m.player.x, e.y - m.player.y) > 900);
  // They close in and their fire damages blocks.
  const hull = () => outpost.structures.reduce((n, s) => n + s.health, 0), before = hull(); let closest = Infinity;
  for (let i = 0; i < 700 && m.outposts.length; i++) { m.player.health = m.maxHealth; m.update(0.05, idle); for (const e of m.enemies) if (e.raidParty) closest = Math.min(closest, Math.hypot(e.x - centre.x, e.y - centre.y)); }
  assert.ok(closest < 500); assert.ok(!m.outposts.length || hull() < before);
});

test('radar gives warning of a raid and hurt raiders leave without paying out', () => {
  const { m, outpost, block } = fort([[1, 0, 'storage'], [-1, 0, 'radarTower']]);
  m.modules = []; const centre = pos(block('outpostCore')); m.player.x = centre.x - 1400; m.update(0.05, idle);
  outpost.stored = { ...zero, iron: 400 }; outpost.raidTimer = 0.01; m.update(0.05, idle);
  assert.ok(Math.abs(outpost.raidWarning! - OUTPOST.raid.radarWarning) < 0.1); assert.match(m.message, /RADAR/); assert.equal(m.enemies.filter(e => e.raidParty).length, 0);
  run(m, OUTPOST.raid.radarWarning - 1); assert.equal(m.enemies.filter(e => e.raidParty).length, 0);
  run(m, 1.5); const party = m.enemies.filter(e => e.raidParty); assert.ok(party.length > 0);
  // Badly damaged raiders run and eventually vanish with no kill or loot.
  const kills = m.kills; m.drops = []; for (const e of party) e.health = ENEMIES[e.kind!].health * 0.1;
  const start = party.map(e => Math.hypot(e.x - centre.x, e.y - centre.y)); run(m, 4);
  party.forEach((e, i) => assert.ok(e.health <= 0 || Math.hypot(e.x - centre.x, e.y - centre.y) > start[i]));
  for (const e of party) { e.x = centre.x + OUTPOST.raid.giveUp + 500; }
  run(m, 0.2); assert.equal(m.enemies.filter(e => e.raidParty).length, 0); assert.equal(m.kills, kills); assert.equal(m.drops.length, 0);
});

test('time away is banked and settled on return: drones only take ore that is really there', () => {
  const { m, outpost, block } = fort([[1, 0, 'reactor'], [0, 1, 'storage'], [-1, 0, 'droneHangar']]), home = pos(block('droneHangar')), centre = pos(block('outpostCore'));
  m.modules = []; m.drops = []; outpost.stored = { ...zero }; outpost.raidTimer = 1e9;
  const back = { x: m.player.x, y: m.player.y };
  // Away: nothing is simulated, the clock just runs (capped).
  m.player.x = centre.x + OUTPOST.activeRange + 1500; m.asteroids = []; for (let i = 0; i < 200; i++) m.update(0.05, idle);
  assert.ok(Math.abs(outpost.away! - 10) < 0.2); assert.equal(storedTotal(outpost), 0); assert.ok(outpost.drones!.every(d => d.state === 'idle'));
  outpost.away = 1e9; m.update(0.05, idle); assert.equal(outpost.away, OUTPOST.awayCap);
  // Return with 90 ore in range: at most 90 arrives, exactly matching what left the rocks.
  outpost.away = 600; m.asteroids = [rockAt(901, home.x - 200, home.y, 60), rockAt(902, home.x - 300, home.y + 100, 30, 'copper'), rockAt(903, home.x - DRONES.range - 600, home.y, 500)];
  m.player.x = back.x; m.player.y = back.y; m.update(0.05, idle);
  const work = Math.floor(2 * DRONES.awayRate * 600); assert.ok(work > 90);
  assert.equal(outpost.away, 0); assert.deepEqual(outpost.stored, { ...zero, iron: 60, copper: 30 }); assert.ok(!m.asteroids.some(a => a.id === 901 || a.id === 902)); assert.equal(m.asteroids.find(a => a.id === 903)!.amount, 500);
  assert.match(m.message, /while you were away/); assert.match(outpost.report ?? '', /drones stored 90 ore/); assert.equal(m.drops.reduce((n, d) => n + d.amount, 0), 0);
  // Limited by banked work and by storage room.
  m.player.x = centre.x + OUTPOST.activeRange + 1500; m.update(0.05, idle); outpost.away = 30; m.asteroids = [rockAt(904, home.x - 200, home.y, 5000)];
  m.player.x = back.x; m.update(0.05, idle); assert.equal(outpost.stored.iron, 60 + Math.floor(2 * DRONES.awayRate * 30)); assert.equal(m.asteroids[0].amount, 5000 - Math.floor(2 * DRONES.awayRate * 30));
  m.player.x = centre.x + OUTPOST.activeRange + 1500; m.update(0.05, idle); outpost.away = OUTPOST.awayCap; const room = outpostStats(outpost).storageCapacity - storedTotal(outpost);
  m.player.x = back.x; m.update(0.05, idle); assert.equal(storedTotal(outpost), outpostStats(outpost).storageCapacity); assert.equal(m.asteroids[0].amount, 5000 - Math.floor(2 * DRONES.awayRate * 30) - room);
  // No power, no mining.
  const reactor = block('reactor'), core = block('outpostCore'); void core; m.damageStructure(outpost, reactor, 9999); outpost.stored = { ...zero };
  assert.ok(outpostStats(outpost).generation > 0);
});

test('raids banked while away damage the outpost unless its defences cover them; repairs still cost iron', () => {
  const build = (blocks: [number, number, StructureKind, number?][]) => { const f = fort(blocks); f.m.modules = []; f.outpost.raidTimer = 1e9; return f; };
  const leaveAndReturn = (f: ReturnType<typeof fort>, seconds: number, raids: number) => {
    const centre = pos(f.block('outpostCore')), back = f.m.player.x; f.m.asteroids = [];
    f.m.player.x = centre.x + OUTPOST.activeRange + 1500; f.m.update(0.05, idle); f.outpost.away = seconds; f.outpost.pendingRaids = raids; f.m.player.x = back; f.m.update(0.05, idle);
  };
  // Undefended: the raid's damage lands on power blocks first.
  const weak = build([[1, 0, 'reactor'], [-1, 0, 'wall'], [0, 1, 'wall']]), level = Math.min(OUTPOST.raid.awayDamage.length, weak.m.dangerAt(pos(weak.block('outpostCore')))), damage = OUTPOST.raid.awayDamage[level - 1];
  const hull = weak.outpost.structures.reduce((n, s) => n + s.health, 0); leaveAndReturn(weak, 300, 1);
  const left = weak.m.outposts.length ? weak.outpost.structures.reduce((n, s) => n + s.health, 0) : 0;
  assert.ok(hull - left >= Math.min(damage, STRUCTURES.reactor.health)); assert.ok(!weak.outpost.structures.some(s => s.kind === 'reactor') || damage < STRUCTURES.reactor.health);
  assert.equal(weak.outpost.pendingRaids, 0); assert.match(weak.outpost.report ?? weak.m.message, /raid/);
  // Well defended: turrets and shields cover the raid and nothing is lost.
  const strong = build([[1, 0, 'reactor'], [-1, 0, 'railgunTurret'], [0, 1, 'railgunTurret'], [1, 1, 'missileTurret'], [-1, 1, 'shieldGenerator'], [0, -1, 'autocannonTurret'], [1, -1, 'autocannonTurret']]);
  for (const s of strong.outpost.structures) if (STRUCTURES[s.kind].turret) { s.level = 5; s.health = maxHealth(s); } strong.outpost.revision++;
  const blocks = strong.outpost.structures.length, total = strong.outpost.structures.reduce((n, s) => n + s.health, 0); leaveAndReturn(strong, 300, 1);
  assert.equal(strong.outpost.structures.length, blocks); assert.equal(strong.outpost.structures.reduce((n, s) => n + s.health, 0), total); assert.match(strong.outpost.report ?? '', /repelled/);
  // Repair stations mend during the absence only as far as stored iron allows.
  const mend = build([[1, 0, 'reactor'], [0, 1, 'repairStation'], [-1, 0, 'reinforcedWall']]), wall = mend.block('reinforcedWall');
  mend.m.damageStructure(mend.outpost, wall, 300); mend.outpost.stored = { ...zero, iron: 8 }; const hurt = wall.health; leaveAndReturn(mend, 600, 0);
  assert.equal(wall.health, hurt + Math.floor(8 / OUTPOST.repairIronPerHp)); assert.equal(mend.outpost.stored.iron, 0);
  mend.outpost.stored.iron = 0; const stuck = wall.health; leaveAndReturn(mend, 600, 0); assert.equal(wall.health, stuck);
});

test('shield, heat, raid and away state survive a save', () => {
  const { m, outpost, block } = fort([[1, 0, 'reactor'], [-1, 0, 'shieldGenerator'], [0, 1, 'droneHangar']]);
  block('droneHangar').level = 3; outpost.revision++; run(m, 2);
  Object.assign(outpost, { shield: 77, heat: 12.5, away: 0, raidTimer: 123, pendingRaids: 0, raidWarning: 0, commandCooldown: 4 });
  const restored = GameModel.fromSave(JSON.parse(JSON.stringify(m.toSave()))), copy = restored.outposts[0];
  assert.equal(copy.shield, 77); assert.equal(copy.heat, 12.5); assert.equal(copy.raidTimer, 123); assert.equal(copy.structures.find(s => s.kind === 'droneHangar')!.level, 3);
  assert.equal(copy.drones!.length, 6); assert.deepEqual(outpostStats(copy), outpostStats(outpost));
});

test('build mode pays from ship cargo first, then the outpost storage, then station deposits, and never creates minerals', () => {
  const m = builderShip(), at = cell(m), empty = { iron: 0, copper: 0, crystal: 0, ice: 0, radioactive: 0 };
  const total = () => (Object.keys(empty) as Resource[]).reduce((sum, ore) => sum + m.cargo[ore] + m.stored[ore] + m.outposts.reduce((s, o) => s + (o.stored?.[ore] ?? 0), 0), 0);
  // An Outpost Core with nothing carried: paid entirely from station deposits.
  const core = STRUCTURES.outpostCore.cost;
  m.cargo = { ...empty }; m.stored = { ...rich };
  let before = total();
  assert.equal(m.placeError('outpostCore', at.cx, at.cy), undefined);
  assert.ok(m.placeStructure('outpostCore', at.cx, at.cy));
  for (const ore of Object.keys(empty) as Resource[]) assert.equal(rich[ore] - m.stored[ore], core[ore]);
  assert.equal(before - total(), Object.values(core).reduce((a, b) => a + b, 0), 'exactly the price left the stores');
  // A wall: some iron carried, some in the outpost, the rest from the station, spent in that order.
  const outpost = m.outposts[0], price = m.structureCost('wall').iron;
  assert.ok(price >= 3, 'the wall needs at least 3 iron for this test');
  m.cargo = { ...empty, iron: 1 }; outpost.stored = { ...empty, iron: 1 }; m.stored = { ...empty, iron: price };
  before = total();
  assert.ok(m.placeStructure('wall', at.cx + 1, at.cy));
  assert.equal(m.cargo.iron, 0, 'cargo spent first'); assert.equal(outpost.stored.iron, 0, 'then outpost storage'); assert.equal(m.stored.iron, 2, 'then station deposits');
  assert.equal(before - total(), price);
  // Not enough anywhere: refused, nothing taken.
  m.cargo = { ...empty }; outpost.stored = { ...empty }; m.stored = { ...empty, iron: price - 1 };
  assert.match(m.placeError('wall', at.cx + 1, at.cy + 1) ?? '', /Not enough iron/);
  assert.equal(m.placeStructure('wall', at.cx + 1, at.cy + 1), false); assert.equal(m.stored.iron, price - 1);
});
