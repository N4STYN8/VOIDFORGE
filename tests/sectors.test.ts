import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameModel } from '../src/model.ts';
import { travel } from '../src/sectors.ts';
import { edgeDirection, entryPoint, sectorSeed, sectorLabel } from '../src/sectorGrid.ts';
import { saveText } from '../src/persistence.ts';
import { SECTOR, WORLD } from '../src/data.ts';

const idle = { x: 0, y: 0, aim: { x: 0, y: 0 }, fire: false, mine: false, dock: false };
const total = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

test('sector seeds and labels are deterministic and home keeps the pilot seed', () => {
  assert.equal(sectorSeed('abc', 0, 0), 'abc');
  assert.equal(sectorSeed('abc', 1, -2), sectorSeed('abc', 1, -2));
  assert.notEqual(sectorSeed('abc', 1, 0), sectorSeed('abc', 0, 1));
  assert.equal(sectorLabel(0, 0), 'Home sector');
  assert.equal(sectorLabel(-1, 2), 'Sector W1 S2');
});

test('edge direction needs both position at the edge and outward thrust; entry is the opposite edge', () => {
  assert.equal(edgeDirection({ x: WORLD.width - 25, y: 5000 }, { x: 1, y: 0 }), 'east');
  assert.equal(edgeDirection({ x: WORLD.width - 25, y: 5000 }, { x: -1, y: 0 }), undefined);
  assert.equal(edgeDirection({ x: 5000, y: 22 }, { x: 0, y: -1 }), 'north');
  assert.equal(edgeDirection({ x: 5000, y: 5000 }, { x: 1, y: 1 }), undefined);
  assert.deepEqual(entryPoint('east', { x: WORLD.width - 20, y: 7000 }), { x: SECTOR.entryInset, y: 7000 });
  assert.deepEqual(entryPoint('north', { x: 9000, y: 20 }), { x: 9000, y: WORLD.height - SECTOR.entryInset });
});

test('holding thrust into an edge raises a sector request after the hold time', () => {
  const m = new GameModel('edge-seed', { streaming: false });
  m.player.x = WORLD.width - 21; m.player.y = WORLD.height / 2;
  const push = { ...idle, x: 1, aim: { x: WORLD.width, y: WORLD.height / 2 } };
  const steps = (seconds: number) => { for (let i = 0; i < Math.round(seconds / 0.05); i++) m.update(0.05, push); };
  steps(SECTOR.hold - 0.3);
  assert.equal(m.sectorRequest, undefined);
  steps(0.6);
  assert.equal(m.sectorRequest, 'east');
});

test('travel keeps the pilot, stores the old sector and returns to it unchanged', () => {
  const home = new GameModel('travel-seed');
  home.cargo.iron = 30; home.stored.copper = 77; home.renameShip('Wanderer');
  const rock = home.asteroids[0]; rock.amount = Math.max(1, rock.amount - 5); const depleted = rock.amount, rockId = rock.id;
  home.player.x = WORLD.width - 20; home.player.y = 9000;
  const east = travel(home, 'east');
  assert.equal(east.seed, sectorSeed('travel-seed', 1, 0));
  assert.deepEqual([east.galaxy.x, east.galaxy.y], [1, 0]);
  assert.ok(east.player.x < SECTOR.entryInset + 1);
  assert.deepEqual([east.player.vx, east.player.vy], [0, 0], 'arrives at rest');
  assert.equal(east.cargo.iron, 30); assert.equal(east.stored.copper, 77); assert.equal(east.shipName, 'Wanderer');
  assert.ok(east.galaxy.sectors['0,0'], 'home sector stored');
  assert.ok(east.asteroids.every(a => Math.hypot(a.x - east.player.x, a.y - east.player.y) > a.radius), 'arrival is clear of rocks');
  // Resources only move with the pilot: cargo plus stored is unchanged.
  assert.equal(total(east.cargo) + total(east.stored), total(home.cargo) + total(home.stored));
  east.player.x = 20; east.player.y = 9000;
  const back = travel(east, 'west');
  assert.equal(back.seed, 'travel-seed'); assert.deepEqual([back.galaxy.x, back.galaxy.y], [0, 0]);
  assert.ok(back.galaxy.sectors['1,0'] && !back.galaxy.sectors['0,0']);
  const snapshot = back.world.snapshot(back.asteroids).changes.find(([id]) => id === rockId);
  assert.equal(snapshot?.[1]?.amount, depleted, 'ore depletion survives the round trip');
});

test('sector position and visited sectors survive save/load; old saves load at home', () => {
  const home = new GameModel('save-seed'); home.player.x = 20; home.player.y = 8000;
  const west = travel(home, 'west');
  const loaded = GameModel.fromSave(JSON.parse(saveText(west)));
  assert.deepEqual([loaded.galaxy.x, loaded.galaxy.y, loaded.galaxy.home], [-1, 0, 'save-seed']);
  assert.ok(loaded.galaxy.sectors['0,0']);
  const legacy = home.toSave(); delete legacy.galaxy;
  const old = GameModel.fromSave(JSON.parse(JSON.stringify(legacy)));
  assert.deepEqual([old.galaxy.x, old.galaxy.y, old.galaxy.home], [0, 0, 'save-seed']);
  assert.throws(() => GameModel.fromSave({ ...legacy, galaxy: { home: 1, x: 0, y: 0, sectors: {} } }));
});
