import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { structuredCloneFallback } from '../server/node16.ts';

test('the Node 16 structuredClone fallback deep-copies like the real one', () => {
  const source = { a: [1, { b: 'x' }], when: new Date(5), map: new Map([['k', { v: 1 }]]), set: new Set([1, 2]), missing: undefined as undefined };
  const copy = structuredCloneFallback(source);
  assert.deepEqual(copy, structuredClone(source));
  assert.notEqual(copy.a, source.a); assert.notEqual(copy.map.get('k'), source.map.get('k'));
  copy.a.push(3); assert.equal(source.a.length, 2);
  assert.equal(structuredCloneFallback(undefined), undefined);
});

test('the relay entry point installs the fallback before anything else loads', () => {
  const first = readFileSync(new URL('../server/main.ts', import.meta.url), 'utf8').split('\n').find(line => line.startsWith('import '));
  assert.equal(first?.trim(), "import './node16.ts';");
});
