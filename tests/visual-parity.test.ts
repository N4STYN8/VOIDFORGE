import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameModel, type Enemy } from '../src/model.ts';
import { NetClient } from '../src/net.ts';
import { SharedLink } from '../src/sharedLink.ts';
import { worldRef } from '../src/sectors.ts';
import { sharedSector, encodeVisual, decodeVisuals, decodeTurrets, encodeLook, decodeLook } from '../src/shared.ts';
import { startRelay } from '../server/relay.ts';
import type { Outpost, Structure } from '../src/outposts.ts';

function quiet(seed = 'visual-parity') {
  const m = new GameModel(seed); m.asteroids = []; m.enemies = []; m.bullets = [];
  Object.assign(m.player, { x: 30000, y: 30000, vx: 0, vy: 0 });
  return m;
}
const idle = (m: GameModel) => ({ x: 0, y: 0, aim: { x: m.player.x, y: m.player.y - 100 }, fire: false, mine: false, dock: false, view: { x: m.player.x - 1500, y: m.player.y - 1000, width: 3000, height: 2000 } });

test('effects raised between updates (other pilots\' data) are shown on the next update, not cleared unseen', () => {
  const m = quiet(); m.update(1 / 60, idle(m));
  m.applyPilotShots([{ x: m.player.x + 100, y: m.player.y, vx: 600, vy: 0, life: 1, weapon: 'cannon', level: 1 }], undefined, 'other');
  m.update(1 / 60, idle(m));
  assert.ok(m.effects.some(e => e.type === 'muzzle' && e.remote), 'the remote muzzle flash survives into the frame that is drawn');
  m.update(1 / 60, idle(m));
  assert.equal(m.effects.some(e => e.type === 'muzzle'), false, 'and is gone after it was shown');
});

test('remote shots stop at enemies and other pilots\' ships with a spark, pass allies, and damage nothing', () => {
  const m = quiet(), p = m.player;
  m.shared = sharedSector('follower', () => true); m.shared.selfId = 'me';
  m.shared.targets = [{ id: 'victim', x: p.x + 400, y: p.y - 300, vx: 0, vy: 0, radius: 20 }, { id: 'friend', x: p.x + 400, y: p.y + 300, vx: 0, vy: 0, radius: 20 }];
  m.shared.allies = new Set(['shooter', 'friend', 'me']);
  const enemy = { id: 77, kind: 'raider', x: p.x - 400, y: p.y - 300, vx: 0, vy: 0, angle: 0, health: 40, cooldown: 99 } as Enemy; m.enemies = [enemy];
  // A stranger's shot at the victim, an ally's shot at another ally, and a shot at the enemy.
  const fire = (x: number, y: number, owner: string) => { m.applyPilotShots([{ x, y, vx: 800, vy: 0, life: 1 }], undefined, owner); return m.bullets[m.bullets.length - 1]; };
  const atVictim = fire(p.x + 200, p.y - 300, 'stranger'), atFriend = fire(p.x + 200, p.y + 300, 'shooter'), atEnemy = fire(p.x - 600, p.y - 300, 'stranger');
  for (let i = 0; i < 30; i++) { m.enemies[0].x = enemy.x; m.update(1 / 60, idle(m)); }
  assert.ok(atVictim.life <= 0 && atVictim.x < p.x + 400, 'stopped at the stranger\'s target');
  assert.ok(atFriend.life > 0 && atFriend.x > p.x + 420, 'passes through an ally of its shooter');
  assert.ok(atEnemy.life <= 0 && atEnemy.x < p.x - 380, 'stopped at the enemy');
  assert.equal(m.enemies[0].health, 40, 'the enemy took no damage here');
});

test('this pilot\'s own explosions are offered to the others; effects from remote data are not sent back', () => {
  const m = quiet(); m.shared = sharedSector('authority', () => true);
  const e = (m as unknown as { spawnEnemy(kind: string, x: number, y: number, angle: number): Enemy }).spawnEnemy('raider', m.player.x + 300, m.player.y, 0);
  (m as unknown as { hitEnemy(e: Enemy, d: number): void }).hitEnemy(e, 9999);
  assert.ok(m.shared.effects.some(x => x.type === 'explosion'), 'the kill explosion is queued for the others');
  m.shared.effects.length = 0;
  m.applyRemoteVisuals([{ type: 'explosion', x: m.player.x, y: m.player.y, radius: 40 }]);
  assert.equal(m.shared.effects.length, 0, 'a remote explosion is never echoed');
});

test('visual codec round trip; remote EMP pulses and plasma fields grow, expire and never touch enemies', () => {
  const rows = [encodeVisual({ type: 'arc', x: 1, y: 2, toX: 30, toY: 40, color: 0x88aaff }), encodeVisual({ type: 'emp', x: 5, y: 6, radius: 300 }), encodeVisual({ type: 'nova', x: 7, y: 8, radius: 90, life: 2.5 }), encodeVisual({ type: 'explosion', x: 9, y: 9, radius: 60, weapon: 'rocket', level: 5 })];
  const back = decodeVisuals(JSON.parse(JSON.stringify(rows)));
  assert.deepEqual(back.map(v => v.type), ['arc', 'emp', 'nova', 'explosion']);
  assert.equal(decodeVisuals([{ k: 'zz', x: 0, y: 0 }, { k: 'e', x: 'a', y: 0 }]).length, 0, 'junk rejected');
  assert.deepEqual(decodeTurrets([[1, 2, 0.5], [1, -1, 0], 'x']), [[1, 2, 0.5]]);
  assert.deepEqual(decodeLook(encodeLook({ x: 0, y: 0 }, 0, 0, [], [], true, true)), { b: 1, d: 1 });
  const m = quiet(), p = m.player;
  const enemy = { id: 5, kind: 'raider', x: p.x + 50, y: p.y, vx: 0, vy: 0, angle: 0, health: 40, cooldown: 99 } as Enemy; m.enemies = [enemy];
  m.applyRemoteVisuals([{ type: 'emp', x: p.x, y: p.y, radius: 200 }, { type: 'nova', x: p.x + 50, y: p.y, radius: 90, life: 0.5 }]);
  m.update(1 / 60, idle(m));
  assert.equal(m.remotePulses.length, 1); assert.ok(m.remotePulses[0].radius > 0);
  for (let i = 0; i < 120; i++) m.update(1 / 60, idle(m));
  assert.equal(m.remotePulses.length, 0, 'pulse finished'); assert.equal(m.remoteFields.length, 0, 'field expired');
  assert.equal(m.enemies[0]?.health ?? 40, 40, 'no damage'); assert.equal(m.enemies[0]?.disabledFor ?? 0, 0, 'no stun');
});

test('over the relay: explosions, EMP pulses, turret aim and a pilot\'s destruction reach the other pilot', async () => {
  const relay = await startRelay({ port: 0, host: '127.0.0.1' }), url = `ws://127.0.0.1:${relay.port}`, clock = () => performance.now() / 1000;
  const pilot = (name: string) => { const model = quiet('visual-relay'); const net = new NetClient(), link = new SharedLink(net, () => model); net.connect(url, name); return { model, net, link }; };
  type Pilot = ReturnType<typeof pilot>;
  const step = (p: Pilot, owner: boolean) => {
    const m = p.model, now = clock(); m.asteroids = [];
    m.update(1 / 60, idle(m));
    p.net.setSector(worldRef(m), owner);
    p.net.sendState(now, { x: m.player.x, y: m.player.y, vx: 0, vy: 0, angle: 0, health: Math.max(0, m.player.health), maxHealth: 100, paint: 0, dead: m.dead || undefined, blocks: [['core', 0, 0, 1]] });
    p.link.frame(m, now);
  };
  const until = async (check: () => boolean, a: Pilot, b: Pilot, each = () => {}) => { for (let i = 0; i < 300 && !check(); i++) { each(); step(a, true); step(b, false); await new Promise(r => setTimeout(r, 10)); } return check(); };
  try {
    const a = pilot('A'), b = pilot('B');
    Object.assign(b.model.player, { x: 30300, y: 30000 });
    assert.ok(await until(() => Boolean(a.model.shared && b.model.shared && b.net.peers.size && a.net.peers.size), a, b), 'sharing');
    // A's EMP pulse and an explosion where B can see them.
    a.model.empPulses.push({ x: 30100, y: 30000, radius: 0, maxRadius: 400, damage: 0, stun: 0, hits: [] });
    a.model.applyRemoteVisuals([]); // nothing
    (a.model as unknown as { addBlast(b: { x: number; y: number; radius: number; life: number }): void }).addBlast({ x: 30150, y: 30050, radius: 60, life: 0.2 });
    let sawExplosion = false;
    assert.ok(await until(() => b.model.remotePulses.length > 0 && sawExplosion, a, b, () => { sawExplosion ||= b.model.effects.some(e => e.type === 'explosion' && e.remote); }), 'B sees A\'s EMP pulse and explosion');
    // A's outpost turret turns: B's copy turns too.
    // Cells are OUTPOST.cell (16) units: these sit beside both ships at about 30,000.
    const turret: Structure = { id: 2, kind: 'autocannonTurret', cx: 1877, cy: 1877, rot: 0, level: 1, health: 100, progress: 1, angle: 0 };
    const outpost = { id: 1, name: 'A1', cx: 1875, cy: 1875, revision: 1, energy: 0, drones: [], structures: [{ id: 1, kind: 'outpostCore', cx: 1875, cy: 1875, rot: 0, level: 1, health: 300, progress: 1 }, turret] } as unknown as Outpost;
    a.model.outposts = [outpost];
    assert.ok(await until(() => b.model.visitorOutposts.length === 1, a, b), 'outpost shared');
    assert.ok(await until(() => Math.abs((b.model.visitorOutposts[0].structures[1].angle ?? 0) - 1.25) < 0.01, a, b, () => { turret.angle = 1.25; }), 'turret aim follows');
    // A is destroyed: B shows the explosion.
    let boom = false;
    assert.ok(await until(() => boom, a, b, () => { a.model.player.health = 0; boom ||= b.model.effects.some(e => e.type === 'explosion' && e.remote && Math.abs(e.x - 30000) < 60); }), 'B sees A explode');
    a.net.disconnect(); b.net.disconnect();
  } finally { await relay.close(); }
});
