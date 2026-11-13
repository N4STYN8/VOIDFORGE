import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameModel, pilotRadius, type Input } from '../src/model.ts';
import { NetClient } from '../src/net.ts';
import { SharedLink } from '../src/sharedLink.ts';
import { adoptWorld, enterWorld, sectorWorld, worldRef } from '../src/sectors.ts';
import { sharedSector } from '../src/shared.ts';
import { packWorld, unpackWorld, WORLD_CHUNK } from '../src/worldTransfer.ts';
import { startRelay } from '../server/relay.ts';
import { NET } from '../src/netProtocol.ts';
import type { Outpost } from '../src/outposts.ts';

const idle = (m: GameModel, extra: Partial<Input> = {}): Input => ({ x: 0, y: 0, aim: { x: m.player.x, y: m.player.y - 100 }, fire: false, mine: false, dock: false, ...extra });
const total = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

test('a sector world packs into relay-sized chunks and unpacks unchanged', async () => {
  const model = new GameModel('pack-test');
  for (let i = 0; i < 40; i++) model.update(0.05, idle(model));
  const world = sectorWorld(model.toSave()), text = await packWorld(world);
  assert.ok(text.length < JSON.stringify(world).length, 'compressed');
  assert.ok(WORLD_CHUNK + 200 < NET.maxMessage, 'a chunk and its envelope fit one relay message');
  assert.deepEqual(await unpackWorld(text), JSON.parse(JSON.stringify(world)));
  assert.equal(await unpackWorld('xnot-a-world'), undefined);
});

test("a guest takes on the host's copy of the sector: same rocks, clock and stations, nothing copied", () => {
  const host = new GameModel('sync-host');
  for (let i = 0; i < 60; i++) host.update(0.05, idle(host));
  // The host has mined a rock down, built an outpost with minerals in it, and has time on the clock.
  const rock = host.asteroids[0]; rock.amount = Math.max(1, rock.amount - 5);
  host.world.time += 321;
  host.outposts = [{ id: 7, name: 'Host Post', cx: 10, cy: 10, structures: [], revision: 1, stored: { iron: 500 } as Outpost['stored'], drones: [] }];
  host.drops.push({ id: 999, x: host.player.x, y: host.player.y, ore: 'iron', amount: 40 });
  const guest = enterWorld(new GameModel('sync-guest'), worldRef(host), host.player);
  guest.cargo.iron = 12; guest.player.vx = 33;
  const spot = { x: guest.player.x, y: guest.player.y }, minerals = total(guest.cargo) + total(guest.stored);
  const synced = adoptWorld(guest, JSON.parse(JSON.stringify(sectorWorld(host.toSave()))));
  assert.equal(synced.world.time, host.world.time, 'same clock, so moving belts line up');
  assert.equal(synced.world.snapshot(synced.asteroids).changes.find(([id]) => id === rock.id)?.[1]?.amount, rock.amount, 'same ore depletion');
  assert.deepEqual([synced.player.x, synced.player.y, synced.player.vx], [spot.x, spot.y, 33], 'the ship stays where it was');
  assert.equal(total(synced.cargo) + total(synced.stored), minerals, 'pilot minerals unchanged');
  assert.equal(synced.outposts.length, 0, "the host's outposts are not the guest's");
  assert.equal(synced.visitorOutposts.length, 1, 'but they are drawn');
  assert.equal(synced.visitorOutposts[0].stored, undefined, 'with no minerals to take');
  assert.ok(!synced.drops.some(d => d.id === 999), "the host's pickups stay the host's");
  assert.deepEqual(synced.galaxy, guest.galaxy, 'still a guest in the same place');
  assert.equal(adoptWorld(guest, { ...sectorWorld(host.toSave()), seed: 'elsewhere' }), guest, 'a different sector is ignored');
  // Saving and loading keeps the guest's copy, without the visitor outposts.
  const again = GameModel.fromSave(synced.toSave());
  assert.equal(again.visitorOutposts.length, 0); assert.equal(again.outposts.length, 0);
});

test('pilots are solid: ships push apart; allies take no damage, a hostile ram does', () => {
  const make = () => { const m = new GameModel('ram-test'); m.asteroids = []; m.enemies = []; Object.assign(m.player, { x: 9000, y: 9000, vx: 0, vy: 0 }); m.shared = sharedSector('authority', () => true); return m; };
  assert.equal(pilotRadius([]), 18); assert.equal(pilotRadius([[1, 0], [0, -2]]), 50);
  const ally = make(); ally.shared!.allies.add('friend');
  ally.player.vx = 400; ally.shared!.targets = [{ id: 'friend', x: 9030, y: 9000, vx: 0, vy: 0, radius: 18 }];
  const health = ally.player.health;
  ally.update(0.05, idle(ally));
  assert.ok(ally.player.x < 9015, 'pushed back out of the other ship (it would have reached 9020)');
  assert.ok(ally.player.vx < 400, 'bounced off');
  assert.equal(ally.player.health, health, 'allies never hurt each other');
  const foe = make();
  foe.player.vx = 600; foe.shared!.targets = [{ id: 'stranger', x: 9030, y: 9000, vx: -200, vy: 0, radius: 18 }];
  const before = foe.player.health + foe.shield;
  foe.update(0.05, idle(foe));
  assert.ok(foe.player.health + foe.shield < before, 'a hard ram into a stranger hurts');
});

test("other pilots' shots fly and stop at rocks here without changing anything", () => {
  const m = new GameModel('remote-shots'); m.enemies = [];
  const rock = m.asteroids.find(a => a.radius > 20)!;
  const start = { x: rock.x - rock.radius - 80, y: rock.y };
  const amount = rock.amount, health = rock.health, vx = rock.vx;
  m.applyPilotShots([{ x: start.x, y: start.y, vx: 900, vy: 0, life: 1, weapon: 'cannon', level: 2 }]);
  const shot = m.bullets.find(b => b.remote)!;
  assert.ok(shot && !shot.enemy, 'a remote shot');
  assert.ok(m.effects.some(e => e.type === 'muzzle'), 'with a muzzle flash');
  for (let i = 0; i < 10 && m.bullets.some(b => b.remote); i++) m.update(0.02, { ...idle(m), view: { x: start.x - 1000, y: start.y - 1000, width: 3000, height: 3000 } });
  assert.ok(!m.bullets.some(b => b.remote), 'stopped by the rock');
  assert.equal(rock.amount, amount); assert.equal(rock.health, health); assert.equal(rock.vx, vx);
  // A knocked rock arrives as motion only.
  m.applyBumps([[rock.id, rock.x + 5, rock.y, 12, -3]]);
  assert.deepEqual([rock.vx, rock.vy], [12, -3]); assert.equal(rock.amount, amount);
});

test('a ship knocking a rock reports it for sharing', () => {
  const m = new GameModel('bump-test'); m.enemies = []; m.shared = sharedSector('authority', () => true);
  const rock = m.asteroids.find(a => !a.motion && a.radius > 15)!;
  Object.assign(m.player, { x: rock.x - rock.radius - 25, y: rock.y, vx: 250, vy: 0 });
  for (let i = 0; i < 10 && !m.shared.bumpedRocks.size; i++) m.update(0.02, idle(m));
  assert.ok(m.shared.bumpedRocks.has(rock.id));
});

test("over the relay: a guest receives the host's sector, sees the host's shots, and learns its clock", async () => {
  const relay = await startRelay({ port: 0, host: '127.0.0.1' }), url = `ws://127.0.0.1:${relay.port}`;
  try {
    const hostModel = new GameModel('relay-sync-host');
    hostModel.world.time += 500; const mined = hostModel.asteroids[0]; mined.amount = 1;
    const hostNet = new NetClient(), hostLink = new SharedLink(hostNet, () => hostModel);
    let guestModel = enterWorld(new GameModel('relay-sync-guest'), worldRef(hostModel), hostModel.player);
    const guestNet = new NetClient(), guestLink = new SharedLink(guestNet, () => guestModel);
    let synced = 0;
    guestLink.onWorld = world => { const next = adoptWorld(guestModel, world); if (next !== guestModel) { guestModel = next; synced++; } };
    hostNet.connect(url, 'Host'); guestNet.connect(url, 'Guest');
    const clock = () => performance.now() / 1000;
    const step = (m: GameModel, net: NetClient, link: SharedLink, owner: boolean, fire = false) => {
      m.enemies = []; m.update(0.05, idle(m, { fire, aim: { x: m.player.x + 300, y: m.player.y } }));
      net.setSector(worldRef(m), owner);
      net.sendState(clock(), { x: m.player.x, y: m.player.y, vx: 0, vy: 0, angle: 0, health: 100, maxHealth: 100, paint: 0, blocks: [['core', 0, 0, 1]] });
      link.frame(m, clock());
    };
    // Keep the host away from its station ring so its guns fire.
    Object.assign(hostModel.player, { x: hostModel.player.x + 2500, y: hostModel.player.y });
    for (let i = 0; i < 400 && !synced; i++) { step(hostModel, hostNet, hostLink, true); step(guestModel, guestNet, guestLink, false); await new Promise(r => setTimeout(r, 10)); }
    assert.equal(synced, 1, 'the guest asked for and received the host sector once');
    assert.equal(guestModel.world.snapshot(guestModel.asteroids).changes.find(([id]) => id === mined.id)?.[1]?.amount, 1, "the host's mined rock");
    // The copy is a moment old when it lands; the authority's clock follows within a second of real time.
    for (let i = 0; i < 100 && Math.abs(guestModel.world.time - hostModel.world.time) >= 1; i++) { step(hostModel, hostNet, hostLink, true); step(guestModel, guestNet, guestLink, false); await new Promise(r => setTimeout(r, 10)); }
    assert.ok(Math.abs(guestModel.world.time - hostModel.world.time) < 1, `clocks agree: ${guestModel.world.time} vs ${hostModel.world.time}`);
    let seen = false;
    for (let i = 0; i < 200 && !seen; i++) { step(hostModel, hostNet, hostLink, true, true); step(guestModel, guestNet, guestLink, false); seen = guestModel.bullets.some(b => b.remote); await new Promise(r => setTimeout(r, 10)); }
    assert.ok(seen, "the host's shots show up for the guest");
    assert.equal(hostNet.oversized + guestNet.oversized, 0, 'nothing too large for the relay');
    hostNet.disconnect(); guestNet.disconnect();
  } finally { await relay.close(); }
});

test('rock changes from other pilots stick even for rocks not streamed in here yet', () => {
  const m = new GameModel('far-rocks'); m.enemies = [];
  const [changed, gone] = m.asteroids.filter(a => !a.motion && a.amount > 5);
  const home = { x: m.player.x, y: m.player.y };
  const fly = (x: number, y: number) => { Object.assign(m.player, { x, y, vx: 0, vy: 0 }); for (let i = 0; i < 3; i++) { m.enemies = []; m.update(0.05, idle(m)); } };
  fly(home.x + 9000, home.y + 9000);
  assert.ok(!m.asteroids.some(a => a.id === changed.id), 'out of range');
  m.applyRock({ id: changed.id, x: changed.x, y: changed.y, vx: 0, vy: 0, amount: 2, health: changed.health, radius: changed.radius });
  m.applyRock({ id: gone.id, gone: true });
  fly(home.x, home.y);
  assert.equal(m.asteroids.find(a => a.id === changed.id)?.amount, 2, 'the change applies once it streams in');
  assert.ok(!m.asteroids.some(a => a.id === gone.id), 'a rock destroyed elsewhere stays destroyed');
});

test('over the relay: a guest far outside ship-state range still receives the sector', async () => {
  const relay = await startRelay({ port: 0, host: '127.0.0.1' }), url = `ws://127.0.0.1:${relay.port}`;
  try {
    const hostModel = new GameModel('relay-far-host'); hostModel.world.time += 200;
    const hostNet = new NetClient(), hostLink = new SharedLink(hostNet, () => hostModel);
    let guestModel = enterWorld(new GameModel('relay-far-guest'), worldRef(hostModel), hostModel.player), synced = 0;
    Object.assign(guestModel.player, { x: hostModel.player.x + NET.interest + 3000, vx: 0, vy: 0 });
    const guestNet = new NetClient(), guestLink = new SharedLink(guestNet, () => guestModel);
    guestLink.onWorld = world => { const next = adoptWorld(guestModel, world); if (next !== guestModel) { guestModel = next; synced++; } };
    hostNet.connect(url, 'Host'); guestNet.connect(url, 'Guest');
    const clock = () => performance.now() / 1000;
    const step = (m: GameModel, net: NetClient, link: SharedLink, owner: boolean) => {
      m.enemies = []; m.update(0.05, idle(m));
      net.setSector(worldRef(m), owner);
      net.sendState(clock(), { x: m.player.x, y: m.player.y, vx: 0, vy: 0, angle: 0, health: 100, maxHealth: 100, paint: 0, blocks: [['core', 0, 0, 1]] });
      link.frame(m, clock());
    };
    for (let i = 0; i < 400 && !synced; i++) { step(hostModel, hostNet, hostLink, true); step(guestModel, guestNet, guestLink, false); await new Promise(r => setTimeout(r, 10)); }
    assert.equal(hostNet.peers.size, 0, 'the host never saw the guest ship');
    assert.equal(synced, 1, 'but the guest got the sector');
    hostNet.disconnect(); guestNet.disconnect();
  } finally { await relay.close(); }
});

test("a pilot's shield and beams travel as offsets from the ship, and bad rows are dropped", async () => {
  const { encodeLook, decodeLook } = await import('../src/shared.ts');
  const ship = { x: 1000, y: 2000 };
  const look = encodeLook(ship, 30, 60, [{ from: { x: 1010, y: 1995 }, to: { x: 1200, y: 2100 }, level: 3, targetId: 77 }], [{ from: { x: 990, y: 2004 }, to: { x: 1050, y: 2050 }, level: 2, targetId: 5 }]);
  assert.deepEqual(look, { s: [30, 60], m: [[10, -5, 1200, 2100, 3, 77]], t: [[-10, 4, 1050, 2050, 2, 5]] });
  assert.deepEqual(decodeLook(JSON.parse(JSON.stringify(look))), look);
  assert.equal(encodeLook(ship, 0, 60, [], []), undefined, 'nothing to show, nothing sent');
  const bad = decodeLook({ s: [999, 60], m: [[5000, 0, 0, 0, 3, 1], [1, 1, 1, 1, 9, 1], 'x'] });
  assert.deepEqual(bad, { s: [60, 60] }, 'shield clamped, impossible beams dropped');
});
