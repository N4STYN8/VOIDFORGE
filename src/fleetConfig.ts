import type {EnemyKind,FactionKind} from './data.ts';
export const FACTIONS:Record<FactionKind,{label:string;color:number;fleets:EnemyKind[][]}>={
 rust:{label:'Rust Pirates',color:0xe68b56,fleets:[['raider','scout','scout'],['frigate','flak','flak']]},
 iron:{label:'Iron Dominion',color:0xe3be66,fleets:[['tank','scout','scout'],['shieldCarrier','sniper','flak'],['escort','flak','tank']]},
 void:{label:'Void Reclaimers',color:0x92cca0,fleets:[['marauder','scrapDrone','scrapDrone'],['bomber','disruptor','scrapDrone']]}
};
/** Home waters stay unchanged. Both regional and core scaling are bounded. */
export function enemyScaling(danger:number,core:number){const tier=Math.max(0,Math.min(3,danger-1)),progress=tier?Math.min(4,Math.max(0,core-1)):0;return {health:1+tier*.08+progress*.025,damage:1+tier*.04+progress*.01,reward:1+tier*.1};}
