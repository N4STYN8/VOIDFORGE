import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CrewOutposts,crewSectorKey,type OutpostCrew} from '../server/crewOutposts.ts';
import {GameModel} from '../src/model.ts';
import {STRUCTURES,MODULE_DURABILITY,OUTPOST,DRONES,type Resource} from '../src/data.ts';
import {maxHealth,outpostStats,cellCenter,type Outpost} from '../src/outposts.ts';
const ores=['iron','copper','crystal','ice','radioactive'] as Resource[];
const stock=(n:number)=>({iron:n,copper:n,crystal:n,ice:n,radioactive:n});
const world={home:'crew-test',seed:'crew-test',x:0,y:0};
const context={world,ship:{x:16080,y:16080,vx:0,vy:0,angle:0,health:100,maxHealth:150,blocks:[['core',0,0,2],['builder',1,0,1]] as [string,number,number,number][],paint:0}};
function source():Outpost{const kinds=['outpostCore','storage','droneHangar','dockingStation'] as const;const structures=kinds.map((kind,i)=>({id:10+i,kind,cx:1000+i,cy:1000,rot:0,level:1,health:STRUCTURES[kind].health,progress:1}));return {id:10,name:'My base',cx:1000,cy:1000,revision:1,structures,energy:0,stored:stock(0),drones:[{id:20,hangar:12,x:16016,y:16008,angle:0,state:'returning',ore:'iron',load:7,timer:0}]};}
function fixture(){const crew:OutpostCrew={id:'c1',resources:stock(100000),outposts:[]};const service=new CrewOutposts();return {crew,service};}
test('personal outpost transfer preserves storage and drone cargo and is idempotent across new requests',()=>{const {crew,service}=fixture(),outpost=source();outpost.stored!.iron=50;const before=crew.resources.iron;
 const reply=service.command(crew,'owner','outpost-transfer',{outpost},context);assert.equal(reply.transferredPersonalId,10);let view=service.view(crew,context)!;assert.equal(view.outposts.length,1);assert.equal(view.outposts[0].stored!.iron,50);assert.equal(view.outposts[0].drones![0].load,7);assert.ok(view.outposts[0].structures.some(s=>s.id===view.outposts[0].drones![0].hangar));assert.equal(crew.resources.iron,before);
 service.command(crew,'owner','outpost-transfer',{outpost},context);view=service.view(crew,context)!;assert.equal(view.outposts.length,1);assert.equal(view.outposts[0].drones![0].load,7);
 const other={world:{...world,home:'other-home'},ship:context.ship};assert.equal(service.view(crew,other)!.outposts.length,0);
});
test('crew bank and outpost storage move resources without creating them; repairs/upgrades cost minerals',()=>{const {crew,service}=fixture();service.command(crew,'owner','outpost-transfer',{outpost:source()},context);let view=service.view(crew,context)!,post=view.outposts[0];const initial=crew.resources.iron+(post.stored?.iron??0);
 service.command(crew,'owner','outpost-bank-deposit',{outpostId:post.id,minerals:{iron:40}},context);post=service.view(crew,context)!.outposts[0];assert.equal(crew.resources.iron+post.stored!.iron,initial);assert.equal(post.stored!.iron,40);
 service.command(crew,'owner','outpost-bank-withdraw',{outpostId:post.id,minerals:{iron:15}},context);post=service.view(crew,context)!.outposts[0];assert.equal(post.stored!.iron,25);assert.equal(crew.resources.iron+post.stored!.iron,initial);
 const block=post.structures.find(s=>s.kind==='storage')!;service.command(crew,'owner','outpost-upgrade',{outpostId:post.id,structureId:block.id},context);post=service.view(crew,context)!.outposts[0];assert.equal(post.structures.find(s=>s.id===block.id)!.level,2);assert.ok(crew.resources.iron+post.stored!.iron<initial);
});
test('placement rejects missing builder, invalid blocks and outside-range construction without spending',()=>{const {crew,service}=fixture(),before=structuredClone(crew.resources);
 assert.throws(()=>service.command(crew,'owner','outpost-place',{kind:'wall',cx:1100,cy:1100},{...context,ship:{...context.ship,blocks:[['core',0,0,2]]}}),/Build module/);
 assert.throws(()=>service.command(crew,'owner','outpost-place',{kind:'madeup',cx:1000,cy:1000},context),/Invalid/);
 assert.throws(()=>service.command(crew,'owner','outpost-place',{kind:'outpostCore',cx:1100,cy:1100},context),/range/);assert.deepEqual(crew.resources,before);
});
test('reloading and ticking a crew sector keeps one authoritative outpost; no claim source means no drone mining',()=>{const {crew,service}=fixture();service.command(crew,'owner','outpost-transfer',{outpost:source()},context);const before=service.view(crew,context)!.outposts[0];const total=before.stored!.iron+before.drones!.reduce((sum,d)=>sum+d.load,0);
 const reloaded=structuredClone(crew),other=new CrewOutposts();for(let i=0;i<4;i++)other.tick(reloaded,.5,[context]);const after=other.view(reloaded,context)!.outposts[0];assert.equal(after.stored!.iron+after.drones!.reduce((sum,d)=>sum+d.load,0),total);assert.equal(other.view(reloaded,context)!.miningReady,false);assert.equal(other.view(reloaded,context)!.outposts.length,1);
});
import {CrewOutpostClient} from '../src/crewOutposts.ts';
import {fixtureModel} from './fixtures.ts';
const storage=new Map<string,string>();(globalThis as any).localStorage={getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)};
function clientFixture(){storage.clear();const model=fixtureModel();model.outposts=[source()];let calls=0;const net:any={pilotId:'pilot',crewSupported:true,crewState:{crew:{id:'crew',name:'Crew'},outpostView:undefined},crewRequest:async(_action:string,_data:any,id:string)=>{calls++;return {requestId:id,ok:true,result:{transferredPersonalId:10}};}};return {model,net,calls:()=>calls};}
test('personal transfer journals source removal before request, and a new client recovers the same receipt',async()=>{
 const {model,net,calls}=clientFixture();let fail=true;const adapter=new CrewOutpostClient(net,()=>model,async()=>fail?'disk failed':undefined);
 await adapter.transferPersonal(10);assert.equal(calls(),0);assert.equal(model.outposts.length,1);assert.equal(adapter.pending,true);fail=false;const recovered=new CrewOutpostClient(net,()=>model,async()=>undefined);recovered.frame();await new Promise(r=>setTimeout(r,10));assert.equal(calls(),1);assert.equal(model.outposts.length,0);assert.equal(recovered.pending,false);
});
test('rejected transfer restores original once and revoked membership can recover a committed receipt',async()=>{
 const {model,net}=clientFixture();net.crewRequest=async(_action:string,_data:any,id:string)=>({requestId:id,ok:false,error:'Not a member'});const adapter=new CrewOutpostClient(net,()=>model,async()=>undefined);await adapter.transferPersonal(10);assert.equal(model.outposts.length,1);assert.equal(model.outposts[0].drones![0].load,7);assert.equal(adapter.pending,false);
});
test('dock repairs cannot be replayed after an applied-save failure',async()=>{
 const {model,net}=clientFixture();net.crewRequest=async(_action:string,_data:any,id:string)=>({requestId:id,ok:true,result:{shipRepair:{health:150,shield:0,modules:[]}}});let writes=0;const adapter=new CrewOutpostClient(net,()=>model,async()=>++writes===2?'disk failed':undefined);model.player.health=10;await adapter.dock(1);assert.equal(adapter.pending,true);assert.equal(model.player.health,model.maxHealth);model.player.health=7;await (adapter as any).recover();assert.equal(model.player.health,7);assert.equal(adapter.pending,false);
});
import {encodeRock,type RockState} from '../src/shared.ts';
test('pristine canonical ore is mined only once into server drone/storage and duplicate pilots do not multiply output',()=>{
 const generated=new GameModel(world.seed);generated.player.x=16080;generated.player.y=16080;generated.asteroids=generated.world.activate(generated.player,generated.asteroids,true);const rock=generated.asteroids[0];assert.ok(rock);
 const post=source(),dx=Math.floor(rock.x/OUTPOST.cell)-post.cx+6,dy=Math.floor(rock.y/OUTPOST.cell)-post.cy;post.cx+=dx;post.cy+=dy;for(const s of post.structures){s.cx+=dx;s.cy+=dy;}for(const d of post.drones??[]){d.x=cellCenter(post.cx+2);d.y=cellCenter(post.cy);d.load=0;d.state='idle';}
 const ctx={...context,ship:{...context.ship,x:cellCenter(post.cx)+80,y:cellCenter(post.cy)+80}};const canonical=new Map<number,RockState>();for(const a of generated.asteroids)canonical.set(a.id,encodeRock(a,a.id));let mined=0;
 const service=new CrewOutposts({claimRock:()=>true,readRock:(_w,id)=>canonical.get(id),onRock:(_w,patch)=>{const old=canonical.get(patch.id);mined+=(old?.amount??0)-(patch.amount??0);canonical.set(patch.id,patch);}});const crew:OutpostCrew={id:'crew',resources:stock(10000),outposts:[]};service.command(crew,'owner','outpost-transfer',{outpost:post},ctx);
 for(let i=0;i<80;i++)service.tick(crew,.5,[ctx,ctx]);const out=service.view(crew,ctx)!.outposts[0];const extracted=Object.values(out.stored!).reduce((sum,n)=>sum+n,0)+(out.drones??[]).reduce((sum,d)=>sum+d.load,0);assert.ok(mined>0,'fresh ore was actually removed');assert.equal(extracted,mined,'every unit appears once in storage/drone cargo');
});
test('only the crew owner can reclaim an outpost, preserving stock and carried drone minerals',()=>{const {crew,service}=fixture();crew.members=[{pilotId:'owner',role:'owner'},{pilotId:'member',role:'member'}];service.command(crew,'owner','outpost-transfer',{outpost:source()},context);const post=service.view(crew,context)!.outposts[0];assert.throws(()=>service.command(crew,'member','outpost-claim-personal',{outpostId:post.id},context),/leader/);const reply=service.command(crew,'owner','outpost-claim-personal',{outpostId:post.id},context);assert.equal((reply.personalOutpost as Outpost).drones![0].load,7);assert.equal(service.view(crew,context)!.outposts.length,0);});
test('claim-personal recovery never duplicates a returned outpost after a final-save failure',async()=>{const {model,net}=clientFixture();model.outposts=[];net.crewRequest=async(_action:string,_data:any,id:string)=>({requestId:id,ok:true,result:{personalOutpost:source()}});let writes=0;const adapter=new CrewOutpostClient(net,()=>model,async()=>++writes===2?'disk failed':undefined);await adapter.claimPersonal(10);assert.equal(adapter.pending,true);assert.equal(model.outposts.length,1);const firstId=model.outposts[0].id;await (adapter as any).recover();assert.equal(model.outposts.length,1);assert.equal(model.outposts[0].id,firstId);assert.equal(model.outposts[0].drones![0].load,7);assert.equal(adapter.pending,false);});
test('journal-storage failure cannot remove the personal source',async()=>{const {model,net,calls}=clientFixture();const original=localStorage.setItem;localStorage.setItem=()=>{throw Error('quota');};try{const adapter=new CrewOutpostClient(net,()=>model,async()=>undefined);await assert.rejects(adapter.transferPersonal(10),/quota/);assert.equal(adapter.pending,false);assert.equal(model.outposts.length,1);assert.equal(calls(),0);}finally{localStorage.setItem=original;}});
