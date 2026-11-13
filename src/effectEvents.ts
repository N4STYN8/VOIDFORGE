import type { WeaponKind } from './data.ts';
export type EffectEvent = { type: 'arc' | 'muzzle' | 'impact' | 'explosion' | 'debris' | 'collection' | 'shield'; x:number;y:number;angle?:number;toX?:number;toY?:number;radius?:number;color?:number;weapon?:WeaponKind;count?:number;level?:number };
