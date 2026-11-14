import { deserialize, serialize } from 'node:v8';

/**
 * The relay runs on the Pi's Node 16, which has no global `structuredClone` (added in Node 17); the crew store and
 * shared game code use it. v8 serialize/deserialize run the same structured-clone algorithm, so this is a faithful
 * stand-in. server/main.ts imports this module first, before anything that might clone.
 */
export function structuredCloneFallback<T>(value: T): T { return deserialize(serialize(value)) as T; }
if (typeof globalThis.structuredClone !== 'function') (globalThis as { structuredClone?: unknown }).structuredClone = structuredCloneFallback;
