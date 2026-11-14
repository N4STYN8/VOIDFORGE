import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameModel } from '../src/model.ts';
import { NetClient } from '../src/net.ts';
import { SharedLink } from '../src/sharedLink.ts';
import { worldRef } from '../src/sectors.ts';
import { encodeOutpost, decodeOutpostPart, outpostFromParts, OUTPOST_PART, encodeDrones, decodeDrones } from '../src/shared.ts';
import { startRelay } from '../server/relay.ts';
import type { Outpost, Structure } from '../src/outposts.ts';

function outpost(id: number, blocks: number, cx = 500, cy = 400): Outpost {
  const structures: Structure[] = [{ id: 1, kind: 'outpostCore', cx, cy, rot: 0, level: 2, health: 300, progress: 1 }];
  for (let i = 1; i < blocks; i++) structures.push({ id: i + 1, kind: i % 3 ? 'wall' : 'autocannonTurret', cx: cx + (i % 40) - 20, cy: cy + Math.floor(i / 40) - 20, rot: i % 4, level: 1, health: 50 + i, progress: i === blocks - 1 ? 0.37 : 1 });
  return { id, name: `Outpost ${id}`, cx, cy, structures, revision: 7, energy: 123, stored: { iron: 999, copper: 5, crystal: 0, ice: 0, radioactive: 0 }, drones: [] } as Outpost;
}

test('outposts encode into parts and rebuild for display without any stored minerals', () => {
  const source = outpost(3, OUTPOST_PART + 150), parts = encodeOutpost(source);
  assert.equal(parts.length, 2, 'large outposts split into parts');
  assert.ok(JSON.stringify(parts[0]).length < 12000, 'each part fits comfortably in one message');
  const decoded = parts.reverse().map(p => decodeOutpostPart(JSON.parse(JSON.stringify(p)))!);
  const copy = outpostFromParts(decoded.sort((a, b) => a.p - b.p), 99);
  assert.equal(copy.id, 99); assert.equal(copy.structures.length, source.structures.length); assert.equal(copy.revision, 7);
  const last = copy.structures[copy.structures.length - 1], original = source.structures[source.structures.length - 1];
  assert.deepEqual([last.kind, last.cx, last.cy, last.rot, last.level, last.health, last.progress], [original.kind, original.cx, original.cy, original.rot, original.level, original.health, 0.37]);
  assert.equal(JSON.stringify(parts).includes('999'), false, 'stored minerals are never sent');
  assert.equal(decodeOutpostPart({ ...parts[0], k: ['notABlock'] }), undefined, 'unknown block kinds rejected');
  assert.equal(decodeOutpostPart({ ...parts[0], p: 5 }), undefined, 'part index out of range rejected');
});

test('over the relay: each pilot sees the other\'s outposts as they are built, changed and lost', async () => {
  const relay = await startRelay({ port: 0, host: '127.0.0.1' }), url = `ws://127.0.0.1:${relay.port}`, clock = () => performance.now() / 1000;
  const pilot = (name: string) => { const model = new GameModel('outpost-share'); model.asteroids = []; model.enemies = []; const net = new NetClient(), link = new SharedLink(net, () => model); net.connect(url, name); return { model, net, link }; };
  type Pilot = ReturnType<typeof pilot>;
  const step = (p: Pilot, owner: boolean) => {
    const m = p.model, now = clock(); m.asteroids = []; m.enemies = [];
    m.update(1 / 60, { x: 0, y: 0, aim: { x: m.player.x, y: m.player.y - 100 }, fire: false, mine: false, dock: false });
    p.net.setSector(worldRef(m), owner);
    p.net.sendState(now, { x: m.player.x, y: m.player.y, vx: 0, vy: 0, angle: 0, health: 1, maxHealth: 1, paint: 0, blocks: [['core', 0, 0, 1]] });
    p.link.frame(m, now);
  };
  const until = async (check: () => boolean, a: Pilot, b: Pilot, limit = 300) => { for (let i = 0; i < limit && !check(); i++) { step(a, true); step(b, false); await new Promise(r => setTimeout(r, 10)); } return check(); };
  try {
    const a = pilot('A'), b = pilot('B');
    Object.assign(a.model.player, { x: 30000, y: 30000 }); Object.assign(b.model.player, { x: 30200, y: 30000 });
    assert.ok(await until(() => Boolean(a.model.shared && b.model.shared), a, b), 'sharing the sector');
    // A (authority) builds after B arrived; B (follower) builds too. Each sees the other's.
    a.model.outposts = [outpost(1, 30, 600, 600)];
    b.model.outposts = [outpost(1, 12, 640, 560)];
    assert.ok(await until(() => b.model.visitorOutposts.length === 1 && a.model.visitorOutposts.length === 1, a, b), 'both see the other\'s outpost');
    assert.equal(b.model.visitorOutposts[0].structures.length, 30);
    assert.equal(a.model.visitorOutposts[0].structures.length, 12);
    assert.equal(b.model.visitorOutposts[0].stored, undefined, 'display copy holds no minerals');
    // A adds a block: B's copy follows.
    const grown = a.model.outposts[0]; grown.structures.push({ id: 99, kind: 'reactor', cx: 610, cy: 610, rot: 0, level: 1, health: 10, progress: 0.2 }); grown.revision++;
    assert.ok(await until(() => b.model.visitorOutposts[0]?.structures.length === 31, a, b), 'new block reaches the other pilot');
    // Construction progress shows without a new revision.
    grown.structures[grown.structures.length - 1].progress = 0.9;
    assert.ok(await until(() => (b.model.visitorOutposts[0]?.structures.at(-1)?.progress ?? 0) >= 0.85, a, b), 'construction progress follows');
    // A's outpost is destroyed: it disappears for B.
    a.model.outposts = [];
    assert.ok(await until(() => b.model.visitorOutposts.length === 0, a, b), 'lost outpost removed');
    // B leaves: A drops B's outposts.
    b.net.disconnect();
    assert.ok(await until(() => a.model.visitorOutposts.length === 0, a, { ...b, net: b.net } as Pilot), 'a departed pilot\'s outposts go');
    a.net.disconnect();
  } finally { await relay.close(); }
});

test('drone rows: only drones in flight near another pilot, with the beam point while cutting', () => {
  const outposts = [{ id: 4, drones: [
    { id: 1, x: 100.4, y: 200.6, angle: 1.2345, state: 'mining', beam: { x: 130, y: 210 } },
    { id: 2, x: 0, y: 0, angle: 0, state: 'idle' },
    { id: 3, x: 9000, y: 9000, angle: 0, state: 'outbound' },
  ] }];
  const rows = encodeDrones(outposts, (x, y) => Math.hypot(x, y) < 1000);
  assert.deepEqual(rows, [[4, 1, 100, 201, 1.23, 130, 210]]);
  assert.deepEqual(decodeDrones(JSON.parse(JSON.stringify(rows))), rows);
  assert.equal(decodeDrones([[4, 1, 0, 0, 0, 5000, 0]]).length, 0, 'a beam far from its drone is rejected');
  assert.equal(decodeDrones([[4, 1, 'x', 0, 0]]).length, 0);
});

test("over the relay: another pilot's drones fly on their outpost here, without mining anything for this pilot", async () => {
  const relay = await startRelay({ port: 0, host: '127.0.0.1' }), url = `ws://127.0.0.1:${relay.port}`, clock = () => performance.now() / 1000;
  const pilot = (name: string) => { const model = new GameModel('drone-share'); model.asteroids = []; model.enemies = []; const net = new NetClient(), link = new SharedLink(net, () => model); net.connect(url, name); return { model, net, link }; };
  type Pilot = ReturnType<typeof pilot>;
  const step = (p: Pilot, owner: boolean) => {
    const m = p.model, now = clock(); m.asteroids = []; m.enemies = [];
    m.update(1 / 60, { x: 0, y: 0, aim: { x: m.player.x, y: m.player.y - 100 }, fire: false, mine: false, dock: false });
    p.net.setSector(worldRef(m), owner);
    p.net.sendState(now, { x: m.player.x, y: m.player.y, vx: 0, vy: 0, angle: 0, health: 1, maxHealth: 1, paint: 0, blocks: [['core', 0, 0, 1]] });
    p.link.frame(m, now);
  };
  try {
    const a = pilot('A'), b = pilot('B');
    Object.assign(a.model.player, { x: 30000, y: 30000 }); Object.assign(b.model.player, { x: 30200, y: 30000 });
    // A's outpost far from A's ship, so A's own model leaves its drones alone (not simulated); the test flies them.
    const home = outpost(1, 5, 1300, 1300);
    home.drones = [{ id: 7, hangar: 2, x: 30100, y: 30100, angle: 0, state: 'outbound', load: 0, timer: 0 }];
    a.model.outposts = [home];
    const cargo = JSON.stringify(b.model.cargo), stored = JSON.stringify(b.model.stored);
    let drawn: { x: number; y: number } | undefined;
    for (let i = 0; i < 400; i++) {
      home.drones![0].x += 1; step(a, true); step(b, false);
      drawn = b.model.visitorOutposts[0]?.drones?.[0];
      if (drawn && Math.abs(drawn.x - home.drones![0].x) < 25 && i > 60) break;
      await new Promise(r => setTimeout(r, 10));
    }
    assert.ok(drawn, "the drone appears on the other pilot's copy of the outpost");
    assert.ok(Math.abs(drawn!.x - home.drones![0].x) < 25, "and follows its owner's drone");
    home.drones![0].state = 'idle';
    let gone = false;
    for (let i = 0; i < 200 && !gone; i++) { step(a, true); step(b, false); gone = !b.model.visitorOutposts[0]?.drones?.length; await new Promise(r => setTimeout(r, 10)); }
    assert.ok(gone, 'a landed drone disappears');
    assert.equal(JSON.stringify(b.model.cargo), cargo); assert.equal(JSON.stringify(b.model.stored), stored, 'nothing mined or delivered for the viewer');
    a.net.disconnect(); b.net.disconnect();
  } finally { await relay.close(); }
});
