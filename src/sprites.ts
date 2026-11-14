import type { Asteroid } from './model.ts';
import { ensureAsteroidGeometry } from './mining.ts';
import { containsPoint, type Vertex } from './asteroidGeometry.ts';
import { RESOURCES, ENEMIES, OUTPOST, STRUCTURES, type EnemyKind, type StructureKind } from './data.ts';
import { bounds, neighbourMask, wear, stationLayout, type Outpost, type StationModule } from './outposts.ts';

// Baked top-down pixel-art sprites painted with the plain Canvas 2D API.
// World sprites use one pixel per world unit; the backdrop is coarser. All are drawn with
// nearest-neighbour filtering. Every sprite is snapped to a small palette (no anti-aliasing, no gradients)
// and world objects get a one-texel dark outline. One world-fixed light sits upper left.
// Presentation only: uses its own seeded RNG and never changes simulation state.

type Ctx = CanvasRenderingContext2D;
export const LIGHT = { x: -0.55, y: -0.835 };
/** `scale` is texture pixels per world unit; draw sprites at `1 / scale`. */
export const ASTEROID_SPRITE = { size: 112, scale: 1 };
export const ENEMY_SPRITE = { size: 120, scale: 1, designRadius: 17 };
export const STATION_SPRITE = { size: 480, scale: 1 };
const OUTLINE = 0x05070c;

const channel = (c: number, shift: number) => (c >> shift) & 255;
export const css = (c: number, alpha = 1) => `rgba(${channel(c, 16)},${channel(c, 8)},${channel(c, 0)},${alpha})`;
export function mix(a: number, b: number, t: number) {
  const k = Math.max(0, Math.min(1, t)), m = (shift: number) => Math.round(channel(a, shift) + (channel(b, shift) - channel(a, shift)) * k);
  return (m(16) << 16) | (m(8) << 8) | m(0);
}
const ramp = (dark: number, mid: number, light: number, t: number) => t < 0.5 ? mix(dark, mid, t * 2) : mix(mid, light, t * 2 - 1);
function seeded(seed: number) {
  let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}
function canvasOf(width: number, height = width) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  return canvas;
}
function path(ctx: Ctx, points: Vertex[]) {
  ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath();
}
const dot = (ctx: Ctx, x: number, y: number, color: number, w = 1, h = 1) => { ctx.fillStyle = css(color); ctx.fillRect(Math.round(x), Math.round(y), w, h); };

/**
 * Turns anti-aliased drawing into pixel art: every texel becomes fully opaque or fully clear,
 * each opaque texel takes its nearest palette colour, and an optional outline hugs the shape.
 */
function snap(ctx: Ctx, palette: number[], outline?: number) {
  const { width, height } = ctx.canvas, image = ctx.getImageData(0, 0, width, height), data = image.data;
  const colors = palette.map(c => [channel(c, 16), channel(c, 8), channel(c, 0)]);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) { data[i + 3] = 0; continue; }
    let best = colors[0], nearest = Infinity;
    for (const c of colors) {
      const distance = (data[i] - c[0]) ** 2 + (data[i + 1] - c[1]) ** 2 + (data[i + 2] - c[2]) ** 2;
      if (distance < nearest) { nearest = distance; best = c; }
    }
    data[i] = best[0]; data[i + 1] = best[1]; data[i + 2] = best[2]; data[i + 3] = 255;
  }
  if (outline !== undefined) {
    const solid = new Uint8Array(width * height);
    for (let i = 0; i < solid.length; i++) solid[i] = data[i * 4 + 3] ? 1 : 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (solid[i] || !((x > 0 && solid[i - 1]) || (x < width - 1 && solid[i + 1]) || (y > 0 && solid[i - width]) || (y < height - 1 && solid[i + width]))) continue;
      data[i * 4] = channel(outline, 16); data[i * 4 + 1] = channel(outline, 8); data[i * 4 + 2] = channel(outline, 0); data[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

// ---------- Background: three seamless parallax layers ----------

function wrapped(size: number, x: number, y: number, radius: number, draw: (x: number, y: number) => void) {
  for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
    if (x + ox + radius < 0 || x + ox - radius > size || y + oy + radius < 0 || y + oy - radius > size) continue;
    draw(x + ox, y + oy);
  }
}
function cloud(ctx: Ctx, x: number, y: number, radius: number, color: number, alpha: number) {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, css(color, alpha)); gradient.addColorStop(0.45, css(color, alpha * 0.35)); gradient.addColorStop(1, css(color, 0));
  ctx.fillStyle = gradient; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}
const NEBULA_PALETTES = [[0x1d4f7a, 0x45307a, 0x0f5a5e], [0x5a2a6a, 0x1c3f80, 0x7a3a4a], [0x0f5f66, 0x243f86, 0x3d6a3a], [0x70432a, 0x4a2a70, 0x1d4a7a]];

/** Layers are drawn enlarged: nebula x4, stars x2. Tiles repeat seamlessly. */
export function paintBackdrop(seed: number) {
  const random = seeded(seed), palette = NEBULA_PALETTES[Math.floor(random() * NEBULA_PALETTES.length)];
  const nebula = canvasOf(512), n = nebula.getContext('2d')!;
  n.fillStyle = '#050911'; n.fillRect(0, 0, 512, 512);
  n.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 26; i++) {
    const x = random() * 512, y = random() * 512, radius = 60 + random() * 150, color = palette[i % palette.length], alpha = 0.1 + random() * 0.17;
    wrapped(512, x, y, radius, (px, py) => cloud(n, px, py, radius, color, alpha));
  }
  n.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 9; i++) {
    const x = random() * 512, y = random() * 512, radius = 50 + random() * 110;
    wrapped(512, x, y, radius, (px, py) => cloud(n, px, py, radius, 0x03060c, 0.5));
  }
  // Posterize the soft clouds into flat stepped bands, like hand-placed pixel clouds.
  const image = n.getImageData(0, 0, 512, 512), step = 7;
  for (let i = 0; i < image.data.length; i += 4) for (let c = 0; c < 3; c++) image.data[i + c] = Math.round(image.data[i + c] / step) * step;
  n.putImageData(image, 0, 0);

  const starColors = [0xffffff, 0xcfe4ff, 0xa9cfe5, 0xffe7c4, 0xffd0b0, 0xbfd0ff];
  const stars = (size: number, count: number, bright: number) => {
    const canvas = canvasOf(size), c = canvas.getContext('2d')!;
    for (let i = 0; i < count; i++) {
      const x = 2 + Math.floor(random() * (size - 4)), y = 2 + Math.floor(random() * (size - 4));
      const color = starColors[Math.floor(random() * starColors.length)], level = random();
      if (level < bright * 0.35) {
        // Twinkle: bright core with dimmer arms.
        const arm = mix(color, 0x0a1220, 0.55);
        dot(c, x, y, color); dot(c, x - 1, y, arm); dot(c, x + 1, y, arm); dot(c, x, y - 1, arm); dot(c, x, y + 1, arm);
      } else dot(c, x, y, mix(color, 0x0a1220, level < bright ? 0.1 : 0.35 + random() * 0.4));
    }
    return canvas;
  };
  return { nebula, far: stars(384, 150, 0.12), near: stars(320, 42, 0.6) };
}

// ---------- Asteroids ----------

/** How strongly each ore tints the slate rock, so fields read by colour even before the ore shows. */
const ROCK_TINT: Record<string, number> = { iron: 0.06, copper: 0.2, crystal: 0.1, ice: 0.3, radioactive: 0.1 };
const SLATE = [0x2b3340, 0x3d4757, 0x525d70, 0x6b778b, 0x8e9aad], CREVICE = 0x0d1118, CELL = 8;
function hash(a: number, b: number, c: number) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Paints a cobbled rock: rounded stone plates separated by dark crevices, with glowing ore
 * filling cavities between them. The silhouette follows the asteroid's collision polygon, the
 * plate pattern is fixed per asteroid, and more ore is exposed as the rock is mined away.
 */
export function paintAsteroid(ctx: Ctx, a: Asteroid) {
  const { size } = ASTEROID_SPRITE, half = size / 2, shape = ensureAsteroidGeometry(a), outer = shape.vertices, base = shape.baseRadius;
  const ore = RESOURCES[a.ore].color, oreLight = mix(ore, 0xffffff, 0.6), oreDeep = mix(ore, 0x000000, 0.45), oreShade = mix(ore, 0x000000, 0.2);
  const tint = ROCK_TINT[a.ore] ?? 0.08, tones = SLATE.map(tone => mix(tone, ore, tint)), glowCrevice = mix(CREVICE, ore, 0.6);
  const fraction = a.amount / Math.max(1, a.originalAmount ?? a.amount);
  // Ore cavities: one main pocket near the middle and more as the rock is carved away.
  const vein = hash(a.id, 0, 10) * Math.PI * 2, pockets = [
    // The main cavity is a short branching vein of three overlapping pockets.
    { x: 0, y: 0, r: base * 0.24 },
    { x: Math.cos(vein) * base * 0.3, y: Math.sin(vein) * base * 0.3, r: base * 0.17 },
    { x: Math.cos(vein + 2.5) * base * 0.34, y: Math.sin(vein + 2.5) * base * 0.34, r: base * 0.14 },
    ...Array.from({ length: 1 + Math.floor((1 - fraction) * 5) }, (_, k) => {
      const angle = hash(a.id, k, 11) * Math.PI * 2, distance = base * (0.45 + hash(a.id, k, 12) * 0.3);
      return { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance, r: base * (0.1 + hash(a.id, k, 13) * 0.09) };
    }),
  ];
  const pocketAt = (x: number, y: number, reach: number) => pockets.some(p => (x - p.x) ** 2 + (y - p.y) ** 2 < (p.r * reach) ** 2);
  const image = ctx.createImageData(size, size), data = image.data, inside = new Uint8Array(size * size);
  const set = (i: number, color: number) => { data[i * 4] = channel(color, 16); data[i * 4 + 1] = channel(color, 8); data[i * 4 + 2] = channel(color, 0); data[i * 4 + 3] = 255; };
  const reach = Math.ceil(Math.max(...outer.map(p => Math.hypot(p.x, p.y)))) + 1;
  for (let py = Math.max(0, half - reach); py < Math.min(size, half + reach); py++) for (let px = Math.max(0, half - reach); px < Math.min(size, half + reach); px++) {
    const x = px - half + 0.5, y = py - half + 0.5;
    if (!containsPoint({ x, y }, outer)) continue;
    // Nearest and second-nearest plate centres on a jittered grid (a small cellular pattern).
    const gx = Math.floor(x / CELL), gy = Math.floor(y / CELL);
    let d1 = Infinity, d2 = Infinity, sx = 0, sy = 0, tx = 0, ty = 0, cellX = 0, cellY = 0;
    for (let j = gy - 2; j <= gy + 2; j++) for (let i = gx - 2; i <= gx + 2; i++) {
      const cx = (i + 0.15 + hash(a.id, i, j) * 0.7) * CELL, cy = (j + 0.15 + hash(a.id, j, i + 77) * 0.7) * CELL, d = Math.hypot(x - cx, y - cy);
      if (d < d1) { d2 = d1; tx = sx; ty = sy; d1 = d; sx = cx; sy = cy; cellX = i; cellY = j; } else if (d < d2) { d2 = d; tx = cx; ty = cy; }
    }
    const index = py * size + px, edge = d2 - d1, lit = ((x - sx) * LIGHT.x + (y - sy) * LIGHT.y) / (CELL * 0.5);
    inside[index] = 1;
    if (pocketAt(sx, sy, 1)) {
      // Glowing ore nodules, shadowed where the surrounding rock overhangs them.
      const rockNeighbour = !pocketAt(tx, ty, 1);
      set(index, edge < 1.1 ? oreDeep : rockNeighbour && edge < 2.6 ? oreDeep : lit > 0.3 ? oreLight : lit < -0.45 ? oreShade : ore);
    } else if (edge < 1.25) {
      set(index, pocketAt(x, y, 1.45) ? glowCrevice : CREVICE);
    } else {
      // Rounded stone plate: its own tone, a lit shoulder toward the light and a shaded one away.
      const overall = (x * LIGHT.x + y * LIGHT.y) / base;
      const tone = 1 + Math.floor(hash(a.id, cellX * 31 + 7, cellY * 17 + 3) * 2.2) + (lit > 0.4 ? 1 : lit < -0.45 ? -1 : 0) + (overall > 0.4 ? 1 : overall < -0.4 ? -1 : 0) - (edge < 2.3 ? 1 : 0);
      set(index, tones[Math.max(0, Math.min(4, tone))]);
    }
  }
  // Silhouette: bright rim toward the light, dark rim away from it, then a one-pixel outline.
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < size && y < size && inside[y * size + x] === 1;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const index = y * size + x;
    if (inside[index]) {
      if (!at(x - 1, y) || !at(x, y - 1)) set(index, tones[4]); else if (!at(x + 1, y) || !at(x, y + 1)) set(index, tones[0]);
    } else if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1)) set(index, OUTLINE);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.putImageData(image, 0, 0);
}

// ---------- Station (drawn directly in pixels, one per world unit) ----------

/** A ring station: octagonal core with a sunken landing deck, truss spokes, habitat ring, solar wings, dish and fuel tanks. */
export function paintStation(unlocked: boolean) {
  const { size } = STATION_SPRITE, canvas = canvasOf(size), ctx = canvas.getContext('2d')!, c = size / 2;
  const accent = unlocked ? 0x65d49c : 0xd6a661, lamp = unlocked ? 0xc6ffe0 : 0xffe2ad, space = 0x0a1422;
  const steel = [0x0c1620, 0x1b2a38, 0x2f4658, 0x4a6478, 0x7f9bb0, 0xc3d6e2];
  const put = (x: number, y: number, color: number, w = 1, h = 1) => dot(ctx, c + x, c + y, color, w, h);
  const toward = (x: number, y: number) => (x * LIGHT.x + y * LIGHT.y) / (Math.hypot(x, y) || 1);
  /** Raised plate: light on the upper-left edges, shade on the lower-right, dark outline. */
  const plate = (x: number, y: number, w: number, h: number, face: number, high = steel[4], low = steel[0]) => {
    put(x - 1, y - 1, OUTLINE, w + 2, h + 2); put(x, y, face, w, h);
    put(x, y, high, w, 1); put(x, y, high, 1, h); put(x, y + h - 1, low, w, 1); put(x + w - 1, y, low, 1, h);
  };
  const glint = (x: number, y: number, color = lamp) => { for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) put(x + dx, y + dy, mix(color, space, 0.5)); put(x, y, color); };
  const disc = (cx: number, cy: number, r: number, paint: (x: number, y: number, d: number) => number | undefined) => {
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) { const color = paint(x, y, Math.hypot(x, y)); if (color !== undefined) put(cx + x, cy + y, color); }
  };
  const dome = (cx: number, cy: number, r: number) => {
    disc(cx, cy, r + 1, (x, y, d) => { const t = (x * LIGHT.x + y * LIGHT.y) / r; return d < r - 0.4 ? (t > 0.5 ? steel[5] : t > 0.05 ? steel[4] : t > -0.45 ? steel[3] : steel[1]) : d < r + 0.6 ? OUTLINE : undefined; });
    put(cx, cy, lamp);
  };

  // Safe-zone boundary: two-pixel ring, dotted inner ring and tick marks.
  const ringColor = mix(accent, space, 0.62);
  for (let i = 0; i < 2800; i++) { const a = i / 2800 * Math.PI * 2; for (const r of [219, 220]) put(Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r), ringColor); }
  for (let i = 0; i < 120; i++) { const a = i / 120 * Math.PI * 2; put(Math.round(Math.cos(a) * 207), Math.round(Math.sin(a) * 207), mix(accent, space, 0.78), 2, 2); }
  for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8; for (let r = 211; r <= 220; r++) put(Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r), mix(accent, space, 0.15), 2, 2); }

  // Open lattice spokes between the core and the habitat ring.
  const truss = (vertical: boolean, from: number, to: number) => {
    for (let along = from; along <= to; along++) for (let across = -5; across <= 5; across++) {
      const rail = Math.abs(across) >= 4, brace = ((along + across) % 8 + 8) % 8 === 0 || ((along - across) % 8 + 8) % 8 === 0;
      if (!rail && !brace && across !== 0) continue;
      const color = rail ? (across < 0 ? steel[4] : steel[1]) : across === 0 ? steel[2] : steel[3];
      if (vertical) put(across, along, color); else put(along, across, color);
    }
  };
  truss(true, -90, -46); truss(true, 46, 90); truss(false, -90, -46); truss(false, 46, 90);

  for (const side of [-1, 1]) {
    // Solar wings: two framed panels of glinting cells on each side.
    plate(side > 0 ? 99 : -111, -4, 12, 8, steel[2], steel[4], steel[1]);
    const left = side > 0 ? 110 : -146;
    for (const topEdge of [-39, 3]) {
      plate(left, topEdge, 36, 36, steel[2]);
      put(left + 2, topEdge + 2, 0x081226, 32, 32);
      for (let row = 0; row < 4; row++) for (let column = 0; column < 4; column++) {
        const x = left + 2 + column * 8, y = topEdge + 2 + row * 8;
        put(x, y, 0x1c3f7c, 7, 7); put(x, y, 0x3b6fb6, 7, 1); put(x, y, 0x3b6fb6, 1, 7);
        put(x + 6, y + 1, 0x122a57, 1, 6); put(x + 1, y + 6, 0x122a57, 6, 1);
        put(x + 2, y + 2, 0x9fc8ff, 2, 1); put(x + 2, y + 3, 0x9fc8ff, 1, 1);
      }
    }
    put(left + (side > 0 ? 0 : 33), -3, steel[3], 3, 6);
    glint(side > 0 ? 149 : -149, -39); glint(side > 0 ? 149 : -149, 39);
  }
  // North: mast and a concave comms dish (inner wall lit on the far side from the light).
  plate(-3, -113, 6, 14, steel[2], steel[4], steel[1]);
  disc(0, -127, 15, (x, y, d) => {
    if (d >= 14.5) return undefined; if (d >= 13.5) return OUTLINE;
    if (d >= 12) return toward(x, y) > 0 ? steel[5] : steel[1];
    if (d < 3.5) return steel[1];
    const t = -toward(x, y); return t > 0.45 ? steel[5] : t > 0 ? steel[4] : t > -0.5 ? steel[3] : steel[2];
  });
  for (let i = 1; i <= 9; i++) { put(-i, -127 - Math.round(i * 0.6), steel[0]); put(i, -127 - Math.round(i * 0.6), steel[0]); put(0, -127 + i, steel[0]); }
  glint(0, -127);
  // South: manifold and two fuel tanks with hazard bands.
  plate(-3, 99, 6, 9, steel[2], steel[4], steel[1]); plate(-18, 106, 36, 5, steel[3]);
  for (const tank of [-11, 11]) for (let y = 110; y <= 142; y++) for (let x = -9; x <= 9; x++) {
    const d = Math.hypot(x, y - Math.max(119, Math.min(133, y)));
    if (d > 9.5) continue;
    const band = y >= 124 && y <= 128;
    const tone = d > 8.5 ? OUTLINE : band ? (x > 2 ? mix(accent, 0x000000, 0.45) : accent) : x <= -6 ? steel[3] : x <= -3 ? steel[5] : x <= 1 ? steel[4] : x <= 5 ? steel[3] : steel[1];
    put(tank + x, y, tone);
  }

  // Habitat ring: a raised torus, so the outer slope is lit on the light side and the inner slope on the far side.
  disc(0, 0, 101, (x, y, d) => {
    if (d < 87 || d >= 101) return undefined;
    if (d < 88 || d >= 100) return OUTLINE;
    const angle = (Math.atan2(y, x) / (Math.PI * 2) + 1) % 1, segment = angle * 24;
    if (segment % 1 < 0.05) return steel[0];
    const facing = toward(x, y) * (d - 94) / 6;
    return facing > 0.3 ? steel[5] : facing > 0.08 ? steel[4] : facing > -0.3 ? steel[3] : facing > -0.6 ? steel[2] : steel[1];
  });
  for (let k = 0; k < 24; k++) {
    const a = (k + 0.5) / 24 * Math.PI * 2, x = Math.round(Math.cos(a) * 94), y = Math.round(Math.sin(a) * 94);
    put(x - 1, y - 1, steel[0], 4, 4); put(x, y, k % 3 === 0 ? lamp : k % 3 === 1 ? 0x16222d : mix(accent, space, 0.25), 2, 2);
  }
  for (const [x, y] of [[73, 73], [-73, 73], [73, -73], [-73, -73]]) glint(x, y, 0xff8a7a);

  // Core: two stacked octagonal decks with bevels, vents and a sunken landing deck.
  disc(0, 0, 50, (x, y) => {
    const ax = Math.abs(x), ay = Math.abs(y), diagonal = (ax + ay) * 0.7071, m = Math.max(ax, ay, diagonal);
    if (m >= 50) return undefined;
    const nx = m === ax ? Math.sign(x) : m === ay ? 0 : Math.sign(x) * 0.7071, ny = m === ay ? Math.sign(y) : m === ax ? 0 : Math.sign(y) * 0.7071;
    const facing = nx * LIGHT.x + ny * LIGHT.y;
    if (m >= 49) return OUTLINE;
    if (m >= 47) return facing > 0 ? steel[4] : steel[0];
    if (m >= 38) return ax === ay ? steel[1] : steel[2];
    if (m >= 37) return steel[0];
    if (m >= 35) return facing > 0 ? steel[5] : steel[1];
    return ax === ay ? steel[2] : steel[3];
  });
  for (const s of [-1, 1]) {
    for (const k of [-13, -9, -5]) { put(s * 42 - 1, k, steel[0], 3, 2); put(k, s * 42 - 1, steel[0], 2, 3); }
    put(s * 43, 9, lamp); put(9, s * 43, lamp);
    put(s * 31 - 2, -1, accent, 4, 2); put(-1, s * 31 - 2, accent, 2, 4);
  }
  disc(0, 0, 27, (x, y, d) => {
    if (d >= 27) return undefined;
    if (d >= 26) return toward(x, y) > 0 ? steel[0] : steel[5];
    if (d >= 22.5 && toward(x, y) > 0.2) return 0x050c12;
    if (Math.abs(d - 15) < 0.8) return accent;
    if (d < 11 && (x + y) % 2 === 0) return mix(accent, 0x0e2029, 0.6);
    return x % 6 === 0 || y % 6 === 0 ? 0x17383f : 0x0e2029;
  });
  put(-8, 0, lamp, 17, 1); put(0, -8, lamp, 1, 17);
  for (const [x, y] of [[-18, -18], [18, -18], [-18, 18], [18, 18]]) put(x, y, lamp);
  for (const [x, y] of [[-32, -32], [32, -32], [-32, 32], [32, 32]]) dome(x, y, 6);
  return canvas;
}

// ---------- Enemy ships ----------

/**
 * Gunmetal warships with a small faction-colour accent, built from mirrored plates, guns,
 * engines and panel seams. Nose points along +x; shading is symmetric about the spine so it
 * survives rotation.
 */
export function paintEnemy(kind: EnemyKind) {
  const { scale, designRadius } = ENEMY_SPRITE, size = Math.ceil(Math.max(ENEMY_SPRITE.size, ENEMIES[kind].radius * 3.2)), canvas = canvasOf(size * scale), ctx = canvas.getContext('2d')!;
  const grow = ENEMIES[kind].radius / designRadius * scale, pixel = 1 / grow;
  const accent = mix(ENEMIES[kind].color, 0x7d8794, 0.22), accentDark = mix(accent, 0x05070d, 0.55), visor = mix(accent, 0xffffff, 0.55);
  const [m0, m1, m2, m3, m4, m5] = [0x12161d, 0x232b37, 0x3a4656, 0x596779, 0x8696a8, 0xc2ced9], flame = 0xff9a52, core = 0xfff0c8;
  ctx.setTransform(grow, 0, 0, grow, size * scale / 2, size * scale / 2); ctx.lineJoin = 'miter';
  type Points = [number, number][];
  const poly = (points: Points, tone: number) => { for (const side of [1, -1]) { path(ctx, points.map(([x, y]) => ({ x, y: y * side }))); ctx.fillStyle = css(tone); ctx.fill(); } };
  const box = (x: number, y: number, w: number, h: number, tone: number) => { ctx.fillStyle = css(tone); ctx.fillRect(x, y, w, h); ctx.fillRect(x, -y - h, w, h); };
  const line = (x1: number, y1: number, x2: number, y2: number, tone: number) => {
    ctx.strokeStyle = css(tone); ctx.lineWidth = pixel;
    for (const side of [1, -1]) { ctx.beginPath(); ctx.moveTo(x1, y1 * side); ctx.lineTo(x2, y2 * side); ctx.stroke(); }
  };
  const disc = (x: number, y: number, r: number, tone: number) => { ctx.fillStyle = css(tone); for (const side of [1, -1]) { ctx.beginPath(); ctx.arc(x, y * side, r, 0, Math.PI * 2); ctx.fill(); } };
  const engine = (x: number, y: number, r: number) => {
    box(x - 8, y - r * 0.65, 6, r * 1.3, flame); box(x - 5, y - r * 0.3, 4, r * 0.6, core);
    box(x - 2, y - r, 3, r * 2, m0); box(x + 1, y - r, 6, r * 2, m2); box(x + 1, y - r, 6, pixel, m4); box(x + 3, y - r, pixel, r * 2, m1);
  };
  const gun = (x: number, y: number, length: number) => { box(x, y, length, 1.7, m0); box(x, y, length, pixel, m3); box(x + length - 1.5, y - 0.4, 1.5, 2.5, m5); };
  const cockpit = (x: number, half: number, length: number) => { box(x, -half, length, half * 2, m0); box(x + 1, -half + 0.7, length - 2, half * 2 - 1.4, visor); };

  if (['scrapDrone','bomber','flak','disruptor','shieldCarrier','marauder','escort','rustLeviathan','tyrant','harvester','storm','dreadforge'].includes(kind)||kind.startsWith('boss')) {
    const def=ENEMIES[kind], width=def.boss?(kind==='dreadforge'?5:kind==='harvester'?4:3):kind==='escort'?3:kind==='scrapDrone'?1:2, rows=def.boss?(kind==='rustLeviathan'?2:kind==='storm'?4:3):kind==='bomber'?3:kind==='scrapDrone'?1:2;
    for(let x=-width;x<=width;x++)for(let y=0;y<rows;y++)if(Math.abs(x)+y<width+rows-1){
      box(x*5-2,y*5-2,4.5,4.5,m0);box(x*5-1.5,y*5-1.5,3.5,3.5,m2);line(x*5-1,y*5-1,x*5+1,y*5-1,m4);
    }
    for(let pipe=-width*4;pipe<width*4;pipe+=5){line(pipe,2,pipe+3,2,0xb77846);disc(pipe,3,.5,m5);}
    engine(-width*5,5,3);cockpit(0,2,5);disc(-5,0,2,accent);
    if(def.weapons.length){gun(width*4,5,7);if(def.boss)gun(0,10,12);}
    if(def.shield||def.aura){disc(-2,6,3,accentDark);disc(-2,6,1.5,visor);}
    if(def.industry){gun(8,8,6);disc(12,8,2,0x66e6c6);}
    if(def.emp){disc(3,8,3,0x9768e6);}
  } else if (kind === 'raider') {
    engine(-15, -9.5, 2.8);
    poly([[7, -4], [-3, -16], [-13, -17.5], [-17, -13], [-10, -5]], m2);
    poly([[-5, -14.5], [-12.5, -16.5], [-15.5, -13.5], [-9, -12]], accent);
    line(7, -4, -3, -16, m4); line(-2, -8, -11, -9, m1);
    box(-3, -12, 7, 3.6, m1); gun(2, -11, 11);
    poly([[24, 0], [14, -3.2], [3, -5.8], [-11, -6.8], [-16, -4.5], [-16, 0]], m3);
    poly([[20, 0], [12, -1.7], [-12, -2.7], [-14, 0]], m4);
    poly([[24, 0], [17, -2.3], [17, 0]], accent);
    line(-4, -6.3, -4, -2.7, m1); line(4, -5.6, 4, -2.1, m1); line(-12, 0, 18, 0, m5);
    cockpit(5, 1.7, 6); box(-14, -1.2, 4, 2.4, accentDark); box(-8, -5.4, 2, 1.4, m0);
  } else if (kind === 'scout') {
    engine(-15, 0, 2.3); engine(-13, -5.4, 1.5);
    poly([[-3, -3], [-11, -15], [-17, -15.5], [-15, -4]], m2); line(-3, -3, -11, -15, m4);
    poly([[-12, -13], [-16.6, -15], [-16, -10.5]], accent); line(-8, -5, -15, -8, m1);
    poly([[11, -2], [5, -9.5], [1, -9.5], [3, -2.5]], m2); line(11, -2, 5, -9.5, m4);
    poly([[25, 0], [10, -2.8], [-8, -4.4], [-15, -3], [-15, 0]], m3);
    poly([[21, 0], [8, -1.3], [-12, -1.8], [-12, 0]], m4);
    box(24, -0.5, 6, 1, m5); line(-10, 0, 18, 0, m5);
    cockpit(8, 1.4, 5); poly([[-2, -4], [-8, -4.4], [-8, -2.7], [-2, -2.5]], accent);
    line(2, -3.4, 2, -1.4, m1); box(4, -9.8, 1.4, 1.4, visor);
  } else if (kind === 'tank') {
    engine(-19, -9, 2.9); engine(-19, 0, 2.9);
    poly([[7, -13], [3, -19], [-10, -19.5], [-13, -14]], m1);
    poly([[4, -17.2], [-9, -17.7], [-10, -16], [3, -15.5]], accent);
    gun(4, -19, 11);
    poly([[19, 0], [15.5, -8.5], [6, -14], [-12, -15], [-18, -9.5], [-18, 0]], m2);
    poly([[19, 0], [15.5, -8.5], [9, -9.5], [10, 0]], m3);
    poly([[9, -9.5], [-10, -11], [-14, -7], [-14, 0], [10, 0]], m3);
    poly([[7, -7], [-9, -8], [-11, -5], [-11, 0], [8, 0]], m4);
    line(10, -9.5, 10, 0, m1); line(-3, -11, -3, -8, m1); line(15.5, -8.5, 6, -14, m4); line(-14, -7, -14, 0, m1);
    for (const x of [-9.5, -6.5, -3.5]) box(x, -13.6, 1.4, 2.4, m0);
    for (const [x, y] of [[13, -6.5], [-12, -12.5], [3, -12.3], [-16, -8]]) box(x, y, pixel, pixel, m5);
    box(-17, -6, 2.5, 12, accentDark);
    disc(-1, 0, 5.6, m0); disc(-1, 0, 4.6, m2); disc(-1.6, 0, 3, m4);
    box(2, -1.5, 15, 3, m0); box(2, -0.6, 15, 1.2, m3); box(16, -1.9, 2.2, 3.8, m5);
    box(11.5, -5.4, 3.4, 1.6, m0); box(12, -5, 2.4, 0.8, visor);
  } else if (kind === 'frigate') {
    // Boxy missile boat: side pods with launch tubes and a forward rack.
    engine(-16, -6, 2.4);
    poly([[2, -6], [-4, -13.5], [-13, -13.5], [-15, -7]], m2); line(2, -6, -4, -13.5, m4);
    for (const x of [-11.5, -8.5, -5.5]) { box(x, -12.8, 2.2, 2.6, m0); box(x + 0.5, -12.3, 1.2, 1.4, accent); }
    poly([[20, 0], [15, -4.5], [2, -6.5], [-13, -7], [-17, -4], [-17, 0]], m3);
    poly([[16, 0], [12, -2.4], [-12, -3.2], [-13, 0]], m4);
    box(5, -6.4, 8.5, 2.2, m1); for (const x of [6, 8.6, 11.2]) box(x, -6, 1.6, 1.4, accent);
    line(0, -6.5, 0, -3, m1); line(-13, 0, 14, 0, m5);
    cockpit(9, 1.5, 5); box(-15, -1.6, 3, 3.2, accentDark);
  } else if (kind === 'carrier') {
    // Wide flight deck with two open hangar bays and a central runway.
    engine(-21, -8.5, 2.6); engine(-21, 0, 2.6);
    poly([[18, 0], [16, -7], [8, -13], [-14, -14.5], [-20, -10], [-20, 0]], m2);
    poly([[14, 0], [12, -5], [6, -9.5], [-12, -10.5], [-16, -7], [-16, 0]], m3);
    box(-10, -9, 16, 5.4, m0); box(-9, -8.2, 14, 3.8, m1);
    for (const x of [-7, -3, 1]) box(x, -8.2, 0.7, 3.8, accent);
    box(-13, -1.1, 24, 2.2, m4); line(-13, 0, 11, 0, m5);
    poly([[18, 0], [16, -7], [13, -6], [14.5, 0]], accent);
    box(8.5, -3.6, 4.4, 2, m0); box(9.1, -3.2, 3.2, 1.2, visor);
    line(16, -7, 8, -13, m4); line(-12, -10.5, -12, -3, m1);
    for (const [x, y] of [[-17, -9], [4, -11.5], [-8, -12.5]]) box(x, y, pixel, pixel, m5);
  } else if (kind === 'defender') {
    // Shield ship: emitter core amidships, shield vanes and twin plasma projectors.
    engine(-15, -5, 2.2);
    poly([[4, -8], [0, -15.5], [-9, -16.5], [-13, -10]], m2); poly([[1, -13.7], [-8, -14.8], [-10, -12], [0, -11]], accent);
    poly([[17, 0], [13, -6], [4, -10], [-10, -10], [-15, -6], [-15, 0]], m3);
    poly([[13, 0], [10, -4], [3, -6.5], [-9, -6.5], [-11, -4], [-11, 0]], m4);
    box(8, -8.8, 9, 1.9, m0); box(15.5, -9.3, 2, 2.9, accent);
    line(4, -10, 4, -6.5, m1); line(-10, -10, -10, -6, m1); line(13, -6, 4, -10, m5);
    disc(0, 0, 5, m0); disc(0, 0, 3.9, visor); disc(0, 0, 1.9, m5);
    cockpit(8.5, 1.3, 4);
  } else if (kind === 'warden') {
    // Boss dreadnought: layered armour decks, a triple forward battery, missile cells and four engines.
    engine(-17, -9.5, 1.9); engine(-17, -3.4, 1.9);
    poly([[7, -9], [3, -16.6], [-12, -16.6], [-15.5, -11]], m1); poly([[3.5, -15], [-11, -15.2], [-12, -13.6], [2.6, -13.2]], accent);
    line(7, -9, 3, -16.6, m4); for (const x of [-8, -4, 0]) line(x, -13, x, -10.4, m0);
    poly([[18, 0], [16, -5], [11, -9.2], [-13, -11], [-17, -7], [-17, 0]], m2);
    poly([[15, 0], [13.5, -4], [9, -7.2], [-11, -8.6], [-14, -5.6], [-14, 0]], m3);
    poly([[11, 0], [10, -3], [6, -5], [-8, -6], [-10, -4], [-10, 0]], m4);
    for (const x of [-7, -2, 3, 8]) line(x, -8.4, x, -5.6, m1);
    line(16, -5, 11, -9.2, m5); line(-13, -11, -17, -7, m1); line(13.5, -4, 9, -7.2, m5);
    box(9, -0.7, 9.5, 1.4, m0); box(9, -0.7, 9.5, pixel, m3); box(17.4, -1, 1.3, 2, m5);
    box(8, -4.4, 8.5, 1.2, m0); box(15.6, -4.7, 1.2, 1.8, m5); box(6, -4.9, 3, 2.2, m1);
    for (const x of [-7.6, -5.6, -3.6, -1.6]) { box(x, -4.8, 1.5, 1.5, m0); box(x + 0.35, -4.45, 0.8, 0.8, accent); }
    for (const x of [-12.2, -11]) box(x, -7.2, 0.6, 2.8, m0);
    poly([[18, 0], [16, -5], [14.6, -4.4], [15.9, 0]], accent);
    box(1.5, -1.9, 4.6, 3.8, m0); box(2.2, -1.2, 3.2, 2.4, visor); box(-9, -1.4, 5, 2.8, accentDark); line(-9.5, 0, 9, 0, m5);
    for (const [x, y] of [[12, -6.4], [-12, -9.6], [0, -7.6], [-15.4, -5], [5, -14.6], [-10, -14.8]]) box(x, y, pixel, pixel, m5);
  } else if (kind === 'leviathan') {
    // Boss: a segmented crystalline hull with shard spines, a glowing core row and a nose beam emitter.
    engine(-16, -4.2, 2);
    poly([[8, -5], [12, -14.5], [5, -8]], accent); poly([[0, -7], [1, -17.4], [-4, -8]], visor); poly([[-8, -7], [-10, -16.4], [-12, -7]], accent); poly([[13, -3], [19.5, -9.4], [12, -5.5]], visor);
    poly([[8, -5], [10.4, -10], [6.4, -6.6]], m5); poly([[-8, -7], [-9.3, -12], [-10.4, -7]], m5);
    poly([[20, 0], [14, -4], [4, -7.5], [-8, -8], [-15, -5.5], [-18, 0]], m2);
    poly([[16, 0], [12, -2.6], [3, -5], [-8, -5.4], [-13, -3.4], [-14, 0]], m3);
    poly([[12, 0], [9, -1.6], [-6, -2.6], [-10, 0]], m4);
    for (const x of [-9, -4, 1, 6]) line(x, -7.7, x, -2.6, m1);
    line(14, -4, 4, -7.5, m5); line(-8, -8, -15, -5.5, m1);
    for (const x of [-6, -1, 4]) { disc(x, 0, 1.8, m0); disc(x, 0, 1.2, visor); }
    box(15, -1.3, 5.5, 2.6, m0); box(19.6, -1.7, 1.7, 3.4, visor); poly([[20, 0], [14, -4], [13, -3], [17.4, 0]], accent);
    box(-13.5, -1.2, 3, 2.4, accentDark);
    for (const [x, y] of [[9, -5.6], [-2, -6.6], [-12, -5.4], [12, -3.4]]) box(x, y, pixel, pixel, m5);
  } else if (kind === 'titan') {
    // Boss: a massive armoured hull built around an open reactor, with plasma batteries forward.
    engine(-17, -10, 1.8); engine(-17, -5, 1.8); engine(-17, 0, 1.8);
    poly([[4, -12], [0, -17.4], [-11, -17.4], [-14, -12]], m1); poly([[1, -16], [-10, -16.2], [-11, -14.6], [0, -14.2]], accent);
    poly([[16, 0], [14.5, -7], [9, -12], [-11, -13], [-17, -8], [-17, 0]], m2);
    poly([[13, 0], [12, -5.5], [7.5, -9.5], [-9.5, -10.4], [-14, -6.5], [-14, 0]], m3);
    for (const x of [-9, 3, 9]) line(x, -12.5, x, -9.8, m1);
    line(14.5, -7, 9, -12, m5); line(12, -5.5, 7.5, -9.5, m5); line(-11, -13, -17, -8, m1);
    for (const x of [-13, -11.6, -10.2]) box(x, -9.4, 0.8, 2.2, accent);
    box(7, -5.8, 10, 2.8, m0); box(7, -5.8, 10, pixel, m3); box(16, -6.3, 1.7, 3.8, accent); box(5, -6.6, 3, 4.2, m1);
    disc(-2, 0, 8.4, m0); disc(-2, 0, 7.4, m1); disc(-2, 0, 5.8, m4); disc(-2, 0, 4.2, accent); disc(-2, 0, 2.3, visor);
    for (const [x, y] of [[-2, -6.6], [3.6, -3.6], [-7.6, -3.6]]) box(x - 0.5, y - 0.5, 1, 1, m0);
    poly([[16, 0], [14.5, -7], [13, -6.4], [14, 0]], accent); cockpit(9.2, 1.5, 3.6);
    for (const [x, y] of [[11, -8], [-12, -11.4], [1, -10.6], [-15.6, -6], [2, -15.6], [-9, -15.8]]) box(x, y, pixel, pixel, m5);
  } else if (kind === 'titanPod') {
    disc(0, 0, 15, m0); box(-10, -10, 20, 10, m2); box(-10, -10, 20, 1.2, m4);
    for (const x of [-7, -1.5, 4]) { box(x, -8, 4.4, 4.4, m0); box(x + 1.1, -6.9, 2.2, 2.2, accent); }
  } else if (kind === 'titanReactor') {
    disc(0, 0, 15, m0); disc(0, 0, 12.5, m1); disc(0, 0, 9.5, accent); disc(0, 0, 6, visor); disc(0, 0, 2.6, m5);
    for (const x of [-13.5, 9.5]) box(x, -1.2, 4, 2.4, m0);
  } else if (kind === 'wardenTurret' || kind === 'leviathanPod' || kind === 'titanCannon') {
    disc(0, 0, 15, m0); disc(0, 0, 13, m2); disc(0, 0, 9.5, m3); disc(-1.5, 0, 5.5, m4);
    box(5, -5, 16, 3, m0); box(5, -5, 16, 0.9, m3); box(19.5, -5.6, 2.4, 4.2, m5); box(-10, -2, 5, 4, accent);
  } else if (kind === 'wardenShield' || kind === 'leviathanNode') {
    disc(0, 0, 15, m0); disc(0, 0, 13, m2); disc(0, 0, 10, m1); disc(0, 0, 7.5, visor); disc(0, 0, 3.4, m5);
    for (const [x, y] of [[10, -10], [-10, -10]]) { box(x - 2, y - 2, 4, 4, m4); box(x - 1, y - 1, 2, 2, accent); }
  } else if (kind === 'drone') {
    engine(-10, 0, 2.4);
    poly([[14, 0], [2, -5], [-8, -12.5], [-11.5, -9], [-7, -3], [-10, 0]], m3);
    poly([[10, 0], [1, -2.3], [-8, -2.6], [-8, 0]], m4);
    poly([[-5, -9.5], [-8.8, -11.5], [-10.5, -8.6]], accent);
    box(2, -1.6, 4.5, 3.2, m0); box(2.8, -0.9, 2.8, 1.8, visor);
  } else {
    engine(-17, -4.3, 2.1);
    poly([[-5, -4.5], [-13, -14], [-18, -13], [-15, -5.5]], m2); line(-5, -4.5, -13, -14, m4);
    poly([[-13, -12], [-17.6, -12.9], [-16.5, -9.4]], accent);
    box(9, -5, 19, 1.6, m4); box(9, -3.4, 19, 0.9, m1); box(27, -5.5, 2, 2.6, m5);
    for (const x of [13, 18, 23]) box(x, -5.4, 1, 3, m0);
    box(11, -0.7, 15, 1.4, visor);
    poly([[12, 0], [10, -3], [-5, -5.2], [-15, -6.5], [-18, -3.5], [-18, 0]], m3);
    poly([[9, 0], [7, -1.7], [-14, -2.5], [-15, 0]], m4);
    line(-2, -4.8, -2, -2.1, m1); line(-15, 0, 8, 0, m5);
    disc(-9, 0, 2.8, m0); disc(-9, 0, 1.6, visor);
    cockpit(2, 1.4, 5); poly([[4, -3.9], [-3, -4.9], [-3, -3.4], [4, -2.6]], accent);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  snap(ctx, [m0, m1, m2, m3, m4, m5, accent, accentDark, visor, flame, core], OUTLINE);
  return canvas;
}

// ---------- Ship modules ----------

/** Removes anti-aliasing from a drawn module icon: hard alpha and stepped colour channels. */
export function crispModule(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')!, image = ctx.getImageData(0, 0, canvas.width, canvas.height), data = image.data, step = 24;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 120) { data[i + 3] = 0; continue; }
    for (let c = 0; c < 3; c++) data[i + c] = Math.min(255, Math.round(data[i + c] / step) * step);
    data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}

/**
 * Returns a repainted copy of a baked module icon. Only neutral hull metal (low saturation) moves toward the
 * paint colour, scaled by brightness, so outlines, lenses, barrels' coloured cores and glows keep their look.
 */
export function paintHull(source: HTMLCanvasElement, color: number, strength: number) {
  const out = document.createElement('canvas'); out.width = source.width; out.height = source.height;
  const ctx = out.getContext('2d')!; ctx.drawImage(source, 0, 0);
  const image = ctx.getImageData(0, 0, out.width, out.height), data = image.data, paint = [(color >> 16) & 255, (color >> 8) & 255, color & 255];
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2], hi = Math.max(r, g, b), lo = Math.min(r, g, b);
    if (hi - lo > 60 || hi < 30) continue;
    const light = (r + g + b) / 3 / 255, t = strength * Math.min(1, light * 2.2);
    // Keep the original shading: the paint is scaled to the pixel's brightness before blending.
    for (let c = 0; c < 3; c++) data[i + c] = Math.round(data[i + c] * (1 - t) + Math.min(255, paint[c] * (0.35 + light * 1.25)) * t);
  }
  ctx.putImageData(image, 0, 0); return out;
}

// ---------- Player outposts (space steampunk: riveted steel, brass framing, copper pipes) ----------

const STEEL = [0x14181f, 0x232a34, 0x343d4a, 0x4a5565, 0x6a7688], BRASS = [0x5c4318, 0x94702a, 0xd9a441, 0xf2d489], COPPER = [0x7a4324, 0xb87333, 0xe09a5c];
/** Station hull greys, darkest to lightest, plus window and indicator lights. */
const HULL = [0x0d1117, 0x1b222c, 0x2b3440, 0x404b59, 0x5c6979, 0x8492a2, 0xb8c4cf], WARM = 0xffd27a, WARM_HI = 0xfff0c0, COOL = 0x9fe6ff;
const CRATES = [0xb2543b, 0x3f6f9e, 0xc89b3c, 0x5f7f4a, 0x8a6ab0, 0x8492a2];
/** How strongly a direction faces the upper-left light: positive is lit. */
const litBy = (dx: number, dy: number) => (dx * LIGHT.x + dy * LIGHT.y) / Math.max(0.001, Math.hypot(dx, dy));

/** Drawing helpers for one module whose top-left corner is (ox, oy). `rot` turns rectangles in an S-pixel square by quarter turns. */
function station(ctx: Ctx, ox: number, oy: number, S = OUTPOST.cell, rot = 0) {
  const px = (x: number, y: number, color: number, w = 1, h = 1) => dot(ctx, ox + x, oy + y, color, w, h);
  const rp = (x: number, y: number, color: number, w = 1, h = 1) => {
    const r = ((rot % 4) + 4) % 4;
    if (r === 1) px(S - (y + h), x, color, h, w); else if (r === 2) px(S - (x + w), S - (y + h), color, w, h); else if (r === 3) px(y, S - (x + w), color, h, w); else px(x, y, color, w, h);
  };
  /** Any filled shape with a dark rim: `inside` tests a pixel, `fill` colours the interior. */
  const shape = (x0: number, y0: number, w: number, h: number, inside: (i: number, j: number) => boolean, fill: (i: number, j: number) => number) => {
    const at = (i: number, j: number) => i >= 0 && j >= 0 && i < w && j < h && inside(i, j);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (at(i, j)) px(x0 + i, y0 + j, at(i - 1, j) && at(i + 1, j) && at(i, j - 1) && at(i, j + 1) ? fill(i, j) : OUTLINE);
  };
  /** Raised plate: dark rim, lit top/left edge, shaded bottom/right edge. */
  const panel = (x: number, y: number, w: number, h: number, tone = 3) => {
    px(x, y, OUTLINE, w, h); px(x + 1, y + 1, HULL[tone], w - 2, h - 2);
    px(x + 1, y + 1, HULL[tone + 1], w - 2, 1); px(x + 1, y + 1, HULL[tone + 1], 1, h - 2); px(x + 1, y + h - 2, HULL[tone - 1], w - 2, 1); px(x + w - 2, y + 1, HULL[tone - 1], 1, h - 2);
  };
  /** Octagonal plate with corners cut by `cut` pixels. */
  const octagon = (x: number, y: number, s: number, cut: number, tone = 3) => shape(x, y, s, s, (i, j) => i + j >= cut && s - 1 - i + j >= cut && i + s - 1 - j >= cut && 2 * (s - 1) - i - j >= cut,
    (i, j) => { const t = (i + j) / (2 * s); return HULL[t < 0.3 ? tone + 1 : t > 0.72 ? tone - 1 : tone]; });
  /** Disc centred on (cx, cy) in pixel-corner coordinates; `fill` gets the offset and distance of each pixel centre. */
  const disc = (cx: number, cy: number, r: number, fill: (dx: number, dy: number, d: number) => number | undefined) => {
    for (let y = Math.floor(-r); y < r; y++) for (let x = Math.floor(-r); x < r; x++) { const dx = x + 0.5, dy = y + 0.5, d = Math.hypot(dx, dy); if (d < r) { const c = fill(dx, dy, d); if (c !== undefined) px(cx + x, cy + y, c); } }
  };
  return { px, rp, shape, panel, octagon, disc };
}

/** Riveted hull plating. Plates run flush into every joined neighbour so walls read as one continuous hull. */
function paintWall(ctx: Ctx, x: number, y: number, mask: number, reinforced: boolean, id: number) {
  const { px } = station(ctx, x, y), S = OUTPOST.cell, t = reinforced ? 2 : 3, random = seeded(id * 13 + 5);
  px(0, 0, HULL[t], S, S);
  if (!(mask & 8)) { px(0, 0, HULL[t + 2], S, 1); px(0, 1, HULL[t + 1], S, 1); }
  if (!(mask & 4)) { px(0, 0, HULL[t + 2], 1, S); px(1, 1, HULL[t + 1], 1, S - 1); }
  if (!(mask & 2)) { px(0, S - 2, HULL[t - 1], S, 1); px(0, S - 1, HULL[Math.max(0, t - 2)], S, 1); }
  if (!(mask & 1)) { px(S - 2, 0, HULL[t - 1], 1, S); px(S - 1, 0, HULL[Math.max(0, t - 2)], 1, S); }
  // Panel seams: a shaded groove with a lit lip, alternating direction from block to block.
  if (random() < 0.5) { px(7, 2, HULL[t - 1], 1, S - 4); px(8, 2, HULL[t + 1], 1, S - 4); } else { px(2, 7, HULL[t - 1], S - 4, 1); px(2, 8, HULL[t + 1], S - 4, 1); }
  for (const [rx, ry] of [[3, 3], [12, 3], [3, 12], [12, 12]]) px(rx, ry, HULL[t + 2]);
  if (reinforced) {
    // Armour ribs and amber hazard corners.
    for (let ry = 4; ry < S - 4; ry += 3) { px(4, ry, HULL[t + 2], S - 8, 1); px(4, ry + 1, HULL[0], S - 8, 1); }
    px(2, 2, 0xd9a441, 2, 1); px(2, 2, 0xd9a441, 1, 2); px(S - 4, S - 3, 0xd9a441, 2, 1); px(S - 3, S - 4, 0xd9a441, 1, 2);
  } else {
    // A strip of cabin windows on some plates, and a small hull greeble on others.
    if (random() < 0.45) { const wy = 4 + Math.floor(random() * 8); for (let k = 0; k < 3; k++) px(4 + k * 3, wy, random() < 0.2 ? 0x3a2c12 : WARM, 2, 1); }
    if (random() < 0.5) { const gx = 3 + Math.floor(random() * 9), gy = 3 + Math.floor(random() * 9); px(gx, gy, HULL[t + 2], 2, 2); px(gx + 2, gy, HULL[t - 1], 1, 2); px(gx, gy + 2, HULL[t - 1], 3, 1); }
  }
}

/** Paints one finished station module of `n` x `n` cells with its top-left corner at (x, y). */
function paintModule(ctx: Ctx, x: number, y: number, m: StationModule) {
  const S = OUTPOST.cell * m.size, c = S / 2, accent = STRUCTURES[m.kind].color, random = seeded(m.id * 7 + 3);
  const { px, rp, shape, panel, octagon, disc } = station(ctx, x, y, S, m.rot);
  const glow = (r: number, hot: number, warm: number) => (_dx: number, _dy: number, d: number) => d < r * 0.45 ? WARM_HI : d < r * 0.75 ? hot : warm;
  const windows = (x0: number, y0: number, count: number, step: number, vertical = false) => { for (let k = 0; k < count; k++) px(x0 + (vertical ? 0 : k * step), y0 + (vertical ? k * step : 0), random() < 0.2 ? 0x3a2c12 : WARM); };
  switch (m.kind) {
    case 'warpFrame': {
      panel(1,1,S-2,S-2,3);px(3,3,0x173743,S-6,S-6);px(3,3,0xaff7ff,S-6,2);px(3,5,0x4abcca,2,S-8);px(S-5,5,0x176079,2,S-8);px(5,S-5,0x268b9c,S-10,2);px(2,2,0xe2bc66);break;
    }
    case 'warpController': {
      octagon(0,0,S,3,4);px(3,3,0x062430,S-6,S-6);px(4,4,0x6ce5f4,S-8,2);px(5,7,0x2195ad,S-10,3);px(4,S-5,0xe1be64,2,1);px(S-6,S-5,0x94ffcc,2,1);break;
    }
    case 'outpostCore': {
      // Command hub: octagonal hull, a ring of lit cabin windows, and a glowing command dome.
      octagon(0, 0, S, 4, 4);
      for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4 + Math.PI / 8; px(Math.floor(c + Math.cos(a) * 5.4), Math.floor(c + Math.sin(a) * 5.4), WARM); }
      disc(c, c, 3.6, (dx, dy, d) => d > 2.8 ? OUTLINE : d < 1.3 ? WARM_HI : litBy(dx, dy) > 0.3 ? 0xffe9a8 : 0xffb347);
      break;
    }
    case 'autocannonTurret': case 'missileTurret': case 'railgunTurret': {
      // Gun bastion: an armoured octagon round a bearing ring; the turning head is a separate sprite.
      octagon(0, 0, S, 4, 3);
      disc(c, c, 6.4, (dx, dy, d) => d < 4.6 ? HULL[0] : d < 5.4 ? (litBy(dx, dy) > 0 ? mix(accent, 0xffffff, 0.35) : mix(accent, 0x000000, 0.5)) : OUTLINE);
      break;
    }
    case 'reactor': {
      // Fusion torus: a lit ring round a white-hot core, coolant spokes, and radiator fins on larger cores.
      panel(1, 1, S - 2, S - 2, 2);
      const fin = Math.round(S * 0.22);
      if (m.size > 1) for (const [fx, fy] of [[3, 3], [S - 3 - fin, 3], [3, S - 3 - fin], [S - 3 - fin, S - 3 - fin]]) for (let k = 0; k < fin; k += 2) px(fx, fy + k, 0xc9d3dc, fin, 1);
      const R = S / 2 - (m.size > 1 ? 3 : 1);
      disc(c, c, R, (dx, dy, d) => {
        if (d > R - 1) return OUTLINE;
        if (d > R * 0.7) return litBy(dx, dy) > 0.25 ? HULL[6] : litBy(dx, dy) > -0.4 ? HULL[4] : HULL[2];
        if (d > R * 0.55) return Math.abs(dx) < 1 || Math.abs(dy) < 1 ? HULL[4] : HULL[0];
        return glow(R * 0.55, accent, 0xffb347)(dx, dy, d);
      });
      break;
    }
    case 'shieldGenerator': {
      // Emitter dish in concentric cyan rings, with a projector pylon at each corner.
      panel(1, 1, S - 2, S - 2, 3);
      const pylon = Math.max(3, Math.round(S / 6));
      for (const [gx, gy] of [[2, 2], [S - 2 - pylon, 2], [2, S - 2 - pylon], [S - 2 - pylon, S - 2 - pylon]]) { px(gx, gy, OUTLINE, pylon, pylon); px(gx + 1, gy + 1, accent, pylon - 2, pylon - 2); px(gx + 1, gy + 1, 0xdff8ff); }
      const R = S * 0.34;
      disc(c, c, R, (dx, dy, d) => d > R - 1 ? OUTLINE : d < R * 0.3 ? 0xdff8ff : Math.floor(d) % 2 === 0 ? (litBy(dx, dy) > 0 ? mix(accent, 0xffffff, 0.3) : accent) : 0x1b4a5c);
      break;
    }
    case 'coolingUnit': {
      // Radiator array: pale fin rows either side of a fan well (the blades turn live).
      panel(1, 1, S - 2, S - 2, 2);
      for (let fy = 3; fy < S - 3; fy += 2) { px(3, fy, 0xbfdbe8, S - 6, 1); px(Math.round(S * 0.62), fy, 0x7f9fb0, S - 3 - Math.round(S * 0.62), 1); }
      disc(c, c, Math.max(3.4, S * 0.22), (_dx, _dy, d) => d > Math.max(3.4, S * 0.22) - 1 ? OUTLINE : 0x16323c);
      px(c - 1, c - 1, COOL, 2, 2);
      break;
    }
    case 'droneRepairBay': {
      // Service pad: octagonal deck, green-lit landing ring and a clamp arm either side.
      octagon(0, 0, S, Math.round(S * 0.25), 2);
      const R = S * 0.3;
      disc(c, c, R, (dx, dy, d) => d > R - 1 ? (litBy(dx, dy) > 0 ? 0xbff0b8 : 0x5f9a5a) : d < 1.5 ? 0xdfffe9 : 0x12261a);
      panel(2, c - 3, 4, 6, 4); panel(S - 6, c - 3, 4, 6, 4);
      break;
    }
    case 'upgradeStation': {
      // Fabricator: a dark work bay under a violet focusing crystal, with gantry arms above and an anvil below.
      panel(1, 1, S - 2, S - 2, 3); px(3, 3, HULL[1], S - 6, S - 6);
      px(c - 1, 3, HULL[5], 2, Math.round(S * 0.18)); px(4, S - 5, HULL[5], S - 8, 2); px(4, S - 4, HULL[2], S - 8, 1);
      const hw = Math.max(2.5, S * 0.18), hh = Math.max(4, S * 0.3);
      shape(Math.round(c - hw), Math.round(c - hh), Math.round(hw * 2), Math.round(hh * 2), (i, j) => Math.abs(i + 0.5 - hw) / hw + Math.abs(j + 0.5 - hh) / hh <= 1.05,
        (i, j) => i + 0.5 < hw && j + 0.5 < hh ? 0xf0e4ff : i + 0.5 < hw || j + 0.5 < hh ? accent : 0x7d5fa0);
      break;
    }
    case 'repairStation': {
      // Medical-white module with a teal cross and a folded manipulator arm.
      panel(1, 1, S - 2, S - 2, 5);
      const t = Math.max(2, Math.round(S / 8)), L = Math.round(S * 0.5);
      px(c - L / 2 - 1, c - L / 2 - 1, 0x12322c, L + 2, L + 2); px(c - t / 2, c - L / 2, accent, t, L); px(c - L / 2, c - t / 2, accent, L, t); px(c - 1, c - 1, 0xe6fff6, 2, 2);
      for (let k = 0; k < Math.round(S * 0.2); k++) px(3 + k, S - 4 - k, HULL[2]);
      break;
    }
    case 'radarTower': {
      // Lattice mast holding a concave dish (shaded where the rim hides the light); the sweep line is drawn live.
      panel(1, 1, S - 2, S - 2, 2);
      for (let k = 3; k < S - 3; k++) { px(k, k, HULL[4]); px(S - 1 - k, k, HULL[4]); }
      const R = S * 0.38;
      disc(c, c, R, (dx, dy, d) => d > R - 1 ? OUTLINE : d > R - 2 ? (litBy(dx, dy) > 0 ? HULL[6] : HULL[3]) : d < 1.3 ? 0xe8f6ff : litBy(dx, dy) > 0 ? 0x4f6f88 : 0x9fb8cc);
      break;
    }
    case 'droneHangar': {
      // Hangar: roofed cabin section, an open dark launch bay with rails, and a hazard-striped lip.
      panel(1, 1, S - 2, S - 2, 3);
      const bay = Math.round(S * 0.38);
      rp(bay, 3, HULL[0], S - bay - 2, S - 6); rp(bay - 1, 2, HULL[5], 1, S - 4);
      rp(bay + 2, Math.round(c - 3), HULL[3], S - bay - 5, 1); rp(bay + 2, Math.round(c + 2), HULL[3], S - bay - 5, 1);
      for (let k = 3; k < S - 3; k++) rp(S - 2, k, k % 4 < 2 ? 0xd9a441 : OUTLINE);
      for (let k = 0; k < m.size * 2; k++) rp(bay + 2 + k * 3, Math.round(c), 0x8fd08a);
      for (let k = 4; k < S - 4; k += 3) rp(3, k, random() < 0.2 ? 0x3a2c12 : WARM);
      break;
    }
    case 'dockingStation': {
      // Docking port: a lit landing pad with guide lights and an extended collar on the open side.
      panel(1, 1, S - 2, S - 2, 3);
      px(3, 3, 0x16323c, S - 7, S - 6);
      for (const [gx, gy] of [[4, 4], [S - 6, 4], [4, S - 5], [S - 6, S - 5]]) px(gx, gy, accent);
      px(c - 1, 5, 0xbfeaff, 2, S - 10); px(5, c - 1, 0xbfeaff, S - 11, 2);
      rp(S - 4, Math.round(c - 3), HULL[5], 3, 6); rp(S - 3, Math.round(c - 2), HULL[0], 2, 4); rp(S - 4, Math.round(c - 4), COOL); rp(S - 4, Math.round(c + 3), COOL);
      break;
    }
    case 'storage': {
      // Cargo frame stacked with ribbed shipping containers in assorted colours.
      panel(1, 1, S - 2, S - 2, 2);
      const rows = Math.max(2, Math.floor((S - 4) / 6)), h = Math.floor((S - 4) / rows), cols = m.size > 1 ? 2 : 1, w = Math.floor((S - 4) / cols);
      for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
        const bx = 2 + k * w, by = 2 + r * h, tint = CRATES[Math.floor(random() * CRATES.length)];
        px(bx, by, OUTLINE, w, h); px(bx + 1, by + 1, tint, w - 2, h - 2); px(bx + 1, by + 1, mix(tint, 0xffffff, 0.35), w - 2, 1); px(bx + 1, by + h - 2, mix(tint, 0x000000, 0.4), w - 2, 1);
        for (let rx = bx + 3; rx < bx + w - 2; rx += 2) px(rx, by + 2, mix(tint, 0x000000, 0.22), 1, h - 4);
      }
      break;
    }
    default: panel(1, 1, S - 2, S - 2, 3);
  }
  if (m.size > 1 && m.kind !== 'storage' && m.kind !== 'droneHangar') windows(Math.round(S * 0.3), 2, m.size * 2, 3);
  // Level pips along the lower edge (levels 2-5).
  for (let i = 1; i < m.level; i++) px(3 + (i - 1) * 3, S - 3, m.level >= 5 ? 0xffe9a8 : 0x9fd8ff, 2, 1);
}

/** Corridor tube between the centres of two joined cells: dark walls, lit upper edge, and a lit window at the seam. */
function paintCorridor(ctx: Ctx, x: number, y: number, horizontal: boolean) {
  const { px } = station(ctx, x, y), S = OUTPOST.cell, h = S / 2;
  if (horizontal) { px(h, h - 3, OUTLINE, S, 6); px(h, h - 2, HULL[4], S, 1); px(h, h - 1, HULL[3], S, 2); px(h, h + 1, HULL[2], S, 1); px(S - 1, h - 1, WARM, 2, 1); }
  else { px(h - 3, h, OUTLINE, 6, S); px(h - 2, h, HULL[4], 1, S); px(h - 1, h, HULL[3], 2, S); px(h + 1, h, HULL[2], 1, S); px(h - 1, S - 1, WARM, 1, 2); }
}

/** Unfinished block: dark footing, dashed amber outline and diagonal bracing. */
function paintScaffold(ctx: Ctx, x: number, y: number) {
  const { px } = station(ctx, x, y), size = OUTPOST.cell;
  px(0, 0, STEEL[0], size, size);
  for (let i = 0; i < size; i += 2) { px(i, 0, BRASS[1]); px(i, size - 1, BRASS[1]); px(0, i, BRASS[1]); px(size - 1, i, BRASS[1]); }
  for (let i = 2; i < size - 2; i += 3) { px(i, i, BRASS[0]); px(size - 1 - i, i, BRASS[0]); }
}

/** Cracks and scorch marks for one damaged cell. */
function paintWear(ctx: Ctx, x: number, y: number, damage: number, id: number) {
  const { px } = station(ctx, x, y), random = seeded(id * 31 + 7);
  for (let i = 0; i < damage * 4; i++) { const cx = 2 + Math.floor(random() * 12), cy = 2 + Math.floor(random() * 12); px(cx, cy, OUTLINE); px(cx + (random() < 0.5 ? 1 : 0), cy + 1, OUTLINE); if (damage >= 3 && i % 4 === 0) px(cx, cy, 0xff7a3c); }
}

/**
 * Bakes a whole outpost into one canvas as a space station: corridors join neighbouring blocks, walls
 * become continuous hull, and squares of the same block kind become one large module. Redrawn only when
 * the outpost's revision changes. Returns the canvas and the world position of its top-left corner.
 */
export function paintOutpost(outpost: Outpost) {
  const b = bounds(outpost), size = OUTPOST.cell, pad = 1, canvas = canvasOf((b.maxX - b.minX + 1) * size + pad * 2, (b.maxY - b.minY + 1) * size + pad * 2), ctx = canvas.getContext('2d')!;
  const at = (s: { cx: number; cy: number }) => [pad + (s.cx - b.minX) * size, pad + (s.cy - b.minY) * size] as const;
  const built = new Map(outpost.structures.filter(s => s.progress >= 1).map(s => [`${s.cx},${s.cy}`, s]));
  // Corridors first, so modules sit on top and the tubes show in the gaps between them.
  for (const s of built.values()) {
    const [x, y] = at(s);
    if (built.has(`${s.cx + 1},${s.cy}`)) paintCorridor(ctx, x, y, true);
    if (built.has(`${s.cx},${s.cy + 1}`)) paintCorridor(ctx, x, y, false);
  }
  for (const m of stationLayout(outpost).modules) {
    const s = outpost.structures.find(t => t.id === m.id)!, [x, y] = at(m);
    if (s.progress < 1) paintScaffold(ctx, x, y);
    else if (m.kind === 'wall' || m.kind === 'reinforcedWall') paintWall(ctx, x, y, neighbourMask(outpost, s), m.kind === 'reinforcedWall', s.id);
    else paintModule(ctx, x, y, m);
  }
  for (const s of outpost.structures) { const damage = wear(s); if (damage && s.progress >= 1) { const [x, y] = at(s); paintWear(ctx, x, y, damage, s.id); } }
  // One-pixel dark outline around the joined silhouette.
  const { width, height } = canvas, image = ctx.getImageData(0, 0, width, height), data = image.data, solid = new Uint8Array(width * height);
  for (let i = 0; i < solid.length; i++) solid[i] = data[i * 4 + 3] ? 1 : 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (solid[i] || !((x > 0 && solid[i - 1]) || (x < width - 1 && solid[i + 1]) || (y > 0 && solid[i - width]) || (y < height - 1 && solid[i + width]))) continue;
    data[i * 4] = channel(OUTLINE, 16); data[i * 4 + 1] = channel(OUTLINE, 8); data[i * 4 + 2] = channel(OUTLINE, 0); data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return { canvas, x: b.minX * size - pad, y: b.minY * size - pad };
}
/** A single finished block with no neighbours, for the build catalogue and placement preview. */
export function paintStructureIcon(kind: StructureKind) {
  const canvas = canvasOf(OUTPOST.cell), ctx = canvas.getContext('2d')!;
  if (kind === 'wall' || kind === 'reinforcedWall') paintWall(ctx, 0, 0, 0, kind === 'reinforcedWall', 1);
  else paintModule(ctx, 0, 0, { kind, cx: 0, cy: 0, size: 1, level: 1, rot: 0, id: 1 });
  if (STRUCTURES[kind].turret) { const head = paintTurretHead(kind); ctx.drawImage(head, (OUTPOST.cell - head.width) / 2, (OUTPOST.cell - head.height) / 2); }
  return canvas;
}
/** A mining drone, nose along +x: brass hull, copper thruster and a green mining lens. */
export function paintDrone() {
  const size = 14, c = size / 2, canvas = canvasOf(size), ctx = canvas.getContext('2d')!, px = (x: number, y: number, color: number, w = 1, h = 1) => dot(ctx, c + x, c + y, color, w, h);
  px(-5, -3, OUTLINE, 10, 6); px(-4, -2, BRASS[1], 8, 4); px(-4, -2, BRASS[3], 8, 1); px(-4, 1, BRASS[0], 8, 1);
  px(-6, -1, OUTLINE, 2, 2); px(-6, -1, COPPER[2], 1, 2); px(3, -1, OUTLINE, 3, 2); px(4, -1, 0x9dffb0, 2, 2); px(-1, -4, STEEL[3], 2, 1); px(-1, 3, STEEL[3], 2, 1); px(-2, -1, STEEL[0], 3, 2);
  return canvas;
}
/** The rotating head of a turret, barrels along +x. Drawn over the baked mount and turned toward its target. */
export function paintTurretHead(kind: StructureKind) {
  const size = 30, c = size / 2, canvas = canvasOf(size), ctx = canvas.getContext('2d')!, px = (x: number, y: number, color: number, w = 1, h = 1) => dot(ctx, c + x, c + y, color, w, h);
  const hub = (r: number, light: number, dark: number) => { for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) { const d = Math.hypot(x + 0.5, y + 0.5); if (d < r - 1) px(x, y, x + y < 0 ? light : dark); else if (d < r) px(x, y, OUTLINE); } };
  if (kind === 'autocannonTurret') {
    for (const y of [-3, 1]) { px(1, y - 1, OUTLINE, 11, 4); px(1, y, STEEL[4], 10, 2); px(1, y, STEEL[3], 10, 1); px(10, y, BRASS[3], 1, 2); }
    hub(5, BRASS[2], BRASS[0]); px(-1, -1, COPPER[2], 2, 2);
  } else if (kind === 'missileTurret') {
    px(-4, -6, OUTLINE, 13, 12); px(-3, -5, STEEL[3], 11, 10); px(-3, -5, STEEL[4], 11, 1); px(-3, 4, STEEL[1], 11, 1);
    for (const y of [-4, 1]) for (const x of [1, 5]) { px(x, y, OUTLINE, 3, 3); px(x + 1, y + 1, 0xff9766); }
    px(-3, -1, BRASS[2], 3, 2);
  } else {
    for (const y of [-3, 2]) { px(0, y - 1, OUTLINE, 14, 3); px(0, y, STEEL[4], 13, 1); px(12, y, 0xd8f2ff); }
    px(2, -1, 0x7fd0ff, 9, 2); hub(5, STEEL[4], STEEL[2]); px(-2, -2, BRASS[2], 4, 4); px(-1, -1, 0xd8f2ff, 2, 2);
  }
  return canvas;
}
