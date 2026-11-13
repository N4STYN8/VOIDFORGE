import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAsteroidGeometry, deformAsteroid, geometryRadius, polygonArea, containsPoint, laserImpact } from '../src/asteroidGeometry.ts';
import { ensureAsteroidGeometry, mineMaterial, type Asteroid } from '../src/mining.ts';
import { collideAsteroid, type Body } from '../src/collisions.ts';
import { EffectPool } from '../src/effects.ts';
import { GameModel } from '../src/model.ts';
import { RESOURCES, type Resource } from '../src/data.ts';
const asteroid = (ore: Resource = 'iron'): Asteroid => ({ id: 27, x: 1000, y: 1000, vx: 0, vy: 0, radius: 44, ore, amount: 100, health: 100 });
test('seeded polygons are unique, reproducible, valid and have 10–16 vertices', () => {
  for (let seed = 0; seed < 80; seed++) {
    const a = createAsteroidGeometry(seed, 44), same = createAsteroidGeometry(seed, 44), other = createAsteroidGeometry(seed + 1, 44);
    assert.deepEqual(a.vertices, same.vertices); assert.notDeepEqual(a.vertices, other.vertices);
    assert.ok(a.vertices.length >= 10 && a.vertices.length <= 16); assert.ok(polygonArea(a.vertices) > 0);
  }
});
test('mining removes more from the impact side, decreases area continuously, and never invalidates edges', () => {
  const a = asteroid(); const shape = ensureAsteroidGeometry(a);
  const original = [...shape.radii]; let previousArea = polygonArea(shape.vertices), released = 0;
  for (let i = 0; i < 99; i++) {
    released += mineMaterial(a, 1, { x: a.x - a.radius, y: a.y });
    const area = polygonArea(shape.vertices);
    assert.ok(area < previousArea); previousArea = area;
    assert.ok(shape.radii.every(r => Number.isFinite(r) && r > 0));
    assert.ok(containsPoint({ x: 0, y: 0 }, shape.vertices));
    // Ordered polar angles with positive radii guarantee noncrossing radial sectors.
    for (let j = 1; j < shape.angles.length; j++) assert.ok(shape.angles[j] > shape.angles[j - 1]);
    if (i === 24) {
      const left = shape.angles.findIndex(angle => Math.cos(angle) < -0.95), right = shape.angles.findIndex(angle => Math.cos(angle) > 0.95);
      assert.ok(left >= 0 && right >= 0);
      assert.ok(shape.radii[left] / original[left] < shape.radii[right] / original[right]);
      assert.ok(area < shape.originalArea * 0.8);
    }
  }
  assert.equal(released, 99); assert.equal(a.amount, 1); assert.ok(a.radius < 12);
});
test('laser impact is on the near edge rather than the center or far side', () => {
  const shape = createAsteroidGeometry(8, 44);
  const point = laserImpact(shape, { x: -200, y: 0 }, { x: 0, y: 0 });
  assert.ok(point.x < -25); assert.ok(Math.abs(point.y) < 0.001);
});
test('a carved side has matching narrow-phase collision boundaries', () => {
  const shape = createAsteroidGeometry(3, 44);
  const originalLeft = Math.abs(laserImpact(shape, { x: -200, y: 0 }, { x: 0, y: 0 }).x);
  deformAsteroid(shape, { x: -44, y: 0 }, 0.55, 0.45);
  const left = Math.abs(laserImpact(shape, { x: -200, y: 0 }, { x: 0, y: 0 }).x);
  assert.ok(left < originalLeft);
  const player: Body = { x: -(left + 4), y: 0, vx: 0, vy: 0, radius: 1, mass: 1 };
  const rock: Body = { x: 0, y: 0, vx: 0, vy: 0, radius: geometryRadius(shape), mass: 3 };
  assert.equal(collideAsteroid(player, rock, shape, 0.3), undefined);
  player.x = -(left + 0.2); assert.notEqual(collideAsteroid(player, rock, shape, 0.3), undefined);
});
test('all five resources conserve ore through partial mining, overkill and repeated destruction', () => {
  for (const ore of Object.keys(RESOURCES) as Resource[]) {
    const a = asteroid(ore), shape = ensureAsteroidGeometry(a), revision = shape.revision;
    assert.equal(mineMaterial(a, 0.2, { x: 956, y: 1000 }), 0); assert.equal(shape.revision, revision);
    const released = mineMaterial(a, 24.8, { x: 956, y: 1000 }); assert.equal(released, 25);
    const m = new GameModel(); m.asteroids = [a]; m.drops = [];
    assert.equal(m.destroyAsteroid(a.id), true); assert.equal(m.destroyAsteroid(a.id), false);
    assert.equal(released + m.drops.reduce((sum, d) => sum + d.amount, 0), 100);
    const b = asteroid(ore); assert.equal(mineMaterial(b, 1000, { x: 956, y: 1000 }), 100); assert.equal(mineMaterial(b, 1000, { x: 956, y: 1000 }), 0);
  }
});
test('legacy asteroid state hydrates without changing remaining ore and fragment counts stay bounded', () => {
  const a = asteroid(); a.amount = 31; a.health = 30.5;
  const shape = ensureAsteroidGeometry(a); assert.equal(a.amount, 31); assert.equal(a.health, 30.5);
  assert.equal(ensureAsteroidGeometry(a), shape);
  const fragments=new EffectPool(80),view={x:-100,y:-100,width:200,height:200};
  for(let i=0;i<100;i++)fragments.consume([{type:'debris',x:0,y:0,angle:Math.PI,color:0xffffff,count:2+i%3}],view);
  assert.ok(fragments.activeCount<=80);fragments.update(2,view);assert.equal(fragments.activeCount,0);
});
