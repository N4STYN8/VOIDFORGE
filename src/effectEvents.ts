import type { WeaponKind } from './data.ts';
export type EffectEvent = { type: 'muzzle' | 'impact' | 'explosion' | 'debris' | 'collection' | 'shield'; x:number;y:number;angle?:number;radius?:number;color?:number;weapon?:WeaponKind;count?:number;level?:number };
