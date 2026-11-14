import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAdmin, readAdminCommand, ADMIN } from '../src/adminProtocol.ts';
import { parseClient, parseServer } from '../src/netProtocol.ts';

const p = (m: object) => parseAdmin(JSON.stringify(m));
const world = { home: 'h', x: 1, y: 0, seed: 'h:sector:1,0' };

test('parseAdmin accepts one valid request of each kind', () => {
  const valid: object[] = [
    { t: 'watch', ref: 1, rooms: ['a', 'b'] },
    { t: 'kick', ref: 2, id: 'abc', reason: 'spam' },
    { t: 'ban', ref: 3, id: 'abc', minutes: 60 },
    { t: 'ban', ref: 3, ip: '1.2.3.4', minutes: 60, reason: 'x' },
    { t: 'unban', ref: 4, ip: '1.2.3.4' },
    { t: 'rename', ref: 5, id: 'abc', name: 'Ace' },
    { t: 'disband', ref: 6, code: 'ABCDEF' },
    { t: 'remove', ref: 7, code: 'ABCDEF', id: 'abc' },
    { t: 'lobby-open', ref: 8, code: 'ABCDEF', open: true },
    { t: 'lock', ref: 9, seed: 's', locked: true },
    { t: 'broadcast', ref: 10, to: { all: true }, text: 'hello' },
    { t: 'broadcast', ref: 10, to: { lobby: 'ABCDEF' }, text: 'hello' },
    { t: 'broadcast', ref: 10, to: { pilot: 'abc' }, text: 'hello' },
    { t: 'broadcast', ref: 10, to: { room: 's' }, text: 'hello' },
    { t: 'teleport', ref: 11, id: 'abc', x: 10, y: 20 },
    { t: 'teleport', ref: 11, id: 'abc', x: 10, y: 20, world },
    { t: 'teleport', ref: 11, id: 'abc', x: 10, y: 20, cell: [1, -2] },
    { t: 'spawn', ref: 12, seed: 's', kind: 'raider', count: 3, x: 1, y: 2 },
    { t: 'clear', ref: 13, seed: 's' },
    { t: 'evict', ref: 14, seed: 's' },
    { t: 'inspect', ref: 15, id: 'abc' },
    { t: 'cargo', ref: 16, id: 'abc', target: 'cargo', delta: { iron: 5, copper: -2 } },
    { t: 'cargo', ref: 16, id: 'abc', target: { outpost: 3 }, delta: { ice: 1 } },
    { t: 'station', ref: 17, id: 'abc', index: 1, unlocked: true },
    { t: 'structure', ref: 18, id: 'abc', outpost: 1, structure: 4, action: 'repair' },
    { t: 'structure', ref: 18, id: 'abc', outpost: 1, action: 'destroy' },
  ];
  for (const m of valid) assert.ok(p(m), JSON.stringify(m));
});

test('parseAdmin rejects malformed or out-of-bounds requests', () => {
  const bad: object[] = [
    { t: 'kick', ref: 1.5, id: 'abc' },
    { t: 'watch', ref: 1, rooms: ['a', 'b', 'c', 'd'] },
    { t: 'spawn', ref: 1, seed: 's', kind: 'raider', count: ADMIN.maxSpawn + 1, x: 0, y: 0 },
    { t: 'spawn', ref: 1, seed: 's', kind: 'raider', count: 0, x: 0, y: 0 },
    { t: 'spawn', ref: 1, seed: 's', kind: 'not-an-enemy', count: 1, x: 0, y: 0 },
    { t: 'cargo', ref: 1, id: 'a', target: 'cargo', delta: { gold: 5 } },
    { t: 'cargo', ref: 1, id: 'a', target: 'cargo', delta: { iron: ADMIN.maxDelta + 1 } },
    { t: 'broadcast', ref: 1, to: { all: true }, text: 'x'.repeat(201) },
    { t: 'teleport', ref: 1, id: 'a', x: 0, y: 0, world, cell: [1, 0] },
    { t: 'nope', ref: 1 },
    { t: 'ban', ref: 1, minutes: 5 },
  ];
  for (const m of bad) assert.equal(p(m), undefined, JSON.stringify(m));
  assert.equal(parseAdmin('not json'), undefined);
});

test('admin server and ack messages validate on the wire', () => {
  assert.deepEqual(parseServer(JSON.stringify({ t: 'admin', ref: 1, c: { op: 'notice', text: 'hi' } })), { t: 'admin', ref: 1, c: { op: 'notice', text: 'hi' } });
  assert.equal(parseServer(JSON.stringify({ t: 'admin', ref: 1, c: { op: 'explode' } })), undefined);
  assert.deepEqual(parseClient(JSON.stringify({ t: 'admin-ack', ref: 2, ok: true, data: { x: 1 } })), { t: 'admin-ack', ref: 2, ok: true, message: undefined, data: { x: 1 } });
  assert.deepEqual(parseClient(JSON.stringify({ t: 'admin-ack', ref: 2, ok: true, message: 'm', data: { s: 'x'.repeat(12001) } })), { t: 'admin-ack', ref: 2, ok: true, message: 'm', data: undefined }, 'an oversized report keeps the outcome and drops only the data');
  assert.deepEqual(readAdminCommand({ op: 'teleport', x: 1, y: 2, cell: [0, 0] }), { op: 'teleport', x: 1, y: 2, cell: [0, 0] });
});
