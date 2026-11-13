import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureModel } from './fixtures.ts';
import { GameModel } from '../src/model.ts';
import { NetClient } from '../src/net.ts';
import { LobbyShare, readMinerals } from '../src/lobbyShare.ts';
import { startRelay } from '../server/relay.ts';
import { cellOf } from '../src/outposts.ts';
import type { Resource } from '../src/data.ts';

const idle = { x: 0, y: 0, aim: { x: 0, y: 0 }, fire: false, mine: false, dock: false };
const empty = (): Record<Resource, number> => ({ iron: 0, copper: 0, crystal: 0, ice: 0, radioactive: 0 });
const total = (...models: GameModel[]) => models.reduce((sum, m) => sum + Object.values(m.stored).reduce((a, b) => a + b, 0) + Object.values(m.cargo).reduce((a, b) => a + b, 0), 0);
/** A pilot in open space with a Build module, nothing carried and nothing deposited. */
function builder() {
  const m = fixtureModel(); m.asteroids = []; m.enemies = []; m.squads = [];
  m.coreLevel = 5; m.modules = [{ x: 1, y: 0, kind: 'builder', level: 1, cooldown: 0, integrity: 999 }];
  m.cargoOverride = 1e9; m.cargo = empty(); m.stored = empty(); Object.assign(m.player, { x: 9000, y: 9000, vx: 0, vy: 0 });
  m.update(0.01, idle); m.energy = m.maxEnergy;
  (m as unknown as { spawnTimer: number }).spawnTimer = 1e9;
  return m;
}

test('shared mineral amounts are whole, positive and known ores only', () => {
  assert.deepEqual(readMinerals({ iron: 5, copper: -2, gold: 9, crystal: 1.5, ice: 0 }), { iron: 5 });
  assert.deepEqual(readMinerals('nope'), {});
});

test('a short pilot borrows only what the lobby pool covers, and the action waits for it', () => {
  const m = builder(), at = { cx: cellOf(m.player.x), cy: cellOf(m.player.y) + 3 }, price = m.structureCost('outpostCore');
  assert.match(m.placeError('outpostCore', at.cx, at.cy) ?? '', /Not enough/);
  assert.equal(m.lobbyCanCover(m.placeError('outpostCore', at.cx, at.cy), price, () => 0), false, 'no pool, nothing to borrow');
  m.lobbyPool = { iron: price.iron, copper: price.copper - 1, crystal: price.crystal };
  assert.equal(m.placeStructure('outpostCore', at.cx, at.cy), false);
  assert.equal(m.borrowRequest, undefined, 'the pool is short of copper: no request');
  m.lobbyPool = { iron: price.iron * 2, copper: price.copper, crystal: price.crystal };
  m.cargo.iron = 10;
  assert.equal(m.placeStructure('outpostCore', at.cx, at.cy), false);
  assert.match(m.message, /Borrowing/);
  assert.deepEqual(m.borrowRequest, { iron: price.iron - 10, copper: price.copper, crystal: price.crystal }, 'only the shortfall');
  // The minerals arrive as deposits and the action runs again by itself.
  m.borrowRequest = undefined;
  m.receiveLobbyMinerals({ iron: price.iron - 10, copper: price.copper, crystal: price.crystal }, 'Nate');
  m.finishBorrow(true);
  assert.equal(m.outposts.length, 1, 'built once the minerals came');
  assert.equal(total(m), 0, 'all of it spent on the core');
});

test('over the relay: an opted-in member pays for a lobby mate, minerals move exactly once', async () => {
  const relay = await startRelay({ port: 0, host: '127.0.0.1' }), url = `ws://127.0.0.1:${relay.port}`;
  try {
    const owner = builder(), borrower = builder();
    owner.stored = { iron: 5000, copper: 5000, crystal: 500, ice: 0, radioactive: 0 };
    const ownerNet = new NetClient(), borrowerNet = new NetClient();
    const ownerShare = new LobbyShare(ownerNet, () => owner), borrowerShare = new LobbyShare(borrowerNet, () => borrower);
    ownerNet.connect(url, 'Owner'); borrowerNet.connect(url, 'Borrower');
    const clock = () => performance.now() / 1000;
    const wait = async (f: () => boolean, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms && !f()) { owner.update(0.05, idle); borrower.update(0.05, idle); ownerShare.frame(owner, clock()); borrowerShare.frame(borrower, clock()); await new Promise(r => setTimeout(r, 10)); } return f(); };
    await wait(() => ownerNet.connected && borrowerNet.connected);
    ownerNet.create(false); await wait(() => Boolean(ownerNet.lobby));
    borrowerNet.join(ownerNet.lobby!.code); await wait(() => borrowerNet.lobby?.members.length === 2);
    // Sharing off: nothing is offered.
    await wait(() => false, 300);
    assert.deepEqual(borrower.lobbyPool, {}, 'nothing shared until the owner opts in');
    ownerShare.enabled = true;
    assert.ok(await wait(() => (borrower.lobbyPool.iron ?? 0) === 5000), 'the pool is announced');
    const before = total(owner, borrower), price = borrower.structureCost('outpostCore'), at = { cx: cellOf(borrower.player.x), cy: cellOf(borrower.player.y) + 3 };
    assert.equal(borrower.placeStructure('outpostCore', at.cx, at.cy), false);
    assert.ok(await wait(() => borrower.outposts.length === 1), 'the core is built with borrowed minerals');
    assert.equal(owner.stored.iron, 5000 - price.iron); assert.equal(owner.stored.copper, 5000 - price.copper);
    assert.equal(before - total(owner, borrower), Object.values(price).reduce((a, b) => a + b, 0), 'exactly the price left the two pilots');
    // Owner opts out: a second build is refused instead of borrowing.
    ownerShare.enabled = false;
    assert.ok(await wait(() => (borrower.lobbyPool.iron ?? 0) === 0));
    ownerNet.disconnect(); borrowerNet.disconnect();
  } finally { await relay.close(); }
});

test('over the relay: minerals sent to a pilot who already left go back to the owner', async () => {
  const relay = await startRelay({ port: 0, host: '127.0.0.1' }), url = `ws://127.0.0.1:${relay.port}`;
  try {
    const owner = builder(); owner.stored = { ...empty(), iron: 100 };
    const ownerNet = new NetClient(), share = new LobbyShare(ownerNet, () => owner); share.enabled = true;
    const raw = new NetClient();
    ownerNet.connect(url, 'Owner'); raw.connect(url, 'Asker');
    const clock = () => performance.now() / 1000;
    const wait = async (f: () => boolean, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms && !f()) { share.frame(owner, clock()); await new Promise(r => setTimeout(r, 10)); } return f(); };
    await wait(() => ownerNet.connected && raw.connected);
    ownerNet.create(false); await wait(() => Boolean(ownerNet.lobby));
    raw.join(ownerNet.lobby!.code); await wait(() => ownerNet.lobby?.members.length === 2);
    // The asker requests 40 iron and leaves the lobby before the answer can reach it.
    raw.party(ownerNet.id, 'take', { id: 'x1', minerals: { iron: 40 } }); raw.leave();
    await wait(() => false, 800);
    assert.equal(owner.stored.iron, 100, 'nothing lost: refunded, or never taken');
    ownerNet.disconnect(); raw.disconnect();
  } finally { await relay.close(); }
});
