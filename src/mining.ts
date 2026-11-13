import type { RockMotion } from './beltMotion.ts';
import { createAsteroidGeometry, deformAsteroid, geometryRadius, laserImpact, type AsteroidGeometry, type Vertex } from './asteroidGeometry.ts';
import type { Resource } from './data.ts';
export type Asteroid = { id: number; x: number; y: number; vx: number; vy: number; radius: number; ore: Resource; amount: number; health: number; motion?:RockMotion;motionChecked?:boolean;rotation?:number;driftX?:number;driftY?:number;originX?: number; originY?: number; shapeSeed?: number; shotYieldRemainder?: number; wastedAmount?: number; originalAmount?: number; geometry?: AsteroidGeometry };
export function ensureAsteroidGeometry(asteroid: Asteroid) {
  asteroid.originalAmount ??= Math.max(asteroid.amount, Math.ceil(asteroid.health));
  if (!asteroid.geometry) {
    asteroid.geometry = createAsteroidGeometry(asteroid.shapeSeed ?? asteroid.id, asteroid.radius);
    const remaining = asteroid.originalAmount ? asteroid.amount / asteroid.originalAmount : 0;
    if (remaining < 1) deformAsteroid(asteroid.geometry, { x: 1, y: 0 }, 0, remaining);
    asteroid.radius = geometryRadius(asteroid.geometry);
  }
  return asteroid.geometry;
}
export function asteroidLocal(a:Pick<Asteroid,'x'|'y'|'rotation'>,point:Vertex){const angle=a.rotation??0,c=Math.cos(angle),s=Math.sin(angle),x=point.x-a.x,y=point.y-a.y;return {x:x*c+y*s,y:-x*s+y*c};}
export function asteroidWorld(a:Pick<Asteroid,'x'|'y'|'rotation'>,point:Vertex){const angle=a.rotation??0,c=Math.cos(angle),s=Math.sin(angle);return {x:a.x+point.x*c-point.y*s,y:a.y+point.x*s+point.y*c};}
export function miningImpact(asteroid: Asteroid, origin: Vertex, aim: Vertex) {
  const shape = ensureAsteroidGeometry(asteroid);
  const local = laserImpact(shape, asteroidLocal(asteroid,origin),asteroidLocal(asteroid,aim));
  return asteroidWorld(asteroid,local);
}
export function mineMaterial(asteroid: Asteroid, damage: number, impact: Vertex) {
  const shape = ensureAsteroidGeometry(asteroid);
  asteroid.health = Math.max(0, asteroid.health - Math.max(0, damage));
  const removed = Math.max(0, Math.min(asteroid.amount, asteroid.amount - Math.ceil(asteroid.health - 1e-9)));
  if (removed > 0) {
    asteroid.amount -= removed;
    deformAsteroid(shape, asteroidLocal(asteroid,impact), removed / Math.max(1, asteroid.originalAmount!), asteroid.amount / Math.max(1, asteroid.originalAmount!));
    asteroid.radius = geometryRadius(shape);
  }
  return removed;
}
