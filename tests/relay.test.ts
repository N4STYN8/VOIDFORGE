import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startRelay, originAllowed, DEFAULT_ORIGINS, type Relay } from '../server/relay.ts';
import { NET, parseClient, parseServer, type ServerMessage, type ShipState } from '../src/netProtocol.ts';

/** A test client on Node's built-in WebSocket that records every relay message. */
async function client(relay: Relay, name: string) {
  const socket = new WebSocket(`ws://127.0.0.1:${relay.port}`), inbox: ServerMessage[] = [];
  socket.addEventListener('message', event => { const m = parseServer(String(event.data)); if (m) inbox.push(m); });
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  const send = (m: object) => socket.send(JSON.stringify(m));
  const next = async <T extends ServerMessage['t']>(t: T, where: (m: Extract<ServerMessage, { t: T }>) => boolean = () => true) => {
    for (let i = 0; i < 200; i++) {
      const index = inbox.findIndex(m => m.t === t && where(m as Extract<ServerMessage, { t: T }>));
      if (index >= 0) return inbox.splice(index, 1)[0] as Extract<ServerMessage, { t: T }>;
      await new Promise(r => setTimeout(r, 5));
    }
    throw new Error(`${name}: no ${t} message`);
  };
  const welcome = await next('welcome');
  send({ t: 'hello', v: NET.version, name });
  return { socket, inbox, send, next, id: welcome.id, close: () => socket.close() };
}
const ship = (x: number): ShipState => ({ x, y: 100, vx: 0, vy: 0, angle: 0, health: 100, maxHealth: 100, paint: 0, blocks: [['core', 0, 0, 1]] });
const world = (seed: string) => ({ home: 'home-seed', x: 0, y: 0, seed });

test('protocol validation rejects malformed messages', () => {
  assert.equal(parseClient('not json'), undefined);
  assert.equal(parseClient(JSON.stringify({ t: 'state', s: { x: 'a' } })), undefined);
  assert.equal(parseClient(JSON.stringify({ t: 'sector', world: { home: '', x: 0, y: 0, seed: 's' } })), undefined);
  assert.deepEqual(parseClient(JSON.stringify({ t: 'join', code: 'ab-c12' })), { t: 'join', code: 'ABC12' });
  assert.equal((parseClient(JSON.stringify({ t: 'hello', v: 1, name: '<b>Ace</b>' })) as { name: string }).name, 'bAceb');
  assert.ok(originAllowed('https://n4styn8.github.io', DEFAULT_ORIGINS));
  assert.ok(originAllowed('http://localhost:5173', DEFAULT_ORIGINS));
  assert.ok(!originAllowed('https://evil.example', DEFAULT_ORIGINS));
  assert.ok(!originAllowed('http://localhost.evil.example', DEFAULT_ORIGINS));
});

test('a friend joins a lobby by code, gets the host world and they see each other only in the same sector', async () => {
  const relay = await startRelay({ port: 0, host: '127.0.0.1' });
  try {
    const host = await client(relay, 'Host'), guest = await client(relay, 'Guest');
    host.send({ t: 'sector', world: world('sector-a') });
    host.send({ t: 'create' });
    const lobby = await host.next('lobby');
    assert.equal(lobby.code.length, NET.codeLength); assert.equal(lobby.host, host.id); assert.equal(lobby.world?.seed, 'sector-a');
    guest.send({ t: 'join', code: lobby.code.toLowerCase() });
    const joined = await guest.next('lobby', m => m.members.length === 2);
    assert.equal(joined.world?.seed, 'sector-a');
    assert.deepEqual(joined.members.map(m => m.name).sort(), ['Guest', 'Host']);
    await host.next('lobby', m => m.members.length === 2);
    // Different sectors: state is not forwarded.
    guest.send({ t: 'sector', world: world('sector-b') });
    host.send({ t: 'state', s: ship(5) });
    await new Promise(r => setTimeout(r, 60));
    assert.ok(!guest.inbox.some(m => m.t === 'state'));
    // Same sector: it is, with the sender's id and name.
    guest.send({ t: 'sector', world: world('sector-a') });
    await new Promise(r => setTimeout(r, 30));
    host.send({ t: 'state', s: ship(42) });
    const seen = await guest.next('state');
    assert.equal(seen.id, host.id); assert.equal(seen.name, 'Host'); assert.equal(seen.s.x, 42);
    // Host moving sector updates the lobby world for everyone, and the guest sees the host leave the room.
    host.send({ t: 'sector', world: { ...world('sector-c'), x: 1 } });
    assert.equal((await guest.next('lobby', m => m.world?.seed === 'sector-c')).world?.x, 1);
    assert.equal((await guest.next('gone')).id, host.id);
    // Host leaving hands the lobby to the guest.
    host.close();
    const handed = await guest.next('lobby', m => m.members.length === 1);
    assert.equal(handed.host, guest.id);
    guest.close();
  } finally { await relay.close(); }
});

test('bad lobby codes, full lobbies and version mismatches get errors', async () => {
  const relay = await startRelay({ port: 0, host: '127.0.0.1' });
  try {
    const a = await client(relay, 'A');
    a.send({ t: 'join', code: 'ZZZZZZ' });
    assert.match((await a.next('error')).message, /No lobby/);
    a.send({ t: 'create' }); const { code } = await a.next('lobby');
    const others = [];
    for (let i = 1; i < NET.maxLobby; i++) { const c = await client(relay, `P${i}`); c.send({ t: 'join', code }); await c.next('lobby'); others.push(c); }
    const late = await client(relay, 'Late'); late.send({ t: 'join', code });
    assert.match((await late.next('error')).message, /full/);
    const old = new WebSocket(`ws://127.0.0.1:${relay.port}`);
    const closed = new Promise<number>(resolve => old.addEventListener('close', e => resolve(e.code)));
    old.addEventListener('open', () => old.send(JSON.stringify({ t: 'hello', v: 999, name: 'Old' })));
    assert.equal(await closed, 4000);
    for (const c of [a, late, ...others]) c.close();
  } finally { await relay.close(); }
});

test('a flooding client is throttled and then disconnected; the health page reports counts', async () => {
  const relay = await startRelay({ port: 0, host: '127.0.0.1' });
  try {
    const flood = await client(relay, 'Flood'), closed = new Promise<number>(resolve => flood.socket.addEventListener('close', e => resolve(e.code)));
    for (let i = 0; i < NET.burst + NET.maxRate * NET.abuse + 20; i++) flood.send({ t: 'state', s: ship(i) });
    assert.equal(await closed, 1008);
    const page = await (await fetch(`http://127.0.0.1:${relay.port}/`)).text();
    assert.match(page, /VOIDFORGE relay v1: \d+ online/);
  } finally { await relay.close(); }
});

test('ship state reaches only pilots within interest range, and /stats reports traffic', async () => {
  const relay = await startRelay({ port: 0, host: '127.0.0.1' });
  try {
    const a = await client(relay, 'A'), b = await client(relay, 'B');
    a.send({ t: 'sector', world: world('wide') }); b.send({ t: 'sector', world: world('wide') });
    b.send({ t: 'state', s: { ...ship(0), x: 0 } });
    await new Promise(r => setTimeout(r, 40));
    a.send({ t: 'state', s: { ...ship(0), x: NET.interest * 3 } });
    await new Promise(r => setTimeout(r, 60));
    assert.ok(!b.inbox.some(m => m.t === 'state'), 'too far away to matter');
    a.send({ t: 'state', s: { ...ship(0), x: NET.interest / 2 } });
    assert.equal((await b.next('state')).s.x, NET.interest / 2);
    const stats = await (await fetch(`http://127.0.0.1:${relay.port}/stats`)).json() as { clients: number; framesOut: number; messagesIn: number };
    assert.equal(stats.clients, 2); assert.ok(stats.framesOut > 0 && stats.messagesIn > 0);
    a.close(); b.close();
  } finally { await relay.close(); }
});
