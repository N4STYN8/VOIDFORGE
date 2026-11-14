import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearLineOfSight, nextEnemyState, type EnemySituation } from '../src/enemyAI.ts';
import { createAsteroidGeometry, deformAsteroid } from '../src/asteroidGeometry.ts';
import { GameModel } from '../src/model.ts';
import { ENEMIES, ENEMY_SPAWN, BOSS, DANGER, HORDE } from '../src/data.ts';
import { POPULATION } from '../src/populationConfig.ts';
import { createWorld, bossSites } from '../src/world.ts';
import { SOUND_PROFILES } from '../src/audio.ts';
import { EffectPool } from '../src/effects.ts';
import { fixtureModel } from './fixtures.ts';
const input = { x: 0, y: 0, aim: { x: 5000, y: 5000 }, fire: false, mine: false, dock: false };
test('asteroids block sight and shots, while distant players do not trigger attacks', () => {
  const m = new GameModel('enemy-los-regression'); m.player.x = 5000; m.player.y = 5000;
  const rock = { id: 9000, x: 5150, y: 5000, radius: 40, vx: 0, vy: 0, amount: 40, health: 40, ore: 'iron' as const };
  m.asteroids = [rock]; m.enemies = [{ id: 9001, kind: 'scout', x: 5300, y: 5000, health: 35, cooldown: 0, angle: 0 }];
  assert.equal(clearLineOfSight(m.enemies[0], m.player, m.asteroids), false);
  m.update(0.01, input); assert.equal(m.bullets.length, 0);
  m.asteroids = []; m.update(0.01, input); assert.ok(m.bullets.some(b => b.enemy));
  m.bullets = []; m.enemies[0].x = 9000; m.enemies[0].cooldown = 0;
  m.update(0.01, input); assert.equal(m.bullets.length, 0);
});
test('patrol squads move in a three-ship formation without firing at a docked player', () => {
  const m = new GameModel('patrol-formation-regression'); m.asteroids = [];
  const squad = m.squads[0]; m.enemies = m.enemies.filter(e => e.squad === squad.id);
  assert.equal(m.enemies.length, 3);
  const before = { ...squad };
  for (let i = 0; i < 20; i++) m.update(0.05, input);
  assert.ok(Math.hypot(squad.x - before.x, squad.y - before.y) > 40);
  assert.equal(m.bullets.length, 0);
  for (const e of m.enemies) assert.ok(Math.hypot(e.x - squad.x, e.y - squad.y) < 130);
});
test('deformed polygons have no intersections between nonadjacent edges', () => {
  const cross = (a: {x:number;y:number}, b: {x:number;y:number}, c: {x:number;y:number}) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  for (let seed = 0; seed < 30; seed++) {
    const shape = createAsteroidGeometry(seed, 44);
    for (let damage = 1; damage < 100; damage++) {
      const angle = damage * 0.7; deformAsteroid(shape, {x:Math.cos(angle)*44,y:Math.sin(angle)*44},0.01,1-damage/100);
      const v = shape.vertices;
      for(let i=0;i<v.length;i++)for(let j=i+2;j<v.length;j++) {
        if(i===0&&j===v.length-1)continue;
        const a=v[i],b=v[(i+1)%v.length],c=v[j],d=v[(j+1)%v.length];
        assert.equal(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0,false);
      }
    }
  }
});

const arena = () => { const m = fixtureModel(); m.asteroids = []; m.enemies = []; m.squads = []; m.player.x = 5000; m.player.y = 5000; m.player.vx = 0; m.player.vy = 0; return m; };
test('every enemy class has its own stats, loadout, behaviour and loot', () => {
  const kinds = (Object.keys(ENEMIES) as (keyof typeof ENEMIES)[]).filter(kind => !ENEMIES[kind].part);
  const signatures = new Set(kinds.map(kind => JSON.stringify([ENEMIES[kind].behavior, ENEMIES[kind].weapons.map(w => [w.type, w.count, w.homing, w.charge]), ENEMIES[kind].drones])));
  assert.equal(signatures.size, kinds.length);
  assert.equal(new Set(kinds.map(kind => ENEMIES[kind].label)).size, kinds.length);
  for (const kind of kinds) { const def = ENEMIES[kind]; assert.ok(def.health > 0 && def.speed > 0 && def.accel > 0 && def.stop < def.range && def.range <= def.detection); }
  for (const pool of [...ENEMY_SPAWN.normal, ...ENEMY_SPAWN.elite]) assert.ok(pool.every(kind => ENEMIES[kind].threat > 0 && !ENEMIES[kind].boss && !ENEMIES[kind].part));
});
test('the starting area only spawns low-threat pirates', () => {
  for (const seed of ['alpha', 'beta', 'gamma']) for (const e of new GameModel(seed).enemies) assert.equal(ENEMIES[e.kind ?? 'raider'].threat, 1);
});
test('enemy shields absorb damage first and recharge after a delay', () => {
  const m = arena(); m.enemies = [{ id: 1, kind: 'defender', x: 5000, y: 3000, health: 110, shield: 140, cooldown: 100, angle: 0 }];
  m.bullets = [{ id: 2, x: 4960, y: 3000, vx: 700, vy: 0, life: 1, enemy: false, damage: 20 }];
  m.update(0.05, input);
  assert.equal(m.enemies[0].shield, 120); assert.equal(m.enemies[0].health, 110);
  for (let i = 0; i < 60; i++) m.update(0.05, input);
  assert.equal(m.enemies[0].shield, 120);
  for (let i = 0; i < 40; i++) m.update(0.05, input);
  assert.equal(m.enemies[0].shield, 140);
});
test('missile frigates launch a guided salvo and back away while reloading', () => {
  const m = arena(); m.enemies = [{ id: 1, kind: 'frigate', x: 5450, y: 5000, health: 120, cooldown: 0, angle: 0 }];
  m.update(0.01, input);
  const salvo = m.bullets.filter(b => b.enemy && b.rocket && b.homing);
  assert.equal(salvo.length, 4);
  const outer = salvo[0], before = Math.abs(Math.atan2(outer.vy, outer.vx) - Math.atan2(m.player.y - outer.y, m.player.x - outer.x));
  for (let i = 0; i < 6; i++) m.update(0.05, input);
  const after = Math.abs(Math.atan2(Math.sin(Math.atan2(outer.vy, outer.vx) - Math.atan2(m.player.y - outer.y, m.player.x - outer.x)), 1));
  assert.ok(after < Math.abs(Math.atan2(Math.sin(before), 1)));
  assert.ok(m.enemies[0].x > 5450);
});
test('drone carriers keep their distance and never exceed their drone limit', () => {
  const m = arena(); m.enemies = [{ id: 1, kind: 'carrier', x: 5000, y: 4450, health: 240, cooldown: 0, angle: 0 }];
  let most = 0;
  for (let i = 0; i < 280; i++) { m.update(0.05, input); most = Math.max(most, m.enemies.filter(e => e.parent === 1).length); }
  assert.equal(most, ENEMIES.carrier.drones!.max);
  assert.ok(m.bullets.every(b => b.weapon !== 'rocket'));
});
test('shielded defenders stop chasing once the player leaves their territory', () => {
  const m = arena(); m.enemies = [{ id: 1, kind: 'defender', x: 5600, y: 5000, health: 110, cooldown: 100, angle: 0, home: { x: 7000, y: 5000 } }];
  for (let i = 0; i < 40; i++) m.update(0.05, input);
  assert.ok(m.enemies[0].x > 5600);
  m.enemies[0].home = { x: 5600, y: 5000 }; const x = m.enemies[0].x;
  for (let i = 0; i < 40; i++) m.update(0.05, input);
  assert.ok(m.enemies[0].x < x);
});
test('destroyed enemies drop their class loot table exactly once', () => {
  const m = arena(); m.drops = []; m.enemies = [{ id: 1, kind: 'tank', x: 5000, y: 3000, health: 1, cooldown: 100, angle: 0 }];
  m.bullets = [{ id: 2, x: 4950, y: 3000, vx: 700, vy: 0, life: 1, enemy: false, damage: 20 }];
  m.update(0.05, input); m.update(0.05, input);
  assert.equal(m.enemies.length, 0);
  assert.deepEqual(Object.fromEntries(m.drops.map(d => [d.ore, d.amount])), ENEMIES.tank.loot);
});

test('state selection covers every state in priority order', () => {
  const calm: EnemySituation = { visible: false, remembers: false, inRange: false, leashed: false, awayFromPost: false, guard: false, strafes: false, reloading: false, retreating: false, repositioning: false };
  const pick = (change: Partial<EnemySituation>) => nextEnemyState({ ...calm, ...change });
  assert.equal(pick({}), 'patrol');
  assert.equal(pick({ awayFromPost: true }), 'return');
  assert.equal(pick({ remembers: true }), 'investigate');
  assert.equal(pick({ visible: true }), 'chase');
  assert.equal(pick({ visible: true, inRange: true }), 'attack');
  assert.equal(pick({ visible: true, inRange: true, strafes: true }), 'strafe');
  assert.equal(pick({ visible: true, inRange: true, guard: true }), 'defend');
  assert.equal(pick({ visible: true, inRange: true, reloading: true }), 'reposition');
  assert.equal(pick({ visible: true, repositioning: true }), 'reposition');
  assert.equal(pick({ repositioning: true }), 'patrol');
  assert.equal(pick({ visible: true, inRange: true, retreating: true, repositioning: true }), 'retreat');
  assert.equal(pick({ visible: true, inRange: true, leashed: true, awayFromPost: true, retreating: true }), 'return');
});
test('enemies investigate the last place they saw the player, then give up', () => {
  const m = arena(); m.enemies = [{ id: 1, kind: 'raider', x: 5600, y: 5000, health: 60, cooldown: 100, angle: 0 }];
  m.update(0.05, input); assert.equal(m.enemies[0].state, 'chase');
  const rock = { id: 9000, x: 5300, y: 5000, radius: 44, vx: 0, vy: 0, amount: 40, health: 40, ore: 'iron' as const };
  m.asteroids = [rock]; m.player.y = 5000; m.update(0.05, input);
  assert.equal(m.enemies[0].state, 'investigate'); assert.deepEqual(m.enemies[0].lastSeen, { x: 5000, y: 5000 });
  m.player.x = 3000; m.player.y = 3000; const start = Math.hypot(m.enemies[0].x - 5000, m.enemies[0].y - 5000);
  for (let i = 0; i < 30; i++) m.update(0.05, input);
  assert.ok(Math.hypot(m.enemies[0].x - 5000, m.enemies[0].y - 5000) < start - 60); assert.equal(m.bullets.length, 0);
  for (let i = 0; i < 140; i++) m.update(0.05, input);
  assert.equal(m.enemies[0].lastSeen, undefined); assert.equal(m.enemies[0].state, 'patrol');
});
test('a hit from out of sight alerts the enemy to the attacker', () => {
  const m = arena(); m.enemies = [{ id: 1, kind: 'raider', x: 5000, y: 3600, health: 60, cooldown: 100, angle: 0 }];
  m.update(0.05, input); assert.equal(m.enemies[0].state, 'patrol');
  m.bullets = [{ id: 2, x: 5000, y: 3660, vx: 0, vy: -700, life: 1, enemy: false, damage: 5 }];
  for (let i = 0; i < 4; i++) m.update(0.05, input);
  assert.equal(m.enemies[0].health, 55); assert.equal(m.enemies[0].state, 'chase'); const y = m.enemies[0].y;
  for (let i = 0; i < 20; i++) m.update(0.05, input);
  assert.ok(m.enemies[0].y > y + 30);
});
test('fragile classes break off once when badly damaged, heavy ones never do', () => {
  const m = arena(); m.enemies = [{ id: 1, kind: 'scout', x: 5250, y: 5000, health: 10, cooldown: 100, angle: 0 }, { id: 2, kind: 'tank', x: 5000, y: 5350, health: 10, cooldown: 100, cooldown2: 100, angle: 0 }];
  m.update(0.05, input);
  assert.equal(m.enemies[0].state, 'retreat'); assert.notEqual(m.enemies[1].state, 'retreat');
  for (let i = 0; i < 40; i++) m.update(0.05, input);
  assert.ok(Math.hypot(m.enemies[0].x - 5000, m.enemies[0].y - 5000) > 400); assert.equal(m.bullets.length, 0);
  for (let i = 0; i < 80; i++) m.update(0.05, input);
  assert.notEqual(m.enemies[0].state, 'retreat'); assert.equal(m.enemies[0].retreated, true);
});
test('an enemy blocked by an asteroid sidesteps instead of grinding against it', () => {
  const m = arena(); m.enemies = [{ id: 1, kind: 'raider', x: 5700, y: 5000, health: 60, cooldown: 100, angle: 0 }];
  m.asteroids = [{ id: 9000, x: 5400, y: 5000, radius: 44, vx: 0, vy: 0, amount: 40, health: 40, ore: 'iron' as const }];
  m.enemies[0].lastSeen = { x: 5000, y: 5000 }; m.enemies[0].memory = 60;
  for (let i = 0; i < 200; i++) { m.enemies[0].memory = 60; m.update(0.05, input); if (m.enemies[0].x < 5300) break; }
  assert.ok(m.enemies[0].x < 5300, `still blocked at ${m.enemies[0].x.toFixed(0)},${m.enemies[0].y.toFixed(0)}`);
});

const wake = (kind = 'warden') => {
  const m = arena(), site = m.bossSites.find(site => site.kind === kind)!;
  m.player.x = site.x - 700; m.player.y = site.y; m.update(0.01, input);
  const boss = m.enemies.find(e => e.kind === site.kind)!;
  return { m, site, boss, parts: () => m.enemies.filter(e => e.parent === boss.id && e.mount) };
};
test('boss sites are seeded, repeatable and never beside a base', () => {
  for (const seed of ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta']) {
    const spec = createWorld(seed), sites = bossSites(spec);
    assert.equal(sites.length, BOSS.sites.length); assert.deepEqual(sites, bossSites(createWorld(seed)));
    for (const site of sites) {
      assert.ok(Math.hypot(site.x - spec.bases[0].x, site.y - spec.bases[0].y) > BOSS.minHomeDistance);
      for (const base of spec.bases) assert.ok(Math.hypot(site.x - base.x, site.y - base.y) > site.radius);
    }
  }
  assert.ok(new GameModel('alpha').enemies.every(e => !ENEMIES[e.kind ?? 'raider'].boss));
});
test('a boss wakes with its turrets, shield generators and escorts when the player approaches', () => {
  const { m, site, boss, parts } = wake(), def = ENEMIES.warden;
  assert.ok(boss); assert.equal(parts().length, def.boss!.parts.length);
  assert.equal(m.enemies.filter(e => e.kind === 'defender').length, def.boss!.escorts.length);
  assert.equal(m.dangerAt(site), DANGER.labels.length); assert.match(m.message, /Iron Warden/);
  m.update(0.05, input); assert.equal(m.enemies.filter(e => e.kind === 'warden').length, 1);
  // Parts ride the hull as it moves and turns.
  boss.x += 300; boss.angle = 1; m.update(0.01, input);
  for (const part of parts()) assert.ok(Math.abs(Math.hypot(part.x - boss.x, part.y - boss.y) - Math.hypot(part.mount!.x, part.mount!.y)) < 3);
});
test('boss shields recharge only while a shield generator survives', () => {
  const { m, boss, parts } = wake(); m.player.x -= 3000; m.enemies = m.enemies.filter(e => e === boss || e.parent === boss.id);
  boss.shield = 100; boss.shieldDelay = 0; m.update(0.5, input); assert.ok(boss.shield! > 100);
  for (const part of parts()) if (ENEMIES[part.kind!].shieldSource) part.health = 0;
  m.update(0.01, input); const held = boss.shield!;
  for (let i = 0; i < 20; i++) m.update(0.1, input);
  assert.equal(boss.shield, held); assert.equal(parts().length, ENEMIES.warden.boss!.parts.filter(part=>!ENEMIES[part.kind].shieldSource).length);
});
test('a boss changes weapons and calls reinforcements once below half health', () => {
  const { m, boss } = wake(), def = ENEMIES.warden, before = m.enemies.length;
  boss.health = def.health * def.boss!.phaseAt - 1; boss.shield = 0; m.update(0.01, input);
  assert.equal(boss.phase2, true); assert.equal(m.enemies.length, before + def.boss!.reinforcements.length); assert.match(m.message, /reinforcements/);
  m.update(0.01, input); assert.equal(m.enemies.length, before + def.boss!.reinforcements.length);
  m.bullets = []; boss.cooldown = 0; boss.cooldown2 = 99; m.update(0.01, input);
  assert.equal(m.bullets.filter(b => b.weapon === 'cannon' && b.damage === def.boss!.phaseWeapons[0].damage).length, def.boss!.phaseWeapons[0].count);
});
test('a defeated boss pays out, calms its territory, stays away through a save, then returns for a smaller reward', () => {
  const { m, site, boss } = wake(); m.drops = [];
  const kill = (target: typeof boss) => { target.shield = 0; target.health = 1; m.bullets = [{ id: 5, x: target.x - 200, y: target.y, vx: 2000, vy: 0, life: 1, enemy: false, damage: 50 }]; for (let i = 0; i < 4; i++) m.update(0.05, input); };
  kill(boss);
  assert.deepEqual(m.defeatedBosses, ['warden']); assert.equal(m.enemies.some(e => e.kind === 'warden' || ENEMIES[e.kind ?? 'raider'].part), false);
  for (const [ore, amount] of Object.entries(ENEMIES.warden.loot)) assert.equal(m.drops.filter(d => d.ore === ore).reduce((n, d) => n + d.amount, 0), amount);
  assert.ok(m.dangerAt(site) <= 2); assert.match(m.message, /destroyed/);
  const restored = GameModel.fromSave(JSON.parse(JSON.stringify(m.toSave())));
  assert.deepEqual(restored.defeatedBosses, ['warden']);
  for (let i = 0; i < 10; i++) restored.update(0.05, input);
  assert.equal(restored.enemies.some(e => e.kind === 'warden'), false); assert.equal(restored.bossSites[0].defeated, true);
  // After the ledger cooldown the boss is back, and a repeat kill pays a reduced reward.
  (m as unknown as { world: { time: number } }).world.time += POPULATION.bossInterval[1] + 1;
  assert.deepEqual(m.defeatedBosses, []); assert.equal(m.dangerAt(site), DANGER.labels.length);
  m.enemies = []; m.drops = []; m.update(0.01, input);
  assert.equal(m.enemies.some(e=>e.kind==='warden'),false);
  const original={x:m.player.x,y:m.player.y};m.player.x=site.x+BOSS.wake+500;m.update(.01,input);Object.assign(m.player,original);m.update(.01,input);
  const again = m.enemies.find(e => e.kind === 'warden')!; assert.ok(again); kill(again);
  for (const [ore, amount] of Object.entries(ENEMIES.warden.loot)) assert.equal(m.drops.filter(d => d.ore === ore).reduce((n, d) => n + d.amount, 0), Math.round(amount * HORDE.repeatBossLoot));
  assert.deepEqual(m.defeatedBosses, ['warden']);
});

test('each boss guards its own seeded territory', () => {
  const m = arena(), sites = m.bossSites;
  assert.deepEqual(sites.map(site => site.kind), ['warden', 'leviathan', 'titan','rustLeviathan','tyrant','harvester','storm','dreadforge']);
  for (const a of sites) for (const b of sites) if (a !== b) assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > 1);
  for (const kind of ['leviathan', 'titan'] as const) { const { boss, parts } = wake(kind); assert.ok(boss); assert.equal(parts().length, ENEMIES[kind].boss!.parts.length); }
});
test('the leviathan pauses its attack to surge shields while a crystal node survives, and launches limited drones', () => {
  const { m, boss, parts } = wake('leviathan'), def = ENEMIES.leviathan, surge = def.boss!.surge!;
  m.enemies = m.enemies.filter(e => e === boss || e.parent === boss.id);
  boss.shield = 50; boss.shieldDelay = 99; boss.surgeTimer = 0.01; m.update(0.05, input);
  assert.ok(boss.surge! > 0); m.bullets = []; boss.cooldown = 0; boss.cooldown2 = 0;
  for (let i = 0; i < 20; i++) { boss.shieldDelay = 99; m.update(0.05, input); }
  assert.ok(boss.shield! > 50 + surge.rate * 0.8); assert.equal(m.bullets.filter(b => b.weapon === 'rail').length, 0); assert.equal(boss.charge, undefined);
  for (const part of parts()) if (ENEMIES[part.kind!].shieldSource) part.health = 0;
  m.update(0.05, input); boss.surgeTimer = 0.01; const held = boss.shield!;
  for (let i = 0; i < 10; i++) { boss.shieldDelay = 99; m.update(0.05, input); }
  assert.equal(boss.shield, held); assert.equal(boss.surge, 0);
  let most = 0; boss.cooldown3 = 0;
  for (let i = 0; i < 500; i++) { m.player.health = 100; m.update(0.05, input); most = Math.max(most, m.enemies.filter(e => e.kind === 'drone').length); }
  assert.equal(most, def.drones!.max);
});
test('the titan EMP is telegraphed, hits only inside its ring and drains energy', () => {
  const { m, boss } = wake('titan'), emp = ENEMIES.titan.boss!.emp!;
  m.enemies = [boss]; m.bullets = []; boss.charge = undefined; boss.cooldown = 99; boss.cooldown2 = 99;
  m.player.x = boss.x - emp.radius + 60; m.player.y = boss.y; m.energy = m.maxEnergy; const hull = m.player.health + m.shield;
  boss.empTimer = 0.01; m.update(0.05, input);
  assert.ok(boss.empCharge! > emp.charge - 0.1); assert.equal(m.player.health + m.shield, hull);
  for (let i = 0; i < Math.ceil(emp.charge / 0.05) + 1; i++) { boss.cooldown = 99; boss.cooldown2 = 99; m.update(0.05, input); }
  assert.equal(m.player.health + m.shield, hull - emp.damage); assert.ok(m.energy <= m.maxEnergy - emp.drain + 5);
  m.bullets = []; boss.charge = undefined; m.player.x = boss.x - emp.radius - 200; m.player.health = 100; m.energy = m.maxEnergy; const outside = m.player.health + m.shield;
  boss.empTimer = 0.01; boss.x = m.player.x + emp.radius + 200;
  for (let i = 0; i < Math.ceil(emp.charge / 0.05) + 3; i++) { boss.cooldown = 99; boss.cooldown2 = 99; boss.sx = 0; boss.sy = 0; boss.x = m.player.x + emp.radius + 200; m.update(0.05, input); }
  assert.equal(m.player.health + m.shield, outside);
});
test('titan reactor vents are sealed until phase two, then pass extra damage past the shield; a final phase follows', () => {
  const { m, boss, parts } = wake('titan'), def = ENEMIES.titan, vent = parts().find(e => e.kind === 'titanReactor')!;
  m.enemies = [boss, ...parts()]; m.player.x = boss.x - 2500;
  const shot = () => { m.bullets = [{ id: 7, x: vent.x - 60, y: vent.y, vx: 2000, vy: 0, life: 1, enemy: false, damage: 40 }]; m.update(0.05, input); m.update(0.05, input); };
  const full = boss.health, shield = boss.shield!; shot();
  assert.equal(boss.health, full); assert.equal(boss.shield, shield); assert.equal(vent.health, ENEMIES.titanReactor.health);
  boss.health = def.health * def.boss!.phaseAt - 1; m.player.x = boss.x - 700; m.update(0.01, input); assert.equal(boss.phase2, true);
  m.player.x = boss.x - 2500; m.update(0.01, input);
  const before = boss.health; shot();
  assert.equal(boss.health, before - 40 * ENEMIES.titanReactor.weakPoint!); assert.equal(boss.shield, shield); assert.ok(parts().includes(vent));
  boss.health = def.health * def.boss!.finalAt! - 1; m.player.x = boss.x - 700; m.update(0.01, input);
  assert.equal(boss.phase3, true); assert.match(m.message, /final/);
  m.enemies = m.enemies.filter(e => e === boss || e.parent === boss.id); m.bullets = []; boss.cooldown = 0; boss.cooldown2 = 99; boss.empTimer = 99; for (const part of parts()) { part.cooldown = 99; } m.update(0.01, input);
  assert.equal(m.bullets.filter(b => b.weapon === 'plasma' && b.damage === def.boss!.finalWeapons![0].damage).length, def.boss!.finalWeapons![0].count);
  // Killing the boss through a vent still counts as a proper defeat with its reward.
  m.drops = []; boss.health = 10; m.player.x = boss.x - 2500; m.update(0.01, input); shot();
  assert.deepEqual(m.defeatedBosses, ['titan']); assert.equal(m.drops.filter(d => d.ore === 'radioactive').reduce((n, d) => n + d.amount, 0), def.loot.radioactive);
  assert.equal(m.enemies.length, 0);
});

test('sound profiles are normalized and bounded', () => {
  for (const [cue, s] of Object.entries(SOUND_PROFILES)) {
    assert.ok(s.gain > 0 && s.gain <= 0.15, cue); assert.ok((s.noise ?? 0) <= 0.15, cue);
    assert.ok(s.start > 20 && s.end > 10 && s.duration > 0 && s.duration <= 1.6, cue);
    const total = s.duration + ((s.repeat ?? 1) - 1) * (s.every ?? 0);
    assert.ok(total <= 2.5, cue); assert.ok((s.gap ?? 0.07) >= 0.07, cue);
  }
});
test('combat emits sound-only cues that fade with distance and never spawn particles', () => {
  const cues = (m: GameModel) => m.effects.filter(e => e.type === 'cue').map(e => e.cue);
  const m = arena(); m.enemies = [{ id: 1, kind: 'sniper', x: 5600, y: 5000, health: 70, cooldown: 0, angle: 0 }, { id: 2, kind: 'scout', x: 5000, y: 4750, health: 35, cooldown: 0, angle: 0 }];
  m.update(0.01, input);
  assert.ok(cues(m).includes('railCharge')); assert.ok(cues(m).includes('pulse')); assert.ok(cues(m).includes('alert'));
  const near = m.effects.find(e => e.cue === 'pulse')!, far = m.effects.find(e => e.cue === 'railCharge')!;
  assert.ok(near.volume! > far.volume! && far.volume! > 0); assert.ok(near.pitch! > far.pitch!);
  assert.ok(m.effects.filter(e => e.type === 'muzzle').every(e => e.silent));
  // Cues are skipped by the particle pool and are heard even when the source is off screen.
  const pool = new EffectPool(); pool.consume(m.effects.filter(e => e.type === 'cue'), { x: 0, y: 0, width: 99999, height: 99999 });
  assert.equal(pool.particles.filter(p => p.active).length, 0);
  m.update(0.01, { ...input, view: { x: 4900, y: 4900, width: 200, height: 200 } } as typeof input);
  m.enemies[1].cooldown = 0; m.update(0.01, { ...input, view: { x: 4900, y: 4900, width: 200, height: 200 } } as typeof input);
  assert.ok(cues(m).includes('pulse')); assert.equal(m.effects.filter(e => e.type === 'muzzle').length, 0);
  m.enemies = [{ id: 3, kind: 'scout', x: 5000 + 2400, y: 5000, health: 35, cooldown: 0, angle: 0, lastSeen: { x: 5000, y: 5000 }, memory: 5 }];
  m.update(0.01, input); assert.equal(cues(m).length, 0);
  const boss = wake(); assert.ok(cues(boss.m).includes('bossWarning'));
  boss.boss.health = 10; boss.boss.shield = 0; boss.m.update(0.01, input); assert.ok(cues(boss.m).includes('bossPhase'));
  boss.m.bullets = [{ id: 9, x: boss.boss.x - 200, y: boss.boss.y, vx: 2000, vy: 0, life: 1, enemy: false, damage: 50 }];
  let down = false; for (let i = 0; i < 4; i++) { boss.m.update(0.05, input); down ||= cues(boss.m).includes('bossDown'); }
  assert.ok(down);
});

test('a horde gives a red-alert warning, then arrives together, hunts the player and pays a bonus when cleared', () => {
  const m = arena(), far = { x: m.bases[0].x + DANGER.safeRadius + 3000, y: m.bases[0].y };
  // The clock does not run near the starting base or while docked.
  m.horde.timer = 1; m.player.x = m.bases[0].x; m.player.y = m.bases[0].y + 130; for (let i = 0; i < 30; i++) m.update(0.05, input);
  assert.equal(m.horde.warning, 0); assert.equal(m.hordeCount, 0);
  m.player.x = far.x; m.player.y = far.y; m.horde.timer = 0.04; m.update(0.05, input);
  assert.equal(m.horde.warning, HORDE.warning); assert.match(m.message, /ALERT/); assert.ok(m.effects.some(e => e.cue === 'hordeAlarm')); assert.equal(m.hordeCount, 0);
  let alarms = 0; for (let i = 0; i < HORDE.warning / 0.05 - 4; i++) { m.update(0.05, input); if (m.effects.some(e => e.cue === 'hordeAlarm')) alarms++; }
  assert.ok(alarms >= 4); assert.equal(m.hordeCount, 0);
  for (let i = 0; i < 8; i++) m.update(0.05, input);
  const level = Math.min(HORDE.size.length, m.danger), horde = m.enemies.filter(e => e.horde);
  assert.equal(horde.length, HORDE.size[level - 1]); assert.equal(m.horde.total, horde.length); assert.equal(m.horde.warning, 0); assert.ok(m.horde.timer >= HORDE.interval[level - 1][0]);
  for (const e of horde) {
    const distance = Math.hypot(e.x - m.player.x, e.y - m.player.y), bearing = Math.atan2(e.y - m.player.y, e.x - m.player.x), off = Math.abs(Math.atan2(Math.sin(bearing - m.horde.angle), Math.cos(bearing - m.horde.angle)));
    assert.ok(distance > 900 && distance < 1700); assert.ok(off < HORDE.arc); assert.equal(e.populationExempt, true); assert.ok(!ENEMIES[e.kind!].boss && !ENEMIES[e.kind!].part);
  }
  const start = horde.map(e => Math.hypot(e.x - m.player.x, e.y - m.player.y));
  for (let i = 0; i < 40; i++) { m.player.health = 100; m.update(0.05, input); }
  horde.forEach((e, i) => assert.ok(e.health <= 0 || Math.hypot(e.x - m.player.x, e.y - m.player.y) < start[i] - 60));
  // The alert survives a save and reload.
  const restored = GameModel.fromSave(JSON.parse(JSON.stringify(m.toSave())));
  assert.equal(restored.hordeCount, m.hordeCount); assert.equal(restored.horde.total, m.horde.total);
  m.drops = []; for (const e of m.enemies) if (e.horde) e.health = 0;
  m.enemies = m.enemies.filter(e => !e.horde); m.update(0.05, input);
  assert.equal(m.hordeCount, 0); assert.match(m.message, /Horde destroyed/);
  for (const [ore, amount] of Object.entries(HORDE.reward)) assert.equal(m.drops.filter(d => d.ore === ore).reduce((n, d) => n + d.amount, 0), amount * level);
  // The bonus is paid once (the ship may already be collecting it).
  const paid = m.drops.length; m.update(0.05, input); assert.ok(m.drops.length <= paid);
});
test('docking calls off a horde warning, and an outrun horde gives up without paying out', () => {
  const m = arena(), base = m.bases[0];
  m.player.x = base.x + DANGER.safeRadius + 3000; m.player.y = base.y; m.horde.timer = 0.04; m.update(0.05, input); assert.ok(m.horde.warning > 0);
  m.player.x = base.x; m.player.y = base.y + 130; m.update(0.05, input);
  assert.equal(m.horde.warning, 0); assert.equal(m.horde.timer, HORDE.retry); assert.equal(m.hordeCount, 0);
  m.player.x = base.x + DANGER.safeRadius + 3000; m.horde.timer = 0.04; m.update(0.05, input);
  for (let i = 0; i < HORDE.warning / 0.05 + 4; i++) m.update(0.05, input);
  assert.ok(m.hordeCount > 0); m.drops = []; const kills = m.kills;
  m.player.x += HORDE.despawn + 2500; m.update(0.05, input); m.update(0.05, input);
  assert.equal(m.hordeCount, 0); assert.equal(m.kills, kills); assert.equal(m.drops.length, 0); assert.doesNotMatch(m.message, /Horde destroyed/);
});
