import { ensureAsteroidGeometry, type Asteroid } from './mining.ts';
import { containsPoint, type Vertex } from './asteroidGeometry.ts';
export function clearLineOfSight(start: Vertex, end: Vertex, asteroids: Asteroid[]) {
  const dx = end.x - start.x, dy = end.y - start.y, lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-8) return true;
  for (const asteroid of asteroids) {
    const t = Math.max(0, Math.min(1, ((asteroid.x - start.x) * dx + (asteroid.y - start.y) * dy) / lengthSquared));
    if ((start.x + dx * t - asteroid.x) ** 2 + (start.y + dy * t - asteroid.y) ** 2 > asteroid.radius ** 2) continue;
    const vertices = ensureAsteroidGeometry(asteroid).vertices;
    const local = { x: start.x - asteroid.x, y: start.y - asteroid.y };
    if (containsPoint(local, vertices)) return false;
    for (let i = 0; i < vertices.length; i++) {
      const a = vertices[i], b = vertices[(i + 1) % vertices.length], ex = b.x - a.x, ey = b.y - a.y;
      const cross = dx * ey - dy * ex;
      if (Math.abs(cross) < 1e-9) continue;
      const ax = a.x - local.x, ay = a.y - local.y;
      const hit = (ax * ey - ay * ex) / cross, u = (ax * dy - ay * dx) / cross;
      if (hit > 0 && hit < 1 && u >= 0 && u <= 1) return false;
    }
  }
  return true;
}
