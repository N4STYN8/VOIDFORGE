import {GameModel,type Enemy,type GameSave,type Bullet} from '../src/model.ts';
import {OUTPOST,STRUCTURES,MODULES,MODULE_DURABILITY,SHIP,WEAPONS,type Resource,type ModuleKind,type StructureKind} from '../src/data.ts';
import {cellCenter,connectedIds,maxHealth,outpostCenter,outpostStats,storedTotal,structureOnSegment,type Outpost} from '../src/outposts.ts';
import {sharedSector,encodeRock,type RockState,type SharedShot} from '../src/shared.ts';
import {segmentCircleHit} from '../src/asteroidGeometry.ts';
import type {WorldRef,ShipState} from '../src/netProtocol.ts';
export type CrewMinerals=Record<Resource,number>;
export type CrewOutpostRecord={key:string;world:WorldRef;state:GameSave;transferred?:string[]};
export type OutpostCrew={id:string;resources:CrewMinerals;members?:{pilotId:string;role:string}[];outposts?:unknown[]};
export type CrewOutpostContext={world?:WorldRef;ship?:ShipState};
export type CrewOutpostOptions={claimRock?:(crewId:string,world:WorldRef,id:number)=>boolean;readRock?:(world:WorldRef,id:number)=>RockState|undefined;onRock?:(world:WorldRef,patch:RockState)=>void;onEnemyHit?:(world:WorldRef,id:number,damage:number)=>void};
export type CrewOutpostView={sectorKey:string;outposts:Outpost[];miningReady:boolean};
export const crewSectorKey=(w:WorldRef)=>JSON.stringify([w.home,w.x,w.y,w.seed]);
const empty=():CrewMinerals=>({iron:0,copper:0,crystal:0,ice:0,radioactive:0});
const clone=<T>(value:T):T=>structuredClone(value);
const finite=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n);
const fail=(text:string):never=>{throw new Error(text);};
/** One authoritative simulation for each crew/sector, persisted by CrewStore's atomic transaction. */
export class CrewOutposts{
 private options:CrewOutpostOptions;
 private combats=new Map<string,{enemies:Enemy[];shots:SharedShot[]}>();
 constructor(options:CrewOutpostOptions={}){this.options=options;}
 private records(crew:OutpostCrew){return (crew.outposts??=[]) as CrewOutpostRecord[];}
 private record(crew:OutpostCrew,world:WorldRef,create=false){const records=this.records(crew),key=crewSectorKey(world);let record=records.find(r=>r.key===key);if(!record&&create){const model=new GameModel(world.seed);model.outposts=[];model.enemies=[];model.modules=[];model.cargo=empty();model.stored=empty();record={key,world:clone(world),state:model.toSave(),transferred:[]};records.push(record);}return record;}
 private load(crew:OutpostCrew,record:CrewOutpostRecord){const model=GameModel.fromSave(record.state);model.stored={...crew.resources};model.cargo=empty();model.enemies=[];const applied=new Set<number>();model.shared=sharedSector('authority',id=>{
   const patch=this.options.readRock?.(record.world,id);if(!patch||patch.gone||!this.options.claimRock?.(crew.id,record.world,id))return false;
   if(!applied.has(id)){const rock=model.asteroids.find(a=>a.id===id);if(!rock)return false;model.applyRock({...patch,amount:Math.min(rock.amount,patch.amount??0)});applied.add(id);}return true;
  });return model;}
 private save(crew:OutpostCrew,record:CrewOutpostRecord,model:GameModel){model.world.capture(model.asteroids);crew.resources={...model.stored};record.state=model.toSave();record.state.stored=empty();record.state.cargo=empty();record.state.enemies=[];record.state.player.health=Math.max(1,record.state.player.health);}
 private pilot(model:GameModel,context:CrewOutpostContext,data:Record<string,unknown>={}){
  const ship=context.ship;if(!ship||ship.dead||!finite(ship.x)||!finite(ship.y))fail('A living pilot in the same sector is required.');
  Object.assign(model.player,{x:ship.x,y:ship.y,vx:ship.vx,vy:ship.vy,angle:ship.angle,health:ship.health});
  model.modules=[];model.coreLevel=1;
  for(const [kind,x,y,level]of ship.blocks??[]){if(!Number.isInteger(level)||level<1||level>5)continue;if(kind==='core'){model.coreLevel=level;continue;}if(!Object.hasOwn(MODULES,kind))continue;model.modules.push({kind:kind as ModuleKind,x,y,level,cooldown:0,integrity:MODULE_DURABILITY[kind as ModuleKind][level-1]});}
  model.energy=model.maxEnergy;model.shield=model.maxShield;
  if(Array.isArray(data.integrity))for(let i=0;i<model.modules.length;i++){const value=data.integrity[i];if(finite(value))model.modules[i].integrity=Math.max(0,Math.min(model.moduleMaxIntegrity(model.modules[i]),value));}
  model.asteroids=model.world.activate(model.player,model.asteroids,true);
 }
 private world(context:CrewOutpostContext){if(!context.world)fail('Enter a sector before using crew outposts.');return context.world;}
 view(crew:OutpostCrew,context:CrewOutpostContext):CrewOutpostView|undefined{if(!context.world)return undefined;const record=this.record(crew,context.world);return {sectorKey:crewSectorKey(context.world),outposts:clone(record?.state.outposts??[]),miningReady:Boolean(this.options.claimRock&&this.options.readRock)};}
 command(crew:OutpostCrew,pilotId:string,action:string,raw:unknown,context:CrewOutpostContext):Record<string,unknown>{
  const world=this.world(context);if(action==='outpost-sync')return {outpostView:this.view(crew,context)};const data=raw&&typeof raw==='object'?raw as Record<string,unknown>:{};
  const record=this.record(crew,world,true)!,model=this.load(crew,record);this.pilot(model,context,data);
  const find=()=>{const outpost=model.outposts.find(o=>o.id===data.outpostId);if(!outpost)fail('Crew outpost no longer exists in this sector.');return outpost;};
  let result:Record<string,unknown>={};
  if(action==='outpost-sync')return {outpostView:this.view(crew,context)};
  if(action==='outpost-place'){
   if(typeof data.kind!=='string'||!Object.hasOwn(STRUCTURES,data.kind)||!Number.isSafeInteger(data.cx)||!Number.isSafeInteger(data.cy))fail('Invalid construction block or grid cell.');
   if(!model.placeStructure(data.kind as StructureKind,data.cx as number,data.cy as number,Number(data.rot??0)))fail(model.message);
  }else if(action==='outpost-upgrade'||action==='outpost-repair'){
   const outpost=find(),block=outpost.structures.find(s=>s.id===data.structureId);if(!block)fail('Select an existing crew block.');
   if(!(action==='outpost-upgrade'?model.upgradeStructure(outpost,block):model.repairStructure(outpost,block)))fail(model.message);
  }else if(action==='outpost-dock'){
   const outpost=find();if(model.dockAt()!==outpost)fail('Move within range of a finished crew docking station.');
   const price=model.repairCost;for(const ore of Object.keys(price)as Resource[])if(crew.resources[ore]<price[ore])fail(`Not enough crew ${ore} for ship repairs.`);
   for(const ore of Object.keys(price)as Resource[])model.stored[ore]-=price[ore];
   result.shipRepair={health:model.maxHealth,shield:model.maxShield,modules:model.modules.map(m=>({x:m.x,y:m.y,integrity:model.moduleMaxIntegrity(m)}))};
  }else if(action==='outpost-bank-deposit'||action==='outpost-bank-withdraw'){
   const outpost=find(),error=model.transferError(outpost);if(error)fail(error);const stored=outpost.stored??=empty();
   const amounts=data.minerals&&typeof data.minerals==='object'?data.minerals as Record<string,unknown>:{};let total=0;
   for(const ore of Object.keys(empty())as Resource[]){const n=amounts[ore]??0;if(!Number.isSafeInteger(n)||Number(n)<0)fail('Invalid mineral amount.');total+=Number(n);}
   if(!total)fail('Choose minerals to transfer.');
   if(action==='outpost-bank-deposit'&&storedTotal(outpost)+total>outpostStats(outpost).storageCapacity)fail('Crew outpost storage is full.');
   for(const ore of Object.keys(empty())as Resource[]){const n=Number(amounts[ore]??0),source=action==='outpost-bank-deposit'?model.stored:stored,target=action==='outpost-bank-deposit'?stored:model.stored;if(source[ore]<n)fail(`Not enough ${ore}.`);target[ore]+=n;source[ore]-=n;}
  }else if(action==='outpost-claim-personal'){
   if(!crew.members?.some(m=>m.pilotId===pilotId&&m.role==='owner'))fail('Only the crew leader may reclaim a crew outpost.');
   const outpost=find();if(Math.hypot(outpostCenter(outpost).x-model.player.x,outpostCenter(outpost).y-model.player.y)>OUTPOST.panelRange)fail('Move close to the crew outpost before reclaiming it.');
   model.outposts=model.outposts.filter(o=>o!==outpost);result.personalOutpost=clone(outpost);
  }else if(action==='outpost-transfer'){
   const source=data.outpost as Outpost|undefined;if(!source||!Number.isSafeInteger(source.id)||!Array.isArray(source.structures)||source.structures.length<1||source.structures.length>(OUTPOST.radius*2+1)**2)fail('Invalid personal outpost.');
   const token=`${pilotId}:${source.id}`;if(record.transferred?.includes(token))return {transferredPersonalId:source.id,message:'Personal outpost was already transferred.',outpostView:this.view(crew,context)};
   const outpost=this.validateTransfer(source,model);if(model.outposts.some(o=>Math.hypot(outpostCenter(o).x-outpostCenter(outpost).x,outpostCenter(o).y-outpostCenter(outpost).y)<OUTPOST.coreSpacing))fail('Too close to an existing crew outpost.');
   if(Math.hypot(outpostCenter(outpost).x-model.player.x,outpostCenter(outpost).y-model.player.y)>OUTPOST.panelRange)fail('Move close to the personal outpost before transferring it.');
   model.outposts.push(outpost);(record.transferred??=[]).push(token);result.transferredPersonalId=source.id;
  }else fail('Unknown crew outpost action.');
  this.save(crew,record,model);return {...result,message:model.message||'Crew outpost updated.',outpostView:this.view(crew,context)};
 }
 private validateTransfer(source:Outpost,model:GameModel){
  const copy=clone(source),cells=new Set<string>(),ids=new Map<number,number>();let next=Math.max(1,...model.outposts.flatMap(o=>[o.id,...o.structures.map(s=>s.id)]))+1;copy.id=next++;
  if(!Number.isSafeInteger(copy.cx)||!Number.isSafeInteger(copy.cy))fail('Invalid core cell.');
  for(const s of copy.structures){if(!Object.hasOwn(STRUCTURES,s.kind)||!Number.isSafeInteger(s.cx)||!Number.isSafeInteger(s.cy)||Math.abs(s.cx-copy.cx)>OUTPOST.radius||Math.abs(s.cy-copy.cy)>OUTPOST.radius||!Number.isInteger(s.level)||s.level<1||s.level>5||!finite(s.health)||!finite(s.progress)||s.progress<0||s.progress>1)fail('Invalid personal structure.');const key=`${s.cx},${s.cy}`;if(cells.has(key))fail('Overlapping personal blocks.');cells.add(key);if(!Number.isSafeInteger(s.id)||ids.has(s.id))fail('Invalid structure identity.');const old=s.id;s.id=next++;ids.set(old,s.id);s.health=Math.max(0,Math.min(maxHealth(s),s.health));}
  if(copy.structures.filter(s=>s.kind==='outpostCore'&&s.cx===copy.cx&&s.cy===copy.cy).length!==1||connectedIds(copy).size!==copy.structures.length)fail('Personal outpost must remain connected to one core.');
  (model as any).id=next;copy.name=String(copy.name??'Crew outpost').replace(/[<>&]/g,'').slice(0,40);copy.revision++;for(const drone of copy.drones??[]){if(!ids.has(drone.hangar)||!Number.isSafeInteger(drone.load)||drone.load<0||drone.load>100000||drone.load>0&&(!drone.ore||!(drone.ore in empty())))fail('Invalid drone cargo.');drone.id=next++;drone.hangar=ids.get(drone.hangar)!;drone.state='returning';}copy.stored??=empty();for(const ore of Object.keys(empty())as Resource[])if(!Number.isSafeInteger(copy.stored[ore])||copy.stored[ore]<0)fail('Invalid stored resources.');const stats=outpostStats(copy);if(storedTotal(copy)>stats.storageCapacity)fail('Personal storage exceeds capacity.');copy.energy=Math.max(0,Math.min(stats.energyCapacity,finite(copy.energy)?copy.energy:0));copy.shield=Math.max(0,Math.min(stats.shieldCapacity,finite(copy.shield)?copy.shield:0));copy.heat=Math.max(0,finite(copy.heat)?copy.heat:0);return copy;
 }
 ingestCombat(crew:OutpostCrew,world:WorldRef,data:{enemies?:Enemy[];shots?:SharedShot[]}){const key=crew.id+':'+crewSectorKey(world),state=this.combats.get(key)??{enemies:[],shots:[]};if(data.enemies)state.enemies=clone(data.enemies);if(data.shots)state.shots.push(...clone(data.shots).slice(0,128));this.combats.set(key,state);}
 tick(crew:OutpostCrew,dt:number,contexts:CrewOutpostContext[]=[]){let changed=false;dt=Math.min(1,Math.max(0,dt));if(!dt)return false;
  for(const record of this.records(crew)){if(!record.state.outposts?.length)continue;const pilots=contexts.filter(c=>c.world&&crewSectorKey(c.world)===record.key&&c.ship&&!c.ship.dead);if(!pilots.length)continue;const context=pilots[0];
   const model=this.load(crew,record);this.pilot(model,context);const combat=this.combats.get(crew.id+':'+record.key);model.enemies=clone(combat?.enemies??[]);model.world.advance(dt);
   if(combat?.shots.length){for(const shot of combat.shots.splice(0)){if('beam'in shot){const hit=structureOnSegment(model.outposts,shot,{x:shot.ex,y:shot.ey});if(hit)(model as any).damageStructure(hit.outpost,hit.structure,shot.damage);}else model.bullets.push({id:Date.now()+model.bullets.length,...shot,weapon:shot.weapon as Bullet["weapon"],enemy:true});}}
   const posts=[...model.outposts],survived:Outpost[]=[],rocks=new Map(model.asteroids.map(a=>[a.id,a]));
   // The relay's sector authority owns NPC spawning; never create a second invisible raid here.
   (model as any).updateRaids=()=>{};
   for(const post of posts){const center=outpostCenter(post),nearest=pilots.reduce((a,b)=>Math.hypot(a.ship!.x-center.x,a.ship!.y-center.y)<=Math.hypot(b.ship!.x-center.x,b.ship!.y-center.y)?a:b);this.pilot(model,nearest);for(const a of model.asteroids)rocks.set(a.id,a);model.outposts=[post];(model as any).updateOutposts(dt);survived.push(...model.outposts);for(const id of model.shared!.changedRocks){const rock=model.asteroids.find(a=>a.id===id);if(rock)rocks.set(id,rock);else rocks.delete(id);this.options.onRock?.(record.world,encodeRock(rock,id));}model.shared!.changedRocks.clear();}
   model.outposts=survived;model.asteroids=[...rocks.values()];this.stepProjectiles(model,record.world,dt);this.save(crew,record,model);changed=true;
  }return changed;
 }
 private stepProjectiles(model:GameModel,world:WorldRef,dt:number){for(const b of model.bullets){if(b.life<=0)continue;const start={x:b.x,y:b.y};b.x+=b.vx*dt;b.y+=b.vy*dt;b.life-=dt;
   const oreT=model.asteroids.reduce((nearest,a)=>Math.min(nearest,segmentCircleHit(start,b,a,a.radius)??Infinity),Infinity);
   if(b.enemy){const hit=structureOnSegment(model.outposts,start,b);if(hit&&oreT>1){(model as any).damageStructure(hit.outpost,hit.structure,b.damage??WEAPONS.enemy.damage);b.life=0;}}
   else{let nearest:Enemy|undefined,t=Infinity;for(const e of model.enemies){const hit=segmentCircleHit(start,b,e,18);if(e.health>0&&hit!==undefined&&hit<t){t=hit;nearest=e;}}if(nearest&&t<oreT){nearest.health-=b.damage??0;this.options.onEnemyHit?.(world,nearest.id,b.damage??0);b.life=0;}}
   if(model.asteroids.some(a=>segmentCircleHit(start,b,a,a.radius)!==undefined))b.life=0;
  }model.bullets=model.bullets.filter(b=>b.life>0);}
}
