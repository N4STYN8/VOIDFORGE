import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startRelay, type Relay, type RelayOptions } from '../server/relay.ts';
import { passwordMatches, parseCookies } from '../server/admin.ts';
import { NET, parseServer, type ServerMessage, type ShipState } from '../src/netProtocol.ts';
import type { AdminServerMessage } from '../src/adminProtocol.ts';
import { NetClient } from '../src/net.ts';
import { SharedLink } from '../src/sharedLink.ts';
import { GameModel } from '../src/model.ts';
import { worldRef } from '../src/sectors.ts';

const PASSWORD = 'correct horse';
const adminDir = (() => { const dir = mkdtempSync(join(tmpdir(), 'vf-admin-')); writeFileSync(join(dir, 'index.html'), '<!doctype html><title>admin</title>'); return dir; })();
const relayWith = (admin: RelayOptions['admin'] = {}) => startRelay({ port: 0, host: '127.0.0.1', admin: { password: PASSWORD, dir: adminDir, ...admin } });

type Reply = { status: number; headers: Record<string, string | string[] | undefined>; body: string };
function http(relay: Relay, method: string, path: string, headers: Record<string, string> = {}, body?: string): Promise<Reply> {
  return new Promise((done, fail) => {
    const req = request({ agent: false, host: '127.0.0.1', port: relay.port, method, path, headers: body ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': String(Buffer.byteLength(body)), ...headers } : headers }, res => {
      let text = ''; res.on('data', c => text += c); res.on('end', () => done({ status: res.statusCode ?? 0, headers: res.headers, body: text }));
    });
    req.on('error', fail); req.end(body);
  });
}
const loginWith = (relay: Relay, password: string, headers: Record<string, string> = {}) => http(relay, 'POST', '/admin/login', headers, `password=${encodeURIComponent(password)}`);
async function cookie(relay: Relay) {
  const reply = await loginWith(relay, PASSWORD);
  assert.equal(reply.status, 303);
  const set = String(reply.headers['set-cookie']);
  return set.split(';')[0];
}
/** Status of a raw WebSocket upgrade attempt: 101 on success. */
function upgradeStatus(relay: Relay, path: string, headers: Record<string, string>): Promise<number> {
  return new Promise((done, fail) => {
    const req = request({ agent: false, host: '127.0.0.1', port: relay.port, path, headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', 'Sec-WebSocket-Version': '13', ...headers } });
    req.on('upgrade', (_res, socket) => { socket.destroy(); done(101); });
    req.on('response', res => { res.resume(); done(res.statusCode ?? 0); });
    req.on('error', fail); req.end();
  });
}
const origin = (relay: Relay) => `http://127.0.0.1:${relay.port}`;

async function inbox<T extends { t: string }>(socket: WebSocket, parse: (raw: string) => T | undefined, name: string) {
  const messages: T[] = [];
  socket.addEventListener('message', event => { const m = parse(String(event.data)); if (m) messages.push(m); });
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  const next = async <K extends T['t']>(t: K, where: (m: Extract<T, { t: K }>) => boolean = () => true, tries = 200) => {
    for (let i = 0; i < tries; i++) {
      const index = messages.findIndex(m => m.t === t && where(m as Extract<T, { t: K }>));
      if (index >= 0) return messages.splice(index, 1)[0] as Extract<T, { t: K }>;
      await new Promise(r => setTimeout(r, 5));
    }
    throw new Error(`${name}: no ${t} message`);
  };
  return { socket, messages, next, send: (m: object) => socket.send(JSON.stringify(m)), close: () => socket.close() };
}
/** A logged-in admin console socket. */
async function admin(relay: Relay) {
  const socket = new WebSocket(`ws://127.0.0.1:${relay.port}/admin/ws`, { headers: { cookie: await cookie(relay), origin: origin(relay) } } as unknown as string[]);
  return inbox<AdminServerMessage>(socket, raw => JSON.parse(raw), 'admin');
}
/** A game client; `headers` lets a test pose as a pilot behind the proxy. */
async function pilot(relay: Relay, name: string, headers: Record<string, string> = {}) {
  const socket = new WebSocket(`ws://127.0.0.1:${relay.port}`, { headers } as unknown as string[]);
  const box = await inbox<ServerMessage>(socket, parseServer, name);
  const welcome = await box.next('welcome');
  box.send({ t: 'hello', v: NET.version, name });
  return { ...box, id: welcome.id };
}
const ship = (x: number, y = 100): ShipState => ({ x, y, vx: 0, vy: 0, angle: 0.5, health: 100, maxHealth: 100, paint: 0, blocks: [['core', 0, 0, 1]] });
const world = (seed: string) => ({ home: 'home-seed', x: 0, y: 0, seed });
const closed = (socket: WebSocket) => socket.readyState === WebSocket.CLOSED ? Promise.resolve() : new Promise(r => socket.addEventListener('close', r, { once: true }));
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));

test('password check and cookie parsing', () => {
  assert.ok(passwordMatches('a', 'a'));
  assert.ok(!passwordMatches('a', 'ab'));
  assert.ok(!passwordMatches('', 'a'));
  assert.deepEqual(parseCookies('a=1; vf_admin=abc%20d'), { a: '1', vf_admin: 'abc d' });
});

test('with no admin password every admin path is a 404', async () => {
  const relay = await startRelay({ port: 0, host: '127.0.0.1' });
  try {
    assert.equal((await http(relay, 'GET', '/admin/')).status, 404);
    assert.equal((await loginWith(relay, '')).status, 404);
    assert.equal(await upgradeStatus(relay, '/admin/ws', { Origin: origin(relay) }), 404);
  } finally { await relay.close(); }
});

test('login, session cookie, static page and lockout', async () => {
  const relay = await relayWith();
  try {
    const anonymous = await http(relay, 'GET', '/admin/');
    assert.equal(anonymous.status, 302); assert.equal(anonymous.headers.location, '/admin/login');
    assert.equal((await http(relay, 'GET', '/admin/login')).status, 200);
    assert.equal((await loginWith(relay, 'wrong')).status, 401);
    const good = await loginWith(relay, PASSWORD);
    assert.equal(good.status, 303);
    const set = String(good.headers['set-cookie']);
    for (const part of ['HttpOnly', 'SameSite=Strict', 'Path=/admin']) assert.ok(set.includes(part), set);
    assert.ok(!set.includes('Secure'), 'plain http has no Secure flag');
    const page = await http(relay, 'GET', '/admin/', { cookie: set.split(';')[0] });
    assert.equal(page.status, 200); assert.ok(page.body.includes('<title>admin</title>'));
    assert.equal(page.headers['cache-control'], 'no-store'); assert.equal(page.headers['x-frame-options'], 'DENY');
    assert.equal((await http(relay, 'GET', '/admin/../package.json', { cookie: set.split(';')[0] })).status !== 200, true);
    assert.equal((await http(relay, 'GET', '/admin/', { cookie: 'vf_admin=forged' })).status, 302);
    for (let i = 0; i < 5; i++) assert.equal((await loginWith(relay, 'wrong')).status, 401);
    assert.equal((await loginWith(relay, PASSWORD)).status, 429, 'locked out after five failures');
  } finally { await relay.close(); }
});

test('a session expires after twelve hours', async () => {
  let clock = 1_000_000;
  const relay = await relayWith({ now: () => clock });
  try {
    const c = await cookie(relay);
    assert.equal((await http(relay, 'GET', '/admin/', { cookie: c })).status, 200);
    clock += 12 * 3600 * 1000 + 1;
    assert.equal((await http(relay, 'GET', '/admin/', { cookie: c })).status, 302);
    assert.equal(await upgradeStatus(relay, '/admin/ws', { cookie: c, Origin: origin(relay) }), 401);
  } finally { await relay.close(); }
});

test('the admin socket needs a session and its own origin, and is capped', async () => {
  const relay = await relayWith();
  try {
    const c = await cookie(relay);
    assert.equal(await upgradeStatus(relay, '/admin/ws', { Origin: origin(relay) }), 401);
    assert.equal(await upgradeStatus(relay, '/admin/ws', { cookie: c, Origin: 'https://evil.example' }), 403);
    assert.equal(await upgradeStatus(relay, '/admin/ws', { cookie: c, Origin: 'https://n4styn8.github.io' }), 403, 'player origins do not open the admin socket');
    const consoles = await Promise.all([1, 2, 3, 4].map(() => admin(relay)));
    assert.equal(await upgradeStatus(relay, '/admin/ws', { cookie: c, Origin: origin(relay) }), 503);
    const first = consoles[0];
    await first.next('overview');
    for (const a of consoles) a.close();
  } finally { await relay.close(); }
});

test('bans block reconnects by forwarded IP and expire; public pages leak no names', async () => {
  let clock = 5_000_000;
  const dir = mkdtempSync(join(tmpdir(), 'vf-bans-')), bansFile = join(dir, 'bans.json');
  writeFileSync(bansFile, '{not json');
  const relay = await relayWith({ trustProxy: true, bansFile, now: () => clock });
  try {
    const victim = await pilot(relay, 'Griefer', { 'x-forwarded-for': '203.0.113.9' });
    const a = await admin(relay);
    const overview = await a.next('overview', m => m.pilots.some(p => p.name === 'Griefer'));
    assert.equal(overview.pilots.find(p => p.name === 'Griefer')!.ip, '203.0.113.9');
    a.send({ t: 'ban', ref: 1, id: victim.id, minutes: 10, reason: 'griefing' });
    assert.equal((await a.next('result', m => m.ref === 1)).ok, true);
    await closed(victim.socket);
    assert.equal(await upgradeStatus(relay, '/', { 'x-forwarded-for': '203.0.113.9' }), 403);
    assert.equal(await upgradeStatus(relay, '/', { 'x-forwarded-for': '203.0.113.10' }), 101);
    clock += 11 * 60000;
    assert.equal(await upgradeStatus(relay, '/', { 'x-forwarded-for': '203.0.113.9' }), 101, 'the ban expired');
    const health = await http(relay, 'GET', '/'), stats = await http(relay, 'GET', '/stats');
    assert.ok(!health.body.includes('Griefer') && !stats.body.includes('Griefer') && !stats.body.includes('203.0.113'));
    a.close();
  } finally { await relay.close(); }
});

test('overview lists pilots and lobbies; kick, rename, disband, remove and open act on them', async () => {
  const relay = await relayWith({ trustProxy: true });
  try {
    const host = await pilot(relay, 'Host', { 'x-forwarded-for': '198.51.100.1' }), guest = await pilot(relay, 'Guest', { 'x-forwarded-for': '198.51.100.2' });
    host.send({ t: 'create' });
    const { code } = await host.next('lobby');
    guest.send({ t: 'join', code }); await guest.next('lobby');
    host.send({ t: 'sector', world: world('s1'), owner: true }); guest.send({ t: 'sector', world: world('s1') });
    host.send({ t: 'state', s: ship(100) });
    const a = await admin(relay);
    const view = await a.next('overview', m => m.pilots.some(p => p.name === 'Host' && p.at) && m.pilots.some(p => p.name === 'Guest' && p.room === 's1'));
    const h = view.pilots.find(p => p.name === 'Host')!;
    assert.equal(h.room, 's1'); assert.equal(h.lobby, code); assert.equal(h.authority, true); assert.deepEqual(h.at, { x: 100, y: 100 }); assert.equal(h.angle, 0.5);
    assert.ok(h.ip.length > 0 && h.since > 0 && h.rate >= 0);
    assert.equal(view.pilots.find(p => p.name === 'Guest')!.authority, false);
    assert.equal(view.lobbies.find(l => l.code === code)!.members.length, 2);
    assert.equal(view.rooms.find(r => r.seed === 's1')!.members, 2);

    a.send({ t: 'rename', ref: 1, id: guest.id, name: 'Renamed' });
    assert.equal((await a.next('result', m => m.ref === 1)).ok, true);
    assert.equal((await guest.next('admin')).c.op, 'rename');
    await a.next('overview', m => m.pilots.some(p => p.name === 'Renamed'));

    a.send({ t: 'lobby-open', ref: 2, code, open: true });
    await a.next('overview', m => m.lobbies.some(l => l.code === code && l.open));
    a.send({ t: 'remove', ref: 3, code, id: guest.id });
    await guest.next('left-lobby');
    guest.send({ t: 'join', code }); await guest.next('lobby');
    a.send({ t: 'disband', ref: 4, code });
    await host.next('left-lobby'); await guest.next('left-lobby');
    await a.next('overview', m => !m.lobbies.some(l => l.code === code));

    a.send({ t: 'kick', ref: 5, id: guest.id, reason: 'test' });
    assert.equal((await a.next('result', m => m.ref === 5)).ok, true);
    await closed(guest.socket);
    await a.next('log', m => m.entries.some(e => e.action === 'kick'));
    const after = await a.next('overview', m => m.pilots.length === 1);
    assert.ok(after.bans.some(b => b.reason.startsWith('Kicked')), 'a kick keeps the address out briefly');
    host.close(); a.close();
  } finally { await relay.close(); }
});

test('locking a sector evicts non-owners and turns newcomers away, but admits the owner', async () => {
  const relay = await relayWith();
  try {
    const visitor = await pilot(relay, 'Visitor');
    visitor.send({ t: 'sector', world: world('s2') });
    const a = await admin(relay);
    await a.next('overview', m => m.rooms.some(r => r.seed === 's2'));
    a.send({ t: 'lock', ref: 1, seed: 's2', locked: true });
    assert.equal((await visitor.next('admin', m => m.c.op === 'evict')).c.op, 'evict');
    const late = await pilot(relay, 'Late');
    late.send({ t: 'sector', world: world('s2') });
    const bounce = await late.next('admin');
    assert.deepEqual(bounce.c, { op: 'evict', reason: 'This sector is locked.' });
    const owner = await pilot(relay, 'Owner');
    owner.send({ t: 'sector', world: world('s2'), owner: true });
    const room = await owner.next('room');
    assert.equal(room.authority, owner.id);
    const view = await a.next('overview', m => m.rooms.some(r => r.seed === 's2' && r.locked));
    assert.equal(view.pilots.find(p => p.name === 'Late')!.room, undefined);
    visitor.close(); late.close(); owner.close(); a.close();
  } finally { await relay.close(); }
});

test('a watching admin gets the whole room unfiltered by distance, bounded, and released when it empties', async () => {
  const relay = await relayWith();
  try {
    const near = await pilot(relay, 'Near'), far = await pilot(relay, 'Far');
    near.send({ t: 'sector', world: world('s3'), owner: true }); far.send({ t: 'sector', world: world('s3') });
    near.send({ t: 'state', s: ship(100) });
    const a = await admin(relay);
    a.send({ t: 'watch', ref: 1, rooms: ['s3'] });
    await a.next('result', m => m.ref === 1);
    far.send({ t: 'state', s: ship(100 + NET.interest * 3) });
    const seen = await a.next('obs', m => m.r === 's3' && m.m.t === 'state' && m.m.id === far.id);
    assert.equal(seen.m.t, 'state');
    near.send({ t: 'cast', k: 'fx', d: { c: 12 } });
    await a.next('obs', m => m.m.t === 'cast' && m.m.from === near.id);
    a.send({ t: 'watch', ref: 2, rooms: ['a', 'b', 'c', 'd'] });
    assert.equal((await a.next('result', m => m.ref === 2)).ok, false);
    // Over the per-room cast budget the observer copy is dropped while room members still get every cast.
    const blob = 'x'.repeat(14000);
    for (let i = 0; i < 9; i++) near.send({ t: 'cast', k: 'fx', d: { blob } });
    for (let i = 0; i < 9; i++) await far.next('cast', m => m.from === near.id);
    const view = await a.next('overview', m => (m.stats.obsDropped ?? 0) > 0);
    assert.ok(view.stats.obsDropped > 0);
    near.close(); far.close();
    await a.next('obs', m => m.m.t === 'gone' && m.m.id === far.id || m.m.t === 'gone' && m.m.id === near.id);
    await a.next('overview', m => !m.rooms.some(r => r.seed === 's3'));
    a.close();
  } finally { await relay.close(); }
});

test('client-run commands: acks become reports and results, silence becomes no response, stray acks are dropped', async () => {
  const relay = await relayWith({ resultTimeout: 150 });
  try {
    const p1 = await pilot(relay, 'One'), p2 = await pilot(relay, 'Two');
    p1.send({ t: 'sector', world: world('s4'), owner: true }); p2.send({ t: 'sector', world: world('s4') });
    const a = await admin(relay);
    await a.next('overview', m => m.rooms.some(r => r.seed === 's4' && r.members === 2));
    a.send({ t: 'inspect', ref: 1, id: p1.id });
    const asked = await p1.next('admin', m => m.c.op === 'inspect');
    p2.send({ t: 'admin-ack', ref: asked.ref, ok: true, data: { forged: true } });
    p1.send({ t: 'admin-ack', ref: 999999, ok: true });
    p1.send({ t: 'admin-ack', ref: asked.ref, ok: true, data: { x: 1 } });
    const report = await a.next('report', m => m.ref === 1);
    assert.deepEqual(report.data, { x: 1 }, 'only the asked pilot can answer');
    assert.equal((await a.next('result', m => m.ref === 1)).ok, true);
    await pause(30);
    assert.equal(a.messages.filter(m => m.t === 'result').length, 0, 'stray acks produce no result');

    a.send({ t: 'cargo', ref: 2, id: p2.id, target: 'cargo', delta: { iron: 5 } });
    await p2.next('admin', m => m.c.op === 'cargo');
    const silent = await a.next('result', m => m.ref === 2);
    assert.deepEqual([silent.ok, silent.message], [false, 'no response']);

    a.send({ t: 'spawn', ref: 3, seed: 's4', kind: 'raider', count: 2, x: 100, y: 100 });
    const spawn = await p1.next('admin', m => m.c.op === 'spawn');
    assert.deepEqual(spawn.c, { op: 'spawn', kind: 'raider', count: 2, x: 100, y: 100 });
    await pause(30);
    assert.ok(!p2.messages.some(m => m.t === 'admin' && m.c.op === 'spawn'), 'spawns go to the sector authority only');

    a.send({ t: 'broadcast', ref: 4, to: { all: true }, text: 'Server restart soon' });
    for (const p of [p1, p2]) assert.deepEqual((await p.next('admin', m => m.c.op === 'notice')).c, { op: 'notice', text: 'Server restart soon' });
    assert.match((await a.next('result', m => m.ref === 4)).message ?? '', /2 pilots/);
    p1.close(); p2.close(); a.close();
  } finally { await relay.close(); }
});

test('evicting or teleporting a lobby guest out of the host sector also removes them from the lobby', async () => {
  const relay = await relayWith({ resultTimeout: 150 });
  try {
    const host = await pilot(relay, 'Host'), guest = await pilot(relay, 'Guest'), other = await pilot(relay, 'Other');
    host.send({ t: 'create' });
    const { code } = await host.next('lobby');
    guest.send({ t: 'join', code }); await guest.next('lobby');
    other.send({ t: 'join', code }); await other.next('lobby');
    for (const p of [guest, other]) p.send({ t: 'sector', world: world('guest-zone') });
    host.send({ t: 'sector', world: world('host-zone'), owner: true });
    const a = await admin(relay);
    await a.next('overview', m => m.rooms.some(r => r.seed === 'guest-zone' && r.members === 2));
    a.send({ t: 'evict', ref: 1, seed: 'guest-zone' });
    const evicted = await guest.next('admin', m => m.c.op === 'evict');
    guest.send({ t: 'admin-ack', ref: evicted.ref, ok: true });
    await guest.next('left-lobby');
    await other.next('left-lobby');
    assert.match((await a.next('result', m => m.ref === 1)).message ?? '', /Evicted 1 pilot/);

    guest.send({ t: 'join', code }); await guest.next('lobby', m => m.members.length === 2);
    a.send({ t: 'teleport', ref: 2, id: guest.id, x: 10, y: 10, cell: [2, 0] });
    await guest.next('admin', m => m.c.op === 'teleport');
    await guest.next('left-lobby');
    host.close(); guest.close(); other.close(); a.close();
  } finally { await relay.close(); }
});

test('review fixes: parallel wrong logins still lock out, a NUL path cannot crash the relay', async () => {
  const relay = await relayWith();
  try {
    const burst = await Promise.all(Array.from({ length: 12 }, () => loginWith(relay, 'wrong')));
    assert.ok(burst.filter(r => r.status === 429).length >= 7, 'a parallel burst is limited like sequential tries');
    assert.equal((await loginWith(relay, PASSWORD)).status, 429);
  } finally { await relay.close(); }
  const other = await relayWith();
  try {
    const c = await cookie(other);
    assert.equal((await http(other, 'GET', '/admin/%00', { cookie: c })).status, 400);
    assert.equal((await http(other, 'GET', '/admin/', { cookie: c })).status, 200, 'still serving');
  } finally { await other.close(); }
});

test('review fixes: loopback addresses are never banned, and a dead admin socket is reaped', async () => {
  const relay = await relayWith({ pingMs: 60 });
  try {
    const local = await pilot(relay, 'Local');
    const a = await admin(relay);
    await a.next('overview', m => m.pilots.some(p => p.name === 'Local'));
    a.send({ t: 'ban', ref: 1, id: local.id, minutes: 5 });
    const refused = await a.next('result', m => m.ref === 1);
    assert.equal(refused.ok, false); assert.match(refused.message ?? '', /TRUST_PROXY/);
    a.send({ t: 'kick', ref: 2, id: local.id });
    await a.next('result', m => m.ref === 2);
    const view = await a.next('overview');
    assert.equal(view.bans.length, 0, 'a kick does not block a loopback address');
    // A raw upgraded socket never answers pings, like a sleeping laptop: the relay closes it.
    const raw = await new Promise<import('node:net').Socket>((done, fail) => {
      void cookie(relay).then(c => {
        const req = request({ agent: false, host: '127.0.0.1', port: relay.port, path: '/admin/ws', headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', 'Sec-WebSocket-Version': '13', cookie: c, Origin: origin(relay) } });
        req.on('upgrade', (_res, socket) => done(socket as import('node:net').Socket)); req.on('error', fail); req.end();
      });
    });
    await new Promise<void>((done, fail) => { const timer = setTimeout(() => fail(new Error('dead admin socket was not reaped')), 2000); raw.on('close', () => { clearTimeout(timer); done(); }); raw.resume(); });
    a.close();
  } finally { await relay.close(); }
});

test('rooms learn when an admin watches them, and stop being marked when the watch ends', async () => {
  const relay = await relayWith();
  try {
    const solo = await pilot(relay, 'Solo');
    solo.send({ t: 'sector', world: world('s5'), owner: true });
    assert.equal((await solo.next('room')).watched, undefined);
    const a = await admin(relay);
    a.send({ t: 'watch', ref: 1, rooms: ['s5'] });
    assert.equal((await solo.next('room', m => m.watched === true)).members, 1);
    a.send({ t: 'watch', ref: 2, rooms: [] });
    await solo.next('room', m => !m.watched);
    a.send({ t: 'watch', ref: 3, rooms: ['s5'] });
    await solo.next('room', m => m.watched === true);
    a.close();
    await solo.next('room', m => !m.watched);
    solo.close();
  } finally { await relay.close(); }
});

test('a watched solo pilot sends an observer feed of its enemies and fire without entering shared mode', async () => {
  const relay = await relayWith();
  const net = new NetClient(), model = new GameModel('observed-solo'), link = new SharedLink(net, () => model);
  try {
    const at = model.player;
    (model as unknown as { spawnEnemy(kind: string, x: number, y: number, angle: number): unknown }).spawnEnemy('raider', at.x + 300, at.y, 0);
    net.connect(`ws://127.0.0.1:${relay.port}`, 'Solo');
    net.setSector(worldRef(model), true);
    const a = await admin(relay);
    const clock = () => performance.now() / 1000;
    for (let i = 0; i < 100 && !net.room; i++) { link.frame(model, clock()); await pause(10); }
    a.send({ t: 'watch', ref: 1, rooms: [model.seed] });
    let feed: Extract<AdminServerMessage, { t: 'obs' }> | undefined;
    for (let i = 0; i < 150 && !feed; i++) {
      link.frame(model, clock()); await pause(10);
      const index = a.messages.findIndex(m => m.t === 'obs' && m.m.t === 'cast' && m.m.k === 'fx' && Array.isArray((m.m.d as { n?: unknown }).n));
      if (index >= 0) feed = a.messages.splice(index, 1)[0] as Extract<AdminServerMessage, { t: 'obs' }>;
    }
    assert.ok(feed, 'the watched solo pilot cast its enemies');
    const fx = (feed!.m as { d: { n: unknown[][]; f?: number } }).d;
    assert.equal(fx.f, 1); assert.equal(fx.n[0][1], 'raider');
    assert.equal(model.shared, undefined, 'single-player rules stay in force');
    // Unwatched again: the feed stops.
    a.send({ t: 'watch', ref: 2, rooms: [] });
    for (let i = 0; i < 40; i++) { link.frame(model, clock()); await pause(10); }
    a.messages.length = 0;
    for (let i = 0; i < 40; i++) { link.frame(model, clock()); await pause(10); }
    assert.ok(!a.messages.some(m => m.t === 'obs'), 'no feed once nobody watches');
    a.close();
  } finally { net.disconnect(); await relay.close(); }
});

test('v2: the activity feed reports joins, leaves, deaths, respawns and lobby changes', async () => {
  const relay = await relayWith();
  try {
    const a = await admin(relay);
    const p = await pilot(relay, 'Eventful');
    await a.next('events', m => m.entries.some(e => e.kind === 'join' && e.id === p.id));
    p.send({ t: 'sector', world: world('ev1'), owner: true });
    p.send({ t: 'state', s: { ...ship(100), dead: true } });
    await a.next('events', m => m.entries.some(e => e.kind === 'died' && e.id === p.id));
    await pause(110);
    p.send({ t: 'state', s: ship(100) });
    await a.next('events', m => m.entries.some(e => e.kind === 'respawn' && e.id === p.id));
    p.send({ t: 'create' });
    await a.next('events', m => m.entries.some(e => e.kind === 'lobby' && e.id === p.id));
    p.close();
    await a.next('events', m => m.entries.some(e => e.kind === 'leave' && e.id === p.id));
    a.close();
  } finally { await relay.close(); }
});

test('v2: flooding raises an alert', async () => {
  const relay = await relayWith();
  try {
    const a = await admin(relay);
    const p = await pilot(relay, 'Flooder');
    for (let i = 0; i < 200; i++) p.send({ t: 'lobbies' });
    const flood = await a.next('events', m => m.entries.some(e => e.kind === 'flood'));
    const e = flood.entries.find(x => x.kind === 'flood')!;
    assert.equal(e.alert, true); assert.equal(e.id, p.id);
    a.close();
  } finally { await relay.close(); }
});

test('v2: pilot detail returns the last block layout, or none before it arrives', async () => {
  const relay = await relayWith();
  try {
    const a = await admin(relay);
    const p = await pilot(relay, 'Shipwright');
    p.send({ t: 'sector', world: world('pd1'), owner: true });
    await a.next('overview', m => m.pilots.some(x => x.id === p.id && x.room === 'pd1'));
    a.send({ t: 'pilot', ref: 1, id: p.id });
    const before = await a.next('pilot', m => m.ref === 1);
    assert.equal(before.blocks, undefined);
    p.send({ t: 'state', s: { ...ship(50), paint: 4 } });
    await a.next('overview', m => m.pilots.some(x => x.id === p.id && x.at));
    a.send({ t: 'pilot', ref: 2, id: p.id });
    const after = await a.next('pilot', m => m.ref === 2);
    assert.deepEqual(after.blocks, [['core', 0, 0, 1]]); assert.equal(after.paint, 4);
    a.close(); p.close();
  } finally { await relay.close(); }
});

test('v2: bulk actions report per-pilot outcomes in one audit entry, and are capped', async () => {
  const relay = await relayWith({ trustProxy: true });
  try {
    const a = await admin(relay);
    const one = await pilot(relay, 'One', { 'x-forwarded-for': '198.51.100.11' }), two = await pilot(relay, 'Two', { 'x-forwarded-for': '198.51.100.12' }), gone = await pilot(relay, 'Gone', { 'x-forwarded-for': '198.51.100.13' });
    await a.next('overview', m => m.pilots.length === 3);
    a.send({ t: 'bulk', ref: 1, ids: [one.id, two.id], action: 'message', text: 'hello all' });
    for (const p of [one, two]) assert.deepEqual((await p.next('admin', m => m.c.op === 'notice')).c, { op: 'notice', text: 'hello all' });
    assert.match((await a.next('result', m => m.ref === 1)).message ?? '', /Message: 2 done/);
    gone.close(); await closed(gone.socket); await pause(50);
    a.send({ t: 'bulk', ref: 2, ids: [one.id, two.id, gone.id], action: 'kick', reason: 'cleanup' });
    const kicked = await a.next('result', m => m.ref === 2);
    assert.equal(kicked.ok, true); assert.equal(kicked.message, 'Kick: 2 done, 1 not online');
    await a.next('log', m => m.entries.some(e => e.action === 'bulk-kick'));
    a.send({ t: 'bulk', ref: 3, ids: Array.from({ length: 501 }, (_, i) => `id${i}`), action: 'kick' });
    assert.equal((await a.next('result', m => m.ref === 3)).ok, false);
    a.close();
  } finally { await relay.close(); }
});

test('v2: events stay bounded under churn and a new admin gets the recent ones', async () => {
  const relay = await relayWith();
  try {
    for (let i = 0; i < 150; i++) { const p = await pilot(relay, `Churn ${i}`); p.close(); await closed(p.socket); }
    await pause(50);
    const a = await admin(relay);
    const first = await a.next('events');
    assert.equal(first.entries.filter(e => !e.alert).length >= 199 && first.entries.length <= 300, true, `recent events plus kept alerts (${first.entries.length})`);
    assert.ok(first.entries.some(e => e.kind === 'join-burst'), 'the connection-burst alert is kept');
    const view = await a.next('overview');
    assert.ok(view.stats.events <= 500 && view.stats.events >= 300);
    a.close();
  } finally { await relay.close(); }
});

test('review fix: a bulk ban saves the bans file once, not once per address', async () => {
  const { Bans } = await import('../server/bans.ts');
  const dir = mkdtempSync(join(tmpdir(), 'vf-bans-batch-')), bans = new Bans(join(dir, 'bans.json'));
  bans.addMany([{ ip: '198.51.100.1', minutes: 5, reason: 'x', name: 'a' }, { ip: '198.51.100.2', minutes: 5, reason: 'x', name: 'b' }, { ip: '198.51.100.3', minutes: 5, reason: 'x', name: 'c' }]);
  assert.equal(bans.saves, 1); assert.equal(bans.list().length, 3);
});

test('review fix: one pilot spamming events cannot flush alerts out of the history', async () => {
  const relay = await relayWith();
  try {
    const spammer = await pilot(relay, 'Spammer');
    spammer.send({ t: 'sector', world: world('spam'), owner: true });
    for (let i = 0; i < 60; i++) { spammer.send({ t: 'state', s: { ...ship(10), dead: i % 2 === 0 } }); await pause(17); }
    for (let i = 0; i < 200; i++) spammer.send({ t: 'lobbies' });
    await pause(200);
    const a = await admin(relay);
    const history = await a.next('events');
    const mine = history.entries.filter(e => e.id === spammer.id && !e.alert);
    assert.ok(mine.length <= 25, `non-alert events from one pilot are rate limited (${mine.length})`);
    assert.ok(history.entries.some(e => e.kind === 'deaths' && e.alert), 'the repeated-deaths alert survives');
    assert.ok(history.entries.some(e => e.kind === 'flood' && e.alert), 'the flood alert survives');
    a.close();
  } finally { await relay.close(); }
});
