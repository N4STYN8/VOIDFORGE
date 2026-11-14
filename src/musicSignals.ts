import type {GameModel} from './model.ts';
import {ENEMIES} from './data.ts';
/** A committed local target, not the mere presence of a hostile somewhere in the sector. */
export function musicEncounter(model:GameModel){
 if(model.dead||model.atStation)return {pve:false,boss:false};
 let pve=false,boss=false;
 for(const e of model.enemies){if(e.health<=0||!e.state||!['chase','attack','strafe','defend','reposition'].includes(e.state))continue;
  if(Math.hypot(e.x-model.player.x,e.y-model.player.y)>1800)continue;
  if(e.id===model.musicBossId&&ENEMIES[e.kind??'raider'].boss){pve=true;boss=true;continue;}
  if(!e.lastSeen||Math.hypot(e.lastSeen.x-model.player.x,e.lastSeen.y-model.player.y)>250)continue;
  pve=true;if(ENEMIES[e.kind??'raider'].boss||model.enemies.some(parent=>parent.id===e.parent&&ENEMIES[parent.kind??'raider'].boss))boss=true;
 }
 return {pve,boss};
}
