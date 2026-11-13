import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureModel } from './fixtures.ts';
import { GameModel } from '../src/model.ts';
import { MODULES, OUTPOST, STRUCTURES, DRONES, MAX_MODULE_LEVEL, type Resource, type StructureKind } from '../src/data.ts';
import { ABILITIES } from '../src/abilityConfig.ts';
import { cellOf, cellCenter, structureAt, connectedIds, neighbourMask, outpostRadius, wear, outpostStats, storedTotal } from '../src/outposts.ts';

const idle = { x: 0, y: 0, aim: { x: 0, y: 0 }, fire: false, mine: false, dock: false };
const rich = { iron: 5000, copper: 5000, crystal: 5000, ice: 5000, radioactive: 5000 };
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
