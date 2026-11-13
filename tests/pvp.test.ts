import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameModel } from '../src/model.ts';
import { sharedSector } from '../src/shared.ts';
import { rebuildAtHome, rebuildCost, travel } from '../src/sectors.ts';
import { startRelay } from '../server/relay.ts';
import { NET, parseServer, type ServerMessage } from '../src/netProtocol.ts';
import { PVP, WORLD } from '../src/data.ts';
import { fixtureModel } from './fixtures.ts';

const total = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
const dropTotal = (m: GameModel) => m.drops.reduce((a, d) => a + d.amount, 0);
/** A pilot in open space with a clear field of fire, sharing the sector. */
function openSpace(seed = 'unit-fixture') {
  const m = seed === 'unit-fixture' ? fixtureModel() : new GameModel(seed);
  m.asteroids = []; m.enemies = [];
  Object.assign(m.player, { x: 9000, y: 9000, vx: 0, vy: 0 });
  m.shared = sharedSector('authority', () => true);
  return m;
}
const fireAt = (m: GameModel, target: { x: number; y: number }, seconds: number) => { for (let i = 0; i < seconds * 20; i++) m.update(0.05, { x: 0, y: 0, aim: target, fire: true, mine: false, dock: false }); };

test('shots hit other pilots in open space, but never allies or pilots inside a station ring', () => {
  const shooter = openSpace(), victim = { id: 'v', x: 9150, y: 9000, vx: 0, vy: 0 };
  shooter.shared!.targets = [victim];
  fireAt(shooter, victim, 1.5);
  const landed = shooter.shared!.pvpHits.filter(h => h.to === 'v').reduce((a, h) => a + h.damage, 0);
  assert.ok(landed > 0, 'hits recorded for the victim');
  shooter.shared!.pvpHits.length = 0; shooter.shared!.allies = new Set(['v']);
  fireAt(shooter, victim, 1.5);
  assert.equal(shooter.shared!.pvpHits.length, 0, 'allies are never hit');
  shooter.shared!.allies = new Set();
  const base = shooter.bases[0]; shooter.shared!.targets = [{ ...victim, x: base.x + 60, y: base.y }];
  Object.assign(shooter.player, { x: base.x + 60 + 260, y: base.y });
  fireAt(shooter, { x: base.x + 60, y: base.y }, 1.5);
  assert.equal(shooter.shared!.pvpHits.length, 0, 'a pilot in a safe ring is untouchable');
});

test('a victim takes capped damage; the killer gets the carried cargo once and the victim owes a rebuild', () => {
  const victim = openSpace(); victim.cargo.iron = 25; victim.cargo.crystal = 4;
  const carried = total(victim.cargo), hull = victim.player.health + victim.shield;
  assert.equal(victim.applyPvpHit('k', 'Killer', 50, true), 0, 'allies deal nothing');
  const first = victim.applyPvpHit('k', 'Killer', PVP.damageCap * 3, false);
  assert.equal(first, Math.min(PVP.damageCap, PVP.damageCap * 3));
  assert.ok(victim.player.health + victim.shield < hull);
  if (!victim.dead) { victim.world.advance(1.1); victim.applyPvpHit('k', 'Killer', 1e5, false); }
  assert.ok(victim.dead);
  assert.equal(victim.shared!.pvpLoot!.to, 'k');
  assert.equal(total(victim.shared!.pvpLoot!.cargo as Record<string, number>), carried);
  assert.equal(total(victim.cargo), 0); assert.equal(dropTotal(victim), 0, 'nothing left at the wreck: it went to the killer');
  victim.update(0.05, { x: 0, y: 0, aim: { x: 0, y: 0 }, fire: false, mine: false, dock: false });
  assert.equal(dropTotal(victim), 0, 'the death tick does not drop it again');
  assert.ok(victim.rebuildDue);
  victim.respawn(); assert.ok(victim.dead, 'a free respawn is not allowed');

  const killer = openSpace(); killer.cargo.iron = killer.cargoCapacity - 10;
  const before = total(killer.cargo) + dropTotal(killer);
  killer.receivePvpLoot(victim.shared!.pvpLoot!.cargo, 'Victim');
  assert.equal(total(killer.cargo) + dropTotal(killer) - before, carried, 'every unit arrives: the hold, then floating beside the ship');
  assert.ok(killer.cargoUsed <= killer.cargoCapacity);
});

test('cargo returns to the wreck when the killer cannot receive it', () => {
  const victim = openSpace(); victim.cargo.copper = 12;
  victim.applyPvpHit('k', 'Killer', 1e5, false); if (!victim.dead) { victim.world.advance(1.1); victim.applyPvpHit('k', 'Killer', 1e5, false); }
  victim.returnPvpLoot(); victim.returnPvpLoot();
  assert.equal(dropTotal(victim), 12, 'returned exactly once');
});

test('rebuilding pays from stored minerals and brings the ship home, even from another sector', () => {
  const home = new GameModel('rebuild-seed'); home.stored.iron = 1000; home.stored.copper = 1000;
  home.player.x = WORLD.width - 20; home.player.y = 9000;
  const east = travel(home, 'east');
  east.shared = sharedSector('follower', () => true); east.enemies = [];
  Object.assign(east.player, { x: 9000, y: 9000 });
  east.applyPvpHit('k', 'Killer', 1e5, false); if (!east.dead) { east.world.advance(1.1); east.applyPvpHit('k', 'Killer', 1e5, false); }
  assert.ok(east.rebuildDue);
  const saved = GameModel.fromSave(JSON.parse(JSON.stringify(east.toSave())));
  assert.ok(saved.rebuildDue, 'owing a rebuild survives a save');
  const rebuilt = rebuildAtHome(saved), cost = rebuildCost(rebuilt.coreLevel);
  assert.equal(rebuilt.seed, 'rebuild-seed'); assert.deepEqual([rebuilt.galaxy.x, rebuilt.galaxy.y], [0, 0]);
  assert.ok(!rebuilt.dead && !rebuilt.rebuildDue);
  assert.equal(rebuilt.stored.iron, 1000 - cost.iron!); assert.equal(rebuilt.stored.copper, 1000 - cost.copper!);
  assert.ok(Math.hypot(rebuilt.player.x - rebuilt.bases[0].x, rebuilt.player.y - rebuilt.bases[0].y) < 400);
  const broke = openSpace(); broke.stored.iron = 3; broke.applyPvpHit('k', 'K', 1e5, false); if (!broke.dead) { broke.world.advance(1.1); broke.applyPvpHit('k', 'K', 1e5, false); }
  const free = rebuildAtHome(broke);
  assert.equal(free.stored.iron, 0, 'pays what it can, never below zero');
});

test('the relay tells a sender when its direct message had nobody to reach', async () => {
  const relay = await startRelay({ port: 0, host: '127.0.0.1' });
  try {
    const socket = new WebSocket(`ws://127.0.0.1:${relay.port}`), inbox: ServerMessage[] = [];
    socket.addEventListener('message', e => { const m = parseServer(String(e.data)); if (m) inbox.push(m); });
    await new Promise(r => socket.addEventListener('open', r, { once: true }));
    socket.send(JSON.stringify({ t: 'hello', v: NET.version, name: 'v' }));
    socket.send(JSON.stringify({ t: 'sector', world: { home: 'h', x: 0, y: 0, seed: 's' } }));
    socket.send(JSON.stringify({ t: 'direct', to: 'gone-pilot', k: 'pvp-loot', d: { iron: 5 } }));
    for (let i = 0; i < 200 && !inbox.some(m => m.t === 'undelivered'); i++) await new Promise(r => setTimeout(r, 5));
    const m = inbox.find(m => m.t === 'undelivered') as Extract<ServerMessage, { t: 'undelivered' }>;
    assert.deepEqual([m.to, m.k], ['gone-pilot', 'pvp-loot']);
    socket.close();
  } finally { await relay.close(); }
});
