import { spawn } from 'node:child_process';
import { NetClient } from '../src/net.ts';
import { NET } from '../src/netProtocol.ts';
import { encodeEnemies } from '../src/shared.ts';
import { SHARE_RATES } from '../src/sharedLink.ts';

/**
 * Relay load test: many headless pilots in sector rooms, each sending ship state at NET.stateHz, room
 * authorities casting a 20-enemy list at SHARE_RATES.enemies, a quarter of rooms in lobbies. Starts its own relay as a child
 * process (so the relay's CPU is measured on its own) unless a URL is given.
 *   node --experimental-strip-types scripts/loadTest.ts [clients=1000] [roomSize=4] [seconds=20] [ws://host:port]
 * Reports relay CPU, memory, frames and bytes per second, skipped (backed-up) updates and end-to-end latency.
 */
const [clientsArg = '1000', roomArg = '4', secondsArg = '20', urlArg] = process.argv.slice(2);
const total = Number(clientsArg), roomSize = Math.max(1, Number(roomArg)), seconds = Number(secondsArg);
const clock = () => performance.now() / 1000;

async function relayUrl(): Promise<{ url: string; stop: () => void }> {
  if (urlArg) return { url: urlArg, stop: () => {} };
  const child = spawn(process.execPath, ['--experimental-strip-types', 'server/main.ts'], { env: { ...process.env, PORT: '0', HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'inherit'] });
  const port = await new Promise<number>((resolve, reject) => {
    child.stdout.on('data', chunk => { const m = /:(\d+)\s*$/m.exec(String(chunk)); if (m) resolve(Number(m[1])); });
    child.once('exit', code => reject(new Error(`relay exited ${code}`)));
  });
  return { url: `ws://127.0.0.1:${port}`, stop: () => child.kill() };
}
const statsOf = async (url: string) => (await fetch(url.replace(/^ws/, 'http') + '/stats')).json() as Promise<{ clients: number; framesOut: number; bytesOut: number; messagesIn: number; skipped: number; cpuMs: number; rssMb: number }>;

const { url, stop } = await relayUrl();
console.log(`relay ${url}: ${total} pilots, ${roomSize} per sector, ${seconds}s`);
const latencies: number[] = []; let received = 0;
const enemies = encodeEnemies(Array.from({ length: 20 }, (_, i) => ({ id: 1000 + i, kind: 'raider' as const, x: 5000 + i * 40, y: 5000, angle: 0, health: 60 })));
const pilots = Array.from({ length: total }, (_, i) => {
  const net = new NetClient(), room = Math.floor(i / roomSize), lead = i % roomSize === 0;
  const receive = net.receive.bind(net);
  net.receive = (raw: string, now?: number) => {
    if (raw.startsWith('{"t":"state"')) { received++; const sent = JSON.parse(raw).s[2]; if (latencies.length < 200000) latencies.push((performance.now() % 1e5 - sent + 1e5) % 1e5); }
    receive(raw, now);
  };
  return { net, room, lead, lobby: lead && room % 4 === 0, x: 5000 + (i % roomSize) * 150, y: 5000 + room % 50 };
});
// Ramp up in batches so the relay sees a realistic arrival rate rather than one burst.
for (let i = 0; i < pilots.length; i += 50) {
  for (const p of pilots.slice(i, i + 50)) { p.net.connect(url, `Load ${p.room}`); p.net.setSector({ home: `load-${p.room}`, x: 0, y: 0, seed: `load-${p.room}` }, p.lead); }
  await new Promise(r => setTimeout(r, 100));
}
for (let t = 0; t < 100 && pilots.some(p => !p.net.connected); t++) await new Promise(r => setTimeout(r, 100));
console.log(`connected ${pilots.filter(p => p.net.connected).length}/${total}`);
for (const p of pilots) if (p.lobby) p.net.create();
await new Promise(r => setTimeout(r, 500));
for (const p of pilots) if (!p.lead) { const lead = pilots[p.room * roomSize]; if (lead.lobby && lead.net.lobby) p.net.join(lead.net.lobby.code); }

const before = await statsOf(url), startWall = Date.now(); let lastEnemies = 0;
const timer = setInterval(() => {
  const now = clock(), sendMs = Math.round(performance.now() % 1e5 * 10) / 10, castEnemies = now - lastEnemies >= 1 / SHARE_RATES.enemies;
  if (castEnemies) lastEnemies = now;
  for (const p of pilots) {
    p.x += Math.cos(now + p.room) * 3; p.y += Math.sin(now + p.room) * 3;
    p.net.sendState(now, { x: p.x, y: p.y, vx: sendMs, vy: 0, angle: 0, health: 100, maxHealth: 100, paint: 0, blocks: [['core', 0, 0, 1], ['cannon', 1, 0, 1]] });
    if (castEnemies && p.net.authority) p.net.cast('enemies', enemies);
  }
}, 1000 / NET.stateHz / 2);
await new Promise(r => setTimeout(r, seconds * 1000));
clearInterval(timer);
const after = await statsOf(url), wall = (Date.now() - startWall) / 1000;
latencies.sort((a, b) => a - b);
const q = (p: number) => latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(p * latencies.length))].toFixed(1) : 'n/a';
console.log(JSON.stringify({
  pilots: after.clients, seconds: Math.round(wall),
  relayCpuPercent: Math.round((after.cpuMs - before.cpuMs) / (wall * 1000) * 100), relayRssMb: after.rssMb,
  messagesInPerSec: Math.round((after.messagesIn - before.messagesIn) / wall), framesOutPerSec: Math.round((after.framesOut - before.framesOut) / wall),
  megabitsOutPerSec: +((after.bytesOut - before.bytesOut) * 8 / wall / 1e6).toFixed(2), skippedBackedUp: after.skipped - before.skipped,
  statesReceived: received, latencyMs: { p50: q(0.5), p95: q(0.95), p99: q(0.99) },
}, null, 1));
for (const p of pilots) p.net.disconnect();
stop();
process.exit(0);
