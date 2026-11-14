import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STRUCTURES, WORMHOLE, type StructureKind } from '../src/data.ts';
import { maxHealth, type Outpost, type Structure } from '../src/outposts.ts';
import { footprint, gatesFor, gateGeometry, planGateRoute, travelError, gateCosts, targetSector } from '../src/wormholes.ts';
import { GameModel } from '../src/model.ts';
import { warpTo, worldRef } from '../src/sectors.ts';
import { CrewOutposts, crewSectorKey, type OutpostCrew, type CrewOutpostRecord } from '../server/crewOutposts.ts';
import { CrewStore } from '../server/crewStore.ts';
import { startRelay } from '../server/relay.ts';
import { parseServer } from '../src/netProtocol.ts';
import { PvpClient } from '../src/pvpClient.ts';
import type { WorldRef, ShipBlock } from '../src/netProtocol.ts';

const stock=(n:number)=>({iron:n,copper:n,crystal:n,ice:n,radioactive:n});
const world:WorldRef={home:'warp-test',seed:'warp-test',x:0,y:0};
function post(level=5,opening=5):Outpost {
  const structures:Structure[]=[];let id=1;
  const add=(kind:StructureKind,cx:number,cy:number,l=1)=>{const s={id:id++,kind,cx:1000+cx,cy:1000+cy,level:l,health:0,progress:1,rot:0};s.health=maxHealth(s);structures.push(s);return s;};
  for(let y=0;y<=opening+1;y++)for(let x=0;x<=opening+1;x++)if(x===0||y===0||x===opening+1||y===opening+1)add('warpFrame',x,y);
  add('warpController',-1,0,level);add('outpostCore',-2,0);for(let i=0;i<5;i++)add('reactor',-2,-i-1,5);add('coolingUnit',-3,0,5);
  return {id:100,name:'Crew forge',cx:998,cy:1000,structures,revision:1,energy:1500,heat:0,stored:stock(0)};
}
const controller=(p:Outpost)=>p.structures.find(s=>s.kind==='warpController')!;
const blocks:ShipBlock[]=[['core',0,0,2]];
const ship=footprint(blocks,-Math.PI/2);
const context=(w=world)=>({world:w,ship:{x:16040,y:15930,vx:0,vy:0,angle:-Math.PI/2,health:100,maxHealth:100,paint:0,blocks},now:1000,requestId:'start'});
function record(p:Outpost,w=world):CrewOutpostRecord{const m=new GameModel(w.seed);m.outposts=[p];return {key:crewSectorKey(w),world:w,state:m.toSave()};}
function fixture(){const p=post(),crew:OutpostCrew={id:'crew',resources:stock(0),members:[{pilotId:'owner',role:'owner'},{pilotId:'member',role:'member'}],outposts:[record(p)]};return {service:new CrewOutposts(),crew,p};}

test('gate needs a real closed perimeter, empty interior, one controller, healthy completed connected blocks',()=>{
 const p=post(),c=controller(p);assert.equal(gateGeometry(p,c).status,'Operational');assert.equal(gateGeometry(p,c).width,80);
 const missing=p.structures.splice(2,1)[0];assert.equal(gateGeometry(p,c).status,'Frame is open');p.structures.push(missing);
 p.structures.push({...missing,id:99,cx:1002,cy:1002,kind:'wall'});assert.equal(gateGeometry(p,c).status,'Opening obstructed');p.structures.pop();
 p.structures.push({...c,id:99,cx:c.cx,cy:c.cy+1});p.revision++;assert.match(gateGeometry(p,c).status,/One controller/);p.structures.pop();p.revision++;
 c.health=1;assert.equal(gateGeometry(p,c).status,'Damaged');c.health=maxHealth(c);c.progress=.5;assert.equal(gateGeometry(p,c).status,'Under construction');
 c.progress=1;p.structures=p.structures.filter(s=>s.kind!=='outpostCore');p.revision++;assert.equal(gateGeometry(p,c).status,'Disconnected from core');
});
test('actual rotated ship bounds constrain the aperture; upgrades never expand range beyond five',()=>{
 const p=post(),g=gatesFor(p,world)[0],long=footprint([...blocks,['cargo',5,0,1]],-Math.PI/2);
 assert.ok(travelError(g,targetSector(world,1,0),long)?.includes('fit'));assert.equal(travelError(g,targetSector(world,5,0),ship),undefined);
 assert.match(travelError(g,targetSector(world,10,0),ship)!,/Range/);
 assert.equal(footprint([...blocks,['cargo',5,0,1]],0).height,long.width);
 assert.ok(footprint([...blocks,['cargo',5,0,1]],0).width>footprint([...blocks,['cargo',5,0,1]],0).height,'Uses the actual model angle, without a sprite-facing offset');
});
test('cooldown, heat, power and per-level range restrict actual departures and survive save/load',()=>{
 for(let level=1;level<=5;level++){const p=post(level),g=gatesFor(p,world)[0];assert.equal(g.range,level);assert.equal(travelError(g,targetSector(world,level,0),ship),undefined);assert.ok(travelError(g,targetSector(world,level+1,0),ship));}
 const p=post();controller(p).gateCooldown=12;p.heat=33;const m=new GameModel(world.seed);m.outposts=[p];const restored=GameModel.fromSave(m.toSave());assert.equal(controller(restored.outposts[0]).gateCooldown,12);assert.equal(gatesFor(restored.outposts[0],world)[0].status,'Cooling down');
 controller(p).gateCooldown=0;p.overheated=true;assert.equal(gatesFor(p,world)[0].status,'Overheated');p.overheated=false;p.energy=0;assert.equal(gatesFor(p,world)[0].status,'Unpowered');p.energy=1500;p.heat=299;assert.match(travelError(gatesFor(p,world)[0],targetSector(world,1,0),ship)!,/heat/);
});
test('departure suspension allows an existing failed combat receipt exchange to recover before switching',async()=>{
 const model=new GameModel('warp-pending-combat');let calls=0;const net:any={connected:true,modularPvp:true,pilotId:'pilot',modularRequest:async()=>{if(++calls===1)throw Error('temporary transport failure');return {ledger:'ledger',events:[],objects:[]};}};
 const client=new PvpClient(net,()=>model,async()=>undefined);client.frame(model,1);await new Promise(r=>setTimeout(r,5));assert.equal(client.pending,true);client.suspended=true;client.frame(model,2);await new Promise(r=>setTimeout(r,5));assert.equal(client.pending,false);client.frame(model,3);assert.equal(calls,2);
});
test('graph routing requires actual usable intermediate departure gates and respects each range',()=>{
 const a=gatesFor(post(5),world)[0],b=gatesFor(post(5),targetSector(world,5,0))[0],c=gatesFor(post(3),targetSector(world,10,0))[0],to=targetSector(world,10,0);
 assert.equal(planGateRoute([a],a.id,to,ship),undefined);
 const route=planGateRoute([a,b,c],a.id,to,ship)!;assert.equal(route.hops.length,2);assert.deepEqual(route.hops.map(h=>h.to.x),[5,10]);assert.equal(route.energy,gateCosts(a,5,ship).energy+gateCosts(b,5,ship).energy);
 for(const bad of [{...b,width:10},{...b,status:'Damaged'},{...b,energy:0},{...b,accessible:false},{...b,world:{...b.world,home:'unrelated'}}])assert.equal(planGateRoute([a,bad,c],a.id,to,ship),undefined);
 assert.equal(planGateRoute([a,c],a.id,to,ship),undefined,'Temporary arrival portals never become graph nodes');
 const other=planGateRoute([a,b,c],a.id,targetSector(world,3,0),ship)!;assert.equal(other.hops.length,1);assert.equal(route.hops.length,2,'Plans are independent');
});
test('crew network derives from persisted outpost records across worlds and builder disconnects',()=>{
 const {service,crew}=fixture();const remote=targetSector(world,5,0);(crew.outposts as CrewOutpostRecord[]).push(record(post(3),remote));
 const view=service.view(crew,context())!;assert.equal(view.gates.length,2);assert.equal(view.gates[1].range,3);
 const reloaded=structuredClone(crew);new CrewOutposts().tick(reloaded,.5,[]);assert.equal(service.view(reloaded,context())!.gates.length,2);
 (reloaded.outposts as CrewOutpostRecord[])[1].state.outposts=[];assert.equal(service.view(reloaded,context())!.gates.length,1);
});
test('crew gate reserves actual energy once, charges before departure, rechecks damage and supports another member',()=>{
 const {service,crew}=fixture(),data={outpostId:100,controllerId:controller((crew.outposts as CrewOutpostRecord[])[0].state.outposts![0]).id,to:{x:5,y:0}};
 const before=service.view(crew,context())!.outposts[0].energy!;
 const start=service.command(crew,'member','outpost-warp-start',data,context()) as any;const after=service.view(crew,context())!.outposts[0].energy!;assert.equal(before-after,start.charge.energy);
 assert.throws(()=>service.command(crew,'owner','outpost-warp-start',data,{...context(),requestId:'other'}),/Charging/);
 const finish={...data,ticketId:'start'};assert.throws(()=>service.command(crew,'member','outpost-warp-complete',finish,context()),/charging/);
 const p=(crew.outposts as CrewOutpostRecord[])[0].state.outposts![0],c=controller(p);c.health=1;
 assert.throws(()=>service.command(crew,'member','outpost-warp-complete',finish,{...context(),now:10000}),/Damaged/);c.health=maxHealth(c);
 const grant=service.command(crew,'member','outpost-warp-complete',finish,{...context(),now:10000}) as any;assert.equal(grant.warp.to.x,5);assert.equal(service.view(crew,context())!.outposts[0].energy,after);
 assert.throws(()=>service.command(crew,'member','outpost-warp-complete',finish,{...context(),now:10000}),/no longer/);
});
test('gate cancel refunds only its reserved energy, and expired offline charges release the busy gate',()=>{
 const {service,crew}=fixture(),id=controller((crew.outposts as CrewOutpostRecord[])[0].state.outposts![0]).id,data={outpostId:100,controllerId:id,to:{x:1,y:0}};
 const energy=service.view(crew,context())!.outposts[0].energy;
 service.command(crew,'member','outpost-warp-start',data,context());service.command(crew,'member','outpost-warp-cancel',{...data,ticketId:'start'},context());assert.equal(service.view(crew,context())!.outposts[0].energy,energy);
 service.command(crew,'member','outpost-warp-start',data,context());service.tick(crew,.5,[]);assert.equal(service.view(crew,context())!.gates[0].status,'Operational');
});
test('crew storage enforces membership and replay receipts survive restart without duplicate energy',()=>{
 const dir=mkdtempSync(join(tmpdir(),'voidforge-warp-'));try{
 const path=join(dir,'crew.json'),service=new CrewOutposts(),options={path,command:service.command.bind(service),view:service.view.bind(service)},store=new CrewStore(options);
 const owner=store.authenticate(undefined,'Owner'),member=store.authenticate(undefined,'Member');store.execute(owner.pilotId,'create','create',{name:'Wormhole crew'});
 const crew=store.crewOf(owner.pilotId)!;crew.members.push({pilotId:member.pilotId,name:'Member',role:'member',joined:Date.now()});crew.outposts=[record(post())];
 const data={outpostId:100,controllerId:controller((crew.outposts as CrewOutpostRecord[])[0].state.outposts![0]).id,to:{x:1,y:0}};
 const first=store.execute(member.pilotId,'warp','outpost-warp-start',data,context());assert.equal(first.ok,true);
 const energy=store.crewOf(owner.pilotId)!.outposts;assert.deepEqual(store.execute(member.pilotId,'warp','outpost-warp-start',data,context()),first);
 const restored=new CrewStore(options);assert.deepEqual(restored.execute(member.pilotId,'warp','outpost-warp-start',data,context()),first);assert.deepEqual(restored.crewOf(owner.pilotId)!.outposts,energy);
 assert.equal(store.execute(owner.pilotId,'kick','kick',{pilotId:member.pilotId}).ok,true);
 assert.equal(store.execute(member.pilotId,'new-warp','outpost-warp-start',data,context()).ok,false);assert.equal(store.snapshot(member.pilotId,[],context()).outpostView,undefined);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('gate travel preserves pilot cargo, equipment, source structures and depleted sector records without spawning free gates',()=>{
 const m=new GameModel(world.seed);m.outposts=[post()];m.cargo.iron=31;m.stored.copper=77;m.player.health=42;
 const target=targetSector(world,1,0),next=warpTo(m,target);assert.deepEqual(next.cargo,m.cargo);assert.deepEqual(next.modules,m.modules);assert.equal(next.player.health,42);assert.equal(next.stored.copper,77);assert.deepEqual(worldRef(next),target);assert.equal(next.outposts.length,0);
 const back=warpTo(next,world,{x:16040,y:16040});assert.equal(back.outposts.length,1);assert.equal(back.cargo.iron,31);assert.ok(back.outposts.every(p=>p.structures.every(s=>Math.hypot((s.cx+.5)*16-back.player.x,(s.cy+.5)*16-back.player.y)>ship.radius+16)));
 const restored=GameModel.fromSave(back.toSave());assert.equal(gatesFor(restored.outposts[0],world)[0].range,5);
});

test('real relay arbitrates simultaneous departures, preserves the lobby, persists charges and revokes access',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'voidforge-warp-wire-')),path=join(dir,'crew.json'),service=new CrewOutposts();
 const store=new CrewStore({path,command:service.command.bind(service)}),owner=store.authenticate(undefined,'Owner'),member=store.authenticate(undefined,'Member');
 store.execute(owner.pilotId,'create','create',{name:'Gate network'});const crew=store.crewOf(owner.pilotId)!;
 crew.members.push({pilotId:member.pilotId,name:'Member',role:'member',joined:Date.now()});crew.outposts=[record(post()),record(post(),targetSector(world,5,0))];store.execute(owner.pilotId,'persist','deposit',{minerals:{iron:1}});
 const relay=await startRelay({host:'127.0.0.1',port:0,crewFile:path});const sockets:WebSocket[]=[];
 async function connect(name:string,credential:string){const socket=new WebSocket(`ws://127.0.0.1:${relay.port}`);sockets.push(socket);const messages:any[]=[];socket.addEventListener('message',e=>{const m=parseServer(String(e.data));if(m)messages.push(m);});await new Promise<void>((r,j)=>{socket.addEventListener('open',()=>r(),{once:true});socket.addEventListener('error',j,{once:true});});
 const send=(m:unknown)=>socket.send(JSON.stringify(m));const wait=async(check:(m:any)=>boolean)=>{for(let i=0;i<400;i++){const at=messages.findIndex(check);if(at>=0)return messages.splice(at,1)[0];await new Promise(r=>setTimeout(r,5));}throw Error(`${name}: relay response timeout`);};
 const welcome=await wait(m=>m.t==='welcome');assert.equal(welcome.wormholes,1);send({t:'hello',v:1,name});send({t:'crew-auth',credential});await wait(m=>m.t==='crew-identity');send({t:'sector',world});send({t:'state',s:context().ship});
 let seq=0;return {send,wait,messages,id:welcome.id,request:async(action:string,data:unknown,id=`${name}-${++seq}`)=>{send({t:'crew',action,data,requestId:id});return wait(m=>m.t==='crew-result'&&m.requestId===id);}};
 }
 try{
  const a=await connect('Owner',owner.credential),b=await connect('Member',member.credential);a.send({t:'create',open:false});const lobby=await a.wait(m=>m.t==='lobby');b.send({t:'join',code:lobby.code});await b.wait(m=>m.t==='lobby');
  const view=await b.wait(m=>m.t==='crew-state'&&m.state.outpostView?.gates?.length===2);assert.equal(view.state.outpostView.gates.length,2);
  const data={outpostId:100,controllerId:controller(post()).id,to:{x:5,y:0}};
  const [one,two]=await Promise.all([a.request('outpost-warp-start',data,'once'),b.request('outpost-warp-start',data,'competing')]);assert.equal(one.ok,true);assert.equal(two.ok,false);
  const replay=await a.request('outpost-warp-start',data,'once');assert.deepEqual(replay,one);
  await new Promise(r=>setTimeout(r,WORMHOLE.charge*WORMHOLE.stabilization.charge*1000+100));
  const finish=await a.request('outpost-warp-complete',{...data,ticketId:'once'},'complete');assert.equal(finish.ok,true);assert.equal(finish.result.warp.to.x,5);
  const frozen=await b.wait(m=>m.t==='lobby'&&m.world?.x===0);assert.equal(frozen.world.seed,world.seed,'Host warp never carries the other lobby member');
  assert.deepEqual(await a.request('outpost-warp-complete',{...data,ticketId:'once'},'complete'),finish);
  assert.equal((await a.request('kick',{pilotId:member.pilotId})).ok,true);
  assert.equal((await b.request('outpost-warp-start',data,'after-kick')).ok,false);await b.wait(m=>m.t==='crew-state'&&!m.state.crew&&!m.state.outpostView);
 }finally{for(const s of sockets)s.close();await relay.close();rmSync(dir,{recursive:true,force:true});}
});
