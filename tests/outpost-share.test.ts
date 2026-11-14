import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameModel } from '../src/model.ts';
import { NetClient } from '../src/net.ts';
import { SharedLink } from '../src/sharedLink.ts';
import { worldRef } from '../src/sectors.ts';
import { encodeOutpost, decodeOutpostPart, outpostFromParts, OUTPOST_PART } from '../src/shared.ts';
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
