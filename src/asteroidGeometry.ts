export type Vertex = { x: number; y: number };
export type AsteroidGeometry = {
  seed: number; baseRadius: number; angles: number[]; originalRadii: number[];
  radii: number[]; vertices: Vertex[]; originalArea: number; revision: number;
};
export function polygonArea(vertices: Vertex[]) {
  return Math.abs(vertices.reduce((sum, p, i) => { const q = vertices[(i + 1) % vertices.length]; return sum + p.x * q.y - q.x * p.y; }, 0)) / 2;
}
function verticesFrom(angles: number[], radii: number[]) {
  return angles.map((angle, i) => ({ x: Math.cos(angle) * radii[i], y: Math.sin(angle) * radii[i] }));
}
export function createAsteroidGeometry(seed: number, radius: number): AsteroidGeometry {
  let state = (seed >>> 0) ^ 0x9e3779b9;
  const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
  const count = 10 + Math.floor(random() * 7);
  const angles = Array.from({ length: count }, (_, i) => (i + (random() - 0.5) * 0.3) / count * Math.PI * 2);
  const radii = angles.map(() => radius * (0.77 + random() * 0.23));
  const vertices = verticesFrom(angles, radii);
  return { seed, baseRadius: radius, angles, originalRadii: [...radii], radii, vertices, originalArea: polygonArea(vertices), revision: 0 };
}
export function deformAsteroid(shape: AsteroidGeometry, impact: Vertex, removedFraction: number, remainingFraction: number) {
  const direction = Math.atan2(impact.y, impact.x), remaining = Math.max(0.001, remainingFraction);
  for (let i = 0; i < shape.radii.length; i++) {
    const difference = Math.atan2(Math.sin(shape.angles[i] - direction), Math.cos(shape.angles[i] - direction));
    const weight = Math.exp(-(difference * difference) / (2 * 0.48 * 0.48));
    const minimum = shape.originalRadii[i] * 0.12 * Math.sqrt(remaining);
    shape.radii[i] = Math.max(minimum, shape.radii[i] - shape.baseRadius * removedFraction * 1.3 * weight);
  }
  const area = polygonArea(verticesFrom(shape.angles, shape.radii));
  const scale = Math.min(1, Math.sqrt(shape.originalArea * remaining / Math.max(0.001, area)));
  shape.radii = shape.radii.map(r => r * scale);
  // Fixed ordered angles and positive radii make a simple star-shaped polygon:
  // dents can become concave, but edges cannot cross or invert.
  shape.vertices = verticesFrom(shape.angles, shape.radii); shape.revision++;
}
export function geometryRadius(shape: AsteroidGeometry) { return Math.max(...shape.radii); }
export function containsPoint(point: Vertex, vertices: Vertex[]) {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const a = vertices[i], b = vertices[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
export function closestBoundary(point: Vertex, vertices: Vertex[]) {
  let best = vertices[0], distanceSquared = Infinity;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length], dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    const candidate = { x: a.x + dx * t, y: a.y + dy * t }, d = (point.x - candidate.x) ** 2 + (point.y - candidate.y) ** 2;
    if (d < distanceSquared) { best = candidate; distanceSquared = d; }
  }
  return { point: best, distance: Math.sqrt(distanceSquared) };
}
export function laserImpact(shape: AsteroidGeometry, origin: Vertex, aim: Vertex): Vertex {
  const intersect = (target: Vertex) => {
    const dx = target.x - origin.x, dy = target.y - origin.y;
    let nearest = Infinity;
    for (let i = 0; i < shape.vertices.length; i++) {
      const a = shape.vertices[i], b = shape.vertices[(i + 1) % shape.vertices.length];
      const ex = b.x - a.x, ey = b.y - a.y, cross = dx * ey - dy * ex;
      if (Math.abs(cross) < 1e-9) continue;
      const ax = a.x - origin.x, ay = a.y - origin.y;
      const t = (ax * ey - ay * ex) / cross, u = (ax * dy - ay * dx) / cross;
      if (t >= 0 && u >= 0 && u <= 1) nearest = Math.min(nearest, t);
    }
    return Number.isFinite(nearest) ? { x: origin.x + dx * nearest, y: origin.y + dy * nearest } : undefined;
  };
  return intersect(aim) ?? intersect({ x: 0, y: 0 }) ?? closestBoundary(origin, shape.vertices).point;
}
export function segmentPolygonHit(shape: AsteroidGeometry, start: Vertex, end: Vertex) {
  if (containsPoint(start, shape.vertices)) return { ...start, t: 0 };
  const dx = end.x - start.x, dy = end.y - start.y;
  let nearest = Infinity;
  for (let i = 0; i < shape.vertices.length; i++) {
    const a = shape.vertices[i], b = shape.vertices[(i + 1) % shape.vertices.length], ex = b.x - a.x, ey = b.y - a.y;
    const cross = dx * ey - dy * ex; if (Math.abs(cross) < 1e-9) continue;
    const ax = a.x - start.x, ay = a.y - start.y, t = (ax * ey - ay * ex) / cross, u = (ax * dy - ay * dx) / cross;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) nearest = Math.min(nearest, t);
  }
  return Number.isFinite(nearest) ? { x: start.x + dx * nearest, y: start.y + dy * nearest, t: nearest } : undefined;
}
export function segmentCircleHit(start: Vertex, end: Vertex, center: Vertex, radius: number): number | undefined {
  const dx = end.x - start.x, dy = end.y - start.y, ox = start.x - center.x, oy = start.y - center.y;
  const c = ox * ox + oy * oy - radius * radius;
  if (c <= 0) return 0;
  const a = dx * dx + dy * dy; if (a < 1e-9) return;
  const b = 2 * (ox * dx + oy * dy), discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return;
  const t = (-b - Math.sqrt(discriminant)) / (2 * a);
  return t >= 0 && t <= 1 ? t : undefined;
}
