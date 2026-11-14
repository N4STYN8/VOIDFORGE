import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameModel, GHOST } from '../src/model.ts';
import { NetClient, INTERP, BUDGET } from '../src/net.ts';
import { encodeEnemies, decodeEnemies, decodeIds, decodeShots, decodePilotShots, encodePilotShot, leadTime, type EnemyRow } from '../src/shared.ts';
import { roomTag, type ShipState } from '../src/netProtocol.ts';

/** A follower model in empty space, so only what the test adds is there. */
function follower() {
  const m = new GameModel('latency-test');
  m.asteroids = []; m.enemies = []; m.bullets = [];
  Object.assign(m.player, { x: 20000, y: 20000, vx: 0, vy: 0 });
  return m;
}
const ghostStep = (m: GameModel, dt: number) => (m as unknown as { updateGhosts(dt: number): void }).updateGhosts(dt);
const row = (id: number, x: number, y: number, vx = 0, vy = 0): EnemyRow => [id, 'raider', x, y, 0, 40, 40, 0, 'patrol', -1, vx, vy];

test('enemy rows carry velocity; rows from older clients still decode, without it', () => {
  const [encoded] = encodeEnemies([{ id: 5, kind: 'raider', x: 10.4, y: 20.6, angle: 1.234, health: 30.2, vx: 123.4, vy: -45.6 }]);
  assert.deepEqual(encoded.slice(10), [123, -46]);
  assert.deepEqual(decodeEnemies([encoded])[0], encoded);
  const old = decodeEnemies([[7, 'raider', 1, 2, 0, 10, 10, 0, 'patrol', -1]]);
  assert.equal(old.length, 1); assert.deepEqual(old[0].slice(10), [0, 0], 'old rows get zero velocity');
  assert.equal(decodeEnemies([[7, 'raider', 1, 2, 0, 10, 10, 0, 'patrol', -1, 1e9, 0]]).length, 0, 'absurd velocity rejected');
  assert.deepEqual(decodeIds([1, 'x', 2.5, 3]), [1, 3]);
});

test('lead time adds age and network delay, within bounds', () => {
  assert.equal(leadTime(0.05, 0.04), 0.09);
  assert.equal(leadTime(undefined, 0.04), 0.04);
  assert.equal(leadTime(5, 5), 0.3, 'capped');
  assert.equal(leadTime(-1, 0), 0);
  assert.equal(leadTime(NaN, NaN), 0);
});

test('mirrored enemies are carried forward on their velocity to the present, without trailing behind', () => {
  const m = follower();
  // A report that is already 0.1 s old (network delay) of an enemy flying at 200 u/s.
  m.applyEnemies([row(1, 1000, 500, 200, 0)], 0.1);
  const e = m.enemies[0];
  assert.ok(Math.abs(e.x - 1020) < 1e-6, 'a new mirror starts where the enemy is now');
  for (let i = 0; i < 18; i++) ghostStep(m, 1 / 60); // 0.3 s
  // Truth at this moment: 1000 + 200 * (0.1 + 0.3) = 1080.
  assert.ok(Math.abs(e.x - 1080) < 1, `x ${e.x.toFixed(2)} should track 1080`);
  assert.ok(Math.abs((e.vx ?? 0) - 200) < 5, 'moves at the reported velocity');
  // A newer report a little off: the mirror converges on it smoothly rather than jumping.
  m.applyEnemies([row(1, 1090, 500, 200, 0)], 0);
  const before = e.x; ghostStep(m, 1 / 60);
  assert.ok(Math.abs(e.x - before) < 10, 'no snap for small corrections');
  for (let i = 0; i < 23; i++) ghostStep(m, 1 / 60);
  assert.ok(Math.abs(e.x - (1090 + 200 * 24 / 60)) < 1, 'converged on the new report');
  // Reports stop: it coasts for GHOST.extrapolate seconds, then holds.
  for (let i = 0; i < 120; i++) ghostStep(m, 1 / 60);
  const held = e.x; for (let i = 0; i < 30; i++) ghostStep(m, 1 / 60);
  assert.ok(Math.abs(e.x - held) < 0.5, 'holds once the report is too old');
  assert.ok(Math.abs(held - (1090 + 200 * GHOST.extrapolate)) < 2);
});

test('boss parts without their own velocity move with their hull', () => {
  const m = follower();
  m.applyEnemies([row(10, 0, 0, 120, -30), [11, 'raider', 40, 0, 0, 10, 10, 0, 'patrol', 10, 0, 0]], 0);
  for (let i = 0; i < 12; i++) ghostStep(m, 1 / 60);
  const [hull, part] = [m.enemies.find(e => e.id === 10)!, m.enemies.find(e => e.id === 11)!];
  assert.ok(Math.abs(part.x - hull.x - 40) < 0.5 && Math.abs(part.y - hull.y) < 0.5, 'the part keeps its place on the hull');
});

test('partial enemy updates keep the rest; removals and full lists drop enemies', () => {
  const m = follower();
  m.applyEnemies([row(1, 0, 0), row(2, 100, 0), row(3, 200, 0)], 0, true);
  m.applyEnemies([row(2, 110, 0), row(4, 300, 0)], 0, false);
  assert.deepEqual(m.enemies.map(e => e.id).sort(), [1, 2, 3, 4], 'partial adds and updates only');
  m.removeEnemies([3]);
  assert.deepEqual(m.enemies.map(e => e.id).sort(), [1, 2, 4]);
  m.applyEnemies([row(4, 300, 0)], 0, true);
  assert.deepEqual(m.enemies.map(e => e.id), [4], 'a full list replaces the mirror');
});

test('enemy shots are fast-forwarded by their age plus network delay, stopping short of this ship', () => {
  const m = follower(), p = m.player;
  const [shot] = decodeShots([{ x: p.x - 2000, y: p.y + 300, vx: 1000, vy: 0, life: 3, damage: 5, a: 0.05 }]);
  assert.equal(shot.a, 0.05);
  m.applyShots([shot], 0.05);
  const b = m.bullets[0];
  assert.ok(Math.abs(b.x - (p.x - 1900)) < 1e-6, 'carried 0.1 s along');
  assert.ok(Math.abs(b.life - 2.9) < 1e-6);
  // Aimed straight at the ship from close range with a long delay: held short, so the hit is still decided normally.
  m.applyShots([{ x: p.x - 150, y: p.y, vx: 1000, vy: 0, life: 3, damage: 5, a: 0.2 }], 0.1);
  const close = m.bullets[1];
  assert.ok(close.x < p.x - 18, 'not carried through the ship');
  assert.ok(close.life > 0);
});

test('a fast-forwarded shot is stopped by a rock on the way', () => {
  const m = new GameModel('latency-test'), p = m.player;
  const rock = m.asteroids.find(a => a.amount > 0)!; m.asteroids = [rock]; m.bullets = [];
  Object.assign(p, { x: rock.x + 5000, y: rock.y + 5000 });
  m.applyShots([{ x: rock.x - rock.radius - 60, y: rock.y, vx: 1000, vy: 0, life: 3, damage: 5, a: 0.2 }], 0);
  assert.equal(m.bullets[0].life, 0, 'the rock stopped it');
});

test('other pilots\' shots leave from where their ship is drawn', () => {
  const shot = encodePilotShot({ x: 1030, y: 2005, vx: 900, vy: 0, life: 1, weapon: 'cannon', level: 1 }, { x: 1000, y: 2000 });
  assert.deepEqual(shot.o, [30, 5]);
  const [decoded] = decodePilotShots([shot]);
  const m = follower();
  m.applyPilotShots([decoded], { x: 950, y: 1990 });
  assert.equal(m.bullets[0].x, 980); assert.equal(m.bullets[0].y, 1995);
  m.applyPilotShots([decoded]);
  assert.equal(m.bullets[1].x, 1030, 'without a drawn ship, the sender\'s position');
  assert.equal(decodePilotShots([{ ...shot, o: [9999, 0] }])[0].o, undefined, 'absurd offsets ignored');
});

/** A socket stand-in that records sends and is always open. */
function fakeSocket() {
  const sent: string[] = [];
  return { sent, socket: { readyState: 1, send(text: string) { sent.push(text); }, close() {}, addEventListener() {} } };
}

test('ping: the reply to a lobbies request measures the round trip', () => {
  const { sent, socket } = fakeSocket();
  const net = new NetClient(() => socket);
  let t = 100; net.clock = () => t;
  net.connect('ws://x', 'P');
  net.receive(JSON.stringify({ t: 'welcome', id: 'me' }), t); // asks for lobbies once online
  assert.ok(sent.some(s => s.includes('"lobbies"')));
  t += 0.04; net.receive(JSON.stringify({ t: 'lobbies', online: 3, list: [] }), t);
  assert.equal(net.pingMs, 40);
  // Heartbeat asks again only after PING.every seconds.
  const before = sent.length; net.heartbeat(t + 1); assert.equal(sent.length, before);
  t += 6; net.heartbeat(t); assert.equal(sent.length, before + 1);
  t += 0.08; net.receive(JSON.stringify({ t: 'lobbies', online: 3, list: [] }), t);
  assert.ok(net.pingMs! > 40 && net.pingMs! < 80, 'smoothed toward the new sample');
  net.disconnect(); assert.equal(net.pingMs, undefined);
});

test('send budget: every message spends, it refills at BUDGET.rate', () => {
  const { socket } = fakeSocket();
  const net = new NetClient(() => socket);
  let t = 0; net.clock = () => t;
  net.connect('ws://x', 'P'); net.receive(JSON.stringify({ t: 'welcome', id: 'me' }), t);
  const full = net.spare(); assert.ok(full <= BUDGET.burst);
  for (let i = 0; i < 10; i++) net.requestLobbies();
  assert.equal(net.spare(), full - 10);
  t += 10 / BUDGET.rate; assert.ok(Math.abs(net.spare() - full) < 1e-6, 'refilled');
});

const state = (id: string, s: ShipState) => JSON.stringify({ t: 'state', id, r: roomTag('room'), s });
const ship = (x: number, vx = 0): ShipState => ({ x, y: 0, vx, vy: 0, angle: 0, health: 1, maxHealth: 1, paint: 0 });

test('remote ships: delay adapts to jitter, and a correction is eased in instead of snapping', () => {
  const steady = new NetClient(() => { throw new Error('no socket'); }), shaky = new NetClient(() => { throw new Error('no socket'); });
  for (const net of [steady, shaky]) net.setSector({ home: 'h', x: 0, y: 0, seed: 'room' });
  for (let i = 0; i < 40; i++) {
    steady.receive(state('a', ship(i * 10, 100)), i * 0.1);
    shaky.receive(state('a', ship(i * 10, 100)), i * 0.1 + (i % 2 ? 0.045 : -0.045));
  }
  const d1 = steady.delayFor(steady.peers.get('a')!), d2 = shaky.delayFor(shaky.peers.get('a')!);
  assert.ok(d1 < 0.06, `steady updates drawn close to the present (${d1.toFixed(3)} s)`);
  assert.ok(d2 > d1 && d2 <= INTERP.max, `jittery updates drawn further back (${d2.toFixed(3)} s)`);
  // Moving at 100 u/s, then a sample that says it stopped short: the drawn pose does not jump.
  const net = new NetClient(() => { throw new Error('no socket'); }); net.setSector({ home: 'h', x: 0, y: 0, seed: 'room' });
  for (let i = 0; i < 10; i++) net.receive(state('a', ship(i * 10, 100)), i * 0.1);
  const at = 1.05, before = net.poses(at)[0].x;
  net.receive(state('a', ship(85, 0)), at);
  const after = net.poses(at)[0].x;
  assert.ok(Math.abs(after - before) < 1e-6, 'continuous at the moment the sample arrives');
  const later = net.poses(at + 0.6)[0].x;
  assert.ok(Math.abs(later - 85) < 1, 'settles on the new sample');
});

test('over the relay: the follower mirrors moving enemies closely and both pilots stay under the relay rate', async () => {
  const { startRelay } = await import('../server/relay.ts');
  const { SharedLink } = await import('../src/sharedLink.ts');
  const { worldRef } = await import('../src/sectors.ts');
  const { NET } = await import('../src/netProtocol.ts');
  const relay = await startRelay({ port: 0, host: '127.0.0.1' }), url = `ws://127.0.0.1:${relay.port}`;
  const clock = () => performance.now() / 1000;
  const pilot = (name: string) => {
    const counter = { sent: 0 }, model = new GameModel('latency-relay');
    model.asteroids = []; model.enemies = [];
    const net = new NetClient(u => { const ws = new WebSocket(u); return { get readyState() { return ws.readyState; }, send(t: string) { counter.sent++; ws.send(t); }, close() { ws.close(); }, addEventListener(type: string, fn: (e: { data?: unknown }) => void) { ws.addEventListener(type, e => fn({ data: (e as MessageEvent).data })); } }; });
    const link = new SharedLink(net, () => model); net.connect(url, name);
    return { model, net, link, counter };
  };
  try {
    const a = pilot('A'), b = pilot('B'), centre = { x: 30000, y: 30000 };
    Object.assign(a.model.player, { ...centre }); Object.assign(b.model.player, { x: centre.x + 200, y: centre.y });
    let fly = () => {};
    const lastStep = new Map<unknown, number>();
    const step = (p: ReturnType<typeof pilot>, owner: boolean) => {
      // Real elapsed time per frame, as in the game (timers here often run slower than 60 fps).
      const m = p.model, now = clock(), dt = Math.min(0.05, now - (lastStep.get(p) ?? now - 1 / 60)); lastStep.set(p, now);
      m.asteroids = []; m.player.health = 1e6;
      m.update(dt, { x: 0, y: 0, aim: { x: m.player.x, y: m.player.y - 100 }, fire: false, mine: false, dock: false });
      if (owner) fly(); // The test, not the enemy AI, decides where the authority's enemies are.
      p.net.setSector(worldRef(m), owner);
      p.net.sendState(now, { x: m.player.x, y: m.player.y, vx: 0, vy: 0, angle: 0, health: 1, maxHealth: 1, paint: 0, blocks: [['core', 0, 0, 1]] });
      p.net.heartbeat(now); p.link.frame(m, now);
    };
    const run = async (seconds: number, each = () => {}) => { const end = clock() + seconds; while (clock() < end) { step(a, true); step(b, false); each(); await new Promise(r => setTimeout(r, 16)); } };
    for (let i = 0; i < 300 && !(a.model.shared && b.model.shared); i++) await run(0.016);
    assert.equal(a.model.shared?.role, 'authority'); assert.equal(b.model.shared?.role, 'follower');
    // Three enemies flying past at a steady 150 u/s, moved by the test (not their AI) so the truth is known.
    a.model.enemies = [1, 2, 3].map(i => ({ id: 900 + i, kind: 'raider', x: centre.x - 600, y: centre.y - 900 + i * 80, vx: 150, vy: 0, angle: 0, health: 40, maxHealth: 40, cooldown: 99, state: 'patrol' })) as typeof a.model.enemies;
    const lanes = new Map(a.model.enemies.map(e => [e.id, e.y])); let flown = clock();
    fly = () => { const now = clock(), dt = now - flown; flown = now; for (const e of a.model.enemies) { e.x += 150 * dt; e.y = lanes.get(e.id)!; e.cooldown = 99; e.vx = 150; e.vy = 0; } };
    const sent0 = { a: a.counter.sent, b: b.counter.sent }, t0 = clock();
    const errors: number[] = [];
    await run(2, () => {
      for (const g of b.model.enemies) { const real = a.model.enemies.find(e => e.id === g.id); if (real && clock() - t0 > 0.7) errors.push(Math.hypot(g.x - real.x, g.y - real.y)); }
    });
    const span = clock() - t0;
    assert.equal(b.model.enemies.length, 3, 'all three mirrored');
    const meanError = errors.reduce((s, e) => s + e, 0) / errors.length;
    // At 150 u/s the old 4 Hz easing trailed by roughly 30 units; dead reckoning stays within a few.
    assert.ok(meanError < 8, `mean mirror error ${meanError.toFixed(1)} units`);
    assert.ok((a.counter.sent - sent0.a) / span < NET.maxRate, 'authority under the relay rate');
    assert.ok((b.counter.sent - sent0.b) / span < NET.maxRate, 'follower under the relay rate');
    // Destroying an enemy removes it from the follower without waiting for the next full list.
    a.model.enemies = a.model.enemies.slice(1);
    await run(0.3);
    assert.equal(b.model.enemies.length, 2);
    a.net.disconnect(); b.net.disconnect();
  } finally { await relay.close(); }
});
