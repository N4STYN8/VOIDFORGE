import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameModel, type Enemy } from '../src/model.ts';
import { ClaimBook, sharedSector, encodeEnemies, encodeRock, decodeEnemies, decodeRocks, decodeShots, decodeHits, decodeLoot } from '../src/shared.ts';
import { startRelay } from '../server/relay.ts';
import { NET, CLAIMS, parseServer, type ServerMessage } from '../src/netProtocol.ts';
import { ENEMIES } from '../src/data.ts';
import { fixtureModel } from './fixtures.ts';

type Internals = { spawnEnemy(kind: string, x: number, y: number, angle: number, extra?: Partial<Enemy>): Enemy; hitEnemy(e: Enemy, damage: number): void; take(rock: unknown, amount: number, point: { x: number; y: number }): number };
const inside = (m: GameModel) => m as unknown as Internals;
const idle = (aim: { x: number; y: number }) => ({ x: 0, y: 0, aim, fire: false, mine: false, dock: false });
const lootTotal = (m: GameModel) => m.drops.reduce((sum, d) => sum + d.amount, 0);

test('claim book answers from granted leases and queues requests once', () => {
  const book = new ClaimBook();
  assert.equal(book.has(7, 0), false);
  assert.equal(book.has(7, 0.1), false, 'not asked twice within half a second');
  assert.deepEqual(book.take(), [7]); assert.deepEqual(book.take(), []);
  book.grant([7], [], CLAIMS.lease, 1);
  assert.equal(book.has(7, 1.5), true);
  assert.equal(book.has(7, 1 + CLAIMS.lease / 1000), false, 'expired lease');
  book.grant([], [7], CLAIMS.lease, 5); assert.equal(book.has(7, 5), false);
});

test('codecs reject junk and cap sizes', () => {
  assert.deepEqual(decodeEnemies([[1, 'not-a-kind', 0, 0, 0, 1, 1, 0, 'patrol', -1], 'x']), []);
  assert.equal(decodeRocks([{ id: 1, gone: true }, { id: 'a' }]).length, 1);
  assert.equal(decodeShots([{ x: 0, y: 0, vx: 1, vy: 1, life: 99, damage: 5 }]).length, 0, 'absurd lifetime');
  assert.equal(decodeHits([{ enemyId: 3, damage: 1e9 }])[0].damage, 2000);
  assert.equal(decodeLoot([{ ore: 'gold', amount: 5, x: 0, y: 0 }, { ore: 'iron', amount: 5, x: 0, y: 0 }]).length, 1);
});

test('a follower reports hits instead of applying them; the authority pays the kill to the pilot who made it', () => {
  const authority = fixtureModel(), follower = fixtureModel();
  authority.shared = sharedSector('authority', () => true); follower.shared = sharedSector('follower', () => true);
  const enemy = inside(authority).spawnEnemy('raider', 3600, 3600, 0);
  follower.applyEnemies(decodeEnemies(encodeEnemies(authority.enemies)));
  const ghost = follower.enemies.find(e => e.id === enemy.id)!;
  inside(follower).hitEnemy(ghost, 30);
  assert.equal(ghost.health, enemy.health, 'follower never changes enemy health');
  assert.deepEqual(follower.shared.hits.map(h => h.enemyId), [enemy.id]);
  const kills = authority.kills, dropsBefore = lootTotal(authority);
  authority.applyRemoteHit(enemy.id, 1e6, 'pilot-b');
  assert.ok(enemy.health <= 0);
  assert.equal(authority.kills, kills, 'not the authority\'s kill');
  assert.equal(lootTotal(authority), dropsBefore, 'no salvage dropped in the authority\'s world');
  const [loot] = authority.shared.loot; assert.equal(loot.to, 'pilot-b');
  const expected = Object.values(ENEMIES.raider.loot).reduce((a, b) => a + b, 0);
  assert.ok(loot.drops.reduce((a, d) => a + d.amount, 0) >= expected);
  const before = lootTotal(follower); follower.receiveLoot(decodeLoot(loot.drops));
  assert.equal(lootTotal(follower) - before, loot.drops.reduce((a, d) => a + d.amount, 0), 'created once, received once');
  // The enemy disappears from the follower when the authority stops reporting it.
  authority.update(0.05, idle({ x: 3600, y: 3600 }));
  follower.applyEnemies(decodeEnemies(encodeEnemies(authority.enemies)));
  assert.ok(!follower.enemies.some(e => e.id === enemy.id));
});

test('authority enemies hunt another pilot they can see, and their fire is shared', () => {
  const authority = fixtureModel(); authority.asteroids = [];
  authority.shared = sharedSector('authority', () => true);
  const enemy = inside(authority).spawnEnemy('raider', 9000, 9000, 0);
  authority.shared.targets = [{ id: 'b', x: 9250, y: 9000, vx: 0, vy: 0 }];
  const start = { x: enemy.x, y: enemy.y };
  for (let i = 0; i < 80; i++) authority.update(0.05, idle({ x: 3300, y: 3300 }));
  assert.ok(enemy.x > start.x || authority.shared.shots.length > 0, 'engaged the remote pilot');
  assert.ok(authority.shared.shots.length > 0, 'shots recorded for the room');
  assert.ok(Math.hypot(enemy.x - 3200, enemy.y - 3330) > 4000, 'did not go after the docked local pilot');
});

test('without the claim a pilot cannot change a rock; with it the change is recorded and copies match', () => {
  const a = fixtureModel(), b = fixtureModel();
  let allowed = false;
  b.shared = sharedSector('follower', () => allowed);
  const rock = b.asteroids[0], before = rock.amount;
  assert.equal(inside(b).take(rock, 5, { x: rock.x, y: rock.y }), 0);
  assert.equal(rock.amount, before);
  allowed = true;
  assert.ok(inside(b).take(rock, 5, { x: rock.x, y: rock.y }) > 0);
  assert.ok(b.shared.changedRocks.has(rock.id));
  a.applyRock(decodeRocks([encodeRock(rock, rock.id)])[0]);
  const copy = a.asteroids.find(x => x.id === rock.id)!;
  assert.equal(copy.amount, rock.amount); assert.deepEqual(copy.geometry, rock.geometry);
  const dropsBefore = lootTotal(a);
  a.applyRock({ id: rock.id, gone: true });
  assert.ok(!a.asteroids.some(x => x.id === rock.id)); assert.equal(lootTotal(a), dropsBefore, 'no ore released for someone else\'s rock');
});

test('a follower spawns no enemies of its own and eases toward the authority positions', () => {
  const follower = new GameModel('follower-world');
  follower.shared = sharedSector('follower', () => true);
  follower.applyEnemies([[42, 'raider', follower.player.x + 600, follower.player.y, 0, 50, 50, 0, 'patrol', -1]]);
  for (let i = 0; i < 400; i++) follower.update(0.05, idle({ x: 0, y: 0 }));
  assert.deepEqual(follower.enemies.map(e => e.id), [42]);
  assert.ok(Math.abs(follower.enemies[0].x - (follower.player.x + 600)) < 50);
});

test('relay elects the sector owner as authority and leases each rock to one pilot at a time', async () => {
  const relay = await startRelay({ port: 0, host: '127.0.0.1' });
  const open = async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${relay.port}`), inbox: ServerMessage[] = [];
    socket.addEventListener('message', e => { const m = parseServer(String(e.data)); if (m) inbox.push(m); });
    await new Promise(r => socket.addEventListener('open', r, { once: true }));
    const next = async (t: ServerMessage['t'], where: (m: ServerMessage) => boolean = () => true) => { for (let i = 0; i < 300; i++) { const k = inbox.findIndex(m => m.t === t && where(m)); if (k >= 0) return inbox.splice(k, 1)[0]; await new Promise(r => setTimeout(r, 5)); } throw new Error(`no ${t}`); };
    const welcome = await next('welcome') as Extract<ServerMessage, { t: 'welcome' }>;
    socket.send(JSON.stringify({ t: 'hello', v: NET.version, name: 'x' }));
    return { socket, next, id: welcome.id, send: (m: object) => socket.send(JSON.stringify(m)) };
  };
  try {
    const visitor = await open(), owner = await open(), world = { home: 'h', x: 0, y: 0, seed: 'shared-room' };
    visitor.send({ t: 'sector', world });
    owner.send({ t: 'sector', world, owner: true });
    const room = await visitor.next('room', m => (m as { members: number }).members === 2) as Extract<ServerMessage, { t: 'room' }>;
    assert.equal(room.authority, owner.id, 'owner runs the sector even though it arrived second');
    visitor.send({ t: 'claim', ids: [5, 6] });
    assert.deepEqual((await visitor.next('claims') as Extract<ServerMessage, { t: 'claims' }>).ok, [5, 6]);
    owner.send({ t: 'claim', ids: [6, 7] });
    const second = await owner.next('claims') as Extract<ServerMessage, { t: 'claims' }>;
    assert.deepEqual([second.ok, second.denied], [[7], [6]]);
    visitor.socket.close();
    await owner.next('room', m => (m as { members: number }).members === 1);
    owner.send({ t: 'claim', ids: [6] });
    assert.deepEqual((await owner.next('claims') as Extract<ServerMessage, { t: 'claims' }>).ok, [6], 'lease freed when its holder left');
    owner.send({ t: 'direct', to: 'nobody', k: 'hit', d: [] });
    owner.socket.close();
  } finally { await relay.close(); }
});
