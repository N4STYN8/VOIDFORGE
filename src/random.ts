export function hashSeed(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}
export class SeedRandom {
  state: number;
  constructor(seed: string | number) { this.state = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed); }
  next = () => { this.state += 0x6d2b79f5; this.state >>>= 0; let t = this.state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
