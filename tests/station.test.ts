import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OUTPOST, type StructureKind } from '../src/data.ts';
import { stationLayout, type Outpost, type Structure } from '../src/outposts.ts';

let nextId = 1;
const block = (kind: StructureKind, cx: number, cy: number, progress = 1, level = 1): Structure => ({ id: nextId++, kind, cx, cy, rot: 0, level, health: 100, progress });
const outpostOf = (structures: Structure[]): Outpost => ({ id: 1, name: 'Test', cx: 0, cy: 0, structures, revision: 1 });
const square = (kind: StructureKind, x: number, y: number, n: number, progress = 1) => Array.from({ length: n * n }, (_, i) => block(kind, x + (i % n), y + Math.floor(i / n), progress));

test('squares of the same finished block kind are drawn as one large module, and every block is drawn once', () => {
  const outpost = outpostOf([block('outpostCore', 0, 0), ...square('storage', 1, 0, 2), ...square('reactor', 3, 0, 3), block('reactor', 6, 0), block('wall', 0, 1)]);
  const { modules } = stationLayout(outpost);
  const big = modules.filter(m => m.size > 1).map(m => [m.kind, m.size, m.cx, m.cy]);
  assert.deepEqual(big, [['storage', 2, 1, 0], ['reactor', 3, 3, 0]]);
  // Each block is covered by exactly one module.
  const covered = modules.reduce((n, m) => n + m.size * m.size, 0);
  assert.equal(covered, outpost.structures.length);
});

test('walls, turrets, the core and unfinished blocks never merge; mixed levels show the lowest', () => {
  const pending = square('storage', 0, 4, 2, 0.5), mixed = square('coolingUnit', 4, 4, 2); mixed[3].level = 3; mixed[0].level = 2;
  const outpost = outpostOf([block('outpostCore', 0, 0), ...square('wall', 0, 1, 2), ...square('autocannonTurret', 2, 1, 2), ...pending, ...mixed]);
  const modules = stationLayout(outpost).modules;
  assert.ok(modules.every(m => m.size === 1 || m.kind === 'coolingUnit'));
  assert.equal(modules.find(m => m.kind === 'coolingUnit')!.level, 1);
  assert.ok(!OUTPOST.merge.includes('wall') && !OUTPOST.merge.includes('outpostCore'));
});

test('the layout depends only on block positions and is cached until the outpost changes', () => {
  const blocks = [block('outpostCore', 0, 0), ...square('storage', 1, 1, 3), block('storage', 4, 1)];
  const a = stationLayout(outpostOf(blocks)), b = stationLayout(outpostOf([...blocks].reverse()));
  assert.deepEqual(a.modules.map(m => [m.kind, m.cx, m.cy, m.size]).sort(), b.modules.map(m => [m.kind, m.cx, m.cy, m.size]).sort());
  const outpost = outpostOf(blocks), first = stationLayout(outpost);
  assert.equal(stationLayout(outpost), first);
  outpost.structures.push(block('wall', 5, 1)); outpost.revision++;
  assert.notEqual(stationLayout(outpost), first);
  assert.ok(stationLayout(outpost).beacons.length >= 2);
});

test('outposts can grow large without overlapping their neighbours', () => {
  assert.ok(OUTPOST.radius >= 24);
  assert.ok(OUTPOST.radius * 2 * OUTPOST.cell < OUTPOST.coreSpacing);
});
