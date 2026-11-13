import { asteroidLocal } from './mining.ts';
import { closestBoundary, containsPoint, type AsteroidGeometry } from './asteroidGeometry.ts';
export type Body = { x: number; y: number; vx: number; vy: number; radius: number; mass: number;rotation?:number };

// Circle contact: separate overlap and exchange normal momentum.
// Returns closing speed; existing overlap at rest never causes impact damage.
export function collide(a: Body, b: Body, restitution: number): number | undefined {
  const dx = b.x - a.x, dy = b.y - a.y;
  const distance = Math.hypot(dx, dy), reach = a.radius + b.radius;
  if (distance >= reach) return;
  const nx = distance > 0 ? dx / distance : 1, ny = distance > 0 ? dy / distance : 0;
  const inverseA = 1 / a.mass, inverseB = 1 / b.mass, inverseTotal = inverseA + inverseB;
  const overlap = reach - distance + 0.01;
  a.x -= nx * overlap * inverseA / inverseTotal; a.y -= ny * overlap * inverseA / inverseTotal;
  b.x += nx * overlap * inverseB / inverseTotal; b.y += ny * overlap * inverseB / inverseTotal;
  const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
  if (closing > 0) {
    const impulse = (1 + restitution) * closing / inverseTotal;
    a.vx -= impulse * nx * inverseA; a.vy -= impulse * ny * inverseA;
    b.vx += impulse * nx * inverseB; b.vy += impulse * ny * inverseB;
  }
  return Math.max(0, closing);
}

export function collideAsteroid(player: Body, rock: Body, geometry: AsteroidGeometry, restitution: number): number | undefined {
  if (Math.hypot(player.x - rock.x, player.y - rock.y) >= player.radius + rock.radius) return;
  const local = asteroidLocal(rock,player);
  const nearest = closestBoundary(local, geometry.vertices), inside = containsPoint(local, geometry.vertices);
  if (!inside && nearest.distance >= player.radius) return;
  let nx = inside ? local.x - nearest.point.x : nearest.point.x - local.x;
  let ny = inside ? local.y - nearest.point.y : nearest.point.y - local.y;
  const length = Math.hypot(nx, ny);
  if (length > 1e-8) { nx /= length; ny /= length; } else { nx = 1; ny = 0; }
  const angle=rock.rotation??0,c=Math.cos(angle),s=Math.sin(angle),worldX=nx*c-ny*s;ny=nx*s+ny*c;nx=worldX;
  const overlap = player.radius + (inside ? nearest.distance : -nearest.distance) + 0.01;
  const inverseP = 1 / player.mass, inverseR = 1 / rock.mass, total = inverseP + inverseR;
  player.x -= nx * overlap * inverseP / total; player.y -= ny * overlap * inverseP / total;
  rock.x += nx * overlap * inverseR / total; rock.y += ny * overlap * inverseR / total;
  const closing = (player.vx - rock.vx) * nx + (player.vy - rock.vy) * ny;
  if (closing > 0) {
    const impulse = (1 + restitution) * closing / total;
    player.vx -= nx * impulse * inverseP; player.vy -= ny * impulse * inverseP;
    rock.vx += nx * impulse * inverseR; rock.vy += ny * impulse * inverseR;
  }
  return Math.max(0, closing);
}
