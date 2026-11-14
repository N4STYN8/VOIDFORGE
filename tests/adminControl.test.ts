import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameModel } from '../src/model.ts';
import { applyAdminCommand } from '../src/adminControl.ts';
import { worldRef } from '../src/sectors.ts';
import type { Outpost } from '../src/outposts.ts';

const fresh = () => { const m = new GameModel('admin-test'); m.enemies = []; return m; };
const run = (m: GameModel, c: Parameters<typeof applyAdminCommand>[1], authority = true) => applyAdminCommand(m, c, { authority });

test('notice and same-sector teleport', () => {
  const m = fresh();
  assert.equal(run(m, { op: 'notice', text: 'hi' }).ok, true);
  assert.equal(m.message, '[Admin] hi');
  m.player.vx = 50;
  const r = run(m, { op: 'teleport', x: 5000, y: 6000 });
  assert.equal(r.ok, true); assert.equal(r.model, undefined);
  assert.deepEqual([m.player.x, m.player.y, m.player.vx, m.player.vy], [5000, 6000, 0, 0]);
});

test('a teleport to a cell of the pilot\'s own grid is a real move that survives a reload', () => {
  const m = fresh();
  const r = run(m, { op: 'teleport', x: 4000, y: 4000, cell: [1, 0] });
  assert.ok(r.ok && r.model);
  assert.equal(r.model.galaxy.x, 1); assert.equal(r.model.galaxy.away, undefined);
  assert.deepEqual([Math.round(r.model.player.x), Math.round(r.model.player.y)], [4000, 4000]);
  const reloaded = GameModel.fromSave(r.model.toSave());
  assert.equal(reloaded.galaxy.x, 1); assert.equal(reloaded.galaxy.away, undefined);
  assert.equal(reloaded.cargo.iron, m.cargo.iron, 'nothing in the hold changes');
});

test('a teleport into another pilot\'s sector is a visit; evict sends the visitor home', () => {
  const other = new GameModel('someone-else'), m = fresh();
  const r = run(m, { op: 'teleport', x: 3000, y: 3000, world: worldRef(other) });
  assert.ok(r.ok && r.model);
  assert.equal(r.model.galaxy.away?.seed, 'someone-else');
  const back = run(r.model, { op: 'evict', reason: 'locked' });
  assert.ok(back.ok && back.model);
  assert.equal(back.model.galaxy.away, undefined); assert.equal(back.model.seed, 'admin-test');
  assert.match(back.model.message, /\[Admin\] locked/);
  const home = run(fresh(), { op: 'evict', reason: 'x' });
  assert.equal(home.ok, true); assert.equal(home.model, undefined); assert.match(home.message ?? '', /already home/i);
});

test('only the sector authority spawns and clears enemies; bosses survive a clear', () => {
  const m = fresh();
  assert.equal(run(m, { op: 'spawn', kind: 'raider', count: 3, x: 5000, y: 5000 }, false).ok, false);
  const r = run(m, { op: 'spawn', kind: 'raider', count: 3, x: 5000, y: 5000 });
  assert.equal(r.ok, true); assert.equal(m.enemies.length, 3);
  assert.ok(m.enemies.every(e => e.populationExempt && e.kind === 'raider'));
  m.enemies.push({ id: 9999, kind: 'rustLeviathan' as never, x: 0, y: 0, health: 10, cooldown: 1, angle: 0, populationExempt: true });
  assert.equal(run(m, { op: 'clear' }, false).ok, false);
  assert.equal(run(m, { op: 'clear' }).ok, true);
  assert.equal(m.enemies.filter(e => e.kind === 'raider').length, 0); assert.equal(m.enemies.length, 1, 'the boss stays');
});

test('inspect reports bases, outposts and minerals within the ack size limit', () => {
  const m = fresh(); m.cargo.iron = 12; m.stored.copper = 7;
  const r = run(m, { op: 'inspect' });
  const data = r.data as { cargo: Record<string, number>; stored: Record<string, number>; bases: { index: number; unlocked: boolean }[]; outposts: unknown[] };
  assert.equal(data.cargo.iron, 12); assert.equal(data.stored.copper, 7);
  assert.equal(data.bases[0].unlocked, true); assert.equal(data.bases[1].unlocked, false);
  assert.deepEqual(data.outposts, []);
  assert.ok(JSON.stringify(data).length < 12000);
});

test('mineral edits clamp at zero and stations unlock, but the first station stays', () => {
  const m = fresh(); m.cargo.iron = 10;
  assert.equal(run(m, { op: 'cargo', target: 'cargo', delta: { iron: 50 } }).ok, true); assert.equal(m.cargo.iron, 60);
  run(m, { op: 'cargo', target: 'cargo', delta: { iron: -1e5 } }); assert.equal(m.cargo.iron, 0);
  run(m, { op: 'cargo', target: 'stored', delta: { crystal: 5 } }); assert.equal(m.stored.crystal, 5);
  assert.match(m.message, /\[Admin\]/);
  assert.equal(run(m, { op: 'station', index: 0, unlocked: false }).ok, false);
  assert.equal(m.bases[0].unlocked, true);
  assert.equal(run(m, { op: 'station', index: 1, unlocked: true }).ok, true); assert.equal(m.bases[1].unlocked, true);
  assert.equal(run(m, { op: 'station', index: 99, unlocked: true }).ok, false);
});

test('outpost blocks repair, upgrade and are destroyed; storage edits reach the outpost', () => {
  const m = fresh();
  const outpost: Outpost = { id: 77, name: 'Outpost 1', cx: 10, cy: 10, revision: 0, stored: { iron: 0, copper: 0, crystal: 0, ice: 0, radioactive: 0 }, structures: [
    { id: 1, kind: 'outpostCore', cx: 10, cy: 10, rot: 0, level: 1, health: 5, progress: 1 },
    { id: 2, kind: 'wall', cx: 11, cy: 10, rot: 0, level: 1, health: 3, progress: 1 },
  ] };
  m.outposts.push(outpost);
  assert.equal(run(m, { op: 'structure', outpost: 77, structure: 2, action: 'repair' }).ok, true);
  assert.ok(outpost.structures[1].health > 3);
  assert.equal(run(m, { op: 'structure', outpost: 77, structure: 2, action: 'upgrade' }).ok, true);
  assert.equal(outpost.structures[1].level, 2);
  const revision = outpost.revision;
  assert.equal(run(m, { op: 'structure', outpost: 77, structure: 2, action: 'destroy' }).ok, true);
  assert.equal(outpost.structures.length, 1); assert.ok(outpost.revision > revision);
  run(m, { op: 'cargo', target: { outpost: 77 }, delta: { ice: 4 } }); assert.equal(outpost.stored!.ice, 4);
  assert.equal(run(m, { op: 'structure', outpost: 5, action: 'repair' }).ok, false);
  assert.equal(run(m, { op: 'structure', outpost: 77, action: 'destroy' }).ok, true);
  assert.equal(m.outposts.length, 0);
});

test('rename hands the new name back for the client to keep', () => {
  const r = run(fresh(), { op: 'rename', name: 'Ace' });
  assert.equal(r.ok, true); assert.equal(r.rename, 'Ace');
});

test('review fix: destroying an outpost moves its minerals to station storage instead of deleting them', () => {
  const m = fresh(); m.stored.iron = 5;
  m.outposts.push({ id: 9, name: 'Depot', cx: 4, cy: 4, revision: 0, stored: { iron: 30, copper: 2, crystal: 0, ice: 0, radioactive: 0 }, structures: [{ id: 1, kind: 'storage', cx: 4, cy: 4, rot: 0, level: 1, health: 10, progress: 1 }] });
  run(m, { op: 'structure', outpost: 9, structure: 1, action: 'destroy' });
  assert.equal(m.outposts[0].stored!.iron, 30, 'a storage block going keeps the outpost stock');
  run(m, { op: 'structure', outpost: 9, action: 'destroy' });
  assert.equal(m.stored.iron, 35); assert.equal(m.stored.copper, 2);
});

test('review fix: inspect stays under the ack limit even with very many outposts', () => {
  const m = fresh();
  for (let i = 0; i < 400; i++) m.outposts.push({ id: i, name: `Outpost number ${i}`, cx: i, cy: i, revision: 0, stored: { iron: 1, copper: 1, crystal: 1, ice: 1, radioactive: 1 }, structures: [] });
  assert.ok(JSON.stringify(run(m, { op: 'inspect' }).data).length < 12000);
});
