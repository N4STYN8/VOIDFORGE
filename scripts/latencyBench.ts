import { GameModel, type Bullet, type Input } from '../src/model.ts';
import { NetClient } from '../src/net.ts';
import { SharedLink } from '../src/sharedLink.ts';
import { worldRef } from '../src/sectors.ts';
import { startRelay } from '../server/relay.ts';

/**
 * Measures how far behind the truth a follower sees things in a shared sector, over a real local relay with
 * an artificial network delay added to both pilots' sockets.
 *   node --experimental-strip-types scripts/latencyBench.ts [oneWayMs=40] [jitterMs=10] [seconds=12]
 * Pilot A owns the sector (authority), circles at speed and fights a horde; pilot B (follower) hovers nearby
 * and fights too. Every B frame compares what B shows with what A actually has at that instant:
 *  - ship: B's drawn pose of A vs A's real position, as distance and as lag (distance / speed);
 *  - enemies: B's mirrored enemies vs A's, same ids, mean distance and lag;
 *  - shots: time from a shot existing on its sender to it appearing on the receiver ("delay"), and how far
 *    behind the sender's real shot it appears ("behind", distance / shot speed). Enemy shots go A → B; pilot
 *    shots are B's own fire seen on A.
 * Also prints each pilot's messages per second (the relay allows NET.maxRate) and kilobytes per second sent.
 */
const [oneWayArg = '40', jitterArg = '10', secondsArg = '12'] = process.argv.slice(2);
const oneWay = Number(oneWayArg), jitter = Number(jitterArg), seconds = Number(secondsArg), warmup = 3;
type Internals = { spawnHorde(level: number): void; horde: { angle: number } };
type Meter = { messages: number; bytes: number };

/** A WebSocket whose traffic in both directions arrives `oneWay` ± `jitter` ms late, in order (like TCP). */
function delayedSocket(meter: Meter) {
  return (url: string) => {
    const ws = new WebSocket(url);
    let sendAt = 0, recvAt = 0;
    const delay = (last: number) => Math.max(last, performance.now() + oneWay + (Math.random() * 2 - 1) * jitter);
    return {
      get readyState() { return ws.readyState; },
      send(text: string) { meter.messages++; meter.bytes += text.length; sendAt = delay(sendAt); setTimeout(() => { if (ws.readyState === 1) ws.send(text); }, sendAt - performance.now()); },
      close() { ws.close(); },
      addEventListener(type: string, listener: (event: { data?: unknown }) => void) {
        if (type === 'message') ws.addEventListener('message', event => { recvAt = delay(recvAt); setTimeout(() => listener({ data: event.data }), recvAt - performance.now()); });
        else ws.addEventListener(type, () => listener({}));
      },
    };
  };
}

function pilot(name: string, url: string, seed: string) {
  const meter: Meter = { messages: 0, bytes: 0 };
  const model = new GameModel(seed), net = new NetClient(delayedSocket(meter)), link = new SharedLink(net, () => model);
  net.connect(url, name);
  return { model, net, link, meter };
}
type Pilot = ReturnType<typeof pilot>;
function input(m: GameModel): Input {
  const p = m.player, target = m.enemies.filter(e => e.health > 0).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
  return { x: 0, y: 0, aim: target ? { x: target.x, y: target.y } : { x: p.x + 100, y: p.y }, fire: true, mine: false, dock: false, view: { x: p.x - 1600, y: p.y - 1000, width: 3200, height: 2000 } };
}
function keepAlive(m: GameModel) { m.player.health = 1e6; m.shield = m.maxShield; // Nobody dies mid-measurement.
  m.energy = m.maxEnergy; m.heat = 0; for (const mod of m.modules) mod.integrity = 1e6; }
function step(p: Pilot, dt: number, now: number, owner: boolean) {
  const m = p.model; keepAlive(m);
  m.update(dt, input(m));
  p.net.setSector(worldRef(m), owner);
  const s = m.player;
  p.net.sendState(now, { x: s.x, y: s.y, vx: s.vx, vy: s.vy, angle: s.angle, health: s.health, maxHealth: m.maxHealth, paint: 0, blocks: [['core', 0, 0, m.coreLevel]] });
  p.net.heartbeat(now);
  p.link.frame(m, now);
}
/** Remembers shots as they appear on the sender, so the receiver's copies can be matched to them. */
class ShotLog {
  private seen = -1;
  shots: { at: number; b: Bullet }[] = [];
  delays: number[] = []; behind: number[] = [];
  watch(m: GameModel, enemy: boolean, now: number) {
    if (this.seen < 0) this.seen = Math.max(0, ...m.bullets.map(b => b.id));
    for (const b of m.bullets) if (b.id > this.seen) { if (b.enemy === enemy && !b.remote && !b.turret) this.shots.push({ at: now, b }); }
    this.seen = Math.max(this.seen, ...m.bullets.map(b => b.id));
    this.shots = this.shots.filter(s => now - s.at < 2);
  }
  /** A receiver's new bullet: the sender's shot with the same velocity, nearest in position. */
  match(copy: Bullet, now: number, measuring: boolean) {
    let best: { at: number; b: Bullet } | undefined, bestD = Infinity;
    for (const s of this.shots) {
      if (Math.abs(s.b.vx - copy.vx) > 2 || Math.abs(s.b.vy - copy.vy) > 2) continue;
      // Only shots that could plausibly be this one (within 0.6 s of flight), so an older shot with the same velocity is not mistaken for it.
      const d = Math.hypot(s.b.x - copy.x, s.b.y - copy.y); if (d < bestD && d < Math.hypot(copy.vx, copy.vy) * 0.6) { bestD = d; best = s; }
    }
    if (!best || !measuring) return;
    this.shots.splice(this.shots.indexOf(best), 1);
    const speed = Math.hypot(copy.vx, copy.vy);
    this.delays.push((now - best.at) * 1000);
    if (best.b.life > 0 && speed > 0) this.behind.push(bestD / speed * 1000);
  }
}
const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
const pct = (a: number[], p: number) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const f = (n: number) => Number.isFinite(n) ? Math.round(n) : '-';

const relay = await startRelay({ port: 0, host: '127.0.0.1' }), url = `ws://127.0.0.1:${relay.port}`, seed = 'latency-bench';
const A = pilot('A', url, seed), B = pilot('B', url, seed);
const base = A.model.bases[0], centre = { x: base.x + 4000, y: base.y + 2500 }, radius = 320, spin = 1;
Object.assign(A.model.player, { x: centre.x + radius, y: centre.y, vx: 0, vy: 0 });
Object.assign(B.model.player, { x: centre.x - 150, y: centre.y + 450, vx: 0, vy: 0 });
const clock = () => performance.now() / 1000, start = clock();
let last = start, hordeAt = -Infinity, measuringFrom = Infinity;
const ship: { err: number; lag: number }[] = [], enemyErr: number[] = [], enemySpeed: number[] = [], enemyLag: number[] = [];
const enemyShots = new ShotLog(), pilotShots = new ShotLog();
// Wrap the receivers' shot intake to time arrivals.
const wrap = (m: GameModel, method: 'applyShots' | 'applyPilotShots', log: ShotLog) => {
  const original = m[method].bind(m) as (...args: unknown[]) => void;
  (m as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => {
    const before = new Set(m.bullets); original(...args);
    for (const b of m.bullets) if (!before.has(b)) log.match(b, clock(), clock() >= measuringFrom);
  };
};
wrap(B.model, 'applyShots', enemyShots); wrap(A.model, 'applyPilotShots', pilotShots);
const meters0 = { a: { ...A.meter }, b: { ...B.meter } };
while (clock() - start < seconds + warmup + 4) {
  await new Promise(r => setTimeout(r, 16));
  const now = clock(), dt = Math.min(0.05, now - last); last = now;
  const angle = (now - start) * spin;
  step(A, dt, now, true);
  if (!A.model.dead) Object.assign(A.model.player, { x: centre.x + Math.cos(angle) * radius, y: centre.y + Math.sin(angle) * radius, vx: -Math.sin(angle) * radius * spin, vy: Math.cos(angle) * radius * spin, angle: angle + Math.PI / 2 });
  enemyShots.watch(A.model, true, now);
  step(B, dt, now, false);
  pilotShots.watch(B.model, false, now);
  const shared = A.model.shared && B.model.shared;
  if (shared && now - hordeAt > 8 && A.model.enemies.filter(e => e.health > 0).length < 6) {
    hordeAt = now; (A.model as unknown as Internals).horde.angle = Math.random() * 6.28; (A.model as unknown as Internals).spawnHorde(3);
  }
  if (shared && measuringFrom === Infinity) { measuringFrom = now + warmup; }
  if (now < measuringFrom) { meters0.a = { ...A.meter }; meters0.b = { ...B.meter }; continue; }
  if (now - measuringFrom > seconds) break;
  const pose = B.net.poses(now).find(p => p.id === A.net.id);
  if (pose) { const err = Math.hypot(pose.x - A.model.player.x, pose.y - A.model.player.y); ship.push({ err, lag: err / (radius * spin) * 1000 }); }
  const truth = new Map(A.model.enemies.map(e => [e.id, e]));
  for (const ghost of B.model.enemies) {
    const real = truth.get(ghost.id); if (!real || real.parent !== undefined) continue;
    const speed = Math.hypot(real.vx ?? 0, real.vy ?? 0), err = Math.hypot(ghost.x - real.x, ghost.y - real.y);
    enemyErr.push(err); enemySpeed.push(speed); if (speed > 40) enemyLag.push(err / speed * 1000);
  }
}
const span = seconds, rate = (m: Meter, m0: Meter) => `${(( m.messages - m0.messages) / span).toFixed(1)} msg/s, ${((m.bytes - m0.bytes) / span / 1024).toFixed(1)} KB/s`;
console.log(`one-way ${oneWay} ms ± ${jitter} ms (RTT ≈ ${oneWay * 2} ms), ${seconds} s measured`);
console.log(`remote ship    : error mean ${mean(ship.map(s => s.err)).toFixed(1)} u, lag mean ${f(mean(ship.map(s => s.lag)))} ms, p95 ${f(pct(ship.map(s => s.lag), 0.95))} ms`);
console.log(`mirrored enemy : error mean ${mean(enemyErr).toFixed(1)} u at mean speed ${mean(enemySpeed).toFixed(0)} u/s, lag (moving >40 u/s) median ${f(pct(enemyLag, 0.5))} ms, p95 ${f(pct(enemyLag, 0.95))} ms`);
console.log(`enemy shots    : ${enemyShots.delays.length} matched, delay median ${f(pct(enemyShots.delays, 0.5))} ms p95 ${f(pct(enemyShots.delays, 0.95))}, behind mean ${f(mean(enemyShots.behind))} ms`);
console.log(`pilot shots    : ${pilotShots.delays.length} matched, delay median ${f(pct(pilotShots.delays, 0.5))} ms p95 ${f(pct(pilotShots.delays, 0.95))}, behind mean ${f(mean(pilotShots.behind))} ms`);
console.log(`traffic A (authority): ${rate(A.meter, meters0.a)} · B (follower): ${rate(B.meter, meters0.b)}`);
const ping = (n: NetClient) => n.rtt;
if (ping(A.net) !== undefined) console.log(`measured ping A ${f((ping(A.net) ?? NaN) * 1000)} ms, B ${f((ping(B.net) ?? NaN) * 1000)} ms`);
A.net.disconnect(); B.net.disconnect();
await relay.close();
process.exit(0);
