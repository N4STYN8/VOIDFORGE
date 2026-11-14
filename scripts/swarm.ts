import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { NetClient } from '../src/net.ts';
import { GameModel, type Input } from '../src/model.ts';
import { enterWorld, ownsSector, progressionScore, returnHome, worldRef } from '../src/sectors.ts';
import { SharedLink } from '../src/sharedLink.ts';

/**
 * Simulated players for the relay: each bot is a real headless GameModel with its own seed, ship and home sector,
 * connected like a browser (ship state, shared-sector traffic, lobbies). Bots actually fly: they fight enemies in
 * range, mine the nearest rock, fly home to unload when the hold fills, and respawn after dying. A share of them
 * form three-pilot lobbies, so guests fly into the host's sector and the sector is shared. Bots never fire at other
 * pilots and never use matchmaking, so real players are not dragged in.
 *   node --experimental-strip-types scripts/swarm.ts [ws://127.0.0.1:8787] [bots=100] [seconds=300] [workers=8] [--prefix=Sim]
 * Bots are split across worker processes; each prints a summary every 10 s and all disconnect when time is up.
 */
type Args = { url: string; bots: number; seconds: number; workers: number; prefix: string; worker?: number; run: string };
function parse(argv: string[]): Args {
  const flag = (name: string) => argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const [url = 'ws://127.0.0.1:8787', bots = '100', seconds = '300', workers = '8'] = argv.filter(a => !a.startsWith('--'));
  return { url, bots: Number(bots), seconds: Number(seconds), workers: Math.max(1, Number(workers)), prefix: flag('prefix') ?? 'Sim', worker: flag('worker') === undefined ? undefined : Number(flag('worker')), run: flag('run') ?? Date.now().toString(36) };
}
const args = parse(process.argv.slice(2));
const TICK = 0.1, GROUP = 3, GROUPED_SHARE = 0.4;

if (args.worker === undefined) {
  // Coordinator: start the workers and pass their output through.
  const script = fileURLToPath(import.meta.url), children = Array.from({ length: Math.min(args.workers, args.bots) }, (_, w) =>
    spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', script, args.url, String(args.bots), String(args.seconds), String(args.workers), `--prefix=${args.prefix}`, `--worker=${w}`, `--run=${args.run}`], { stdio: 'inherit' }));
  console.log(`[swarm] ${args.bots} bots across ${children.length} workers -> ${args.url} for ${args.seconds}s (run ${args.run})`);
  const stop = () => { for (const c of children) c.kill('SIGINT'); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  let left = children.length;
  for (const c of children) c.on('exit', () => { if (--left === 0) { console.log('[swarm] all workers stopped'); process.exit(0); } });
} else {
  runWorker(args, args.worker);
}

type Bot = { n: number; name: string; net: NetClient; model: GameModel; link: SharedLink; leader?: Bot; diedAt: number; goal?: { x: number; y: number }; unloaded: number; ticks: number };

function runWorker(a: Args, w: number) {
  const workerCount = Math.min(a.workers, a.bots), clock = () => performance.now() / 1000, start = clock();
  const grouped = Math.floor(a.bots * GROUPED_SHARE / GROUP) * GROUP;
  const bots: Bot[] = [];
  // Lobby groups stay inside one worker so members can read the leader's lobby code directly.
  const owner = (n: number) => n < grouped ? Math.floor(n / GROUP) % workerCount : n % workerCount;
  for (let n = 0; n < a.bots; n++) {
    if (owner(n) !== w) continue;
    const name = `${a.prefix} ${String(n + 1).padStart(3, '0')}`, model = new GameModel(`${a.prefix.toLowerCase()}-${a.run}-${n}`), net = new NetClient();
    const bot: Bot = { n, name, net, model, link: undefined as unknown as SharedLink, diedAt: 0, unloaded: 0, ticks: 0 };
    bot.link = new SharedLink(net, () => bot.model);
    // Guests follow the host's world like the browser does (src/main.ts onLobbyWorld).
    net.onLobbyWorld = world => {
      if (!world) { if (bot.model.galaxy.away) bot.model = returnHome(bot.model); return; }
      if (net.isHost || world.seed === bot.model.seed) return;
      bot.model = enterWorld(bot.model, world, world.spot ? { x: world.spot[0], y: world.spot[1] } : undefined);
    };
    net.onAdmin = (ref, command) => net.adminAck(ref, false, `${name} is a simulated pilot.`, command.op === 'inspect' ? { simulated: true } : undefined);
    net.connect(a.url, name);
    if (n < grouped && n % GROUP === 0) net.create(false);
    bots.push(bot);
  }
  for (const b of bots) if (b.n < grouped && b.n % GROUP) b.leader = bots.find(o => o.n === b.n - b.n % GROUP);

  let ms = 0, samples = 0, lastReport = clock();
  const timer = setInterval(() => {
    const now = clock(), t0 = performance.now();
    for (const b of bots) step(b, now);
    ms += performance.now() - t0; samples++;
    if (now - lastReport >= 10) {
      lastReport = now;
      const online = bots.filter(b => b.net.connected).length, dead = bots.filter(b => b.model.dead).length, kills = bots.reduce((s, b) => s + b.model.kills, 0);
      const unloaded = bots.reduce((s, b) => s + b.unloaded, 0), lobbies = bots.filter(b => b.net.lobby).length, shared = bots.filter(b => b.net.sharing).length;
      console.log(`[worker ${w}] ${online}/${bots.length} online · ${lobbies} in lobbies · ${shared} sharing a sector · ${dead} dead · ${kills} kills · ${unloaded} ore unloaded · tick ${(ms / Math.max(1, samples)).toFixed(1)} ms`);
      ms = 0; samples = 0;
    }
    if (now - start >= a.seconds) finish();
  }, TICK * 1000);
  const finish = () => { clearInterval(timer); for (const b of bots) b.net.disconnect(); setTimeout(() => process.exit(0), 300); };
  process.on('SIGINT', finish); process.on('SIGTERM', finish);
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
/** One simulated pilot's turn: decide, fly, and send what a browser would. */
function step(b: Bot, now: number) {
  const { net } = b;
  if (b.leader && !b.net.lobby && b.leader.net.lobby && b.net.connected) net.join(b.leader.net.lobby.code);
  const model = b.model, p = model.player;
  if (model.dead) {
    if (!b.diedAt) b.diedAt = now;
    if (now - b.diedAt > 3 && !model.rebuildDue) { model.respawn(); b.diedAt = 0; }
  }
  const input: Input = { x: 0, y: 0, aim: { x: p.x + Math.cos(p.angle) * 200, y: p.y + Math.sin(p.angle) * 200 }, fire: false, mine: false, dock: false };
  if (!model.dead) {
    const enemy = model.enemies.filter(e => e.health > 0 && dist(e, p) < 750).sort((x, y) => dist(x, p) - dist(y, p))[0];
    const full = model.cargoUsed >= model.cargoCapacity * 0.8;
    if (full) {
      const base = model.nearestUnlockedBase;
      if (model.atStation) input.dock = true;
      else fly(input, p, base, 120);
    } else if (enemy) {
      input.aim = { x: enemy.x, y: enemy.y }; input.fire = true;
      const away = Math.atan2(p.y - enemy.y, p.x - enemy.x) + 0.6;
      fly(input, p, { x: enemy.x + Math.cos(away) * 380, y: enemy.y + Math.sin(away) * 380 }, 60);
    } else {
      const rock = model.asteroids.filter(r => r.amount > 0 && dist(r, p) < 3500).sort((x, y) => dist(x, p) - dist(y, p))[0];
      if (rock) {
        input.aim = { x: rock.x, y: rock.y };
        if (dist(rock, p) < rock.radius + 170) { input.mine = true; brake(input, p); } else fly(input, p, rock, rock.radius + 120);
      } else {
        if (!b.goal || dist(b.goal, p) < 300) b.goal = { x: p.x + (Math.random() - 0.5) * 6000, y: p.y + (Math.random() - 0.5) * 6000 };
        fly(input, p, b.goal, 200);
      }
    }
  }
  const held = model.cargoUsed;
  model.update(TICK, input);
  if (input.dock) b.unloaded += Math.max(0, held - model.cargoUsed);
  b.ticks++;
  const world = worldRef(model);
  net.setSector({ ...world, spot: [Math.round(model.player.x), Math.round(model.player.y)] }, ownsSector(model));
  const q = model.player;
  net.sendState(now + 0.01, { x: q.x, y: q.y, vx: q.vx, vy: q.vy, angle: q.angle, health: q.health, maxHealth: model.maxHealth, paint: b.n % 8, dead: model.dead || undefined, thrust: input.x !== 0 || input.y !== 0,
    blocks: [['core', 0, 0, model.coreLevel], ...model.modules.map(m => [m.kind, m.x, m.y, m.level] as [string, number, number, number])] });
  if (b.ticks % 50 === 1) net.profile(model.galaxy.home, progressionScore(model));
  b.link.frame(model, now);
}
/** Thrust toward a point, easing off and braking as the ship arrives. */
function fly(input: Input, p: { x: number; y: number; vx: number; vy: number }, to: { x: number; y: number }, stop: number) {
  const dx = to.x - p.x, dy = to.y - p.y, d = Math.hypot(dx, dy);
  if (d < stop) { brake(input, p); return; }
  const speed = Math.hypot(p.vx, p.vy), want = Math.min(260, d * 0.8);
  // Steer the velocity toward the wanted velocity: thrust along the difference.
  const tx = dx / d * want - p.vx, ty = dy / d * want - p.vy, m = Math.hypot(tx, ty);
  if (m > 8 || speed < 20) { input.x = tx / Math.max(1, m); input.y = ty / Math.max(1, m); }
}
function brake(input: Input, p: { vx: number; vy: number }) {
  const s = Math.hypot(p.vx, p.vy);
  if (s > 15) { input.x = -p.vx / s; input.y = -p.vy / s; }
}
