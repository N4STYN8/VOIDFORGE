import { NetClient } from '../src/net.ts';
import { GameModel, type Enemy } from '../src/model.ts';
import { worldRef, progressionScore } from '../src/sectors.ts';
import { SharedLink } from '../src/sharedLink.ts';
import { LobbyShare } from '../src/lobbyShare.ts';
import { OUTPOST } from '../src/data.ts';

/**
 * Developer test pilot for the relay. It runs a real headless GameModel as the owner (and so the
 * authority) of a seeded sector, flies a slow circle inside its home station's safe ring and shares
 * rocks, enemies and shots like a browser would.
 *   node --experimental-strip-types scripts/relayBot.ts [ws://127.0.0.1:8787] [JOIN-CODE|-] [seed] [--raiders] [--visitor] [--orbit=N]
 * With no code (or "-") it creates a lobby and prints the invite code; a browser joins with
 * http://localhost:5173/?relay=ws://127.0.0.1:8787&join=CODE. `--raiders` adds a raider pack 900 units
 * from the station for testing shared enemies. `--visitor` joins no lobby and is not the sector owner (a
 * stranger for PvP tests, carrying 20 iron); `--orbit=N` sets the circle radius; `--fire` shoots at the nearest other
 * pilot (outside the station ring, so use a large orbit); `--mine` parks beside a rock outside the station ring
 * and mines it (to check remote beams); `--share` deposits plenty of minerals and shares them with the lobby.
 * `--horde` brings a level-4 horde in every 40 s (to load-test shared enemies). `--outpost` founds an outpost 700 units
 * east of the station, adds a wall block every 2 s and flies a drone around it (to check outposts and drones reach other pilots). It never touches browser saves.
 */
const args = process.argv.slice(2), outposting = args.includes('--outpost'), hordes = args.includes('--horde'), sharing = args.includes('--share'), mine = args.includes('--mine'), fire = args.includes('--fire'), raiders = args.includes('--raiders'), visitor = args.includes('--visitor'), orbit = Number(args.find(a => a.startsWith('--orbit='))?.slice(8) ?? 160), [url = 'ws://127.0.0.1:8787', code = '-', seed = 'relay-bot-world'] = args.filter(a => !a.startsWith('--'));
const model = new GameModel(seed), net = new NetClient(), link = new SharedLink(net, () => model), centre = { x: model.bases[0].x, y: model.bases[0].y }, clock = () => performance.now() / 1000, start = clock();
const share = new LobbyShare(net, () => model);
if (sharing) { share.enabled = true; model.stored = { iron: 5000, copper: 5000, crystal: 500, ice: 500, radioactive: 100 }; }
net.onNote = text => console.log(`[bot] ${text}`);
net.connect(url, visitor ? 'Stranger' : 'Test Pilot');
if (visitor) model.cargo.iron = 20; else if (code !== '-') net.join(code); else net.create();
if (raiders) for (let i = 0; i < 3; i++) (model as unknown as { spawnEnemy(kind: string, x: number, y: number, angle: number): Enemy }).spawnEnemy('raider', centre.x + 900 + i * 60, centre.y + 300, Math.PI);
let announced = '', reported = 0, diedAt = 0, hordeAt = -Infinity, builtAt = -Infinity;
if (outposting) {
  const cx = Math.floor((centre.x + 700) / OUTPOST.cell), cy = Math.floor(centre.y / OUTPOST.cell);
  model.outposts.push({ id: 1, name: 'Bot Outpost', cx, cy, structures: [{ id: 1, kind: 'outpostCore', cx, cy, rot: 0, level: 1, health: 400, progress: 1 }], revision: 1, energy: 0, drones: [] } as unknown as (typeof model.outposts)[number]);
}
setInterval(() => {
  const now = clock(), angle = (now - start) * 0.4;
  const target = (model.shared?.targets ?? []).slice().sort((a, b) => Math.hypot(a.x - model.player.x, a.y - model.player.y) - Math.hypot(b.x - model.player.x, b.y - model.player.y))[0];
  // A test pilot that dies respawns at its station after a moment, so checks are not cut short.
  if (model.dead && !model.rebuildDue && clock() - (diedAt ||= clock()) > 3) { model.respawn(); diedAt = 0; }
  if (hordes && clock() - hordeAt > 40 && model.enemies.filter(e => e.horde).length < 5) { hordeAt = clock(); (model as unknown as { horde: { angle: number }; spawnHorde(level: number): void }).horde.angle = Math.random() * 6.28; (model as unknown as { spawnHorde(level: number): void }).spawnHorde(4); console.log('[bot] horde incoming'); }
  const rock = mine ? model.asteroids.filter(a => Math.hypot(a.x - centre.x, a.y - centre.y) > 400 && a.amount > 0).sort((a, b) => Math.hypot(a.x - centre.x, a.y - centre.y) - Math.hypot(b.x - centre.x, b.y - centre.y))[0] : undefined;
  if (rock && !model.dead && Math.hypot(rock.x - model.player.x, rock.y - model.player.y) > rock.radius + 90) Object.assign(model.player, { x: rock.x - rock.radius - 60, y: rock.y, vx: 0, vy: 0 });
  model.update(0.05, { x: 0, y: 0, aim: rock ? { x: rock.x, y: rock.y } : target ? { x: target.x, y: target.y } : { x: centre.x, y: centre.y - 500 }, fire: fire && Boolean(target), mine: Boolean(rock), dock: false });
  if (!model.dead && !mine) Object.assign(model.player, { x: centre.x + Math.cos(angle) * orbit, y: centre.y + Math.sin(angle) * orbit, vx: -Math.sin(angle) * orbit * 0.4, vy: Math.cos(angle) * orbit * 0.4, angle: angle + Math.PI / 2 });
  net.setSector({ ...worldRef(model), spot: [Math.round(model.player.x), Math.round(model.player.y)] }, !visitor);
  const p = model.player;
  net.sendState(now, { x: p.x, y: p.y, vx: p.vx, vy: p.vy, angle: p.angle, health: p.health, maxHealth: model.maxHealth, paint: 3, thrust: true,
    blocks: [['core', 0, 0, model.coreLevel], ...model.modules.map(m => [m.kind, m.x, m.y, m.level] as [string, number, number, number])] });
  if (!visitor) net.profile(model.galaxy.home, progressionScore(model));
  if (outposting && now - builtAt > 2 && model.outposts[0] && model.outposts[0].structures.length < 40) {
    // A wall that grows east one block every two seconds, each one under construction for a moment.
    builtAt = now; const o = model.outposts[0], n = o.structures.length;
    for (const s of o.structures) s.progress = 1;
    o.structures.push({ id: n + 1, kind: 'wall', cx: o.cx + 1 + (n - 1) % 12, cy: o.cy + Math.floor((n - 1) / 12) - 1, rot: 0, level: 1, health: 60, progress: 0.3 } as (typeof o.structures)[number]); o.revision++;
  }
  if (outposting && model.outposts[0]) {
    // A drone circling the outpost with its beam on, set after the update (the bot's outpost has no hangar to keep it).
    const o = model.outposts[0], ox = (o.cx + 0.5) * OUTPOST.cell, oy = (o.cy + 0.5) * OUTPOST.cell, a = (now - start) * 0.8;
    const x = ox + Math.cos(a) * 160, y = oy + Math.sin(a) * 160;
    o.drones = [{ id: 1, hangar: 1, x, y, angle: a + Math.PI / 2, state: 'mining', load: 0, timer: 0, beam: { x: x + Math.cos(a) * 30, y: y + Math.sin(a) * 30 } }];
  }
  link.frame(model, now);
  share.frame(model, now);
  const lobby = net.lobby ? `${net.lobby.code}:${net.lobby.members.map(m => m.name).join(',')}` : '';
  if (lobby !== announced) { announced = lobby; if (net.lobby) console.log(`[bot] lobby ${net.lobby.code} members: ${net.lobby.members.map(m => m.name).join(', ')}`); }
  if (now - reported > 5) { reported = now; console.log(`[bot] role ${model.shared?.role ?? 'alone'} · enemies ${model.enemies.length} · pilots here ${net.room?.members ?? 1} · hull ${Math.round(model.player.health)} · targets ${(model.shared?.targets ?? []).map(t => `${Math.round(t.x)},${Math.round(t.y)}`).join(' ') || 'none'} · cargo ${model.cargoUsed}${model.rebuildDue ? ' · destroyed, rebuild due' : ''} · ${model.message}`); }
}, 50);
