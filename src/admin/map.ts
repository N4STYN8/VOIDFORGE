import { ENEMIES, RESOURCES, WORLD, type EnemyKind, type Resource } from '../data.ts';
import { CHUNK_SIZE } from '../world.ts';
import { sectorLabel, sectorSeed } from '../sectorGrid.ts';
import { ENEMY_SPRITE, STATION_SPRITE } from '../sprites.ts';
import type { Asteroid } from '../mining.ts';
import type { AdminPilot, AdminRoom } from '../adminProtocol.ts';
import type { ShipBlock, WorldRef } from '../netProtocol.ts';
import { chunkRocks, liveFor, specFor } from './sectorView.ts';
import { BACKDROP_LAYERS, ROCK_HALF, backdrop, enemySprite, rockSprite, shipImage, stationSprite } from './art.ts';

/**
 * The admin universe map. Every pilot has their own endless sector grid tied to a home seed, so the universe is
 * drawn as one cluster per home on a stable spiral. Universe units: a sector is 1 x 1 and cells sit GAP apart; a
 * world position maps linearly into its cell, so one camera zooms from the whole universe down to rocks and ship
 * blocks. Zoomed in, sectors are drawn with the game's own pixel art (src/admin/art.ts).
 */
export const GAP = 1.15;
const W = WORLD.width;
export type Place = { home: string; gx: number; gy: number; wx: number; wy: number };
export type Camera = { x: number; y: number; scale: number };
export type Ship = {
  id: string; name: string; seed?: string; world?: WorldRef; x: number; y: number; vx: number; vy: number; angle: number; t: number;
  health: number; maxHealth: number; dead?: boolean; thrust?: boolean; blocks?: ShipBlock[]; paint: number; live: number;
  /** Displayed (smoothed) pose. */ dx: number; dy: number; da: number; shownSeed?: string;
};
type Burst = { x: number; y: number; t: number };
const css = (c: number, a = 1) => `rgba(${c >> 16 & 255},${c >> 8 & 255},${c & 255},${a})`;
const PALETTE = { cyan: '#73c9ee', orange: '#ffb347', grid: 'rgba(115,201,238,', active: 'rgba(255,170,80,', red: '#ff4d5e', gold: '#ffd166' };
/** Detail thresholds in screen pixels per world unit. */
const LOD = { sector: 260, art: 0.03, rocks: 0.02 };

export class UniverseMap {
  cam: Camera = { x: 0, y: 0, scale: 40 };
  homes = new Map<string, { ox: number; oy: number; label: string }>();
  ships = new Map<string, Ship>();
  pilots: AdminPilot[] = [];
  rooms: AdminRoom[] = [];
  followed?: string;
  selectedSeed?: string;
  /** Pilots highlighted in the roster selection. */
  selected = new Set<string>();
  private bursts = new Map<string, Burst[]>();
  private stars = Array.from({ length: 260 }, (_, i) => ({ x: (Math.sin(i * 12.9898) * 43758.5453 % 1 + 1) % 1, y: (Math.sin(i * 78.233) * 12543.1234 % 1 + 1) % 1, b: 0.2 + (i % 7) / 10 }));

  home(seed: string) {
    let h = this.homes.get(seed);
    if (!h) { const i = this.homes.size, r = 14 * Math.sqrt(i), a = i * 2.39996; this.homes.set(seed, h = { ox: Math.cos(a) * r, oy: Math.sin(a) * r, label: seed.slice(0, 10) }); }
    return h;
  }
  universe(home: string, gx: number, gy: number, wx: number, wy: number) { const h = this.home(home); return { x: h.ox + gx * GAP + wx / W, y: h.oy + gy * GAP + wy / W }; }
  toScreen(ux: number, uy: number, w: number, h: number) { return { x: (ux - this.cam.x) * this.cam.scale + w / 2, y: (uy - this.cam.y) * this.cam.scale + h / 2 }; }
  toUniverse(sx: number, sy: number, w: number, h: number) { return { x: (sx - w / 2) / this.cam.scale + this.cam.x, y: (sy - h / 2) / this.cam.scale + this.cam.y }; }
  place(sx: number, sy: number, w: number, h: number): Place | undefined {
    const u = this.toUniverse(sx, sy, w, h);
    let best: Place | undefined, bestD = Infinity;
    for (const [home, o] of this.homes) {
      const gx = Math.floor((u.x - o.ox) / GAP), gy = Math.floor((u.y - o.oy) / GAP);
      const fx = u.x - o.ox - gx * GAP, fy = u.y - o.oy - gy * GAP;
      if (fx > 1 || fy > 1) continue;
      const d = Math.hypot(gx, gy);
      if (d < bestD && d < 30) { bestD = d; best = { home, gx, gy, wx: fx * W, wy: fy * W }; }
    }
    return best;
  }
  worldAt(home: string, gx: number, gy: number): WorldRef {
    const room = this.rooms.find(r => r.world && r.world.home === home && r.world.x === gx && r.world.y === gy);
    return room?.world ?? { home, x: gx, y: gy, seed: sectorSeed(home, gx, gy) };
  }

  setOverview(pilots: AdminPilot[], rooms: AdminRoom[], now: number) {
    this.pilots = pilots; this.rooms = rooms;
    for (const p of pilots) {
      if (p.profile) { const h = this.home(p.profile.home); if (h.label === p.profile.home.slice(0, 10)) h.label = p.name; }
      if (p.world) this.home(p.world.home);
    }
    for (const r of rooms) if (r.world) this.home(r.world.home);
    const ids = new Set(pilots.map(p => p.id));
    for (const id of this.ships.keys()) if (!ids.has(id)) this.ships.delete(id);
    for (const p of pilots) {
      let s = this.ships.get(p.id);
      if (!s) { const at = p.at ?? { x: W / 2, y: W / 2 }; s = { id: p.id, name: p.name, x: at.x, y: at.y, vx: 0, vy: 0, angle: p.angle ?? 0, t: now, health: 1, maxHealth: 1, paint: 0, live: 0, dx: at.x, dy: at.y, da: p.angle ?? 0 }; this.ships.set(p.id, s); }
      s.name = p.name; s.world = p.world; s.seed = p.room;
      if (now - s.live > 1.5) { if (p.at) { s.x = p.at.x; s.y = p.at.y; s.vx = 0; s.vy = 0; s.angle = p.angle ?? s.angle; s.t = now; } s.dead = p.dead; }
    }
  }
  /** A tapped ship state from a watched sector (packed wire form). */
  setState(seed: string, id: string, name: string | undefined, packed: unknown, now: number) {
    const s = this.ships.get(id); if (!s || !Array.isArray(packed)) return;
    const [x, y, vx, vy, angle, health, maxHealth, paint, flags, blocks] = packed as number[];
    const dead = (flags & 1) === 1;
    if (dead && !s.dead) { const list = this.bursts.get(seed) ?? []; list.push({ x, y, t: now }); if (list.length > 16) list.shift(); this.bursts.set(seed, list); }
    Object.assign(s, { x, y, vx, vy, angle, health, maxHealth, paint: paint || 0, t: now, live: now, seed, dead, thrust: (flags & 2) === 2 });
    if (name) s.name = name;
    if (Array.isArray(blocks)) s.blocks = blocks as unknown as ShipBlock[];
  }
  /** Block layout fetched for the drawer (`pilot` reply) when no tapped state carried one yet. */
  setLayout(id: string, blocks: ShipBlock[] | undefined, paint: number | undefined) { const s = this.ships.get(id); if (s && blocks && !s.blocks) { s.blocks = blocks; s.paint = paint ?? s.paint; } }
  shipUniverse(s: Ship) { return s.world ? this.universe(s.world.home, s.world.x, s.world.y, s.dx, s.dy) : undefined; }
  step(now: number, dt: number) {
    for (const s of this.ships.values()) {
      const ahead = Math.min(0.4, Math.max(0, now - s.t)), tx = s.x + s.vx * ahead, ty = s.y + s.vy * ahead;
      if (s.shownSeed !== s.seed || Math.hypot(tx - s.dx, ty - s.dy) > 2500) { s.dx = tx; s.dy = ty; s.da = s.angle; s.shownSeed = s.seed; continue; }
      const k = Math.min(1, dt * 10); s.dx += (tx - s.dx) * k; s.dy += (ty - s.dy) * k;
      let d = s.angle - s.da; d = Math.atan2(Math.sin(d), Math.cos(d)); s.da += d * k;
    }
    const f = this.followed && this.ships.get(this.followed), u = f && this.shipUniverse(f);
    if (u) { this.cam.x += (u.x - this.cam.x) * Math.min(1, dt * 8); this.cam.y += (u.y - this.cam.y) * Math.min(1, dt * 8); }
    for (const [seed, list] of this.bursts) { const keep = list.filter(b => now - b.t < 1); if (keep.length) this.bursts.set(seed, keep); else this.bursts.delete(seed); }
  }
  visibleSeeds(w: number, h: number): string[] {
    if (this.cam.scale < LOD.sector) return [];
    const out: { seed: string; d: number }[] = [];
    for (const r of this.rooms) {
      if (!r.world || !r.members) continue;
      const c = this.universe(r.world.home, r.world.x, r.world.y, W / 2, W / 2), p = this.toScreen(c.x, c.y, w, h), half = this.cam.scale / 2;
      if (p.x + half < 0 || p.x - half > w || p.y + half < 0 || p.y - half > h) continue;
      out.push({ seed: r.seed, d: Math.hypot(p.x - w / 2, p.y - h / 2) });
    }
    return out.sort((a, b) => a.d - b.d).map(o => o.seed);
  }
  shipAt(sx: number, sy: number, w: number, h: number) {
    let best: Ship | undefined, bestD = 16;
    for (const s of this.ships.values()) { const u = this.shipUniverse(s); if (!u) continue; const p = this.toScreen(u.x, u.y, w, h), d = Math.hypot(p.x - sx, p.y - sy); if (d < bestD) { bestD = d; best = s; } }
    return best;
  }
  zoomAt(sx: number, sy: number, w: number, h: number, factor: number) {
    const before = this.toUniverse(sx, sy, w, h);
    this.cam.scale = Math.min(W * 2, Math.max(4, this.cam.scale * factor));
    const after = this.toUniverse(sx, sy, w, h);
    if (!this.followed) { this.cam.x += before.x - after.x; this.cam.y += before.y - after.y; }
  }
  /** Universe camera centred on a pilot at a zoom of `pxPerUnit` screen pixels per world unit (the drawer's mini-map). */
  cameraOn(id: string, pxPerUnit: number): Camera | undefined { const s = this.ships.get(id), u = s && this.shipUniverse(s); return u && { x: u.x, y: u.y, scale: pxPerUnit * W }; }

  /** Draws the map with this camera (or another one, for the drawer's mini-map). */
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, now: number, watched: Set<string>, cam: Camera = this.cam, labels = true) {
    const saved = this.cam; this.cam = cam;
    try { this.paint(ctx, w, h, now, watched, labels); } finally { this.cam = saved; }
  }
  private paint(ctx: CanvasRenderingContext2D, w: number, h: number, now: number, watched: Set<string>, labels: boolean) {
    ctx.imageSmoothingEnabled = false;
    const k = this.cam.scale / W;
    ctx.fillStyle = '#050911'; ctx.fillRect(0, 0, w, h);
    const centre = k > 0.004 ? this.place(w / 2, h / 2, w, h) : undefined;
    if (centre) this.paintBackdrop(ctx, w, h, this.worldAt(centre.home, centre.gx, centre.gy).seed, centre);
    else for (const s of this.stars) { ctx.fillStyle = `rgba(190,210,255,${s.b * 0.55})`; ctx.fillRect(Math.floor(s.x * w), Math.floor(s.y * h), 1, 1); }
    const cells = new Map<string, { home: string; gx: number; gy: number; room?: AdminRoom }>();
    const key = (home: string, gx: number, gy: number) => `${home}|${gx},${gy}`;
    for (const home of this.homes.keys()) cells.set(key(home, 0, 0), { home, gx: 0, gy: 0 });
    for (const r of this.rooms) if (r.world) cells.set(key(r.world.home, r.world.x, r.world.y), { home: r.world.home, gx: r.world.x, gy: r.world.y, room: r });
    for (const p of this.pilots) if (p.world && !cells.has(key(p.world.home, p.world.x, p.world.y))) cells.set(key(p.world.home, p.world.x, p.world.y), { home: p.world.home, gx: p.world.x, gy: p.world.y });
    const ring = new Map<string, { home: string; gx: number; gy: number }>();
    for (const c of cells.values()) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const kk = key(c.home, c.gx + dx, c.gy + dy); if (!cells.has(kk)) ring.set(kk, { home: c.home, gx: c.gx + dx, gy: c.gy + dy }); }
    const cellRect = (home: string, gx: number, gy: number) => { const a = this.universe(home, gx, gy, 0, 0), p = this.toScreen(a.x, a.y, w, h); return { x: p.x, y: p.y, s: this.cam.scale }; };
    const onScreen = (r: { x: number; y: number; s: number }) => r.x + r.s > 0 && r.y + r.s > 0 && r.x < w && r.y < h;
    ctx.lineWidth = 1;
    for (const c of ring.values()) { const r = cellRect(c.home, c.gx, c.gy); if (!onScreen(r)) continue; ctx.strokeStyle = `${PALETTE.grid}0.14)`; ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.s, r.s); }
    for (const c of cells.values()) {
      const r = cellRect(c.home, c.gx, c.gy); if (!onScreen(r)) continue;
      const room = c.room, active = Boolean(room?.members), seed = room?.seed ?? sectorSeed(c.home, c.gx, c.gy);
      if (r.s <= LOD.sector) { ctx.fillStyle = active ? `${PALETTE.active}0.12)` : `${PALETTE.grid}0.05)`; ctx.fillRect(r.x, r.y, r.s, r.s); }
      else this.drawSector(ctx, seed, r, k, w, h, now, watched.has(seed));
      ctx.strokeStyle = room?.locked ? PALETTE.red : watched.has(seed) ? '#4fd8ff' : seed === this.selectedSeed ? PALETTE.gold : active ? `${PALETTE.active}0.75)` : `${PALETTE.grid}0.35)`;
      ctx.lineWidth = room?.locked || watched.has(seed) ? 2 : 1; ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.s, r.s); ctx.lineWidth = 1;
      if (labels && r.s > 40) {
        const linked = room?.world && room.seed !== sectorSeed(c.home, c.gx, c.gy);
        ctx.font = `${Math.min(13, 9 + r.s / 200)}px ui-monospace, Consolas, monospace`; ctx.textBaseline = 'top';
        const text = `${sectorLabel(c.gx, c.gy)}${linked ? ' ↔ linked' : ''}${room?.members ? ` · ${room.members} pilot${room.members === 1 ? '' : 's'}` : ''}${room?.locked ? ' · LOCKED' : ''}`;
        ctx.fillStyle = 'rgba(3,6,12,0.7)'; ctx.fillRect(r.x + 2, r.y + 2, ctx.measureText(text).width + 6, 16);
        ctx.fillStyle = room?.locked ? PALETTE.red : '#9fe4ff'; ctx.fillText(text, r.x + 5, r.y + 4);
      }
    }
    ctx.setLineDash([4, 6]); ctx.strokeStyle = 'rgba(190,120,255,0.5)';
    for (const r of this.rooms) {
      if (!r.world || r.seed === sectorSeed(r.world.home, r.world.x, r.world.y)) continue;
      const target = [...this.homes.keys()].find(home => r.seed === home || r.seed.startsWith(`${home}:sector:`)); if (!target) continue;
      const m = /:sector:(-?\d+),(-?\d+)$/.exec(r.seed), tx = m ? Number(m[1]) : 0, ty = m ? Number(m[2]) : 0;
      const a = this.universe(r.world.home, r.world.x, r.world.y, W / 2, W / 2), b = this.universe(target, tx, ty, W / 2, W / 2);
      const pa = this.toScreen(a.x, a.y, w, h), pb = this.toScreen(b.x, b.y, w, h);
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
    }
    ctx.setLineDash([]);
    if (labels && this.cam.scale < 900) for (const [, o] of this.homes) {
      const p = this.toScreen(o.ox + 0.5, o.oy - 0.12, w, h);
      ctx.fillStyle = PALETTE.orange; ctx.font = '600 12px ui-monospace, Consolas, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(o.label, p.x, p.y); ctx.textAlign = 'left';
    }
    for (const s of this.ships.values()) this.drawShip(ctx, s, k, w, h, now, labels);
  }
  /** The game's three parallax layers for the sector under the screen centre, tiled with nearest-neighbour scaling. */
  private paintBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number, seed: string, at: Place) {
    const layers = backdrop(seed);
    for (const layer of BACKDROP_LAYERS) {
      const image = layers[layer.key], pattern = ctx.createPattern(image, 'repeat'); if (!pattern) continue;
      const scale = layer.scale, ox = -(at.wx * layer.factor) % (image.width * scale), oy = -(at.wy * layer.factor) % (image.height * scale);
      ctx.save(); ctx.translate(ox, oy); ctx.scale(scale, scale); ctx.fillStyle = pattern; ctx.fillRect(-image.width, -image.height, w / scale + image.width * 2, h / scale + image.height * 2); ctx.restore();
    }
  }
  private drawSector(ctx: CanvasRenderingContext2D, seed: string, r: { x: number; y: number; s: number }, k: number, w: number, h: number, now: number, watched: boolean) {
    const spec = specFor(seed); if (!spec) return;
    const at = (x: number, y: number) => ({ x: r.x + x * k, y: r.y + y * k });
    ctx.save(); ctx.beginPath(); ctx.rect(r.x, r.y, r.s, r.s); ctx.clip();
    ctx.fillStyle = 'rgba(5,9,17,0.35)'; ctx.fillRect(r.x, r.y, r.s, r.s);
    if (k < LOD.art) {
      // Far out: where the ore lies.
      for (const c of spec.clusters) { const p = at(c.x, c.y); ctx.fillStyle = css(RESOURCES[c.ore].color, 0.08); ctx.beginPath(); ctx.arc(p.x, p.y, c.radius * k, 0, Math.PI * 2); ctx.fill(); }
      for (const b of spec.belts) { const p = at(b.x, b.y); ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(b.angle); ctx.fillStyle = css(RESOURCES[b.ore].color, 0.07); ctx.fillRect(-b.length * k / 2, -b.width * k / 2, b.length * k, b.width * k); ctx.restore(); }
    }
    const live = liveFor(seed);
    if (k > LOD.rocks) {
      const x0 = Math.max(0, Math.floor(-r.x / k / CHUNK_SIZE)), y0 = Math.max(0, Math.floor(-r.y / k / CHUNK_SIZE));
      const x1 = Math.floor((w - r.x) / k / CHUNK_SIZE), y1 = Math.floor((h - r.y) / k / CHUNK_SIZE), budget = { left: 8 }, bakes = { left: 24 }, drawn = new Set<number>();
      const draw = (rock: Asteroid) => {
        const p = at(rock.x, rock.y), size = ROCK_HALF * k;
        if (p.x + size < 0 || p.y + size < 0 || p.x - size > w || p.y - size > h) return;
        const sprite = k >= LOD.art ? rockSprite(seed, rock, bakes.left-- > 0) : undefined;
        if (sprite) { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(rock.rotation ?? 0); ctx.drawImage(sprite, -ROCK_HALF * k, -ROCK_HALF * k, sprite.width * k, sprite.height * k); ctx.restore(); }
        else this.dot(ctx, p, rock.radius * k, rock.ore);
      };
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) for (const a of chunkRocks(seed, cx, cy, budget) ?? []) {
        drawn.add(a.id);
        const change = live.rocks.get(a.id); if (change?.gone) continue;
        draw(change ? { ...a, ...change, ore: a.ore } as Asteroid : a);
      }
      for (const [id, c] of live.rocks) if (!drawn.has(id) && !c.gone && c.x !== undefined && c.y !== undefined && c.radius) draw({ id, x: c.x, y: c.y, vx: 0, vy: 0, radius: c.radius, ore: 'iron', amount: c.amount ?? 1, health: c.health ?? 1, geometry: c.geometry } as Asteroid);
    }
    spec.bases.forEach((base, i) => {
      const p = at(base.x, base.y);
      if (k >= LOD.art) { const sprite = stationSprite(i === 0), size = STATION_SPRITE.size * k; ctx.drawImage(sprite, p.x - size / 2, p.y - size / 2, size, size); }
      else { ctx.strokeStyle = 'rgba(115,201,238,0.8)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(4, 280 * k), 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1; }
      if (k > 0.004) { ctx.fillStyle = PALETTE.cyan; ctx.font = '11px ui-monospace, Consolas, monospace'; ctx.fillText(base.name, p.x + Math.max(8, 150 * k), p.y + Math.max(6, 150 * k)); }
    });
    if (watched) {
      const ease = Math.min(1, (now - live.enemiesAt) / 0.25);
      for (const e of live.enemies.values()) {
        const [, kind, , , angle, health, maxHealth] = e.row, def = ENEMIES[kind as EnemyKind];
        const p = at(e.px + (e.x - e.px) * ease, e.py + (e.y - e.py) * ease), size = Math.max(4, def.radius * k);
        if (k >= LOD.art) { const sprite = enemySprite(kind as EnemyKind), s = ENEMY_SPRITE.size * k; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(angle); ctx.drawImage(sprite, -s / 2, -s / 2, s, s); ctx.restore(); }
        else {
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(angle); ctx.fillStyle = css(def.color); ctx.strokeStyle = '#140608'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(size, 0); ctx.lineTo(-size * 0.8, size * 0.7); ctx.lineTo(-size * 0.5, 0); ctx.lineTo(-size * 0.8, -size * 0.7); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
        }
        if (size > 7 && health < maxHealth) { ctx.fillStyle = '#300'; ctx.fillRect(p.x - size, p.y - size - 6, size * 2, 3); ctx.fillStyle = '#ff5d6c'; ctx.fillRect(p.x - size, p.y - size - 6, size * 2 * Math.max(0, health / Math.max(1, maxHealth)), 3); }
      }
      ctx.lineCap = 'round';
      for (const s of live.shots) {
        const dt = now - s.t;
        if (s.beam) { const a = at(s.x, s.y), b = at(s.beam.ex, s.beam.ey); ctx.strokeStyle = 'rgba(255,90,90,0.9)'; ctx.lineWidth = Math.max(1, 3 * k * 4); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); continue; }
        const x = s.x + s.vx * dt, y = s.y + s.vy * dt, a = at(x - s.vx * 0.035, y - s.vy * 0.035), b = at(x, y);
        ctx.lineWidth = Math.max(1.5, Math.min(4, 5 * k * 4)); ctx.strokeStyle = s.enemy ? '#ff7a45' : '#fff1a8';
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      ctx.lineCap = 'butt'; ctx.lineWidth = 1;
    }
    for (const b of this.bursts.get(seed) ?? []) {
      const age = now - b.t, p = at(b.x, b.y), radius = Math.max(6, 90 * k) * (0.3 + age * 1.4);
      ctx.strokeStyle = `rgba(255,170,80,${1 - age})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = `rgba(255,220,150,${0.6 * (1 - age)})`; ctx.beginPath(); ctx.arc(p.x, p.y, radius * 0.45, 0, Math.PI * 2); ctx.fill(); ctx.lineWidth = 1;
    }
    ctx.restore();
  }
  private dot(ctx: CanvasRenderingContext2D, p: { x: number; y: number }, radius: number, ore: Resource) {
    const c = RESOURCES[ore].color;
    if (radius < 0.8) { ctx.fillStyle = css(c, 0.6); ctx.fillRect(p.x, p.y, 1, 1); return; }
    ctx.fillStyle = css(((c >> 16 & 255) * 0.45) << 16 | ((c >> 8 & 255) * 0.45) << 8 | (c & 255) * 0.45); ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, Math.PI * 2); ctx.fill();
  }
  private drawShip(ctx: CanvasRenderingContext2D, s: Ship, k: number, w: number, h: number, now: number, labels: boolean) {
    const u = this.shipUniverse(s); if (!u) return;
    const p = this.toScreen(u.x, u.y, w, h);
    if (p.x < -80 || p.y < -80 || p.x > w + 80 || p.y > h + 80) return;
    const followed = s.id === this.followed, picked = this.selected.has(s.id), world = s.world!;
    const screen = (wx: number, wy: number) => { const q = this.universe(world.home, world.x, world.y, wx, wy); return this.toScreen(q.x, q.y, w, h); };
    const look = liveFor(world.seed).looks.get(s.id)?.look;
    if (look && k > 0.004) {
      const beam = (rows: number[][] | undefined, color: string, glow: string) => {
        for (const [dx, dy, tx, ty] of rows ?? []) {
          const a = screen(s.dx + dx, s.dy + dy), b = screen(tx, ty);
          ctx.strokeStyle = glow; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      };
      beam(look.m as number[][] | undefined, '#b8ffe6', 'rgba(90,255,190,0.35)'); beam(look.t as number[][] | undefined, '#ffb8ff', 'rgba(230,80,255,0.35)');
      ctx.lineWidth = 1;
      if (look.s && look.s[0] > 0) { ctx.strokeStyle = `rgba(110,200,255,${0.25 + 0.5 * look.s[0] / Math.max(1, look.s[1])})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(10, 44 * k), 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1; }
    }
    const art = s.blocks && k >= LOD.art ? shipImage(s.blocks, s.paint) : undefined;
    if (art) {
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(s.da); ctx.globalAlpha = s.dead ? 0.35 : 1;
      if (s.thrust && !s.dead) {
        const back = (-art.ox + 6) * k, flicker = 0.75 + 0.25 * Math.sin(now * 40);
        ctx.fillStyle = `rgba(255,170,60,${0.8 * flicker})`; ctx.beginPath(); ctx.moveTo(back, -5 * k); ctx.lineTo(back - 22 * k * flicker, 0); ctx.lineTo(back, 5 * k); ctx.closePath(); ctx.fill();
      }
      ctx.drawImage(art.canvas, -art.ox * k, -art.oy * k, art.canvas.width * k, art.canvas.height * k);
      ctx.restore(); ctx.globalAlpha = 1;
    } else {
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(s.da);
      ctx.fillStyle = s.dead ? '#555' : followed ? PALETTE.gold : picked ? '#ff9f43' : '#5fe0ff'; ctx.strokeStyle = '#05070c'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-6, 5); ctx.lineTo(-3, 0); ctx.lineTo(-6, -5); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
    }
    const ringR = Math.max(14, 60 * k);
    if (followed || picked) { ctx.strokeStyle = followed ? PALETTE.gold : '#ff9f43'; ctx.lineWidth = 1.5; ctx.setLineDash(picked && !followed ? [3, 3] : []); ctx.beginPath(); ctx.arc(p.x, p.y, ringR, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1; }
    if (!labels) return;
    ctx.font = '11px ui-monospace, Consolas, monospace'; ctx.textBaseline = 'top'; ctx.textAlign = 'center';
    const tag = `${s.name}${s.dead ? ' ✖' : ''}`, ty = p.y + ringR + 2;
    ctx.lineWidth = 3; ctx.strokeStyle = '#03060c'; ctx.strokeText(tag, p.x, ty); ctx.fillStyle = followed ? PALETTE.gold : '#9fe4ff'; ctx.fillText(tag, p.x, ty); ctx.textAlign = 'left'; ctx.lineWidth = 1;
    if (k >= LOD.art && s.maxHealth > 1) { const bw = 36; ctx.fillStyle = '#132'; ctx.fillRect(p.x - bw / 2, ty + 14, bw, 3); ctx.fillStyle = '#5fe08a'; ctx.fillRect(p.x - bw / 2, ty + 14, bw * Math.max(0, s.health / s.maxHealth), 3); }
  }
}
