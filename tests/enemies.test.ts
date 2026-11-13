import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearLineOfSight } from '../src/enemyAI.ts';
import { createAsteroidGeometry, deformAsteroid } from '../src/asteroidGeometry.ts';
import { GameModel } from '../src/model.ts';
const input = { x: 0, y: 0, aim: { x: 5000, y: 5000 }, fire: false, mine: false, dock: false };
test('asteroids block sight and shots, while distant players do not trigger attacks', () => {
  const m = new GameModel(); m.player.x = 5000; m.player.y = 5000;
  const rock = { id: 9000, x: 5150, y: 5000, radius: 40, vx: 0, vy: 0, amount: 40, health: 40, ore: 'iron' as const };
  m.asteroids = [rock]; m.enemies = [{ id: 9001, kind: 'scout', x: 5300, y: 5000, health: 35, cooldown: 0, angle: 0 }];
  assert.equal(clearLineOfSight(m.enemies[0], m.player, m.asteroids), false);
  m.update(0.01, input); assert.equal(m.bullets.length, 0);
  m.asteroids = []; m.update(0.01, input); assert.ok(m.bullets.some(b => b.enemy));
  m.bullets = []; m.enemies[0].x = 9000; m.enemies[0].cooldown = 0;
  m.update(0.01, input); assert.equal(m.bullets.length, 0);
});
test('patrol squads move in a three-ship formation without firing at a docked player', () => {
  const m = new GameModel(); m.asteroids = [];
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
