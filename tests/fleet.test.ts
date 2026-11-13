import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureModel } from './fixtures.ts';
import { GameModel } from '../src/model.ts';
import { FLEET, WAYPOINTS, WORLD, RESOURCES, type Resource } from '../src/data.ts';
import { bearing, heading, bearingDelta, navMarkers } from '../src/nav.ts';
import { mapToWorld } from '../src/map.ts';

const ores = Object.keys(RESOURCES) as Resource[];
const total = (m: GameModel) => ores.reduce((sum, ore) => sum + m.stored[ore] + m.cargo[ore], 0);
/** A docked ship with plenty of stored minerals. */
function docked() {
  const m = fixtureModel(); assert.ok(m.atStation);
  for (const ore of ores) m.stored[ore] = 5000;
  return m;
}

test('ships are bought from stored minerals and each further ship costs more', () => {
  const m = docked(), before = { ...m.stored }, first = m.shipPrice;
  assert.deepEqual(first, FLEET.cost); assert.equal(m.fleetSize, 1);
  assert.ok(m.buyShip()); assert.equal(m.fleetSize, 2); assert.equal(m.hangar[0].name, 'Ship 2'); assert.equal(m.hangar[0].coreLevel, 1);
  for (const ore of ores) assert.equal(m.stored[ore], before[ore] - (first[ore] ?? 0));
  const second = m.shipPrice;
  for (const ore of Object.keys(FLEET.cost) as Resource[]) assert.equal(second[ore], Math.ceil(FLEET.cost[ore] * (1 + FLEET.growth)));
  assert.ok(m.buyShip()); assert.equal(m.hangar[1].name, 'Ship 3'); assert.notEqual(m.hangar[0].id, m.hangar[1].id);
  assert.notEqual(m.hangar[0].modules, m.hangar[1].modules);
});

test('a ship cannot be bought without the minerals or away from a station', () => {
  const m = docked(); m.stored.iron = FLEET.cost.iron - 1; const snapshot = { ...m.stored };
  assert.match(m.buyShipError() ?? '', /iron/); assert.equal(m.buyShip(), false); assert.deepEqual(m.stored, snapshot); assert.equal(m.fleetSize, 1);
  m.stored.iron = 5000; m.player.x = 9000; m.player.y = 9000;
  assert.match(m.buyShipError() ?? '', /station/); assert.equal(m.buyShip(), false); assert.equal(m.fleetSize, 1);
});

test('switching ships keeps each hull\'s core level, modules and damage', () => {
  const m = docked(); m.buyShip(); const spare = m.hangar[0].id;
  assert.ok(m.upgradeModule(0, 0)); assert.equal(m.coreLevel, 2);
  assert.ok(m.installModule('armor', -1, 0)); m.renameShip('Hauler');
  const builtModules = m.modules.map(mod => `${mod.kind}:${mod.level}:${mod.x},${mod.y}`), fullHull = m.maxHealth; m.player.health = 37;
  assert.ok(m.switchShip(spare));
  assert.equal(m.shipName, 'Ship 2'); assert.equal(m.coreLevel, 1); assert.equal(m.modules.length, 2); assert.equal(m.fleetSize, 2);
  assert.ok(m.player.health <= m.maxHealth && m.player.health > 0);
  const parked = m.hangar[0]; assert.equal(parked.name, 'Hauler'); assert.equal(parked.coreLevel, 2); assert.equal(parked.health, 37);
  assert.ok(m.switchShip(parked.id));
  assert.equal(m.shipName, 'Hauler'); assert.equal(m.coreLevel, 2); assert.equal(m.player.health, 37); assert.equal(m.maxHealth, fullHull);
  assert.deepEqual(m.modules.map(mod => `${mod.kind}:${mod.level}:${mod.x},${mod.y}`), builtModules);
  assert.equal(m.hangar[0].name, 'Ship 2');
});

test('switching unloads carried cargo to storage and never loses minerals', () => {
  const m = docked(); m.buyShip(); m.cargo.iron = 70; m.cargo.crystal = 12; const before = total(m), stored = { ...m.stored };
  assert.ok(m.switchShip(m.hangar[0].id));
  assert.equal(total(m), before); assert.equal(m.cargo.iron, 0); assert.equal(m.cargo.crystal, 0);
  assert.equal(m.stored.iron, stored.iron + 70); assert.equal(m.stored.crystal, stored.crystal + 12);
});

test('ships are only changed at a station and only for ships in the hangar', () => {
  const m = docked(); m.buyShip(); const id = m.hangar[0].id;
  assert.equal(m.switchShip(-5), false); assert.equal(m.shipName, 'Ship 1');
  m.player.x = 9000; m.player.y = 9000; m.cargo.iron = 20;
  assert.match(m.switchShipError(id) ?? '', /station/); assert.equal(m.switchShip(id), false); assert.equal(m.shipName, 'Ship 1'); assert.equal(m.cargo.iron, 20);
});

test('ship names are trimmed, limited and stripped of markup', () => {
  const m = docked();
  assert.equal(m.renameShip('  <b>Rock "Eater"</b>  '), 'bRock Eater/b');
  assert.equal(m.renameShip('x'.repeat(80)).length, FLEET.nameLength);
  const name = m.shipName; assert.equal(m.renameShip('   '), name);
});

test('the fleet and map markers survive a save and older saves still load', () => {
  const m = docked(); m.buyShip(); m.renameShip('Flagship'); m.hangar[0].health = 55;
  m.toggleWaypoint({ x: 5000, y: 6000 }); m.toggleWaypoint({ x: 800, y: 900 });
  const save = JSON.parse(JSON.stringify(m.toSave())), loaded = GameModel.fromSave(save);
  assert.equal(loaded.shipName, 'Flagship'); assert.deepEqual(loaded.hangar, m.hangar); assert.deepEqual(loaded.waypoints, m.waypoints);
  assert.ok(loaded.switchShip(loaded.hangar[0].id)); assert.equal(loaded.player.health, 55);
  delete save.shipName; delete save.hangar; delete save.waypoints;
  const old = GameModel.fromSave(save); assert.equal(old.shipName, 'Ship 1'); assert.deepEqual(old.hangar, []); assert.deepEqual(old.waypoints, []);
});

test('map markers are added, removed by clicking them again, clamped and limited', () => {
  const m = fixtureModel();
  assert.equal(m.toggleWaypoint({ x: 4000, y: 4000 }, 50), 'added'); assert.equal(m.toggleWaypoint({ x: 4500, y: 4000 }, 50), 'added'); assert.equal(m.waypoints.length, 2);
  assert.equal(m.toggleWaypoint({ x: 4020, y: 4010 }, 50), 'removed'); assert.equal(m.waypoints.length, 1); assert.equal(m.waypoints[0].x, 4500);
  assert.equal(m.toggleWaypoint({ x: -500, y: WORLD.height + 500 }), 'added'); assert.deepEqual({ x: m.waypoints[1].x, y: m.waypoints[1].y }, { x: 0, y: WORLD.height });
  for (let i = m.waypoints.length; i < WAYPOINTS.max; i++) assert.equal(m.toggleWaypoint({ x: 1000 + i * 300, y: 2000 }), 'added');
  assert.equal(m.toggleWaypoint({ x: 9000, y: 9000 }), 'full'); assert.equal(m.waypoints.length, WAYPOINTS.max);
  assert.ok(navMarkers(m).filter(marker => marker.kind === 'waypoint').length === WAYPOINTS.max);
});

test('compass bearings are measured clockwise from north', () => {
  const o = { x: 100, y: 100 };
  assert.equal(bearing(o, { x: 100, y: 0 }), 0); assert.equal(bearing(o, { x: 200, y: 100 }), 90);
  assert.equal(bearing(o, { x: 100, y: 200 }), 180); assert.equal(bearing(o, { x: 0, y: 100 }), 270);
  assert.ok(Math.abs(heading(-Math.PI / 2)) < 1e-9); assert.ok(Math.abs(heading(0) - 90) < 1e-9); assert.ok(Math.abs(heading(Math.PI) - 270) < 1e-9);
  assert.equal(bearingDelta(10, 350), 20); assert.equal(bearingDelta(350, 10), -20); assert.equal(bearingDelta(180, 0), -180); assert.equal(bearingDelta(90, 90), 0);
});

test('a map click converts back to the world position at any zoom and pan', () => {
  const size = 900, scale = size / WORLD.width;
  for (const view of [{ zoom: 1, centerX: 0.5, centerY: 0.5 }, { zoom: 3, centerX: 0.2, centerY: 0.7 }, { zoom: 6, centerX: 0.9, centerY: 0.1 }]) {
    for (const world of [{ x: 0, y: 0 }, { x: 3200, y: 3330 }, { x: WORLD.width, y: WORLD.height / 3 }]) {
      // Forward transform used by drawExplorationMap.
      const u = ((world.x * scale - view.centerX * size) * view.zoom + size / 2) / size, v = ((world.y * scale - view.centerY * size) * view.zoom + size / 2) / size;
      const back = mapToWorld(size, view, u, v);
      assert.ok(Math.abs(back.x - world.x) < 1e-6 && Math.abs(back.y - world.y) < 1e-6);
    }
  }
});

test('each ship keeps its own paint and bad paint values fall back to bare metal', () => {
  const m = docked(); assert.equal(m.shipPaint, 0);
  m.buyShip(); m.buyShip(); assert.deepEqual(m.hangar.map(ship => ship.paint), [1, 2]);
  assert.ok(m.setShipPaint(4)); assert.equal(m.setShipPaint(FLEET.paints.length), false); assert.equal(m.setShipPaint(-1), false); assert.equal(m.setShipPaint(1.5), false); assert.equal(m.shipPaint, 4);
  assert.ok(m.switchShip(m.hangar[0].id)); assert.equal(m.shipPaint, 1); assert.equal(m.hangar[0].paint, 4);
  const save = JSON.parse(JSON.stringify(m.toSave())), loaded = GameModel.fromSave(save);
  assert.equal(loaded.shipPaint, 1); assert.deepEqual(loaded.hangar.map(ship => ship.paint), [4, 2]);
  save.shipPaint = 99; save.hangar[0].paint = 'red';
  const odd = GameModel.fromSave(save); assert.equal(odd.shipPaint, 0); assert.ok(odd.switchShip(odd.hangar[0].id)); assert.equal(odd.shipPaint, 0);
});
