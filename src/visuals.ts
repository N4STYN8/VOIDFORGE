import Phaser from 'phaser';
import type { Asteroid } from './model.ts';
import { ensureAsteroidGeometry } from './mining.ts';
import { containsPoint, type Vertex } from './asteroidGeometry.ts';
import { RESOURCES, WORLD, type ModuleKind } from './data.ts';

// Primitive-only presentation helpers. All dimensions here are visual, not physics.
export function drawModule(g: Phaser.GameObjects.Graphics, x: number, y: number, angle: number, kind: ModuleKind | 'core', color: number, level = 1) {
  g.save(); g.translateCanvas(x, y); g.rotateCanvas(angle);
  if (level > 1) { g.lineStyle(1, level === 3 ? 0xf4d18a : 0x91d4f2, 0.7); g.strokeRect(-8, -8, 16, 16); }
  g.fillStyle(0x030810, 0.8); g.fillRect(-6, -5, 16, 16);
  g.fillStyle(0x243646); g.fillRect(-7, -7, 14, 14);
  g.lineStyle(1, color, 0.85); g.strokeRect(-7, -7, 14, 14);
  g.fillStyle(color, 0.2); g.fillRect(-5, -5, 10, 3);
  if (kind === 'core') {
    g.fillStyle(0x70d5fa); g.fillTriangle(6, 0, -4, -5, -4, 5);
    g.fillStyle(0x4f829b); g.fillRect(-10, -5, 3, 3); g.fillRect(-10, 2, 3, 3);
    g.fillStyle(0x8ce6ff); g.fillRect(-12, -4, 2, 2); g.fillRect(-12, 2, 2, 2);
    g.fillStyle(0xd7f6ff); g.fillRect(-2, -2, 3, 4);
  } else if (kind === 'cannon') {
    g.fillStyle(0x596978); g.fillCircle(0, 0, 5);
    g.fillStyle(0xe6c271); g.fillRect(0, -2, 10 + level, 4);
    g.fillStyle(0xf8e6b8); g.fillRect(9, -2, 2, 4);
  } else if (kind === 'pulse' || kind === 'plasma' || kind === 'rail' || kind === 'flak' || kind === 'emp') {
    g.fillStyle(color,.4);g.fillRect(-5,-5,10,10);
    if(kind==='rail'){g.fillStyle(0xc4dbe6);g.fillRect(-3,-4,14,2);g.fillRect(-3,2,14,2);g.fillStyle(color);g.fillRect(0,-1,12,2);}
    else if(kind==='flak'){g.fillStyle(color);for(const y of [-4,0,4])g.fillRect(-2,y-1,11,2);}
    else if(kind==='emp'){g.lineStyle(1,color);g.strokeCircle(0,0,5);g.lineBetween(-5,-4,5,4);g.lineBetween(-5,4,5,-4);}
    else{g.lineStyle(2,color);g.strokeCircle(0,0,4);g.fillStyle(0xefffff);g.fillRect(0,-1.5,9,3);}
  } else if(kind==='reactor'){
    g.lineStyle(1,color);g.strokeRect(-5,-5,10,10);g.fillStyle(color);g.fillTriangle(0,-5,-4,3,4,3);g.fillStyle(0x283343);g.fillRect(-1,-1,2,3);
  } else if(kind==='cooler'){
    for(let i=-4;i<=4;i+=3){g.fillStyle(color,.8);g.fillRect(i,-5,1,10);}g.fillStyle(0xd8f9ff);g.fillRect(-5,-1,10,2);
  } else if (kind === 'miner') {
    g.lineStyle(2, color); g.strokeCircle(0, 0, 4);
    if (level > 1) { g.lineStyle(1, color, 0.5); g.strokeCircle(0, 0, 6); }
    g.fillStyle(0xd4fff0); g.fillCircle(0, 0, 2);
    g.fillStyle(color); g.fillRect(4, -2, 4, 4);
  } else if (kind === 'tractor') {
    g.lineStyle(1.5, color); g.strokeCircle(0, 0, 4); g.lineBetween(4, -5, 7, -5); g.lineBetween(4, 5, 7, 5); g.lineBetween(6, -5, 6, 5); g.fillStyle(0xf4dfff); g.fillCircle(0, 0, 1.5);
  } else if (kind === 'shield') {
    g.lineStyle(1.5, color); g.strokeCircle(0, 0, 5); g.fillStyle(color, 0.35); g.fillTriangle(0, 5, -4, -3, 4, -3);
  } else if (kind === 'rocket') {
    g.fillStyle(0x182331); g.fillRect(-5, -5, 10, 10);
    for (const y of [-3, 3]) { g.fillStyle(0xe3c7a4); g.fillRect(-3, y - 1, 8, 2); g.fillStyle(color); g.fillTriangle(5, y - 2, 8, y, 5, y + 2); }
  } else if (kind === 'armor') {
    g.fillStyle(0x697b8e); g.fillTriangle(-5, -5, 5, -5, -5, 5); g.fillStyle(0x9baec0); g.fillTriangle(5, 5, 5, -5, -5, 5);
    g.lineStyle(1, 0xc2d2df); g.strokeRect(-5, -5, 10, 10);
  } else if (kind === 'engine') {
    g.fillStyle(0x66859d); g.fillRect(-5, -4, 9, 8); g.fillStyle(0x121f30); g.fillRect(-6, -3, 4, 6);
    g.fillStyle(color); g.fillTriangle(-7, -3, -14, 0, -7, 3);
  } else {
    g.fillStyle(color, 0.55); g.fillRect(-4, -4, 8, 8);
    g.lineStyle(1, 0x1b2638); g.lineBetween(-4, -1, 4, -1); g.lineBetween(-4, 2, 4, 2);
  }
  g.fillStyle(0xe4f5ff);
  for (let i = 0; i < level; i++) g.fillRect(-5 + i * 4, 5, 2, 1);
  g.fillStyle(0x9badbc, 0.7); g.fillRect(-6, -6, 1, 1); g.fillRect(5, -6, 1, 1);
  g.restore();
}

export function drawAsteroid(g: Phaser.GameObjects.Graphics, a: Asteroid, origin = { x: a.x, y: a.y }) {
  const shape = ensureAsteroidGeometry(a), color = RESOURCES[a.ore].color;
  const vertices = shape.vertices, points = vertices.map(v => new Phaser.Geom.Point(origin.x + v.x, origin.y + v.y));
  const fraction = a.amount / Math.max(1, a.originalAmount!), base = shape.baseRadius;
  const shades = a.ore === 'ice' ? [0x748b9c, 0x92b4c9, 0x5d7285, 0x647b91] : [0x63656c, 0x555860, 0x40464f, 0x4b505a];
  for (let i = 0; i < points.length; i++) {
    const next = points[(i + 1) % points.length];
    g.fillStyle(shades[(i + (a.id % 3)) % shades.length]);
    g.fillTriangle(origin.x, origin.y, points[i].x, points[i].y, next.x, next.y);
  }
  g.lineStyle(1, 0x9ba1aa, 0.5); g.strokePoints(points, true);
  const scale = Math.sqrt(Math.max(0.01, fraction));
  const featureInside = (point: Vertex, radius: number) => [[0, 0], [radius, 0], [-radius, 0], [0, radius], [0, -radius]].every(([x, y]) => containsPoint({ x: point.x + x, y: point.y + y }, vertices));
  for (let i = 0; i < 5; i++) {
    const angle = a.id * 1.7 + i * 2.4;
    const local = { x: Math.cos(angle) * base * 0.45 * scale, y: Math.sin(angle) * base * 0.45 * scale };
    const r = base * (0.09 + (i % 3) * 0.035) * scale;
    if (!featureInside(local, r * 1.2)) continue;
    const x = origin.x + local.x, y = origin.y + local.y;
    g.fillStyle(0x8b919b, 0.6); g.fillEllipse(x, y + 1, r * 2.2, r * 1.7);
    g.fillStyle(0x282f39, 0.85); g.fillEllipse(x, y - 1, r * 2, r * 1.5);
    g.fillStyle(0x404751); g.fillEllipse(x + 1, y, r * 1.2, r * 0.8);
  }
  // Additional seams become visible as outer rock is carved off.
  const deposits = 2 + Math.floor((1 - fraction) * 5);
  for (let i = 0; i < deposits; i++) {
    const angle = a.id + i * 2.1;
    const local = { x: Math.cos(angle) * base * 0.34 * scale, y: Math.sin(angle) * base * 0.34 * scale };
    if (!featureInside(local, 5 * scale)) continue;
    const x = origin.x + local.x, y = origin.y + local.y;
    g.lineStyle(3 * scale, 0x252b34); g.lineBetween(x - 4 * scale, y + 3 * scale, x + 4 * scale, y - 3 * scale);
    g.lineStyle(Math.max(1, 1.7 * scale), color, 0.85); g.lineBetween(x - 3 * scale, y + 2 * scale, x + 3 * scale, y - 2 * scale);
    if (a.ore === 'crystal' || a.ore === 'radioactive') { g.fillStyle(color, 0.75); g.fillTriangle(x, y - 4 * scale, x + 3 * scale, y + scale, x - 2 * scale, y + 2 * scale); }
  }
  if (fraction < 0.6) {
    g.lineStyle(1, color, 0.35 + (1 - fraction) * 0.4);
    const count = fraction < 0.3 ? 5 : 3;
    for (let i = 0; i < count; i++) {
      const p = vertices[(i * 3 + a.id) % vertices.length];
      g.lineBetween(origin.x, origin.y, origin.x + p.x * 0.85, origin.y + p.y * 0.85);
    }
  }
}

export function drawStation(g: Phaser.GameObjects.Graphics, base = { x: WORLD.stationX, y: WORLD.stationY, unlocked: true }) {
  const { x, y } = base;
  const accent = base.unlocked ? 0x65d49c : 0xd6a661;
  g.lineStyle(1, accent, 0.18); g.strokeCircle(x, y, 220);
  for (let i = 0; i < 16; i++) {
    const a = i * Math.PI / 8;
    g.lineStyle(2, accent, 0.5); g.lineBetween(x + Math.cos(a) * 214, y + Math.sin(a) * 214, x + Math.cos(a) * 220, y + Math.sin(a) * 220);
  }
  g.fillStyle(0x101e2a); g.fillRoundedRect(x - 66, y - 50, 132, 100, 8);
  g.lineStyle(2, 0x52798a); g.strokeRoundedRect(x - 66, y - 50, 132, 100, 8);
  g.fillStyle(0x1c3742); g.fillRect(x - 45, y - 32, 90, 64);
  g.lineStyle(1, accent, 0.6); g.strokeRect(x - 45, y - 32, 90, 64);
  g.lineStyle(2, accent); g.strokeCircle(x, y, 20);
  g.lineBetween(x - 10, y, x + 10, y); g.lineBetween(x, y - 10, x, y + 10);
  for (const side of [-1, 1]) {
    g.fillStyle(0x264459); g.fillRect(x + side * 83 - 13, y - 40, 26, 80);
    g.lineStyle(1, 0x52798a); g.strokeRect(x + side * 83 - 13, y - 40, 26, 80);
    for (let row = -30; row <= 30; row += 15) { g.lineStyle(1, 0x6495ad, 0.5); g.lineBetween(x + side * 83 - 10, y + row, x + side * 83 + 10, y + row); }
    g.fillStyle(0x90edbd); g.fillRect(x + side * 57 - 2, y - 40, 4, 10); g.fillRect(x + side * 57 - 2, y + 30, 4, 10);
  }
}
