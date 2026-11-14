import {test} from 'node:test';import assert from 'node:assert/strict';
import {startRelay} from '../server/relay.ts';import {NetClient} from '../src/net.ts';import {GameModel} from '../src/model.ts';import {ChunkWorld} from '../src/world.ts';import {MODULE_DURABILITY,BASE_RADIUS} from '../src/data.ts';import type {CombatReceipt,SalvageObject} from '../src/pvpSalvage.ts';
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
function arenaPoint(seed:string){const world=new ChunkWorld(seed);for(let x=9000;x<15000;x+=300)for(let y=9000;y<15000;y+=300){const rocks=world.activate({x,y},[],true);if(world.spec.bases.every(b=>Math.hypot(b.x-x,b.y-y)>BASE_RADIUS+500)&&!rocks.some(r=>r.x+r.radius>x-50&&r.x-r.radius<x+300&&Math.abs(r.y-y)<r.radius+60))return{x,y};}throw Error('No empty test arena.');}
async function pilot(url:string,name:string,x:number,y:number,hold=false){const net=new NetClient();net.connect(url,name);for(let i=0;i<100&&!net.pilotId;i++)await sleep(10);assert.ok(net.modularPvp&&net.pilotId);const m=new GameModel('modular-wire');m.salvageState.life=name;m.player={x,y,vx:0,vy:0,angle:0,health:100};m.coreLevel=5;m.shield=0;m.modules=hold?[{kind:'cargo',level:1,x:-1,y:0,integrity:35,cooldown:0}]:[{kind:'cannon',level:1,x:1,y:0,integrity:45,cooldown:0},{kind:'tractor',level:5,x:0,y:-1,integrity:MODULE_DURABILITY.tractor[4],cooldown:0}];if(hold)m.cargo.iron=180;
 net.setSector({seed:m.seed,home:m.seed,x:0,y:0});net.sendState(performance.now()/1000,{...m.player,maxHealth:100,paint:0,blocks:[['core',0,0,5],...m.modules.map(n=>[n.kind,n.x,n.y,n.level] as [string,number,number,number])]});
 const exchange=async(fire:{x:number;y:number;angle:number}[]=[],tractors:{x:number;y:number;ids:string[]}[]=[])=>{const reply=await net.modularRequest('sync',{ship:m.combatManifest(),fire,tractors}) as {ledger:string;events:CombatReceipt[];objects:SalvageObject[]};for(const event of reply.events){const actual=m.applyCombatReceipt(reply.ledger,event);await net.modularRequest('ack',{seq:event.seq,actual,removed:m.salvageState.lastDebit?.removed??[]});}return reply;};await exchange();return{net,m,exchange};}

test('real relay: server projectiles dismantle a hold, source escrow commits once, and a tractor recovers actual cargo/module',async()=>{
 const server=await startRelay({host:'127.0.0.1',port:0});const nets:NetClient[]=[];try{const at=arenaPoint('modular-wire'),url=`ws://127.0.0.1:${server.port}`,a=await pilot(url,'A',at.x,at.y),b=await pilot(url,'B',at.x+220,at.y,true);nets.push(a.net,b.net);
 let forwarded=0;b.net.onDirect=()=>forwarded++;a.net.direct(b.net.id!,'pvp-hit',{damage:2000});a.net.direct(b.net.id!,'pvp-loot',{iron:9999});await sleep(40);assert.equal(forwarded,0,'registered combat pilots reject old unverified awards/damage');
 for(let i=0;i<15&&b.m.modules.length;i++){await a.exchange([{x:1,y:0,angle:0}]);await sleep(250);await b.exchange();}
 assert.equal(b.m.modules.length,0,'hold detached by accumulated server shots');assert.equal(b.m.dead,false);assert.equal(b.m.cargo.iron,120);
 let objects=(await a.exchange()).objects;assert.equal(objects.reduce((n,o)=>n+o.cargo.iron,0),60);assert.ok(objects.some(o=>o.module?.kind==='cargo'));
 for(let i=0;i<30&&(a.m.cargo.iron<60||a.m.salvageState.modules.length<1);i++){objects=(await a.exchange([],[{x:0,y:-1,ids:objects.map(o=>o.id)}])).objects;await sleep(80);}
 assert.equal(a.m.cargo.iron,60);assert.equal(a.m.salvageState.modules.length,1);assert.equal(a.m.salvageState.modules[0].kind,'cargo');assert.equal(a.m.salvageState.modules[0].integrity,0);assert.equal(a.m.cargo.iron+b.m.cargo.iron,180);
 }finally{for(const net of nets)net.disconnect();await server.close();}
});

test('real relay chunks large combat manifests without imposing a new module-count cap or oversized frames',async()=>{
 const server=await startRelay({host:'127.0.0.1',port:0});let net:NetClient|undefined;try{const p=await pilot(`ws://127.0.0.1:${server.port}`,'Large',9000,9000);net=p.net;p.m.modules=Array.from({length:500},(_,i)=>({kind:'cargo' as const,level:1,x:i+1,y:0,integrity:35,cooldown:0,invested:{iron:60,copper:20,crystal:0,ice:0,radioactive:0}}));await p.exchange();assert.equal(net.oversized,0);assert.equal(net.connected,true);}finally{net?.disconnect();await server.close();}
});
