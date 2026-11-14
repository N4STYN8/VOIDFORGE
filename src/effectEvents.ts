import type { WeaponKind } from './data.ts';
import type { SoundCue } from './audio.ts';
// 'cue' events are sound-only (never drawn): `cue` names the sound, `pitch`/`volume` shape it. `silent` marks a visual whose sound was sent as a cue.
export type EffectEvent = { localSound?:boolean;amount?:number;ultimate?:boolean;cue?: SoundCue; pitch?: number; volume?: number; silent?: boolean; type: 'arc' | 'muzzle' | 'impact' | 'explosion' | 'debris' | 'collection' | 'shield' | 'cue'; x:number;y:number;angle?:number;toX?:number;toY?:number;radius?:number;color?:number;weapon?:WeaponKind;count?:number;level?:number };
