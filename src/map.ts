import { EXPLORATION, RESOURCES, WORLD, DANGER, ENEMIES, OUTPOST } from './data.ts';
import { waypointColor } from './nav.ts';
import type { GameModel } from './model.ts';
// Danger never changes for a seed, so each explored cell is rated once.
const dangerCache = new Map<string, Map<string, number>>();
function cellDanger(model: GameModel, key: string, x: number, y: number) {
  const world = `${model.seed}:${model.defeatedBosses.length}`;
  let cells = dangerCache.get(world);
  if (!cells) { dangerCache.clear(); cells = new Map(); dangerCache.set(world, cells); }
  let level = cells.get(key);
  if (level === undefined) { level = model.dangerAt({ x: (x + 0.5) * EXPLORATION.cell, y: (y + 0.5) * EXPLORATION.cell }); cells.set(key, level); }
  return level;
}
export function drawExplorationMap(canvas: HTMLCanvasElement, model: GameModel, view = { zoom: 1, centerX: 0.5, centerY: 0.5 }) {
  const ctx = canvas.getContext('2d'); if (!ctx) return;
  const size = canvas.width, scale = size / WORLD.width, unit=1/view.zoom;
  ctx.clearRect(0,0,size,size);ctx.fillStyle = '#040d18b8'; ctx.fillRect(0, 0, size, size);
  ctx.save(); ctx.translate(size / 2, size / 2); ctx.scale(view.zoom, view.zoom); ctx.translate(-view.centerX * size, -view.centerY * size);
  for (const key of model.explored) {
    const [x, y] = key.split(',').map(Number);
    ctx.fillStyle = DANGER.mapTint[cellDanger(model, key, x, y) - 1] || '#122335'; ctx.fillRect(x * EXPLORATION.cell * scale, y * EXPLORATION.cell * scale, EXPLORATION.cell * scale + 0.5, EXPLORATION.cell * scale + 0.5);
  }
  for (const rock of model.chartedAsteroids) {
    if (!model.isExplored(rock)) continue;
    ctx.fillStyle = '#' + RESOURCES[rock.ore].color.toString(16).padStart(6, '0'); ctx.fillRect(rock.x * scale, rock.y * scale, 2*unit, 2*unit);
  }
  for (const outpost of model.outposts) {
    // Player outposts: a brass square with the outpost's name.
    const x = (outpost.cx + 0.5) * OUTPOST.cell * scale, y = (outpost.cy + 0.5) * OUTPOST.cell * scale;
    ctx.fillStyle = '#d9a441'; ctx.fillRect(x - 3*unit, y - 3*unit, 6*unit, 6*unit); ctx.strokeStyle = '#f2d489'; ctx.lineWidth = unit; ctx.strokeRect(x - 4.5*unit, y - 4.5*unit, 9*unit, 9*unit);
    ctx.font = `${10*unit}px monospace`; ctx.fillText(outpost.name, Math.min(x + 8*unit, size - 110*unit), y + 4*unit);
  }
  for (const base of model.bases) {
    if (!model.isExplored(base)) continue;
    const x = base.x * scale, y = base.y * scale;
    ctx.strokeStyle = base.unlocked ? '#75e2ac' : '#e7b477'; ctx.lineWidth = 1.5*unit; ctx.strokeRect(x - 4*unit, y - 4*unit, 8*unit, 8*unit);
    ctx.fillStyle = ctx.strokeStyle; ctx.font = `${10*unit}px monospace`; ctx.fillText(base.name + (base.unlocked ? ' [ACTIVE]' : ' [LOCKED]'), Math.min(x + 8*unit, size - 160*unit), y - 8*unit);
  }
  for (const site of model.bossSites) {
    // Boss territories appear once explored: a red diamond while guarded, grey once cleared.
    if (!model.isExplored(site)) continue;
    const x = site.x * scale, y = site.y * scale, color = site.defeated ? '#7d8fa0' : '#ff5d7a';
    ctx.strokeStyle = color; ctx.lineWidth = unit; ctx.beginPath(); ctx.arc(x, y, site.radius * scale, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(x, y - 5*unit); ctx.lineTo(x + 5*unit, y); ctx.lineTo(x, y + 5*unit); ctx.lineTo(x - 5*unit, y); ctx.closePath(); ctx.fill();
    ctx.font = `${10*unit}px monospace`; ctx.fillText(ENEMIES[site.kind].label + (site.defeated ? ' [CLEARED]' : ' [BOSS]'), Math.min(x + 9*unit, size - 150*unit), y + 4*unit);
  }
  model.waypoints.forEach((w, i) => {
    // Player markers: a numbered diamond. Counter-scaled so they stay the same size at any map zoom.
    const x = w.x * scale, y = w.y * scale, r = 6 / view.zoom;
    ctx.fillStyle = waypointColor(i); ctx.strokeStyle = '#05070c'; ctx.lineWidth = 1.5 / view.zoom;
    ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.font = `${11 / view.zoom}px monospace`; ctx.fillText(String(i + 1), x + r * 1.5, y + r * 0.6);
  });
  ctx.fillStyle = '#f2808d';
  for (const e of model.enemies) if (model.isExplored(e) && Math.hypot(e.x - model.player.x, e.y - model.player.y) < 1100) { ctx.beginPath(); ctx.arc(e.x * scale, e.y * scale, 2.5*unit, 0, Math.PI * 2); ctx.fill(); }
  const p = model.player;
  ctx.save(); ctx.translate(p.x * scale, p.y * scale); ctx.rotate(p.angle);ctx.scale(unit,unit); ctx.fillStyle = '#e6f9ff'; ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4, -4); ctx.lineTo(-4, 4); ctx.closePath(); ctx.fill(); ctx.restore();
  ctx.restore();
  ctx.strokeStyle = '#32516a'; ctx.lineWidth = unit; ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
}
/** World position under a point of the map canvas, the inverse of the transform drawExplorationMap uses. */
export function mapToWorld(canvasSize: number, view: { zoom: number; centerX: number; centerY: number }, u: number, v: number) {
  const scale = canvasSize / WORLD.width;
  return { x: ((u * canvasSize - canvasSize / 2) / view.zoom + view.centerX * canvasSize) / scale, y: ((v * canvasSize - canvasSize / 2) / view.zoom + view.centerY * canvasSize) / scale };
}
