import { RESOURCES, ENEMIES, OUTPOST, WAYPOINTS, EXPLORATION, WORLD } from './data.ts';
import type { GameModel } from './model.ts';

// Navigation displays drawn with the plain Canvas 2D API: the radar minimap and the compass strip.
// Both are read-only views of the model.

export type NavMarker = { x: number; y: number; kind: 'base' | 'locked' | 'outpost' | 'waypoint' | 'boss' | 'horde'; label: string; color: string };
const hex = (color: number) => '#' + color.toString(16).padStart(6, '0');
export const waypointColor = (index: number) => hex(WAYPOINTS.colors[index % WAYPOINTS.colors.length]);

/** Everything worth navigating to that the player knows about: discovered stations, outposts, own markers and explored boss territories. */
export function navMarkers(model: GameModel): NavMarker[] {
  const markers: NavMarker[] = [];
  for (const base of model.bases) if (base.unlocked || model.isExplored(base)) markers.push({ x: base.x, y: base.y, kind: base.unlocked ? 'base' : 'locked', label: base.name, color: base.unlocked ? '#75e2ac' : '#e7b477' });
  for (const outpost of model.outposts) markers.push({ x: (outpost.cx + 0.5) * OUTPOST.cell, y: (outpost.cy + 0.5) * OUTPOST.cell, kind: 'outpost', label: outpost.name, color: '#d9a441' });
  model.waypoints.forEach((w, i) => markers.push({ x: w.x, y: w.y, kind: 'waypoint', label: `Marker ${i + 1}`, color: waypointColor(i) }));
  for (const site of model.bossSites) if (!site.defeated && model.isExplored(site)) markers.push({ x: site.x, y: site.y, kind: 'boss', label: ENEMIES[site.kind].label, color: '#ff5d7a' });
  if (model.horde.warning > 0) markers.push({ x: model.player.x + Math.cos(model.horde.angle) * 1200, y: model.player.y + Math.sin(model.horde.angle) * 1200, kind: 'horde', label: 'Horde', color: '#ff3355' });
  return markers;
}
function glyph(ctx: CanvasRenderingContext2D, marker: NavMarker, x: number, y: number, size: number) {
  ctx.fillStyle = marker.color; ctx.strokeStyle = '#05070c'; ctx.lineWidth = 1;
  ctx.beginPath();
  if (marker.kind === 'waypoint') { ctx.moveTo(x, y - size); ctx.lineTo(x + size, y); ctx.lineTo(x, y + size); ctx.lineTo(x - size, y); }
  else if (marker.kind === 'boss' || marker.kind === 'horde') { ctx.moveTo(x, y - size); ctx.lineTo(x + size, y + size); ctx.lineTo(x - size, y + size); }
  else ctx.rect(x - size, y - size, size * 2, size * 2);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  if (marker.kind === 'base' || marker.kind === 'locked') { ctx.fillStyle = '#05070c'; ctx.fillRect(x - 1, y - size + 1, 2, size * 2 - 2); ctx.fillRect(x - size + 1, y - 1, size * 2 - 2, 2); }
}

/** Radar minimap centred on the ship, north up. `range` is the world distance from the centre to the edge. */
export function drawRadar(canvas: HTMLCanvasElement, model: GameModel, range: number, circular = false) {
  const ctx = canvas.getContext('2d'); if (!ctx) return;
  const size = canvas.width, half = size / 2, scale = half / range, p = model.player;
  const at = (point: { x: number; y: number }) => ({ x: half + (point.x - p.x) * scale, y: half + (point.y - p.y) * scale });
  ctx.save();if(circular){ctx.beginPath();ctx.arc(half,half,half-1,0,Math.PI*2);ctx.clip();}
  ctx.imageSmoothingEnabled = false; ctx.fillStyle = '#060b14'; ctx.fillRect(0, 0, size, size);
  // Explored space is lighter, so the radar also shows where you have not been.
  const cell = EXPLORATION.cell, cells = Math.ceil(range / cell) + 1, pcx = Math.floor(p.x / cell), pcy = Math.floor(p.y / cell);
  ctx.fillStyle = '#0f1d2e';
  for (let cx = pcx - cells; cx <= pcx + cells; cx++) for (let cy = pcy - cells; cy <= pcy + cells; cy++) {
    if (!model.explored.has(`${cx},${cy}`)) continue;
    const a = at({ x: cx * cell, y: cy * cell }); ctx.fillRect(Math.floor(a.x), Math.floor(a.y), Math.ceil(cell * scale) + 1, Math.ceil(cell * scale) + 1);
  }
  // World edge.
  const edge = at({ x: 0, y: 0 }); ctx.strokeStyle = '#34526a'; ctx.lineWidth = 1; ctx.strokeRect(edge.x, edge.y, WORLD.width * scale, WORLD.height * scale);
  // Range rings and cross hairs.
  ctx.strokeStyle = '#1d3347'; ctx.beginPath(); ctx.moveTo(half, 0); ctx.lineTo(half, size); ctx.moveTo(0, half); ctx.lineTo(size, half); ctx.stroke();
  for (const ring of (circular?[.25,.5,.75,1]:[.5,1])) { ctx.beginPath(); ctx.arc(half, half, half * ring - 1, 0, Math.PI * 2); ctx.stroke(); }
  for (const a of model.asteroids) {
    const q = at(a); if (q.x < -4 || q.y < -4 || q.x > size + 4 || q.y > size + 4) continue;
    const r = Math.max(1, Math.round(a.radius * scale)); ctx.fillStyle = hex(RESOURCES[a.ore].color); ctx.globalAlpha = 0.85; ctx.fillRect(Math.round(q.x - r), Math.round(q.y - r), r * 2, r * 2);
  }
  ctx.globalAlpha = 1;
  for (const d of model.drops) { const q = at(d); ctx.fillStyle = hex(RESOURCES[d.ore].color); ctx.fillRect(Math.round(q.x), Math.round(q.y), 1, 1); }
  // Outpost footprints.
  ctx.fillStyle = '#d9a441';
  for (const outpost of model.outposts) for (const s of outpost.structures) { const q = at({ x: s.cx * OUTPOST.cell, y: s.cy * OUTPOST.cell }); if (q.x > -4 && q.y > -4 && q.x < size + 4 && q.y < size + 4) ctx.fillRect(Math.round(q.x), Math.round(q.y), Math.max(1, Math.ceil(OUTPOST.cell * scale)), Math.max(1, Math.ceil(OUTPOST.cell * scale))); }
  for (const e of model.enemies) {
    if (e.health <= 0 || ENEMIES[e.kind ?? 'raider'].part) continue;
    const q = at(e); if (q.x < 0 || q.y < 0 || q.x > size || q.y > size) continue;
    const big = ENEMIES[e.kind ?? 'raider'].boss; ctx.fillStyle = big ? '#ff2d55' : e.horde || e.raidParty ? '#ff7a8f' : '#f2808d'; ctx.fillRect(Math.round(q.x) - (big ? 3 : 1), Math.round(q.y) - (big ? 3 : 1), big ? 6 : 3, big ? 6 : 3);
  }
  // Markers: drawn in place when in range, otherwise pinned to the edge with a pointer.
  for (const marker of navMarkers(model)) {
    const q = at(marker), inside = circular?Math.hypot(q.x-half,q.y-half)<half-6:Math.abs(q.x - half) < half - 6 && Math.abs(q.y - half) < half - 6;
    if (inside) { glyph(ctx, marker, Math.round(q.x), Math.round(q.y), 4); continue; }
    const angle = Math.atan2(q.y - half, q.x - half), reach = half - 7, k = circular?reach:Math.min(reach / Math.abs(Math.cos(angle) || 1e-6), reach / Math.abs(Math.sin(angle) || 1e-6));
    const ex = half + Math.cos(angle) * k, ey = half + Math.sin(angle) * k;
    ctx.fillStyle = marker.color; ctx.strokeStyle = '#05070c'; ctx.beginPath();
    ctx.moveTo(ex + Math.cos(angle) * 6, ey + Math.sin(angle) * 6); ctx.lineTo(ex + Math.cos(angle + 2.5) * 5, ey + Math.sin(angle + 2.5) * 5); ctx.lineTo(ex + Math.cos(angle - 2.5) * 5, ey + Math.sin(angle - 2.5) * 5); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  // The ship: an arrow at the centre pointing where it faces.
  ctx.save(); ctx.translate(half, half); ctx.rotate(p.angle); ctx.fillStyle = circular?'#58e2e8':'#ffffff'; ctx.strokeStyle = '#05070c'; ctx.beginPath(); ctx.moveTo(circular?11:7, 0); ctx.lineTo(circular?-7:-4, circular?-6:-4); ctx.lineTo(circular?-3:-2, 0); ctx.lineTo(circular?-7:-4, circular?6:4); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
  ctx.fillStyle = '#9fc4dc'; ctx.font = '9px monospace'; ctx.textAlign = 'center'; ctx.fillText('N', half, 9);
  ctx.restore();
}

const POINTS: [number, string][] = [[0, 'N'], [45, 'NE'], [90, 'E'], [135, 'SE'], [180, 'S'], [225, 'SW'], [270, 'W'], [315, 'NW']];
/** Compass bearing in degrees (0 = north/up, clockwise) from one point to another. */
export const bearing = (from: { x: number; y: number }, to: { x: number; y: number }) => ((Math.atan2(to.x - from.x, -(to.y - from.y)) * 180 / Math.PI) + 360) % 360;
/** Heading of a ship angle (radians, 0 = +x) as a compass bearing. */
export const heading = (angle: number) => ((angle * 180 / Math.PI + 90) % 360 + 360) % 360;
/** Signed difference between two bearings in -180..180. */
export const bearingDelta = (to: number, from: number) => ((to - from + 540) % 360) - 180;

/**
 * Compass strip centred on the ship's heading, showing `fov` degrees. Cardinal points slide as the ship
 * turns; markers sit at their bearing, or pin to the nearer end when outside the strip. The marker closest
 * to dead ahead is named with its distance.
 */
export function drawCompass(canvas: HTMLCanvasElement, model: GameModel, fov = 160) {
  const ctx = canvas.getContext('2d'); if (!ctx) return;
  // The backing canvas follows the laid-out width at 2x, so text keeps its size on narrow screens and stays sharp when the HUD is scaled up.
  const k = 2, w = Math.max(240, Math.round(canvas.clientWidth || 520)), h = 60; if (canvas.width !== w * k) { canvas.width = w * k; canvas.height = h * k; }
  fov *= w / 520;
  const mid = w / 2, here = heading(model.player.angle), perDegree = w / fov, p = model.player;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.clearRect(0, 0, w, h); ctx.fillStyle = 'rgba(8,14,26,0.9)'; ctx.fillRect(0, 0, w, 30);
  ctx.strokeStyle = '#2f4860'; ctx.lineWidth = 2; ctx.strokeRect(1, 1, w - 2, 28); ctx.fillStyle = '#7fd6f2'; ctx.fillRect(0, 0, w, 2);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let degree = 0; degree < 360; degree += 15) {
    const x = mid + bearingDelta(degree, here) * perDegree; if (x < 6 || x > w - 6) continue;
    const point = POINTS.find(([d]) => d === degree), major = degree % 45 === 0;
    ctx.fillStyle = major ? '#7fa3bd' : '#3c566c'; ctx.fillRect(Math.round(x), major ? 20 : 23, 1.5, major ? 7 : 4);
    if (point) { ctx.fillStyle = point[1].length === 1 ? '#e6f4ff' : '#8fb0c8'; ctx.font = point[1].length === 1 ? 'bold 15px monospace' : '10px monospace'; ctx.fillText(point[1], x, 11); }
  }
  let focus: { marker: NavMarker; off: number } | undefined;
  for (const marker of navMarkers(model)) {
    const off = bearingDelta(bearing(p, marker), here), pinned = Math.abs(off) > fov / 2 - 4, x = pinned ? (off < 0 ? 9 : w - 9) : mid + off * perDegree;
    glyph(ctx, marker, Math.round(x), 23, pinned ? 3.5 : 5);
    if (!focus || Math.abs(off) < Math.abs(focus.off)) focus = { marker, off };
  }
  // Heading notch.
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(mid, 31); ctx.lineTo(mid - 6, 38); ctx.lineTo(mid + 6, 38); ctx.closePath(); ctx.fill();
  if (focus) {
    const distance = Math.hypot(focus.marker.x - p.x, focus.marker.y - p.y), text = `${focus.marker.label} · ${distance >= 1000 ? (distance / 1000).toFixed(1) + ' km' : Math.round(distance) + ' m'} ${Math.abs(focus.off) < 6 ? '· ahead' : focus.off < 0 ? '◄' : '►'}`;
    ctx.font = 'bold 13px monospace'; const width = ctx.measureText(text).width + 16;
    ctx.fillStyle = 'rgba(8,14,26,0.9)'; ctx.fillRect(mid - width / 2, 40, width, 19); ctx.fillStyle = focus.marker.color; ctx.fillText(text, mid, 50);
  }
}
