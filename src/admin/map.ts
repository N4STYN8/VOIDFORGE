import { CORE, ENEMIES, MODULES, RESOURCES, WORLD, type EnemyKind, type ModuleKind, type Resource } from '../data.ts';
import { CHUNK_SIZE } from '../world.ts';
import { sectorLabel, sectorSeed } from '../sectorGrid.ts';
import type { AdminPilot, AdminRoom } from '../adminProtocol.ts';
import type { ShipBlock, WorldRef } from '../netProtocol.ts';
import { chunkRocks, liveFor, specFor } from './sectorView.ts';

/**
 * The admin universe map. Every pilot has their own endless sector grid tied to a home seed, so the
 * universe is drawn as one cluster per home, laid out on a stable spiral. Universe units: a sector is
 * 1 x 1, cells sit GAP apart, and a world position inside a sector maps linearly into its cell, so one
 * camera zooms smoothly from the whole universe down to individual rocks and ship blocks.
 */
export const GAP = 1.15;
const W = WORLD.width;
export type Place = { home: string; gx: number; gy: number; wx: number; wy: number };
export type Ship = {
  id: string; name: string; seed?: string; world?: WorldRef; x: number; y: number; vx: number; vy: number; angle: number; t: number;
  health: number; maxHealth: number; dead?: boolean; thrust?: boolean; blocks?: ShipBlock[]; live: number;
  /** Displayed (smoothed) pose. */ dx: number; dy: number; da: number; shownSeed?: string;
};
const css = (c: number, a = 1) => `rgba(${c >> 16 & 255},${c >> 8 & 255},${c & 255},${a})`;
const shade = (c: number, f: number) => ((Math.min(255, (c >> 16 & 255) * f) << 16) | (Math.min(255, (c >> 8 & 255) * f) << 8) | Math.min(255, (c & 255) * f)) >>> 0;
const BLOCK = 16;

export class UniverseMap {
  cam = { x: 0, y: 0, scale: 40 };
  homes = new Map<string, { ox: number; oy: number; label: string }>();
  ships = new Map<string, Ship>();
  pilots: AdminPilot[] = [];
  rooms: AdminRoom[] = [];
  followed?: string;
  selectedSeed?: string;
  private stars = Array.from({ length: 220 }, (_, i) => ({ x: (Math.sin(i * 12.9898) * 43758.5453 % 1 + 1) % 1, y: (Math.sin(i * 78.233) * 12543.1234 % 1 + 1) % 1, b: 0.25 + (i % 7) / 10 }));

  /** Registers a home grid; clusters keep their spiral slot while the page is open. */
  home(seed: string) {
    let h = this.homes.get(seed);
    if (!h) { const i = this.homes.size, r = 14 * Math.sqrt(i), a = i * 2.39996; this.homes.set(seed, h = { ox: Math.cos(a) * r, oy: Math.sin(a) * r, label: seed.slice(0, 10) }); }
    return h;
  }
  /** Universe point of a world position in a sector. */
  universe(home: string, gx: number, gy: number, wx: number, wy: number) { const h = this.home(home); return { x: h.ox + gx * GAP + wx / W, y: h.oy + gy * GAP + wy / W }; }
  toScreen(ux: number, uy: number, w: number, h: number) { return { x: (ux - this.cam.x) * this.cam.scale + w / 2, y: (uy - this.cam.y) * this.cam.scale + h / 2 }; }
  toUniverse(sx: number, sy: number, w: number, h: number) { return { x: (sx - w / 2) / this.cam.scale + this.cam.x, y: (sy - h / 2) / this.cam.scale + this.cam.y }; }
  /** The sector cell and world position under a screen point, if it falls inside some home grid's cell. */
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
  /** The room (or a plain generated sector) at a grid cell. */
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
      if (!s) { const at = p.at ?? { x: W / 2, y: W / 2 }; s = { id: p.id, name: p.name, x: at.x, y: at.y, vx: 0, vy: 0, angle: p.angle ?? 0, t: now, health: 1, maxHealth: 1, live: 0, dx: at.x, dy: at.y, da: p.angle ?? 0 }; this.ships.set(p.id, s); }
      s.name = p.name; s.world = p.world; s.seed = p.room; s.dead = p.dead;
      // Overview positions (1 Hz) only when no fresher tapped state is flowing for this pilot.
      if (p.at && now - s.live > 1.5) { s.x = p.at.x; s.y = p.at.y; s.vx = 0; s.vy = 0; s.angle = p.angle ?? s.angle; s.t = now; }
    }
  }
  /** A tapped ship state from a watched sector (packed wire form). */
  setState(seed: string, id: string, name: string | undefined, packed: unknown, now: number) {
    const s = this.ships.get(id); if (!s || !Array.isArray(packed)) return;
    const [x, y, vx, vy, angle, health, maxHealth, , flags, blocks] = packed as number[];
    Object.assign(s, { x, y, vx, vy, angle, health, maxHealth, t: now, live: now, seed, dead: (flags & 1) === 1, thrust: (flags & 2) === 2 });
    if (name) s.name = name;
    if (Array.isArray(blocks)) s.blocks = blocks as unknown as ShipBlock[];
  }
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
  }
  /** Sectors whose detail is on screen now, nearest the centre first (the page watches up to three). */
  visibleSeeds(w: number, h: number): string[] {
    if (this.cam.scale < 260) return [];
    const out: { seed: string; d: number }[] = [];
    for (const r of this.rooms) {
      if (!r.world || !r.members) continue;
      const c = this.universe(r.world.home, r.world.x, r.world.y, W / 2, W / 2), p = this.toScreen(c.x, c.y, w, h);
      const half = this.cam.scale / 2;
      if (p.x + half < 0 || p.x - half > w || p.y + half < 0 || p.y - half > h) continue;
      out.push({ seed: r.seed, d: Math.hypot(p.x - w / 2, p.y - h / 2) });
    }
    return out.sort((a, b) => a.d - b.d).map(o => o.seed);
  }
  shipAt(sx: number, sy: number, w: number, h: number) {
    let best: Ship | undefined, bestD = 14;
    for (const s of this.ships.values()) { const u = this.shipUniverse(s); if (!u) continue; const p = this.toScreen(u.x, u.y, w, h), d = Math.hypot(p.x - sx, p.y - sy); if (d < bestD) { bestD = d; best = s; } }
    return best;
  }
  zoomAt(sx: number, sy: number, w: number, h: number, factor: number) {
    const before = this.toUniverse(sx, sy, w, h);
    this.cam.scale = Math.min(W * 2, Math.max(4, this.cam.scale * factor));
    const after = this.toUniverse(sx, sy, w, h);
    if (!this.followed) { this.cam.x += before.x - after.x; this.cam.y += before.y - after.y; }
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, now: number, watched: Set<string>) {
    ctx.fillStyle = '#05070c'; ctx.fillRect(0, 0, w, h);
    for (const s of this.stars) { ctx.fillStyle = `rgba(190,210,255,${s.b * 0.5})`; ctx.fillRect(Math.floor(s.x * w), Math.floor(s.y * h), 1, 1); }
    const k = this.cam.scale / W; // screen px per world unit
    // Grid cells: every known room plus each home sector, with a faint ring of neighbours.
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
    for (const c of ring.values()) { const r = cellRect(c.home, c.gx, c.gy); if (!onScreen(r)) continue; ctx.strokeStyle = 'rgba(80,100,140,0.18)'; ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.s, r.s); }
    for (const c of cells.values()) {
      const r = cellRect(c.home, c.gx, c.gy); if (!onScreen(r)) continue;
      const room = c.room, active = Boolean(room?.members);
      ctx.fillStyle = active ? 'rgba(255,150,50,0.10)' : 'rgba(90,120,170,0.05)'; ctx.fillRect(r.x, r.y, r.s, r.s);
      ctx.strokeStyle = room?.locked ? '#ff4d5e' : room && watched.has(room.seed) ? '#4fd8ff' : room?.seed && room.seed === this.selectedSeed ? '#ffd166' : active ? 'rgba(255,170,80,0.7)' : 'rgba(110,140,190,0.35)';
      ctx.lineWidth = room?.locked || (room && watched.has(room.seed)) ? 2 : 1; ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.s, r.s); ctx.lineWidth = 1;
      if (r.s > 40) {
        ctx.fillStyle = 'rgba(200,215,240,0.75)'; ctx.font = `${Math.min(13, 9 + r.s / 200)}px system-ui,sans-serif`; ctx.textBaseline = 'top';
        const seed = room?.seed ?? sectorSeed(c.home, c.gx, c.gy), linked = room?.world && room.seed !== sectorSeed(c.home, c.gx, c.gy);
        ctx.fillText(`${sectorLabel(c.gx, c.gy)}${linked ? ' ↔ linked' : ''}${room?.members ? ` · ${room.members} pilot${room.members === 1 ? '' : 's'}` : ''}${room?.locked ? ' · LOCKED' : ''}`, r.x + 4, r.y + 4);
        if (r.s > 260) this.drawSector(ctx, seed, c.home, c.gx, c.gy, r, k, w, h, now, watched.has(seed));
      }
    }
    // Links: a cell that holds another pilot's sector points to where that home's grid is drawn.
    ctx.setLineDash([4, 6]); ctx.strokeStyle = 'rgba(160,120,255,0.45)';
    for (const r of this.rooms) {
      if (!r.world || r.seed === sectorSeed(r.world.home, r.world.x, r.world.y)) continue;
      const target = [...this.homes.keys()].find(home => r.seed === home || r.seed.startsWith(`${home}:sector:`)); if (!target) continue;
      const m = /:sector:(-?\d+),(-?\d+)$/.exec(r.seed), tx = m ? Number(m[1]) : 0, ty = m ? Number(m[2]) : 0;
      const a = this.universe(r.world.home, r.world.x, r.world.y, W / 2, W / 2), b = this.universe(target, tx, ty, W / 2, W / 2);
      const pa = this.toScreen(a.x, a.y, w, h), pb = this.toScreen(b.x, b.y, w, h);
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
    }
    ctx.setLineDash([]);
    // Home labels.
    if (this.cam.scale < 900) for (const [, o] of this.homes) {
      const p = this.toScreen(o.ox + 0.5, o.oy - 0.12, w, h);
      ctx.fillStyle = '#ffb347'; ctx.font = '600 12px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(o.label, p.x, p.y); ctx.textAlign = 'left';
    }
    // Ships.
    for (const s of this.ships.values()) this.drawShip(ctx, s, k, w, h, now);
  }

  private drawSector(ctx: CanvasRenderingContext2D, seed: string, home: string, gx: number, gy: number, r: { x: number; y: number; s: number }, k: number, w: number, h: number, now: number, watched: boolean) {
    const spec = specFor(seed); if (!spec) return;
    const at = (x: number, y: number) => ({ x: r.x + x * k, y: r.y + y * k });
    ctx.save(); ctx.beginPath(); ctx.rect(r.x, r.y, r.s, r.s); ctx.clip();
    // Geography: belts and clusters show where the ore lies at any zoom.
    for (const c of spec.clusters) { const p = at(c.x, c.y); ctx.fillStyle = css(RESOURCES[c.ore].color, 0.06); ctx.beginPath(); ctx.arc(p.x, p.y, c.radius * k, 0, Math.PI * 2); ctx.fill(); }
    for (const b of spec.belts) {
      const p = at(b.x, b.y); ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(b.angle); ctx.fillStyle = css(RESOURCES[b.ore].color, 0.05);
      ctx.fillRect(-b.length * k / 2, -b.width * k / 2, b.length * k, b.width * k); ctx.restore();
    }
    for (const base of spec.bases) { const p = at(base.x, base.y); ctx.strokeStyle = 'rgba(115,201,238,0.8)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(4, 280 * k), 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1; if (k > 0.004) { ctx.fillStyle = '#73c9ee'; ctx.font = '11px system-ui,sans-serif'; ctx.fillText(base.name, p.x + 6, p.y + 6); } }
    const live = liveFor(seed);
    // Rocks: generated chunks (a few built per frame) with the live changes the sector authority sent.
    if (k > 0.025) {
      const x0 = Math.max(0, Math.floor((0 - r.x) / k / CHUNK_SIZE)), y0 = Math.max(0, Math.floor((0 - r.y) / k / CHUNK_SIZE));
      const x1 = Math.floor((w - r.x) / k / CHUNK_SIZE), y1 = Math.floor((h - r.y) / k / CHUNK_SIZE), budget = { left: 10 }, drawn = new Set<number>();
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
        for (const a of chunkRocks(seed, cx, cy, budget) ?? []) {
          drawn.add(a.id);
          const change = live.rocks.get(a.id); if (change?.gone) continue;
          this.rock(ctx, at(change?.x ?? a.x, change?.y ?? a.y), (change?.radius ?? a.radius) * k, a.ore);
        }
      }
      for (const [id, c] of live.rocks) if (!drawn.has(id) && !c.gone && c.x !== undefined && c.y !== undefined && c.radius) this.rock(ctx, at(c.x, c.y), c.radius * k, 'iron');
    }
    if (watched) {
      // Enemies, eased between the authority's updates.
      const ease = Math.min(1, (now - live.enemiesAt) / 0.25);
      for (const e of live.enemies.values()) {
        const [, kind, , , angle, health, maxHealth] = e.row, def = ENEMIES[kind as EnemyKind];
        const p = at(e.px + (e.x - e.px) * ease, e.py + (e.y - e.py) * ease), size = Math.max(4, def.radius * k);
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(angle);
        ctx.fillStyle = css(def.color); ctx.strokeStyle = '#140608'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(size, 0); ctx.lineTo(-size * 0.8, size * 0.7); ctx.lineTo(-size * 0.5, 0); ctx.lineTo(-size * 0.8, -size * 0.7); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
        if (size > 7) { ctx.fillStyle = '#300'; ctx.fillRect(p.x - size, p.y - size - 6, size * 2, 3); ctx.fillStyle = '#ff5d6c'; ctx.fillRect(p.x - size, p.y - size - 6, size * 2 * Math.max(0, health / Math.max(1, maxHealth)), 3); }
      }
      // Shots and beams.
      ctx.lineWidth = Math.max(1, Math.min(3, 3 * k * 10));
      for (const s of live.shots) {
        const dt = now - s.t;
        if (s.beam) { const a = at(s.x, s.y), b = at(s.beam.ex, s.beam.ey); ctx.strokeStyle = 'rgba(255,90,90,0.9)'; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); continue; }
        const x = s.x + s.vx * dt, y = s.y + s.vy * dt, a = at(x - s.vx * 0.04, y - s.vy * 0.04), b = at(x, y);
        ctx.strokeStyle = s.enemy ? '#ff7a45' : '#fff1a8'; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      ctx.lineWidth = 1;
    }
    ctx.restore();
    void home; void gx; void gy;
  }
  private rock(ctx: CanvasRenderingContext2D, p: { x: number; y: number }, radius: number, ore: Resource) {
    if (radius < 0.6) { ctx.fillStyle = css(RESOURCES[ore].color, 0.6); ctx.fillRect(p.x, p.y, 1, 1); return; }
    ctx.fillStyle = css(shade(RESOURCES[ore].color, 0.45)); ctx.strokeStyle = css(shade(RESOURCES[ore].color, 0.9), 0.8);
    ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, Math.PI * 2); ctx.fill(); if (radius > 3) ctx.stroke();
  }
  private drawShip(ctx: CanvasRenderingContext2D, s: Ship, k: number, w: number, h: number, now: number) {
    const u = this.shipUniverse(s); if (!u) return;
    const p = this.toScreen(u.x, u.y, w, h);
    if (p.x < -60 || p.y < -60 || p.x > w + 60 || p.y > h + 60) return;
    const followed = s.id === this.followed, seed = s.world?.seed;
    // Beams and shield from the pilot's look, drawn from the smoothed ship pose.
    const look = seed ? liveFor(seed).looks.get(s.id)?.look : undefined;
    if (look && k > 0.004) {
      const world = s.world!, screen = (wx: number, wy: number) => { const q = this.universe(world.home, world.x, world.y, wx, wy); return this.toScreen(q.x, q.y, w, h); };
      const beam = (rows: number[][] | undefined, color: string) => {
        for (const [dx, dy, tx, ty] of rows ?? []) { const a = screen(s.dx + dx, s.dy + dy), b = screen(tx, ty); ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.lineWidth = 1; }
      };
      beam(look.m as number[][] | undefined, 'rgba(90,255,190,0.85)'); beam(look.t as number[][] | undefined, 'rgba(230,80,255,0.85)');
      if (look.s && look.s[0] > 0) { ctx.strokeStyle = `rgba(110,200,255,${0.25 + 0.5 * look.s[0] / Math.max(1, look.s[1])})`; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(8, 40 * k), 0, Math.PI * 2); ctx.stroke(); }
    }
    const blockPx = BLOCK * k;
    if (s.blocks && blockPx >= 2.5) {
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(s.da + Math.PI / 2);
      if (s.thrust && !s.dead) { ctx.fillStyle = `rgba(255,170,60,${0.5 + 0.4 * Math.sin(now * 40)})`; const maxY = Math.max(...s.blocks.map(b => b[2])); ctx.fillRect(-blockPx * 0.3, (maxY + 0.5) * blockPx, blockPx * 0.6, blockPx * 0.8); }
      for (const [kind, bx, by] of s.blocks) {
        const color = kind === 'core' ? CORE.color : MODULES[kind as ModuleKind]?.color ?? 0x8899aa;
        ctx.fillStyle = css(s.dead ? shade(color, 0.35) : color); ctx.fillRect((bx - 0.5) * blockPx, (by - 0.5) * blockPx, blockPx, blockPx);
        ctx.strokeStyle = '#05070c'; ctx.lineWidth = Math.max(1, blockPx / 8); ctx.strokeRect((bx - 0.5) * blockPx, (by - 0.5) * blockPx, blockPx, blockPx);
      }
      ctx.restore();
    } else {
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(s.da);
      ctx.fillStyle = s.dead ? '#555' : followed ? '#ffd166' : '#5fe0ff'; ctx.strokeStyle = '#05070c'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-6, 5); ctx.lineTo(-3, 0); ctx.lineTo(-6, -5); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
    }
    if (followed) { ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(14, 60 * k), 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1; }
    ctx.fillStyle = followed ? '#ffd166' : 'rgba(220,235,255,0.9)'; ctx.font = '11px system-ui,sans-serif'; ctx.textBaseline = 'top'; ctx.textAlign = 'center';
    ctx.fillText(`${s.name}${s.dead ? ' ✖' : ''}`, p.x, p.y + Math.max(10, 50 * k)); ctx.textAlign = 'left';
    if (blockPx >= 2.5 && s.maxHealth > 1) { const bw = 36; ctx.fillStyle = '#132'; ctx.fillRect(p.x - bw / 2, p.y + Math.max(24, 50 * k + 14), bw, 3); ctx.fillStyle = '#5fe08a'; ctx.fillRect(p.x - bw / 2, p.y + Math.max(24, 50 * k + 14), bw * Math.max(0, s.health / s.maxHealth), 3); }
  }
}
