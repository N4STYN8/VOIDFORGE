import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ChunkWorld,createWorld,assignNaturalDrift,type WorldSpec} from '../src/world.ts';
import {beltPosition,placeBeltAtTime,advanceBelt,type BeltKind} from '../src/beltMotion.ts';
import {GameModel,type ShipModule} from '../src/model.ts';
import {ensureAsteroidGeometry,mineMaterial,miningImpact,asteroidLocal,type Asteroid} from '../src/mining.ts';
import {collideAsteroid} from '../src/collisions.ts';
import {clearLineOfSight,avoidMovingOre} from '../src/enemyAI.ts';
import {EnemyPopulation,enemyRegionKey} from '../src/enemyPopulation.ts';
import {fixtureModel} from './fixtures.ts';
function field(type:BeltKind){
 const spec=createWorld('motion-fixture');spec.belts=[{x:30000,y:30000,angle:0,length:8000,width:650,curve:150,phase:.6,density:.9,ore:'iron'}];spec.clusters=[];spec.starter=[];spec.expansion=undefined;spec.populationFields={belts:[],clusters:[]};spec.bases.forEach((b,i)=>{b.x=3000+i*1500;b.y=3000;});
 const world=new ChunkWorld(spec.seed,{spec,changes:[],surveyed:[]});world.spec.beltMotions![0].type=type;
 const rocks=world.activate({x:30000,y:30000},[]);return{world,rocks};
}
const idle={x:0,y:0,aim:{x:30500,y:30000},fire:false,mine:false,dock:false};
test('seeded worlds include all four motion definitions and a minority of gentle individual drifters',()=>{
 const world=new ChunkWorld('motion-mix');assert.deepEqual([...new Set(world.spec.beltMotions!.map(b=>b.type))].sort(),['drifting','flowing','orbital','static']);
 let drifting=0;for(let i=0;i<200;i++){const a:Asteroid={id:10000+i,shapeSeed:i,x:30000,y:30000,vx:0,vy:0,radius:30,ore:'iron',amount:40,health:40};assignNaturalDrift(a,world.spec);const speed=Math.hypot(a.driftX!,a.driftY!);if(speed){drifting++;assert.ok(speed>=1.5&&speed<=3.5);}}
 assert.ok(drifting>15&&drifting<75);
 const home=world.spec.bases[0],starter={id:1,...home,vx:0,vy:0,radius:30,ore:'iron' as const,amount:40,health:40};assignNaturalDrift(starter,world.spec);assert.equal(starter.driftX,0);assert.equal(starter.driftY,0);
});
test('natural drift persists rather than decaying away, while static rocks stay still',()=>{
 const m=fixtureModel();m.player.x=5000;m.player.y=5000;m.enemies=[];
 const a:Asteroid={id:9100,x:5200,y:5000,originX:5200,originY:5000,vx:2,vy:0,driftX:2,driftY:0,radius:30,ore:'iron',amount:40,health:40},b:Asteroid={...a,id:9101,x:5600,originX:5600,vx:0,driftX:0};m.asteroids=[a,b];
 for(let i=0;i<100;i++)m.update(.05,idle);assert.ok(Math.abs(a.x-5210)<.001);assert.equal(a.vx,2);assert.equal(b.x,5600);assert.ok(a.rotation!==0);
});
for(const type of ['drifting','orbital','flowing'] as BeltKind[])test(`${type} formations cross source chunks, rotate independently and persist after mining and reload`,()=>{
 const {world,rocks}=field(type),moving=rocks.filter(a=>a.motion);assert.ok(moving.length>10);
 const a=moving.sort((a,b)=>Math.hypot(b.x-30000,b.y-30000)-Math.hypot(a.x-30000,a.y-30000))[0],start={x:a.x,y:a.y};
 let time=1800;while(time<20000&&Math.hypot(beltPosition(a,world.spec,time).x-start.x,beltPosition(a,world.spec,time).y-start.y)<1300)time+=1800;
 assert.ok(time<20000);const target=beltPosition(a,world.spec,time);world.advance(time);const loaded=world.activate(target,rocks,true),current=loaded.find(rock=>rock.id===a.id)!;assert.ok(current);assert.ok(Math.hypot(current.x-target.x,current.y-target.y)<.01);assert.ok(Math.abs(current.rotation!)>.01);assert.equal(new Set(loaded.map(a=>a.id)).size,loaded.length);
 const impact=miningImpact(current,{x:current.x-120,y:current.y},current),removed=mineMaterial(current,10,impact);assert.equal(removed,10);const geometry=structuredClone(current.geometry);
 const snapshot=JSON.parse(JSON.stringify(world.snapshot(loaded))),again=new ChunkWorld(world.spec.seed,snapshot),restored=again.activate(current,[],true),same=restored.find(rock=>rock.id===a.id)!;
 assert.ok(same);assert.deepEqual(same.geometry,geometry);assert.equal(same.amount,current.amount);assert.ok(Math.hypot(same.x-current.x,same.y-current.y)<.001);
 const first=placeBeltAtTime(structuredClone(current),again.spec,again.time);assert.equal(first,undefined);assert.equal(new Set(restored.map(a=>a.id)).size,restored.length);
 const neighbour=restored.find(b=>b.id!==same.id&&b.motion?.id===same.motion?.id)!;assert.ok(neighbour);assert.notEqual(neighbour.rotation,same.rotation);
});

test('rotated asteroid polygons govern laser impact, sight and physical contacts',()=>{
 const a:Asteroid={id:9000,x:1000,y:1000,vx:0,vy:0,radius:41,ore:'iron',amount:40,health:40,rotation:Math.PI/2};const shape=ensureAsteroidGeometry(a);shape.vertices=[{x:-40,y:-8},{x:40,y:-8},{x:40,y:8},{x:-40,y:8}];a.radius=41;
 const hit=miningImpact(a,{x:1100,y:1000},a);assert.ok(Math.abs(hit.x-1008)<.01);assert.equal(clearLineOfSight({x:940,y:1030},{x:1060,y:1030},[a]),false);
 const body={x:1022,y:1000,vx:0,vy:0,radius:10,mass:1};assert.equal(collideAsteroid(body,{...a,mass:3},shape,.3),undefined);
 a.rotation=0;assert.ok(collideAsteroid({...body},{...a,mass:3},shape,.3)!==undefined);
});

test('moving-target mining tracks impact and transfers finite ore momentum to tractor-collectible drops',()=>{
 const {world,rocks}=field('drifting'),a=rocks.find(a=>a.motion)!;const m=new GameModel(world.spec.seed,{world:world.snapshot(rocks),streaming:false,restoring:true});m.asteroids=world.activate(a,rocks,true);m.world.spec.beltMotions=world.spec.beltMotions;m.player.x=a.x-150;m.player.y=a.y;m.player.angle=0;m.coreLevel=5;m.energy=m.maxEnergy;m.enemies=[];
 const miner:ShipModule={x:1,y:0,kind:'miner',level:1,cooldown:0,integrity:40};m.modules=[miner];
 let target=m.asteroids.find(b=>b.id===a.id)!;m.asteroids=[target];const initial=target.amount;
 for(let i=0;i<5;i++)m.update(.05,{...idle,mine:true,aim:{x:target.x,y:target.y}});
 assert.ok(target.amount<initial);assert.ok(m.drops.length>0);assert.ok(Math.hypot(m.drops[0].vx??0,m.drops[0].vy??0)>0);assert.equal(m.drops.reduce((n,d)=>n+d.amount,0)+target.amount,initial);assert.equal(m.miningLinks[0].targetId,target.id);
 const last=m.miningLinks[0].to;assert.ok(Math.hypot(last.x-target.x,last.y-target.y)<=target.radius+.01);
 m.modules.push({x:-1,y:0,kind:'tractor',level:5,cooldown:0,integrity:100});for(let i=0;i<30;i++)m.update(.05,{...idle,aim:target});assert.ok(m.cargoUsed>0);assert.equal(m.cargoUsed+m.drops.reduce((n,d)=>n+d.amount,0)+target.amount,initial);
});

test('moving belts regenerate depleted members in their current parent motion without resetting the original',()=>{
 const {world,rocks}=field('flowing'),a=rocks.find(a=>a.motion)!;world.destroy(a.id,a);let active=rocks.filter(b=>b!==a);const slot=[...world.regions.values()].flatMap(r=>r.slots).find(s=>s.sourceId===a.id)!;assert.equal(slot.motionId,a.motion!.id);
 for(let i=0;i<30&&!slot.current;i++){world.advance(Math.max(0,slot.due-world.time)+.1);const position=beltPosition(a,world.spec,world.time);active=world.activate(position,active,true);world.replenish(position,active);}
 assert.ok(slot.current);assert.equal(slot.current!.motion?.id,a.motion!.id);assert.notEqual(slot.current!.id,a.id);assert.equal(world.changes.get(a.id),null);const p=beltPosition(slot.current!,world.spec,world.time);assert.ok(Math.hypot(p.x-slot.current!.x,p.y-slot.current!.y)<.001);
});

test('enemies steer around current moving rock positions while still using existing visibility',()=>{
 const rock:Asteroid={id:1,x:60,y:0,vx:2,vy:0,radius:30,ore:'iron',amount:40,health:40};assert.notEqual(avoidMovingOre({x:0,y:0},0,[rock],17),0);rock.y=200;assert.equal(avoidMovingOre({x:0,y:0},0,[rock],17),0);
});


test('resource-rich moving belts raise local patrol threat while the starting region stays protected',()=>{
 const spec=createWorld('moving-threat');spec.belts=[];spec.clusters=[];spec.expansion=undefined;spec.populationFields={belts:[],clusters:[]};spec.bases.forEach((b,i)=>{b.x=3000+i*1500;b.y=3000;});
 const pop=new EnemyPopulation(spec),point={x:30000,y:30000};let id=100;
 const rocks:Asteroid[]=Array.from({length:20},(_,i)=>({id:i+10000,x:30000+i*60,y:30000,vx:3,vy:0,radius:30,ore:'crystal',amount:50,health:50,motion:{id:'belt',anchorX:30000+i*60,anchorY:30000,offsetX:0,offsetY:0,time:0,pathVx:3,pathVy:0,phase:0,rate:.01,spin:.01}}));
 pop.update(0,point,undefined,rocks,spec.bases.map(b=>({...b,unlocked:true})),[],[],()=>id++);
 assert.equal(pop.regions.get(enemyRegionKey(point))!.threat,'high');
});


test('old saves start belt motion at their saved epoch without jumping and then retain their phase',()=>{
 const {world,rocks}=field('drifting'),old=rocks.find(a=>a.motion)!,point={x:old.x,y:old.y},snapshot=JSON.parse(JSON.stringify(world.snapshot(rocks)));
 delete snapshot.spec.beltMotions;delete snapshot.spec.motionEpoch;snapshot.population.time=1200;snapshot.changes=[];
 const migrated=new ChunkWorld(snapshot.spec.seed,snapshot);migrated.spec.beltMotions![0].type='drifting';assert.equal(migrated.spec.motionEpoch,1200);
 let active=migrated.activate(point,[]),a=active.find(a=>a.id===old.id)!;assert.ok(a);assert.ok(Math.hypot(a.x-point.x,a.y-point.y)<.001);
 migrated.advance(120);active=migrated.activate(beltPosition(a,migrated.spec,migrated.time),active,true);a=active.find(a=>a.id===old.id)!;const saved=JSON.parse(JSON.stringify(migrated.snapshot(active))),again=new ChunkWorld(saved.spec.seed,saved),b=again.activate(a,[],true).find(b=>b.id===a.id)!;
 assert.ok(Math.hypot(b.x-a.x,b.y-a.y)<.001);assert.equal(again.spec.motionEpoch,1200);
});
