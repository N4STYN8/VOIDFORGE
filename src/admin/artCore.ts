import { css } from '../sprites.ts';
import { FLEET } from '../data.ts';

/** Paint index as the game understands it; anything a client sends that is not a real paint draws as the default. */
export const normalPaint = (paint: number) => Number.isInteger(paint) && paint >= 0 && FLEET.paints[paint] ? paint : 0;

/**
 * DOM-free pieces of the admin's art layer (testable in Node): a small LRU cache, and a Canvas 2D stand-in
 * for the subset of Phaser's Graphics that the game's module painter (`drawModule` in src/visuals.ts) uses, so
 * the admin page draws ship modules with the game's own code and no game engine.
 */
export class Lru<K, V> {
  private map = new Map<K, V>();
  private max: number;
  private weigh?: (v: V) => number;
  private maxWeight: number;
  private weight = 0;
  /** At most `max` entries and, when `weigh` is given, at most `maxWeight` total weight (for example canvas pixels). */
  constructor(max: number, weigh?: (v: V) => number, maxWeight = Infinity) { this.max = max; this.weigh = weigh; this.maxWeight = maxWeight; }
  get(key: K) { const v = this.map.get(key); if (v !== undefined) { this.map.delete(key); this.map.set(key, v); } return v; }
  set(key: K, value: V) {
    this.drop(key); this.map.set(key, value); this.weight += this.weigh?.(value) ?? 0;
    while (this.map.size > 1 && (this.map.size > this.max || this.weight > this.maxWeight)) this.drop(this.map.keys().next().value!);
    return value;
  }
  private drop(key: K) { if (!this.map.has(key)) return; this.weight -= this.weigh?.(this.map.get(key)!) ?? 0; this.map.delete(key); }
  get size() { return this.map.size; }
}

type Point = { x: number; y: number };
export class CanvasGraphics {
  private ctx: CanvasRenderingContext2D;
  private fill = 'rgba(0,0,0,1)';
  private stroke = 'rgba(0,0,0,1)';
  private width = 1;
  constructor(ctx: CanvasRenderingContext2D) { this.ctx = ctx; }
  fillStyle(color: number, alpha = 1) { this.fill = css(color, alpha); return this; }
  lineStyle(width: number, color: number, alpha = 1) { this.width = width; this.stroke = css(color, alpha); return this; }
  private doFill() { this.ctx.fillStyle = this.fill; this.ctx.fill(); }
  private doStroke() { this.ctx.strokeStyle = this.stroke; this.ctx.lineWidth = this.width; this.ctx.stroke(); }
  lineBetween(x1: number, y1: number, x2: number, y2: number) { const c = this.ctx; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); this.doStroke(); return this; }
  fillCircle(x: number, y: number, r: number) { const c = this.ctx; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); this.doFill(); return this; }
  strokeCircle(x: number, y: number, r: number) { const c = this.ctx; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); this.doStroke(); return this; }
  fillTriangle(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) { const c = this.ctx; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.lineTo(x3, y3); c.closePath(); this.doFill(); return this; }
  private path(points: Point[], close: boolean) { const c = this.ctx; c.beginPath(); points.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)); if (close) c.closePath(); }
  fillPoints(points: Point[], close = true) { this.path(points, close); this.doFill(); return this; }
  strokePoints(points: Point[], close = false) { this.path(points, close); this.doStroke(); return this; }
  fillRect(x: number, y: number, w: number, h: number) { const c = this.ctx; c.beginPath(); c.rect(x, y, w, h); this.doFill(); return this; }
  fillRoundedRect(x: number, y: number, w: number, h: number, r = 2) {
    const c = this.ctx, k = Math.max(0, Math.min(r, w / 2, h / 2));
    c.beginPath(); c.moveTo(x + k, y); c.lineTo(x + w - k, y); c.arcTo(x + w, y, x + w, y + k, k); c.lineTo(x + w, y + h - k); c.arcTo(x + w, y + h, x + w - k, y + h, k);
    c.lineTo(x + k, y + h); c.arcTo(x, y + h, x, y + h - k, k); c.lineTo(x, y + k); c.arcTo(x, y, x + k, y, k); c.closePath(); this.doFill(); return this;
  }
  save() { this.ctx.save(); return this; }
  restore() { this.ctx.restore(); return this; }
  translateCanvas(x: number, y: number) { this.ctx.translate(x, y); return this; }
  rotateCanvas(angle: number) { this.ctx.rotate(angle); return this; }
}
