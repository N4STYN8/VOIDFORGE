import { fixtureModel } from './fixtures.ts';
import { closestBoundary, containsPoint } from '../src/asteroidGeometry.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WORLD, ENEMIES } from '../src/data.ts';
import { GameModel, type Input } from '../src/model.ts';
const idle = (patch: Partial<Input> = {}): Input => ({ x: 0, y: 0, aim: { x: 3380, y: 3330 }, fire: false, mine: false, dock: false, ...patch });
test('thrust accelerates, diagonal speed is capped, and world boundaries stop velocity', () => {
  const m = fixtureModel(); m.enemies = []; m.asteroids = [];
  const start = { ...m.player };
  m.update(0.05, idle({ x: 1, y: 1 }));
  assert.ok(m.player.x > start.x && m.player.y > start.y);
  assert.ok(Math.hypot(m.player.vx, m.player.vy) < 280);
  for (let i = 0; i < 20; i++) m.update(0.05, idle({ x: 1, y: 1 }));
  assert.ok(Math.abs(Math.hypot(m.player.vx, m.player.vy) - 280) < 0.001);
  m.player.x = 20; m.player.vx = -100;
  m.update(0.05, idle({ x: -1 }));
  assert.equal(m.player.x, 20); assert.equal(m.player.vx, 0);
});
test('releasing thrust coasts with gradual drag, counter-thrust reverses, respawn clears momentum', () => {
  const m = fixtureModel(); m.enemies = []; m.asteroids = [];
  for (let i = 0; i < 20; i++) m.update(0.05, idle({ x: 1 }));
  const x = m.player.x, speed = m.player.vx;
  for (let i = 0; i < 10; i++) m.update(0.05, idle());
  assert.ok(m.player.x - x > 80);
  assert.ok(m.player.vx > 0 && m.player.vx < speed);
  for (let i = 0; i < 20; i++) m.update(0.05, idle({ x: -1 }));
  assert.ok(m.player.vx < 0);
  m.player.health = 0; m.respawn();
  assert.equal(m.player.vx, 0); assert.equal(m.player.vy, 0);
});
test('configured unlimited cargo still collects and stores everything', () => {
  const m = fixtureModel();m.cargoCapacity=Infinity; m.enemies = []; m.asteroids = m.asteroids.filter(a => a.x === 3380 || a.x === 3000);
  for (let i = 0; i < 89; i++) m.update(0.05, idle({ mine: true }));
  assert.equal(m.drops.filter(d => d.ore === 'iron').reduce((n, d) => n + d.amount, 0), 40);
  m.player.x = m.drops[0].x; m.player.y = m.drops[0].y; m.update(0.01, idle());
  assert.equal(m.cargo.iron, 40);
  m.player.x = 3200; m.player.y = 3330;
  m.cargo.iron = 1000000; const copper = m.asteroids.find(a => a.ore === 'copper' && a.x === 3000)!;
  for (let i = 0; i < 20; i++) m.update(0.05, idle({ mine: true, aim: copper }));
  assert.equal(m.drops.filter(d => d.ore === 'copper').reduce((n, d) => n + d.amount, 0), 9);
  m.player.x = m.drops[0].x; m.player.y = m.drops[0].y; m.update(0.01, idle());
  assert.equal(m.cargo.copper, 9);
  m.drops.push({ id: 999, x: m.player.x, y: m.player.y, ore: 'crystal', amount: 50000 });
  m.update(0.01, idle()); assert.equal(m.cargoUsed, 1050009); assert.equal(m.drops.length, 0);
  m.player.x = 3200; m.player.y = 3330;
  m.update(0.05, idle({ dock: true })); assert.equal(m.cargoUsed, 0); assert.equal(m.stored.iron, 1000000); assert.equal(m.stored.crystal, 50000);
});
test('projectiles destroy enemies and drop collectible resources', () => {
  const m = fixtureModel(); m.player.x = 4000; m.player.y = 4000;
  m.enemies = [{ id: 900, x: 4150, y: 4000, health: 60, cooldown: 100, angle: 0 }];
  for (let i = 0; i < 35; i++) m.update(0.05, idle({ fire: true, aim: { x: 4150, y: 4000 } }));
  assert.equal(m.kills, 1); assert.equal(m.drops.length, 1); assert.equal(m.enemyHits, 3);
  m.player.x = m.drops[0].x; m.player.y = m.drops[0].y; m.update(0.01, idle()); assert.equal(m.cargo.iron, 6);
});
test('death drops cargo once and respawn preserves station storage', () => {
  const m = fixtureModel(); m.player.x = 4000; m.player.y = 4000; m.player.health = 9;
  m.cargo.copper = 12; m.stored.iron = 50;
  m.bullets = [{ id: 999, x: 4000, y: 4000, vx: 0, vy: 0, life: 1, enemy: true }];
  m.update(0.01, idle()); assert.equal(m.dead, true); assert.equal(m.cargoUsed, 0); assert.equal(m.drops[0].amount, 12);
  m.update(0.01, idle()); assert.equal(m.deaths, 1);
  m.respawn(); assert.equal(m.player.health, 100); assert.equal(m.stored.iron, 50); assert.equal(m.atStation, true);
});
test('station blocks gunfire; docking only repairs when minerals are available', () => {
  const m = fixtureModel(); m.player.health = 40;
  m.bullets = [{ id: 999, ...m.player, vx: 0, vy: 0, life: 1, enemy: true }];
  m.update(0.01, idle()); assert.equal(m.player.health, 40);
  m.update(0.01, idle({ dock: true })); assert.equal(m.player.health, 40);
  m.stored.iron = 12; m.update(0.01, idle({ dock: true })); assert.equal(m.player.health, 100); assert.equal(m.stored.iron, 0);
});


test('module installation charges stored ore and enforces adjacency and station access', () => {
  const m = fixtureModel();
  assert.equal(m.installModule('cannon', -1, 0), false);
  m.stored = { iron: 200, copper: 100, crystal: 0, ice: 0, radioactive: 0 };
  assert.equal(m.installModule('cannon', 2, 2), false);
  assert.equal(m.installModule('cannon', 1, 0), false);
  assert.equal(m.installModule('cannon', -1, 0), true);
  assert.equal(m.stored.iron, 180); assert.equal(m.stored.copper, 90);
  assert.equal(m.installModule('cannon', -2, 0), true);
  assert.equal(m.installModule('cannon', -2, 1), true);
  assert.equal(m.installModule('cannon', -2, 2), true);
  m.player.x = 5000; assert.equal(m.installModule('cargo', 0, 1), false);
});
test('installed modules add projectiles, mining throughput and pickup reach, and survive respawn', () => {
  const m = fixtureModel(); m.enemies = [];
  m.asteroids = m.asteroids.filter(a => a.x === 3380);
  m.stored = { iron: 100, copper: 100, crystal: 0, ice: 0, radioactive: 0 };
  assert.equal(m.installModule('miner', -1, 0), true);
  assert.equal(m.installModule('cannon', 0, 1), true);
  assert.equal(m.installModule('cargo', -2, 0), true);
  assert.equal(m.pickupRange, 95); assert.equal(m.miningRate, 18);
  m.player.x = 3380; m.player.y = 3530;
  m.update(0.01, idle({ fire: true })); assert.equal(m.bullets.length, 2);
  m.bullets = [];
  for (let i = 0; i < 20; i++) m.update(0.05, idle({ mine: true }));
  assert.equal(m.cargo.iron + m.drops.filter(d => d.ore === 'iron').reduce((n, d) => n + d.amount, 0), 18);
  m.player.health = 0; m.respawn(); assert.equal(m.modules.length, 5); assert.equal(m.pickupRange, 95);
});

test('fast asteroid impact damages hull and transfers momentum to ore', () => {
  const m = fixtureModel(); m.enemies = [];
  m.player.x = 4000; m.player.y = 4000; m.player.vx = 280;
  m.asteroids = [{ id: 999, x: 4050, y: 4000, vx: 0, vy: 0, radius: 35, ore: 'iron', amount: 40, health: 40 }];
  m.update(0.05, idle({ x: 1 }));
  assert.ok(m.player.health < 100); assert.ok(m.asteroids[0].vx > 0);
  const local = { x: m.player.x - m.asteroids[0].x, y: m.player.y - m.asteroids[0].y };
  assert.equal(containsPoint(local, m.asteroids[0].geometry!.vertices), false);
  assert.ok(closestBoundary(local, m.asteroids[0].geometry!.vertices).distance >= 18 - 0.001);
  const x = m.asteroids[0].x;
  m.player.x = 3800; m.player.vx = 0;
  m.update(0.05, idle()); assert.ok(m.asteroids[0].x > x);
});
test('gentle pushing and stationary contact do not hurt the player; ore stays bounded', () => {
  const m = fixtureModel(); m.enemies = [];
  m.player.x = 4000; m.player.y = 4000; m.player.vx = 30;
  m.asteroids = [{ id: 999, x: 4042, y: 4000, vx: 0, vy: 0, radius: 35, ore: 'iron', amount: 40, health: 40 }];
  m.update(0.01, idle()); assert.equal(m.player.health, 100); assert.ok(m.asteroids[0].vx > 0);
  m.player.vx = 0; m.asteroids[0].vx = 0; m.player.x = m.asteroids[0].x;
  m.update(0.01, idle()); assert.equal(m.player.health, 100); assert.ok(Number.isFinite(m.player.x));
  const edge = WORLD.width - m.asteroids[0].radius;
  m.asteroids[0].x = edge; m.asteroids[0].vx = 100;
  m.update(0.05, idle()); assert.equal(m.asteroids[0].x, edge); assert.ok(m.asteroids[0].vx < 0);
});
test('ship impacts can kill both ships, award loot once, and use normal death recovery', () => {
  const m = fixtureModel(); m.asteroids = [];
  m.player.x = 4000; m.player.y = 4000; m.player.vx = 280; m.player.health = 5; m.cargo.copper = 100;
  m.enemies = [{ id: 999, x: 4038, y: 4000, health: 5, cooldown: 100, angle: 0 }];
  m.update(0.05, idle({ x: 1 }));
  assert.equal(m.dead, true); assert.equal(m.kills, 1); assert.equal(m.enemies.length, 0);
  assert.equal(m.drops.find(d => d.ore === 'copper')?.amount, 100);
  assert.equal(m.drops.filter(d => d.ore === 'iron').length, 1);
  m.respawn(); assert.equal(m.player.health, 100); assert.equal(m.player.vx, 0);
});
test('a pushed deposit transfers motion to a neighboring deposit', () => {
  const m = fixtureModel(); m.enemies = [];
  m.asteroids = [{ id: 998, x: 4000, y: 4000, vx: 100, vy: 0, radius: 30, ore: 'iron', amount: 30, health: 30 }, { id: 999, x: 4060, y: 4000, vx: 0, vy: 0, radius: 30, ore: 'copper', amount: 30, health: 30 }];
  m.update(0.05, idle()); assert.ok(m.asteroids[1].vx > 0);
});

test('individual upgrades charge costs, respect maximum level and station access, and change real stats', () => {
  const m = fixtureModel(); m.asteroids = []; m.enemies = [];
  assert.equal(m.upgradeModule(0, -1), false);
  m.coreLevel = 3;
  m.stored = { iron: 1000, copper: 1000, crystal: 1000, ice: 0, radioactive: 0 };
  assert.equal(m.upgradeModule(0, -1), true); assert.equal(m.miningRate, 15);
  assert.equal(m.stored.iron, 985); assert.equal(m.stored.copper, 990);
  assert.equal(m.modules.find(m => m.kind === 'cannon')!.level, 1);
  assert.equal(m.upgradeModule(0, -1), true); assert.equal(m.miningRate, 24); assert.equal(m.stored.crystal, 990);
  const stored = { ...m.stored };
  assert.equal(m.upgradeModule(0, -1), false); assert.deepEqual(m.stored, stored);
  assert.equal(m.upgradeModule(1, 0), true);
  m.player.x = 5000;
  m.update(0.01, idle({ fire: true })); assert.equal(m.bullets[0].damage, 30);
  m.player.x = 5000; assert.equal(m.upgradeModule(0, 0), false); assert.equal(m.coreLevel, 3);
});
test('core, armor, collectors and thrusters improve hull, pickup reach and movement across respawn', () => {
  const m = fixtureModel(); m.asteroids = []; m.enemies = [];
  m.stored = { iron: 1000, copper: 1000, crystal: 1000, ice: 0, radioactive: 0 };
  assert.equal(m.upgradeModule(0, 0), true); assert.equal(m.maxHealth, 150); assert.equal(m.player.health, 150);
  assert.equal(m.installModule('armor', -1, 0), true); assert.equal(m.maxHealth, 180);
  assert.equal(m.upgradeModule(-1, 0), true); assert.equal(m.maxHealth, 205);
  const previousSpeed=m.maxSpeed,previousThrust=m.acceleration;
  assert.equal(m.installModule('engine',0,1),true);assert.ok(m.maxSpeed>previousSpeed);assert.ok(m.acceleration>previousThrust);
  const speed=m.maxSpeed;assert.equal(m.upgradeModule(0,1),true);assert.ok(m.maxSpeed>speed);
  assert.equal(m.installModule('cargo', -2, 0), true); assert.equal(m.upgradeModule(-2, 0), true); assert.equal(m.pickupRange, 120);
  m.player.health = 0; m.respawn(); assert.equal(m.player.health, 205); assert.equal(m.coreLevel, 2);
  m.player.health = 1; m.update(0.01, idle({ dock: true })); assert.equal(m.player.health, 205);
});
test('rockets explode on contact and damage multiple enemies once with limited fire rate', () => {
  const m = fixtureModel(); m.asteroids = []; m.enemies = [];
  m.stored = { iron: 100, copper: 100, crystal: 0, ice: 0, radioactive: 0 };
  assert.equal(m.installModule('rocket', -1, 0), true);
  m.modules = m.modules.filter(m => m.kind === 'rocket');
  m.player.x = 4000; m.player.y = 4000;
  m.enemies = [{ id: 998, x: 4150, y: 4000, health: 60, cooldown: 100, angle: 0 }, { id: 999, x: 4190, y: 4020, health: 60, cooldown: 100, angle: 0 }];
  m.update(0.01, idle({ fire: true, aim: { x: 4150, y: 4000 } }));
  assert.equal(m.bullets.length, 1); assert.equal(m.bullets[0].rocket, true);
  m.update(0.01, idle({ fire: true })); assert.equal(m.bullets.length, 1);
  for (let i = 0; i < 15; i++) m.update(0.05, idle());
  assert.equal(m.kills, 2); assert.equal(m.enemies.length, 0); assert.equal(m.drops.length, 2);
});


test('shield modules absorb hits, delay regeneration and carry upgrades across respawn', () => {
  const m = fixtureModel(); m.asteroids = []; m.enemies = [];
  m.stored = { iron: 1000, copper: 1000, crystal: 1000, ice: 0, radioactive: 0 };
  assert.equal(m.installModule('shield', -1, 0), true); assert.equal(m.shield, 40);
  m.player.x = 5000; m.player.y = 5000;
  m.bullets = [{ id: 999, x: 5000, y: 5000, vx: 0, vy: 0, life: 1, enemy: true, damage: 50 }];
  m.update(0.01, idle()); assert.equal(m.shield, 0); assert.equal(m.player.health, 90);
  for (let i = 0; i < 40; i++) m.update(0.05, idle());
  assert.equal(m.shield, 0);
  for (let i = 0; i < 40; i++) m.update(0.05, idle());
  assert.ok(m.shield > 0 && m.shield < 40);
  m.player.x = 3200; m.player.y = 3330; m.coreLevel = 2; assert.equal(m.upgradeModule(-1, 0), true); assert.equal(m.maxShield, 75);
  m.player.health = 0; m.respawn(); assert.equal(m.shield, 75);
});
test('moving cubes preserves upgrades and connected layout without spending minerals', () => {
  const m = fixtureModel(); m.stored = { iron: 1000, copper: 1000, crystal: 1000, ice: 0, radioactive: 0 };
  m.coreLevel = 2; m.upgradeModule(1, 0); const before = { ...m.stored };
  assert.equal(m.moveModule(1, 0, -1, 0), true);
  assert.equal(m.modules.find(m => m.kind === 'cannon')!.level, 2); assert.deepEqual(m.stored, before);
  assert.equal(m.moveModule(-1, 0, 2, 2), false);
  assert.equal(m.modules.find(m => m.kind === 'cannon')!.x, -1);
});
test('locked outposts charge minerals once and enable docking, upgrades and nearby respawn', () => {
  const m = fixtureModel(); m.asteroids = []; m.enemies = [];
  const base = m.bases[1]; m.player.x = base.x; m.player.y = base.y + 100;
  assert.equal(m.atStation, false); assert.equal(m.unlockBase(), false);
  m.cargo.iron = 50; m.stored.iron = 50; m.cargo.copper = 40;
  assert.equal(m.unlockBase(), true); assert.equal(m.cargo.iron, 0); assert.equal(m.stored.iron, 20); assert.equal(m.cargo.copper, 0);
  assert.equal(m.atStation, true); const stored = { ...m.stored };
  assert.equal(m.unlockBase(), false); assert.deepEqual(m.stored, stored);
  m.player.health = 1; m.update(0.01, idle({ dock: true })); assert.equal(m.player.health, m.maxHealth);
  m.player.health = 0; m.respawn(); assert.equal(m.player.x, base.x); assert.equal(m.player.y, base.y + 130);
});
test('the larger world reveals explored tiles only and retains discoveries after death', () => {
  const m = fixtureModel(); m.asteroids = []; m.enemies = [];
  assert.equal(WORLD.width, 19200); assert.equal(WORLD.height, 19200);
  const home = { x: m.player.x, y: m.player.y }, far = { x: 15000, y: 15000 };
  assert.equal(m.isExplored(home), true); assert.equal(m.isExplored(far), false);
  m.player.x = far.x; m.player.y = far.y; m.update(0.01, idle());
  assert.equal(m.isExplored(far), true); m.player.health = 0; m.respawn();
  assert.equal(m.isExplored(far), true); assert.equal(m.isExplored(home), true);
});
test('enemy variants fire their defined damage and keep distinct engagement distances', () => {
  const m = fixtureModel(); m.asteroids = [];
  m.player.x = 5000; m.player.y = 5000;
  m.enemies = [{ id: 998, kind: 'scout', x: 5300, y: 5000, health: 35, cooldown: 0, angle: 0 }, { id: 999, kind: 'sniper', x: 5600, y: 5000, health: 70, cooldown: 0, angle: 0 }];
  m.update(0.01, idle()); assert.equal(m.bullets.length, 2);
  assert.ok(m.bullets.some(b => b.damage === ENEMIES.scout.weapon.damage)); assert.ok(m.bullets.some(b => b.damage === ENEMIES.sniper.weapon.damage));
  assert.ok(m.enemies[0].x < 5300); assert.equal(m.enemies[1].x, 5600);
});


test('tractor beam pulls ore through visible links and conserves pickup amounts', () => {
  const m = fixtureModel(); m.asteroids = []; m.enemies = [];
  m.stored = { iron: 100, copper: 100, crystal: 100, ice: 0, radioactive: 0 };
  assert.equal(m.installModule('tractor', -1, 0), true);
  m.drops = [{ id: 999, x: m.player.x + 140, y: m.player.y, ore: 'ice', amount: 30 }];
  const x = m.drops[0].x; m.update(0.05, idle()); assert.ok(m.drops[0].x < x); assert.equal(m.tractorLinks.length, 1);
  for (let i = 0; i < 20; i++) m.update(0.05, idle());
  assert.equal(m.cargo.ice, 30); assert.equal(m.drops.length, 0);
  m.coreLevel = 2; assert.equal(m.upgradeModule(-1, 0), true);
  m.drops = [{ id: 1000, x: m.player.x + 250, y: m.player.y, ore: 'radioactive', amount: 12 }];
  m.update(0.05, idle()); assert.equal(m.tractorLinks.length, 1);
});
test('module damage detaches disconnected blocks and repairs require the exact quoted minerals', () => {
  const m = fixtureModel(); m.asteroids = []; m.enemies = [];
  m.stored = { iron: 1000, copper: 1000, crystal: 1000, ice: 0, radioactive: 0 };
  m.installModule('cargo', 2, 0);
  m.player.x = 5000; m.player.y = 5000; m.player.angle = 0;
  m.modules.find(m => m.kind === 'cannon')!.integrity = 5;
  m.bullets = [{ id: 999, x: 5016, y: 5000, vx: 0, vy: 0, life: 1, enemy: true, damage: 10 }];
  m.update(0.01, idle({ aim: { x: 5200, y: 5000 } }));
  assert.equal(m.modules.some(m => m.kind === 'cannon'), false); assert.equal(m.modules.some(m => m.kind === 'cargo'), false);
  assert.equal(m.detachedModules.length, 2); assert.ok(m.drops.length > 0);
  m.player.x = 3200; m.player.y = 3330;
  const miner = m.modules.find(m => m.kind === 'miner')!; miner.integrity = 20;
  const cost = m.repairCost; const before = { ...m.stored };
  assert.equal(m.repairShip(), true); assert.equal(m.player.health, m.maxHealth); assert.equal(miner.integrity, m.moduleMaxIntegrity(miner));
  assert.equal(m.stored.iron, before.iron - cost.iron); assert.equal(m.stored.copper, before.copper - cost.copper);
});
test('module swaps preserve equipment and recycling returns only paid costs at current condition', () => {
  const m = fixtureModel(); m.stored = { iron: 100, copper: 100, crystal: 0, ice: 0, radioactive: 0 };
  m.coreLevel = 2; m.upgradeModule(1, 0); assert.equal(m.moveModule(1, 0, 0, -1), true);
  assert.equal(m.modules.find(m => m.kind === 'cannon')!.level, 2);
  const refund = m.moduleRefund(m.modules.find(m => m.kind === 'cannon')!), before = { ...m.stored };
  assert.equal(m.removeModule(0, -1), true); assert.equal(m.stored.iron, before.iron + refund.iron);
  assert.equal(m.removeModule(0, -1), false); assert.equal(m.stored.iron, before.iron + refund.iron);
  assert.equal(m.removeModule(0, 0), false);
});
test('projectiles ignore former timeouts and disappear at visible screen bounds', () => {
  const m = fixtureModel(); m.asteroids = []; m.enemies = [];
  m.bullets = [{ id: 999, x: 3200, y: 3330, vx: 100, vy: 0, life: 0.001, enemy: false }];
  const view = { x: 3000, y: 3000, width: 500, height: 600 };
  for (let i = 0; i < 20; i++) m.update(0.05, idle({ view }));
  assert.equal(m.bullets.length, 1);
  for (let i = 0; i < 50; i++) m.update(0.05, idle({ view }));
  assert.equal(m.bullets.length, 0);
});


test('safe zones disable player fire while enemies patrol and cannot enter them', () => {
  const m = fixtureModel(); m.asteroids = [];
  m.enemies = [{ id: 999, kind: 'scout', x: 3500, y: 3200, health: 35, cooldown: 0, angle: 0 }];
  const before = { ...m.enemies[0] };
  m.update(0.05, idle({ fire: true })); assert.equal(m.bullets.length, 0);
  assert.ok(Math.hypot(m.enemies[0].x - before.x, m.enemies[0].y - before.y) > 0);
  m.enemies[0].x = 3200; m.enemies[0].y = 3200; m.update(0.05, idle());
  assert.ok(Math.hypot(m.enemies[0].x - 3200, m.enemies[0].y - 3200) >= 247.99);
  m.player.x = 4000; m.update(0.05, idle({ fire: true })); assert.ok(m.bullets.some(b => !b.enemy));
});


test('core hull tiers gate item levels while module counts are unrestricted', () => {
  const m=fixtureModel();m.stored={iron:10000,copper:10000,crystal:10000,ice:10000,radioactive:10000};
  assert.equal(m.upgradeModule(1,0),false);assert.ok(m.upgradeError(1,0)?.includes('core / hull'));
  m.upgradeModule(0,0);assert.equal(m.upgradeModule(1,0),true);assert.equal(m.upgradeModule(1,0),false);
  m.upgradeModule(0,0);assert.equal(m.upgradeModule(1,0),true);
  for(let i=2;i<=35;i++)assert.equal(m.installModule('cannon',i,0),true);
  assert.ok(m.modules.length>24);assert.equal(m.moveModule(35,0,34,1),true);
});
test('projectiles collide with ore before enemies and recover less material than mining', () => {
  const m = fixtureModel(); m.player.x=5000;m.player.y=5000;
  const rock={id:9000,x:5100,y:5000,vx:0,vy:0,radius:35,ore:'iron' as const,amount:40,health:40};m.asteroids=[rock];
  m.enemies=[{id:9001,x:5200,y:5000,health:60,cooldown:100,angle:0}];
  m.bullets=[{id:9002,x:5050,y:5000,vx:1400,vy:0,life:1,enemy:false,damage:20}];
  m.update(.05,idle());assert.equal(m.bullets.length,0);assert.equal(m.enemies[0].health,60);
  assert.ok(rock.amount<40);const ore=m.drops.reduce((n,d)=>n+d.amount,0);assert.ok(ore>0&&ore<40-rock.amount);
  assert.equal(ore+rock.amount+(rock.wastedAmount??0),40);
});
test('enemy ships physically push ore and receive impact damage', () => {
  const m=fixtureModel();m.player.x=5600;m.player.y=5000;
  m.asteroids=[{id:9000,x:5040,y:5000,vx:0,vy:0,radius:35,ore:'iron',amount:40,health:40}];
  m.enemies=[{id:9001,kind:'scout',x:5000,y:5000,health:35,cooldown:100,angle:0}];
  m.update(.05,idle());assert.ok(m.enemies[0].health<35);assert.ok(m.asteroids[0].vx>0);
});


test('holding mine auto-targets reachable ore; multiple upgraded beams mine different asteroids', () => {
  const m=fixtureModel();m.stored={iron:1000,copper:1000,crystal:1000,ice:0,radioactive:0};
  m.installModule('miner',-1,0);
  m.update(.05,idle({mine:true,aim:{x:0,y:0}}));
  assert.equal(m.miningLinks.length,2);assert.equal(new Set(m.miningLinks.map(b=>b.targetId)).size,1);
  m.upgradeModule(0,0);m.upgradeModule(0,-1);m.upgradeModule(-1,0);
  m.update(.05,idle({mine:true,aim:{x:0,y:0}}));
  assert.equal(new Set(m.miningLinks.map(b=>b.targetId)).size,2);
  assert.ok(m.asteroids.every(a=>a.health<40));
});
