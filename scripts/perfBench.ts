import { PerformanceObserver } from 'node:perf_hooks';
import { GameModel, type Enemy, type Input } from '../src/model.ts';
import { sharedSector, encodeEnemies, decodeEnemies } from '../src/shared.ts';

/**
 * Headless frame-time benchmark for the simulation, in single-player and shared sectors.
 *   node --experimental-strip-types scripts/perfBench.ts [frames=900] [horde=4]
 * Each scenario puts the ship in open space, brings a horde of the given level (1–4) in, fires at the
 * nearest enemy and steps the model at 60 fps. Shared scenarios add two remote pilots: the authority
 * hunts them too; the follower mirrors the authority's enemies (applyEnemies at 4/s) instead.
 * Prints per-frame update cost (mean, p95, p99, worst) in milliseconds, plus garbage-collection pauses
 * (count, total and longest) and heap allocated per frame, since GC pauses show up as hitches.
 */
const [framesArg = '900', hordeArg = '4'] = process.argv.slice(2);
const frames = Number(framesArg), level = Math.min(4, Math.max(1, Number(hordeArg)));
type Internals = { spawnHorde(level: number): void; horde: { angle: number } };

function setup(seed: string) {
  const m = new GameModel(seed);
  // Open space well away from the start, where hordes come.
  const base = m.bases[0];
  Object.assign(m.player, { x: base.x + 4000, y: base.y + 2500, vx: 0, vy: 0 });
  m.update(0.016, idle(m));
  (m as unknown as Internals).horde.angle = 0;
  (m as unknown as Internals).spawnHorde(level);
  return m;
}
function idle(m: GameModel): Input { return { x: 0, y: 0, aim: { x: m.player.x + 100, y: m.player.y }, fire: false, mine: false, dock: false, view: { x: m.player.x - 800, y: m.player.y - 450, width: 1600, height: 900 } }; }
function fighting(m: GameModel): Input {
  const p = m.player, target = m.enemies.filter(e => e.health > 0).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
  return { ...idle(m), aim: target ? { x: target.x, y: target.y } : { x: p.x + 100, y: p.y }, fire: Boolean(target) };
}
function keepAlive(m: GameModel) { m.player.health = m.maxHealth; m.shield = m.maxShield; m.energy = m.maxEnergy; m.heat = 0; }
function stats(times: number[]) {
  const sorted = [...times].sort((a, b) => a - b), q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return { mean: +(times.reduce((a, b) => a + b, 0) / times.length).toFixed(3), p95: +q(0.95).toFixed(3), p99: +q(0.99).toFixed(3), worst: +sorted[sorted.length - 1].toFixed(3) };
}
const gc: number[] = [];
new PerformanceObserver(list => { for (const entry of list.getEntries()) gc.push(entry.duration); }).observe({ entryTypes: ['gc'] });
async function run(name: string, m: GameModel, each: (m: GameModel, frame: number) => void) {
  const times: number[] = []; gc.length = 0; const heap0 = process.memoryUsage().heapUsed; let allocated = 0, lastHeap = heap0;
  for (let i = 0; i < frames; i++) {
    keepAlive(m); each(m, i);
    const t = performance.now(); m.update(1 / 60, fighting(m)); times.push(performance.now() - t);
    const heap = process.memoryUsage().heapUsed; if (heap > lastHeap) allocated += heap - lastHeap; lastHeap = heap;
    // Yield now and then so GC observations are delivered (a real game yields every frame).
    if (i % 60 === 59) { await new Promise(r => setImmediate(r)); lastHeap = process.memoryUsage().heapUsed; }
  }
  await new Promise(r => setTimeout(r, 20));
  const gcStats = { gcs: gc.length, gcMs: +gc.reduce((a, b) => a + b, 0).toFixed(1), gcWorst: +Math.max(0, ...gc).toFixed(2), kbPerFrame: Math.round(allocated / frames / 1024) };
  console.log(name.padEnd(34), JSON.stringify({ ...stats(times), ...gcStats, enemies: m.enemies.length, asteroids: m.asteroids.length, bullets: m.bullets.length }));
  return m;
}

// Warm the JIT once so the first scenario is not penalised.
await run('warm-up', setup('perf-bench'), () => {});
await run('single-player', setup('perf-bench'), () => {});

const authority = setup('perf-bench');
authority.shared = sharedSector('authority', () => true);
await run('shared: authority, 2 pilots', authority, (m, i) => {
  const p = m.player;
  m.shared!.targets = [{ id: 'a', x: p.x + 300 + Math.cos(i / 40) * 80, y: p.y + 120, vx: 0, vy: 0, radius: 34 }, { id: 'b', x: p.x - 250, y: p.y - 200 + Math.sin(i / 50) * 60, vx: 0, vy: 0, radius: 34 }];
  m.shared!.shots.length = 0; m.shared!.hits.length = 0; m.shared!.changedRocks.clear(); m.shared!.bumpedRocks.clear();
});

// Follower: the authority's enemy list arrives four times a second; enemies are eased in between.
const source = setup('perf-bench');
const follower = setup('perf-bench'); follower.enemies = [];
follower.shared = sharedSector('follower', () => true);
await run('shared: follower, mirrored enemies', follower, (m, i) => {
  if (i % 15 === 0) { keepAlive(source); source.update(0.25, idle(source)); m.applyEnemies(decodeEnemies(JSON.parse(JSON.stringify(encodeEnemies(source.enemies as Enemy[]))))); }
  m.shared!.targets = []; m.shared!.hits.length = 0;
});
