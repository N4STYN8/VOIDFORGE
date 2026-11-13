import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NetClient, relayUrl, inviteLink } from '../src/net.ts';
import { NET, roomTag, type ShipState, type WorldRef } from '../src/netProtocol.ts';
import { startRelay } from '../server/relay.ts';
import { GameModel } from '../src/model.ts';
import { enterWorld, returnHome, worldRef, travel } from '../src/sectors.ts';
import { saveText } from '../src/persistence.ts';
import { WORLD } from '../src/data.ts';
import { sectorSeed } from '../src/sectorGrid.ts';

const ship = (x: number, angle = 0): ShipState => ({ x, y: 0, vx: 0, vy: 0, angle, health: 80, maxHealth: 100, paint: 2 });
const state = (id: string, s: ShipState, room = 'a') => JSON.stringify({ t: 'state', id, name: 'Nate', r: roomTag(room), s });
const total = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

test('relay address only accepts local overrides; invite links carry the code', () => {
  assert.equal(relayUrl(''), NET.defaultRelay);
  assert.equal(relayUrl('?relay=ws://localhost:8787'), 'ws://localhost:8787');
  assert.equal(relayUrl('?relay=wss://evil.example'), NET.defaultRelay);
  assert.equal(relayUrl('?relay=ws://localhost.evil.example'), NET.defaultRelay);
  assert.equal(inviteLink('https://n4styn8.github.io', '/VOIDFORGE/', 'AB23CD'), 'https://n4styn8.github.io/VOIDFORGE/?join=AB23CD');
});

test('remote ships interpolate between samples, take the short way round, and time out', () => {
  const net = new NetClient(() => { throw new Error('no socket'); });
  net.setSector({ home: 'h', x: 0, y: 0, seed: 'a' });
  net.receive(state('a', { ...ship(0, Math.PI - 0.1), blocks: [['core', 0, 0, 1]] }), 10);
  net.receive(state('a', ship(100, -Math.PI + 0.1)), 10.1);
  const [mid] = net.poses(10.1 + NET.interpolationDelay - 0.05);
  assert.ok(Math.abs(mid.x - 50) < 1e-6);
  assert.ok(Math.abs(Math.abs(mid.angle) - Math.PI) < 0.02, 'turns through pi, not through zero');
  assert.deepEqual(mid.blocks, [['core', 0, 0, 1]], 'layout kept from the earlier message');
  assert.equal(net.poses(10.1 + NET.peerTimeout + 1).length, 0);
});

test('changing sector clears the previous room\'s ships', () => {
  const net = new NetClient(() => { throw new Error('no socket'); });
  const world = (seed: string): WorldRef => ({ home: 'h', x: 0, y: 0, seed });
  net.setSector(world('a')); net.receive(state('p', ship(1)), 1);
  net.setSector({ ...world('a'), spot: [5, 5] });
  assert.equal(net.peers.size, 1, 'same sector keeps peers');
  net.setSector(world('b'));
  assert.equal(net.peers.size, 0);
  net.receive(state('p', ship(2), 'a'), 2);
  assert.equal(net.peers.size, 0, 'a late update from the old room is dropped');
  net.receive(state('p', ship(2), 'b'), 2);
  assert.equal(net.peers.size, 1);
});

test('two NetClients meet through a real relay: lobby, host world, then ship state', async () => {
  const relay = await startRelay({ port: 0, host: '127.0.0.1' }), url = `ws://127.0.0.1:${relay.port}`;
  const wait = async (check: () => boolean) => { for (let i = 0; i < 400 && !check(); i++) await new Promise(r => setTimeout(r, 5)); assert.ok(check()); };
  try {
    const host = new NetClient(), guest = new NetClient(), worlds: (WorldRef | null)[] = [];
    guest.onLobbyWorld = world => worlds.push(world);
    host.setSector({ home: 'host-home', x: 0, y: 0, seed: 'host-home', spot: [500, 600] });
    host.connect(url, 'Zach'); host.create();
    await wait(() => Boolean(host.lobby));
    assert.ok(host.isHost);
    guest.setSector({ home: 'guest-home', x: 0, y: 0, seed: 'guest-home' });
    guest.connect(url, 'Nate'); guest.join(host.lobby!.code);
    await wait(() => worlds.length === 1);
    assert.equal(worlds[0]!.seed, 'host-home'); assert.deepEqual(worlds[0]!.spot, [500, 600]);
    guest.setSector(worlds[0]!);
    await new Promise(r => setTimeout(r, 30));
    host.sendState(1, { ...ship(42), blocks: [['core', 0, 0, 3]] });
    await wait(() => guest.peers.size === 1);
    const peer = [...guest.peers.values()][0];
    assert.equal(peer.name, 'Zach'); assert.deepEqual(peer.blocks, [['core', 0, 0, 3]]);
    host.leave();
    await wait(() => host.lobby === undefined && guest.isHost);
    guest.disconnect();
    assert.equal(worlds.at(-1), null, 'losing the lobby sends the guest home');
    host.disconnect();
  } finally { await relay.close(); }
});

test('a guest flies their own ship into the host world and back home without losing or duplicating anything', () => {
  const host = new GameModel('lobby-host-seed'), guest = new GameModel('lobby-guest-seed');
  guest.cargo.iron = 20; guest.stored.crystal = 9; guest.player.x += 50;
  const homeSpot = { x: guest.player.x, y: guest.player.y };
  const visiting = enterWorld(guest, worldRef(host), { x: host.player.x, y: host.player.y });
  assert.equal(visiting.seed, host.seed, 'same sector world as the host');
  assert.deepEqual(visiting.world.spec.belts, host.world.spec.belts, 'same generated geography');
  assert.ok(Math.hypot(visiting.player.x - host.player.x, visiting.player.y - host.player.y) < 600, 'arrives near the host');
  assert.equal(visiting.cargo.iron, 20); assert.equal(visiting.stored.crystal, 9);
  assert.match(visiting.sectorName, /Lobby world/);
  // Guests cross edges too: into the next cell of the host's grid, still a guest, with everything they carry.
  const onward = travel(visiting, 'east');
  assert.equal(onward.galaxy.away?.x, 1); assert.equal(onward.galaxy.away?.y, 0); assert.equal(onward.galaxy.away?.home, host.galaxy.home);
  assert.equal(onward.seed, sectorSeed(host.galaxy.home, 1, 0), 'the same cell the host would reach');
  assert.equal(onward.cargo.iron, 20); assert.equal(onward.stored.crystal, 9);
  assert.ok(onward.galaxy.foreign?.[host.seed], 'the host sector copy is kept');
  assert.equal(GameModel.fromSave(JSON.parse(saveText(onward))).galaxy.away?.seed, onward.seed, 'survives a save');
  const back = travel(onward, 'west');
  assert.equal(back.seed, host.seed); assert.equal(back.galaxy.away?.x, 0);
  visiting.player.x = WORLD.width - 21;
  for (let i = 0; i < 60 && !visiting.sectorRequest; i++) visiting.update(0.05, { x: 1, y: 0, aim: { x: WORLD.width, y: visiting.player.y }, fire: false, mine: false, dock: false });
  assert.equal(visiting.sectorRequest, 'east', 'holding thrust into an edge asks to cross'); visiting.sectorRequest = undefined;
  // Mine a rock in the visit; the guest's copy keeps it after going home and coming back.
  const rock = visiting.asteroids[0], rockId = rock.id; rock.amount = Math.max(1, rock.amount - 3); const left = rock.amount;
  const reloaded = GameModel.fromSave(JSON.parse(saveText(visiting)));
  assert.equal(reloaded.galaxy.away?.seed, host.seed, 'being away survives a save');
  const home = returnHome(visiting);
  assert.equal(home.seed, guest.seed); assert.equal(home.galaxy.away, undefined);
  assert.ok(Math.hypot(home.player.x - homeSpot.x, home.player.y - homeSpot.y) < 400, 'returns to where they left');
  assert.ok(home.galaxy.foreign?.[host.seed], 'kept a copy of the host sector');
  assert.equal(total(home.cargo) + total(home.stored), total(guest.cargo) + total(guest.stored));
  const again = enterWorld(home, worldRef(host));
  const kept = again.world.snapshot(again.asteroids).changes.find(([id]) => id === rockId);
  assert.equal(kept?.[1]?.amount, left);
});

test('staying online reconnects after a drop, backing off, until the pilot goes offline', async () => {
  const opened: string[] = [];
  type Listener = (event: { data?: unknown }) => void;
  const sockets: { listeners: Record<string, Listener[]>; fire(type: string): void }[] = [];
  const open = (url: string) => {
    opened.push(url);
    const socket = { readyState: 0, listeners: {} as Record<string, Listener[]>, sent: [] as string[],
      addEventListener(type: string, listener: Listener) { (this.listeners[type] ??= []).push(listener); },
      send(text: string) { this.sent.push(text); }, close() { this.fire('close'); },
      fire(type: string) { for (const l of this.listeners[type] ?? []) l({}); } };
    sockets.push(socket); return socket;
  };
  const net = new NetClient(open as never);
  net.stayOnline('ws://relay.test', 'Ace');
  assert.equal(opened.length, 1); assert.ok(net.staysOnline);
  sockets[0].fire('close');
  assert.equal(net.status, 'offline'); assert.match(net.note, /Retrying in 2s/);
  await new Promise(r => setTimeout(r, 2100));
  assert.equal(opened.length, 2, 'tried again');
  sockets[1].fire('close');
  assert.match(net.note, /Retrying in 4s/, 'backs off');
  net.goOffline();
  assert.ok(!net.staysOnline); assert.equal(net.note, 'Playing offline.');
  await new Promise(r => setTimeout(r, 50));
  assert.equal(opened.length, 2, 'no more attempts once offline');
});
