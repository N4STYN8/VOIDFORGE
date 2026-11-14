import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Lru, CanvasGraphics } from '../src/admin/artCore.ts';
import { drawModule } from '../src/visuals.ts';
import { MODULES, equipment, type EquipmentKind } from '../src/data.ts';

test('Lru evicts the least recently used entry and refreshes on get', () => {
  const cache = new Lru<string, number>(2);
  cache.set('a', 1); cache.set('b', 2);
  assert.equal(cache.get('a'), 1);
  cache.set('c', 3);
  assert.equal(cache.get('b'), undefined, 'b was the least recently used');
  assert.equal(cache.get('a'), 1); assert.equal(cache.get('c'), 3); assert.equal(cache.size, 2);
});

/** A context that records calls, standing in for a browser canvas. */
function recorder() {
  const calls: string[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_t, key: string) => (...args: unknown[]) => { calls.push(key); void args; },
    set: (_t, key: string) => { calls.push(`set:${key}`); return true; },
  });
  return { calls, ctx: ctx as unknown as CanvasRenderingContext2D };
}

test('the canvas Graphics adapter draws every module kind and level without throwing', () => {
  for (const kind of ['core', ...Object.keys(MODULES)] as EquipmentKind[]) for (let level = 1; level <= equipment(kind).levels.length; level++) {
    const { calls, ctx } = recorder();
    drawModule(new CanvasGraphics(ctx) as unknown as Parameters<typeof drawModule>[0], 24, 24, -Math.PI / 2, kind as never, equipment(kind).color, level);
    assert.ok(calls.includes('fill'), `${kind} L${level} fills something`);
  }
});

test('review fix: weighted LRU evicts by total weight, and unknown paints fold to the default', async () => {
  const { normalPaint } = await import('../src/admin/artCore.ts');
  const cache = new Lru<string, number>(100, v => v, 10);
  cache.set('a', 6); cache.set('b', 3); cache.set('c', 4);
  assert.equal(cache.get('a'), undefined, 'over the weight budget the oldest goes');
  assert.equal(cache.get('b'), 3); assert.equal(cache.get('c'), 4);
  assert.equal(normalPaint(2), 2); assert.equal(normalPaint(9999), 0); assert.equal(normalPaint(-1), 0); assert.equal(normalPaint(1.5), 0);
});
