import { FLEET, MODULES, equipment, type EnemyKind, type EquipmentKind } from '../data.ts';
import { drawModule } from '../visuals.ts';
import { paintAsteroid, paintBackdrop, paintEnemy, paintStation, crispModule, paintHull, ASTEROID_SPRITE } from '../sprites.ts';
import { bakeShipImage, type ShipArtBlock } from '../shipImage.ts';
import { ensureAsteroidGeometry, type Asteroid } from '../mining.ts';
import { hashSeed } from '../world.ts';
import type { ShipBlock } from '../netProtocol.ts';
import { CanvasGraphics, Lru, normalPaint } from './artCore.ts';

/**
 * The game's own pixel art for the admin map, baked once and cached: module icons (through the Canvas
 * Graphics adapter), whole ship images in their paint (the game's `bakeShipImage`), enemy and station sprites,
 * per-sector backdrops and per-rock asteroid sprites. Everything is one texel per world unit, like the game.
 */
const canvas = (w: number, h = w) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const known = (kind: string): kind is EquipmentKind => kind === 'core' || kind in MODULES;

const icons = new Map<string, HTMLCanvasElement>();
/** A 48x48 module texture facing north, as the game bakes `icon-<kind>-<level>`, optionally in a hull paint. */
export function moduleIcon(kind: EquipmentKind, level: number, rawPaint = 0) {
  const paint = normalPaint(rawPaint), lv = Math.max(1, Math.min(equipment(kind).levels.length, level)), key = `${kind}-${lv}-${paint}`;
  let icon = icons.get(key);
  if (!icon) {
    const base = canvas(48), g = new CanvasGraphics(base.getContext('2d')!);
    drawModule(g as unknown as Parameters<typeof drawModule>[0], 24, 24, -Math.PI / 2, kind as never, equipment(kind).color, lv);
    crispModule(base);
    icon = paint && FLEET.paints[paint] ? paintHull(base, FLEET.paints[paint].color, FLEET.paintStrength) : base;
    icons.set(key, icon);
  }
  return icon;
}

export type ShipArt = { canvas: HTMLCanvasElement; ox: number; oy: number };
/** Ship images by layout and paint, bounded by count and by total pixels (about 64 MB of canvas). */
const ships = new Lru<string, ShipArt | null>(300, art => art ? art.canvas.width * art.canvas.height : 1, 16_000_000);
/** Fresh ship bakes allowed this frame (src/admin/main.ts refills it); the rest draw as icons until their turn. */
export const shipBakes = { left: 6 };
/** The whole ship as the game draws it: forward is +x, origin at the core. Undefined when it cannot be baked. */
export function shipImage(blocks: ShipBlock[], rawPaint = 0): ShipArt | undefined {
  const paint = normalPaint(rawPaint), key = `${paint}|${blocks.map(b => b.join(',')).join(';')}`;
  let art = ships.get(key);
  if (art === undefined) {
    if (shipBakes.left <= 0) return undefined;
    shipBakes.left--;
    const parts: ShipArtBlock[] = blocks.filter(b => known(b[0])).map(([kind, x, y, level]) => ({ kind: kind as EquipmentKind, x, y, level }));
    const baked = parts.length ? bakeShipImage(parts, b => moduleIcon(b.kind, b.level, paint), 16) : null;
    art = ships.set(key, baked ? { canvas: baked.canvas, ox: baked.offsetX, oy: baked.offsetY } : null);
  }
  return art ?? undefined;
}

const enemies = new Map<string, HTMLCanvasElement>();
export function enemySprite(kind: EnemyKind) { let c = enemies.get(kind); if (!c) enemies.set(kind, c = paintEnemy(kind)); return c; }
const stations: Partial<Record<'on' | 'off', HTMLCanvasElement>> = {};
export function stationSprite(on: boolean) { const k = on ? 'on' : 'off'; return stations[k] ??= paintStation(on); }

export type Backdrop = { nebula: HTMLCanvasElement; far: HTMLCanvasElement; near: HTMLCanvasElement };
const backdrops = new Lru<string, Backdrop>(4);
/** The game's three parallax layers for a sector, seeded exactly as the game seeds them. */
export function backdrop(seed: string) { return backdrops.get(seed) ?? backdrops.set(seed, paintBackdrop(hashSeed(seed + ':stars') || 47)); }
/** Parallax factor and texel scale of each layer, as in the game scene. */
export const BACKDROP_LAYERS = [{ key: 'nebula', factor: 0.1, scale: 4 }, { key: 'far', factor: 0.28, scale: 2 }, { key: 'near', factor: 0.55, scale: 2 }] as const;

const rocks = new Lru<string, { revision: number; canvas: HTMLCanvasElement }>(3000);
/** One rock's sprite (ASTEROID_SPRITE.size square, centred), re-baked only when its outline changes and `bake` allows. */
export function rockSprite(seed: string, rock: Asteroid, bake = true) {
  const key = `${seed}|${rock.id}`, shape = ensureAsteroidGeometry(rock), hit = rocks.get(key);
  if (hit && hit.revision === shape.revision) return hit.canvas;
  // Out of this frame's baking budget: keep showing the old picture, or nothing yet.
  if (!bake) return hit?.canvas;
  const c = hit?.canvas ?? canvas(ASTEROID_SPRITE.size * ASTEROID_SPRITE.scale);
  const ctx = c.getContext('2d')!; ctx.clearRect(0, 0, c.width, c.height);
  paintAsteroid(ctx, rock);
  rocks.set(key, { revision: shape.revision, canvas: c });
  return c;
}
export const ROCK_HALF = ASTEROID_SPRITE.size / 2;
