import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameModel } from '../src/model.ts';
import { NetClient } from '../src/net.ts';
import { SharedLink } from '../src/sharedLink.ts';
import { worldRef } from '../src/sectors.ts';
import { startRelay } from '../server/relay.ts';

const total = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
const drops = (m: GameModel) => m.drops.reduce((a, d) => a + d.amount, 0);

/** A full pilot: model, relay client and shared-sector link, stepped by hand. */
function pilot(name: string, url: string) {
  const model = new GameModel('pvp-arena');
  model.asteroids = []; model.enemies = [];
  const net = new NetClient(), link = new SharedLink(net, () => model);
  net.connect(url, name);
  return { model, net, link, name };
}
type Pilot = ReturnType<typeof pilot>;
function step(p: Pilot, now: number, aim?: { x: number; y: number }) {
  const m = p.model; m.enemies = []; m.asteroids = [];
  m.update(0.05, { x: 0, y: 0, aim: aim ?? { x: m.player.x, y: m.player.y - 100 }, fire: Boolean(aim), mine: false, dock: false });
  p.net.setSector(worldRef(m), false);
  const s = m.player;
  p.net.sendState(now, { x: s.x, y: s.y, vx: s.vx, vy: s.vy, angle: s.angle, health: Math.max(0, s.health), maxHealth: m.maxHealth, paint: 0, dead: m.dead || undefined, blocks: [['core', 0, 0, m.coreLevel]] });
  p.link.frame(m, now);
}

test('over the relay: a stranger shoots a pilot down, takes their cargo, and the victim owes a rebuild', async () => {
  const relay = await startRelay({ port: 0, host: '127.0.0.1' }), url = `ws://127.0.0.1:${relay.port}`;
  try {
    const shooter = pilot('Shooter', url), victim = pilot('Victim', url);
    Object.assign(shooter.model.player, { x: 9000, y: 9000, vx: 0, vy: 0 });
    Object.assign(victim.model.player, { x: 9180, y: 9000, vx: 0, vy: 0 });
    victim.model.cargo.iron = 30; victim.model.cargo.copper = 7;
    const before = total(shooter.model.cargo) + total(victim.model.cargo) + drops(shooter.model) + drops(victim.model);
    const clock = () => performance.now() / 1000;
    // Wait until both see each other in a shared sector.
    for (let i = 0; i < 200 && !(shooter.model.shared?.targets.length && victim.model.shared?.targets.length); i++) { step(shooter, clock()); step(victim, clock()); await new Promise(r => setTimeout(r, 10)); }
    assert.ok(shooter.model.shared && victim.model.shared, 'both sharing the sector');
    assert.equal(shooter.model.shared!.allies.size, 0, 'strangers, not allies');
    for (let i = 0; i < 1200 && !(victim.model.dead && total(shooter.model.cargo) > 0); i++) {
      step(shooter, clock(), { x: victim.model.player.x, y: victim.model.player.y }); step(victim, clock());
      await new Promise(r => setTimeout(r, 5));
    }
    assert.ok(victim.model.dead, 'victim destroyed by PvP fire');
    assert.ok(victim.model.rebuildDue, 'victim owes a rebuild');
    for (let i = 0; i < 50 && total(shooter.model.cargo) < 37; i++) { step(shooter, clock()); step(victim, clock()); await new Promise(r => setTimeout(r, 10)); }
    assert.equal(shooter.model.cargo.iron, 30); assert.equal(shooter.model.cargo.copper, 7);
    const after = total(shooter.model.cargo) + total(victim.model.cargo) + drops(shooter.model) + drops(victim.model);
    assert.equal(after, before, 'minerals moved, none created or lost');
    shooter.net.disconnect(); victim.net.disconnect();
  } finally { await relay.close(); }
});

test('over the relay: lobby allies cannot hurt each other', async () => {
  const relay = await startRelay({ port: 0, host: '127.0.0.1' }), url = `ws://127.0.0.1:${relay.port}`;
  try {
    const a = pilot('A', url), b = pilot('B', url), clock = () => performance.now() / 1000;
    Object.assign(a.model.player, { x: 9000, y: 9000 }); Object.assign(b.model.player, { x: 9180, y: 9000 });
    a.net.create();
    for (let i = 0; i < 200 && !a.net.lobby; i++) { step(a, clock()); await new Promise(r => setTimeout(r, 5)); }
    b.net.join(a.net.lobby!.code);
    for (let i = 0; i < 200 && !(b.net.lobby?.members.length === 2 && a.model.shared?.allies.size === 2); i++) { step(a, clock()); step(b, clock()); await new Promise(r => setTimeout(r, 10)); }
    const hull = b.model.player.health + b.model.shield;
    for (let i = 0; i < 200; i++) { step(a, clock(), { x: b.model.player.x, y: b.model.player.y }); step(b, clock()); await new Promise(r => setTimeout(r, 2)); }
    assert.ok(b.model.player.health + b.model.shield >= hull, 'no damage between allies');
    a.net.disconnect(); b.net.disconnect();
  } finally { await relay.close(); }
});
