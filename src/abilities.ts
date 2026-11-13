import { SPECIAL } from './abilityConfig.ts';
import type { Bullet,Enemy,ShipModule } from './model.ts';
export type AbilityState={cooldown:number;active:number;sustained:number;shots:number;mining:number;phase:number};
export const freshAbility=():AbilityState=>({cooldown:0,active:0,sustained:0,shots:0,mining:0,phase:0});
export function state(module:ShipModule){return module.ability??=freshAbility();}
export function tick(state:AbilityState,dt:number){state.cooldown=Math.max(0,state.cooldown-dt);state.active=Math.max(0,state.active-dt);state.phase=Math.max(0,state.phase-dt);}
export function activate(s:AbilityState,duration:number,cooldown:number){if(s.cooldown>0)return false;s.active=duration;s.cooldown=cooldown;return true;}
export function onFire(module:ShipModule){
  if(module.level<5)return {rate:1,penetrating:false,swarm:false};
  const s=state(module);s.shots++;
  return {rate:module.kind==='cannon'?1+SPECIAL.cannon.maxBonus*Math.min(1,s.sustained/SPECIAL.cannon.ramp):1,
    penetrating:module.kind==='rail'&&s.shots%SPECIAL.rail.every===0,
    swarm:module.kind==='rocket'&&activate(s,0,SPECIAL.rocket.cooldown)};
}
export function onMiningHit(module:ShipModule|undefined,dt:number){
  if(!module||module.level<5)return 0;
  const s=state(module);s.mining+=dt;if(s.mining<SPECIAL.miner.interval)return 0;s.mining-=SPECIAL.miner.interval;return SPECIAL.miner.extra;
}
export function onDamageTaken(module:ShipModule,damage:number){return module.level>=5&&damage>=SPECIAL.armor.threshold&&activate(state(module),SPECIAL.armor.duration,SPECIAL.armor.cooldown);}
export function onBoost(module:ShipModule){if(module.level>=5)state(module).phase=SPECIAL.engine.invulnerable;}
export function onEnergyDeficit(module:ShipModule,energy:number,capacity:number,demand:number,output:number){return module.level>=5&&energy<capacity*SPECIAL.reactor.threshold&&demand>output&&activate(state(module),SPECIAL.reactor.duration,SPECIAL.reactor.cooldown);}
export function onOverheat(module:ShipModule,heat:number,capacity:number){return module.level>=5&&heat>=capacity*SPECIAL.cooler.threshold&&activate(state(module),0,SPECIAL.cooler.cooldown);}

/** Hit plans are non-recursive: the host applies secondary damage directly. */
export function onHit(bullet:Bullet,target:Enemy,enemies:Enemy[]){
  if(bullet.level!==5||bullet.fragment||bullet.weapon!=='pulse')return;
  const distance=(enemy:Enemy)=>Math.hypot(enemy.x-target.x,enemy.y-target.y);
  const secondary=enemies.filter(e=>e!==target&&e.health>0&&distance(e)<=SPECIAL.pulse.range).sort((a,b)=>distance(a)-distance(b))[0];
  if(secondary)return {target:secondary,damage:(bullet.damage??0)*SPECIAL.pulse.fraction};
}
