import { ENEMIES,ENEMY_SPAWN,BASE_RADIUS,WORLD,PATROL,type EnemyKind } from './data.ts';
import type { Enemy,Point,GameModel } from './model.ts';
import { fieldAt,dangerAt,SeedRandom,hashSeed,outsideView,type WorldSpec,type PopulationView,type SpawnBlocker } from './world.ts';
import { POPULATION } from './populationConfig.ts';
import type { Asteroid } from './mining.ts';
type Threat=keyof typeof POPULATION.threats;
type EnemyClass='normal'|'elite';
export type EnemyRegion={key:string;threat:Threat;normalDue:number;eliteDue:number;normalCycle:number;eliteCycle:number;attempt:number;defeats:number;sleeping:Enemy[]};
export type BossState={readyAt:number;defeats:number;uniqueGranted:boolean};
export type EnemyPopulationSnapshot={regions:EnemyRegion[];bosses:[string,BossState][]};
const distance=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
/** Elite classes are whatever the elite spawn pools contain, so new enemy types need no change here. */
export const isElite=(kind?:EnemyKind)=>ENEMY_SPAWN.elite.some(pool=>pool.includes(kind??'raider'));
/** Typical seeded danger level of a population region (median of five samples); the home region is always level 1. Picks which classes reinforce it. */
export function regionDanger(spec:WorldSpec,key:string){
 const [cx,cy]=key.split(',').map(Number),size=POPULATION.enemyRegionSize;
 if(distance({x:(cx+.5)*size,y:(cy+.5)*size},spec.bases[0])<size*.8)return 1;
 return [[.2,.2],[.8,.2],[.5,.5],[.2,.8],[.8,.8]].map(([dx,dy])=>dangerAt(spec,(cx+dx)*size,(cy+dy)*size)).sort((a,b)=>a-b)[2];
}
export const enemyRegionKey=(point:Point)=>`${Math.floor(point.x/POPULATION.enemyRegionSize)},${Math.floor(point.y/POPULATION.enemyRegionSize)}`;
export function threatAt(spec:WorldSpec,key:string):Threat{
 const [cx,cy]=key.split(',').map(Number),size=POPULATION.enemyRegionSize;
 if(distance({x:(cx+.5)*size,y:(cy+.5)*size},spec.bases[0])<size*.8)return 'low';
 let score=0;
 for(const [dx,dy]of [[.2,.2],[.8,.2],[.5,.5],[.2,.8],[.8,.8]]){const f=fieldAt(spec,(cx+dx)*size,(cy+dy)*size);score+=f.density*(f.ore==='crystal'||f.ore==='radioactive'?1.4:1);}
 score=score/5+(hashSeed(spec.seed+':threat:'+key)/4294967296)*.06;
 return score>.48?'high':score>.16?'medium':'low';
}
export class EnemyPopulation {
 readonly regions=new Map<string,EnemyRegion>();
 readonly bosses=new Map<string,BossState>();
 private spec:WorldSpec;
 constructor(spec:WorldSpec,snapshot?:EnemyPopulationSnapshot){this.spec=spec;for(const region of snapshot?.regions??[])this.regions.set(region.key,structuredClone(region));for(const [key,value]of snapshot?.bosses??[])this.bosses.set(key,{...value});}
 private region(key:string,now:number){let r=this.regions.get(key);if(!r){r={key,threat:threatAt(this.spec,key),normalDue:now,eliteDue:now,normalCycle:0,eliteCycle:0,attempt:0,defeats:0,sleeping:[]};this.regions.set(key,r);}return r;}
 private interval(r:EnemyRegion,kind:EnemyClass){const range=POPULATION.threats[r.threat][kind==='normal'?'normalInterval':'eliteInterval'],cycle=kind==='normal'?r.normalCycle:r.eliteCycle;return range[0]+new SeedRandom(`${this.spec.seed}:reinforce:${r.key}:${kind}:${cycle}`).next()*(range[1]-range[0]);}
 recordDefeat(enemy:Enemy,now:number){
  const r=this.region(enemy.populationRegion??enemyRegionKey(enemy),now),kind=enemy.populationClass??(isElite(enemy.kind)?'elite':'normal');r.defeats++;
  if(kind==='normal')r.normalDue=Math.max(r.normalDue,now+this.interval(r,kind));else r.eliteDue=Math.max(r.eliteDue,now+this.interval(r,kind));
 }
 bossReady(key:string,now:number){return now>=(this.bosses.get(key)?.readyAt??0);}
 recordBossDefeat(key:string,now:number){
  const old=this.bosses.get(key);if(old&&now<old.readyAt)return {accepted:false,uniqueReward:false};
  const defeats=(old?.defeats??0)+1,range=POPULATION.bossInterval,rng=new SeedRandom(`${this.spec.seed}:boss:${key}:${defeats}`);
  const result={accepted:true,uniqueReward:!old?.uniqueGranted};this.bosses.set(key,{readyAt:now+range[0]+rng.next()*(range[1]-range[0]),defeats,uniqueGranted:true});return result;
 }
 snapshot():EnemyPopulationSnapshot{return {regions:structuredClone([...this.regions.values()]),bosses:structuredClone([...this.bosses.entries()])};}
 update(now:number,player:Point,view:PopulationView|undefined,asteroids:Asteroid[],bases:GameModel['bases'],enemies:Enemy[],squads:GameModel['squads'],nextId:()=>number,ship:SpawnBlocker[]=[]){
  // Park actors, including patrol membership, rather than killing/despawning them for loot.
  const active:Enemy[]=[];
  for(const e of enemies){
   if(e.health<=0)continue;
   // Bosses, their parts, escorts, reinforcements and drones are spawned by encounters, not by regional targets.
   if(e.populationExempt){active.push(e);continue;}
   e.populationRegion??=enemyRegionKey(e);e.populationClass??=isElite(e.kind)?'elite':'normal';
   const region=this.region(e.populationRegion,now);
   if(distance(e,player)>POPULATION.enemyUnloadRadius){const squad=squads.find(s=>s.id===e.squad);if(squad)e.populationPatrol={...squad};region.sleeping.push(e);}else active.push(e);
  }
  const [px,py]=enemyRegionKey(player).split(',').map(Number),keys:string[]=[];
  for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){const x=px+dx,y=py+dy;if(x>=0&&y>=0&&x*POPULATION.enemyRegionSize<WORLD.width&&y*POPULATION.enemyRegionSize<WORLD.height)keys.push(`${x},${y}`);}
  keys.sort((a,b)=>{const d=(key:string)=>{const [x,y]=key.split(',').map(Number);return Math.hypot((x+.5)*POPULATION.enemyRegionSize-player.x,(y+.5)*POPULATION.enemyRegionSize-player.y);};return d(a)-d(b);});
  const clear=(point:Point,radius:number)=>point.x>radius&&point.y>radius&&point.x<WORLD.width-radius&&point.y<WORLD.height-radius&&
   distance(point,player)>=POPULATION.enemyMinDistance&&distance(point,player)<=POPULATION.enemyLoadRadius&&outsideView(point,view,player,radius)&&
   bases.every(b=>distance(point,b)>POPULATION.baseClearance+radius)&&asteroids.every(a=>distance(point,a)>a.radius+radius+20)&&active.every(e=>distance(point,e)>ENEMIES[e.kind??'raider'].radius+radius+20)&&ship.every(b=>distance(point,b)>b.radius+radius+20);
  let arrivals=0;
  for(const key of keys){
   const r=this.region(key,now);
   // Existing sleeping actors count against targets and only wake at safe, offscreen positions.
   for(const e of [...r.sleeping])if(active.length<POPULATION.enemyBudget&&clear(e,ENEMIES[e.kind??'raider'].radius)){
    active.push(e);r.sleeping=r.sleeping.filter(other=>other.id!==e.id);
    if(e.populationPatrol&&!squads.some(s=>s.id===e.populationPatrol!.id))squads.push({...e.populationPatrol});
   }
   for(const kind of ['normal','elite'] as const){
    const config=POPULATION.threats[r.threat],count=[...active,...r.sleeping].filter(e=>e.populationRegion===key&&e.populationClass===kind).length,target=config[kind];
    const due=kind==='normal'?r.normalDue:r.eliteDue;
    if(count>=target||due>now||active.length>=POPULATION.enemyBudget||arrivals>=POPULATION.enemyArrivalsPerTick)continue;
    const groupSize=Math.min(kind==='normal'?PATROL.groupSize:1,target-count,POPULATION.enemyBudget-active.length,POPULATION.enemyArrivalsPerTick-arrivals);
    const rng=new SeedRandom(`${this.spec.seed}:enemy-arrival:${key}:${kind}:${kind==='normal'?r.normalCycle:r.eliteCycle}:${r.attempt++}`);
    const [cx,cy]=key.split(',').map(Number),types:EnemyKind[]=ENEMY_SPAWN[kind][regionDanger(this.spec,key)-1];
    const kinds=Array.from({length:groupSize},(_,i)=>i===0&&kind==='normal'?types[0]:types[Math.floor(rng.next()*types.length)]);
    let formation:Point[]|undefined,angle=0;
    for(let attempt=0;attempt<50&&!formation;attempt++){
     const center={x:(cx+rng.next())*POPULATION.enemyRegionSize,y:(cy+rng.next())*POPULATION.enemyRegionSize};angle=rng.next()*Math.PI*2;
     if(groupSize>1&&(center.x<350||center.y<350||center.x>WORLD.width-350||center.y>WORLD.height-350||bases.some(b=>distance(center,b)<BASE_RADIUS+300)))continue;
     const points=kinds.map((_,i)=>{const forward=i===0?0:-PATROL.spacing,side=i===0?0:(i===1?-1:1)*PATROL.spacing;return {x:center.x+Math.cos(angle)*forward-Math.sin(angle)*side,y:center.y+Math.sin(angle)*forward+Math.cos(angle)*side};});
     if(points.every((point,i)=>clear(point,ENEMIES[kinds[i]].radius)))formation=points;
    }
    if(!formation)continue;
    const squad=groupSize>1?{id:nextId(),...formation[0],angle}:undefined;if(squad)squads.push(squad);
    for(let i=0;i<groupSize;i++)active.push({id:nextId(),...formation[i],kind:kinds[i],health:ENEMIES[kinds[i]].health,cooldown:1,angle,squad:squad?.id,slot:squad?i:undefined,populationRegion:key,populationClass:kind});
    arrivals+=groupSize;
    if(kind==='normal'){r.normalCycle++;r.normalDue=Math.max(due,now-this.interval(r,kind)*2)+this.interval(r,kind);}else{r.eliteCycle++;r.eliteDue=Math.max(due,now-this.interval(r,kind)*2)+this.interval(r,kind);}
   }
  }
  return {enemies:active,squads:squads.filter(s=>active.some(e=>e.squad===s.id))};
 }
}
