import type { SectorWorld } from './model.ts';

/**
 * Packs a sector world for sending through the relay in chunks: JSON, gzip-compressed where the platform
 * offers CompressionStream (browsers and Node 18+), then base64 so chunks are plain ASCII. A leading
 * letter says which: `z` compressed, `j` plain. No dependencies, no DOM.
 */
export const WORLD_CHUNK = 12000;
/** A sector world larger than this (unpacked) is refused rather than parsed. */
const WORLD_LIMIT = 8_000_000;

function toBase64(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
function fromBase64(text: string) {
  const binary = atob(text), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
async function pipe(bytes: Uint8Array, stream: { readable: ReadableStream<Uint8Array>; writable: WritableStream<BufferSource> }, limit = Infinity) {
  const writer = stream.writable.getWriter(); void writer.write(bytes as BufferSource).then(() => writer.close()).catch(() => {});
  const reader = stream.readable.getReader(), parts: Uint8Array[] = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    total += value.length; if (total > limit) { void reader.cancel(); throw new Error('world too large'); }
    parts.push(value);
  }
  const out = new Uint8Array(total); let at = 0; for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}
const compression = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

export async function packWorld(world: SectorWorld): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(world));
  if (compression()) return 'z' + toBase64(await pipe(json, new CompressionStream('gzip')));
  return 'j' + toBase64(json);
}
/** Undefined if the text is not a packed sector world. */
export async function unpackWorld(text: string): Promise<SectorWorld | undefined> {
  try { return await unpack(text); } catch { return undefined; }
}
async function unpack(text: string): Promise<SectorWorld | undefined> {
  const kind = text[0], bytes = fromBase64(text.slice(1));
  let json: Uint8Array;
  if (kind === 'z' && compression()) json = await pipe(bytes, new DecompressionStream('gzip'), WORLD_LIMIT);
  else if (kind === 'j' && bytes.length <= WORLD_LIMIT) json = bytes;
  else return undefined;
  const world = JSON.parse(new TextDecoder().decode(json));
  return world && typeof world === 'object' && typeof world.seed === 'string' && world.world && typeof world.world === 'object' ? world as SectorWorld : undefined;
}
