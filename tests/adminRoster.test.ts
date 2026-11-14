import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterPilots, sortPilots, Selection, emptyFilter } from '../src/admin/roster.ts';
import type { AdminPilot, AdminRoom } from '../src/adminProtocol.ts';

const P = (id: string, extra: Partial<AdminPilot> = {}): AdminPilot => ({ id, name: id, ip: '10.0.0.1', authority: false, since: 0, rate: 1, ...extra });
const pilots: AdminPilot[] = [
  P('a1', { name: 'Ace', ip: '203.0.113.5', room: 'r1', lobby: 'LOBBYA', ping: 40, profile: { home: 'h', power: 30 } }),
  P('b2', { name: 'Sim 001', room: 'r2', ping: 5, dead: true }),
  P('c3', { name: 'Sim 002', room: 'r1', lobby: 'LOBBYA', authority: true }),
  P('d4', { name: 'Zed', room: 'r3' }),
];
const rooms: AdminRoom[] = [{ seed: 'r1', members: 2, locked: false, watched: false }, { seed: 'r2', members: 1, locked: false, watched: false }, { seed: 'r3', members: 1, locked: false, watched: false }];
const ids = (list: AdminPilot[]) => list.map(p => p.id);

test('text search matches name, ip, id and lobby literally and case-insensitively', () => {
  assert.deepEqual(ids(filterPilots(pilots, { ...emptyFilter(), text: 'ace' }, rooms)), ['a1']);
  assert.deepEqual(ids(filterPilots(pilots, { ...emptyFilter(), text: '203.0.113' }, rooms)), ['a1']);
  assert.deepEqual(ids(filterPilots(pilots, { ...emptyFilter(), text: 'lobbya' }, rooms)), ['a1', 'c3']);
  assert.deepEqual(ids(filterPilots(pilots, { ...emptyFilter(), text: '.*' }, rooms)), []);
  assert.deepEqual(ids(filterPilots(pilots, { ...emptyFilter(), text: '   ' }, rooms)), ids(pilots));
});

test('status chips: bots, humans, dead, alive, solo, lobby, sharing, authority; plus sector and lobby', () => {
  const only = (...status: string[]) => ids(filterPilots(pilots, { ...emptyFilter(), status: new Set(status) as never }, rooms));
  assert.deepEqual(only('bots'), ['b2', 'c3']);
  assert.deepEqual(only('humans'), ['a1', 'd4']);
  assert.deepEqual(only('dead'), ['b2']);
  assert.deepEqual(only('solo'), ['b2', 'd4']);
  assert.deepEqual(only('sharing'), ['a1', 'c3']);
  assert.deepEqual(only('authority'), ['c3']);
  assert.deepEqual(only('bots', 'alive'), ['c3']);
  assert.deepEqual(ids(filterPilots(pilots, { ...emptyFilter(), seed: 'r1' }, rooms)), ['a1', 'c3']);
  assert.deepEqual(ids(filterPilots(pilots, { ...emptyFilter(), lobby: 'LOBBYA' }, rooms)), ['a1', 'c3']);
});

test('sorting by ping puts unknown pings last in both directions', () => {
  assert.deepEqual(ids(sortPilots(pilots, 'ping', 1)), ['b2', 'a1', 'c3', 'd4']);
  assert.deepEqual(ids(sortPilots(pilots, 'ping', -1)).slice(0, 2), ['a1', 'b2']);
  assert.deepEqual(ids(sortPilots(pilots, 'name', 1)), ['a1', 'b2', 'c3', 'd4']);
});

test('selection toggles, ranges inclusively, and forgets pilots who went offline', () => {
  const s = new Selection();
  s.toggle('a1'); s.toggle('a1'); assert.equal(s.has('a1'), false);
  s.range(['a1', 'b2', 'c3', 'd4'], 'b2', 'd4');
  assert.deepEqual(s.ids(new Set(['a1', 'b2', 'c3', 'd4'])), ['b2', 'c3', 'd4']);
  assert.deepEqual(s.ids(new Set(['b2', 'd4'])), ['b2', 'd4']);
  s.setAll(['a1']); assert.deepEqual(s.ids(new Set(['a1', 'b2'])), ['a1']);
  s.clear(); assert.equal(s.size, 0);
});
