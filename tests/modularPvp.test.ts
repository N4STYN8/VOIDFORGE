import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {MODULES,MODULE_DURABILITY,MODULAR_PVP,RESOURCES,WEAPON_TYPES,SHIP_SYSTEMS} from '../src/data.ts';
import {minerals} from '../src/economy.ts';
import {GameModel} from '../src/model.ts';
import {ChunkWorld} from '../src/world.ts';
import {structuralHit,shipIntersection,cargoAllocation,mineralTotal,readCombatShip,type CombatShip,type CombatModule} from '../src/pvpSalvage.ts';
import {PvpArena} from '../server/pvpArena.ts';
import {saveText} from '../src/persistence.ts';
const module=(kind:CombatModule['kind'],x:number,y:number,level=1):CombatModule=>({kind,x,y,level,integrity:MODULE_DURABILITY[kind][level-1]});
const ship=(modules:CombatModule[]=[],x=9000):CombatShip=>({life:'life',x,y:9000,vx:0,vy:0,angle:0,health:100,shield:0,coreLevel:5,modules,cargo:minerals()});
const idle={x:0,y:0,aim:{x:10000,y:9000},fire:false,mine:false,dock:false};

test('rotated-grid trajectory hits the first occupied exterior cell, not a random healthy component',()=>{
 const s=ship([module('cannon',-1,0),module('engine',1,0)]);const hit=shipIntersection(s,{x:8900,y:9000},{x:9100,y:9000})!;assert.equal(hit.x,-1);assert.equal(hit.y,0);
 s.angle=Math.PI/2;const rotated=shipIntersection(s,{x:9000,y:8900},{x:9000,y:9100})!;assert.equal(rotated.x,-1);assert.equal(rotated.y,0);
 assert.equal(shipIntersection(s,{x:8900,y:8800},{x:9100,y:8800}),undefined);
});

test('module damage accumulates before detach; exterior losses do not damage the core',()=>{
 const s=ship([module('cannon',-1,0),module('engine',1,0)]),other=s.modules[1].integrity;
 let result=structuralHit(s,{x:-1,y:0},10,'cannon',1);assert.equal(result.detached.length,0);assert.equal(s.modules[0].integrity,45-10*MODULAR_PVP.damageScale);assert.equal(s.modules[1].integrity,other);assert.equal(s.health,100);
 result=structuralHit(s,{x:-1,y:0},100,'cannon',1);assert.equal(result.detached.length,1);assert.equal(s.modules.length,1);assert.equal(s.health,100);
});

test('L1 affects one cell; L5 rail/blast may detach two only with enough damage, preserving weapon identities',()=>{
 let s=ship([module('cannon',1,0),module('cargo',2,0),module('engine',3,0)]);let r=structuralHit(s,{x:1,y:0},1000,'cannon',1);assert.equal(r.detached.length,1);assert.equal(s.modules[0].integrity,35);assert.equal(s.modules[0].offline,true);assert.equal(s.modules[1].offline,true);
 s=ship([module('cannon',1,0),module('cargo',2,0)]);r=structuralHit(s,{x:1,y:0},1000,'rail',5);assert.equal(r.detached.length,2);
 s=ship([module('cannon',1,0),module('cargo',2,0)]);r=structuralHit(s,{x:1,y:0},1,'rail',5);assert.equal(r.detached.length,0);assert.equal(r.damage.length,2);
 s=ship([module('cannon',1,0),module('cargo',2,0)]);r=structuralHit(s,{x:1,y:0},1000,'pulse',5);assert.equal(r.detached.length,1);
});

test('hold allocation is deterministic and detachment transfers only actual minerals including disconnected holds',()=>{
 const s=ship([module('cargo',1,0),module('cargo',2,0)]);s.cargo.iron=150;s.cargo.copper=25;const allocation=cargoAllocation(s);assert.equal(allocation.get('0,0')!.iron,120);assert.equal(allocation.get('1,0')!.iron,30);assert.equal(allocation.get('1,0')!.copper,25);
 const before=mineralTotal(s.cargo),r=structuralHit(s,{x:1,y:0},100,'cannon',1);assert.equal(mineralTotal(r.released),55);assert.equal(mineralTotal(s.cargo)+mineralTotal(r.released),before);assert.equal(s.cargo.iron,120);
});

test('shields absorb impacts; core destruction releases remaining attached cargo/components and causes defeat',()=>{
 const s=ship([module('engine',1,0)]);s.shield=20;s.cargo.ice=40;const blocked=structuralHit(s,{x:1,y:0},10,'cannon',1);assert.equal(blocked.damage.length,0);assert.equal(s.health,100);s.shield=0;
 const result=structuralHit(s,{x:0,y:0},1000,'rail',5);assert.equal(result.defeat,true);assert.equal(result.detached.length,1);assert.equal(result.released.ice,40);assert.equal(s.modules.length,0);assert.equal(mineralTotal(s.cargo),0);
});

test('server combat receipts disable detached weapons/engines, persist, deduplicate and preserve finite cargo',()=>{
 const m=new GameModel('structural-model');m.player.x=9000;m.player.y=9000;m.player.angle=0;m.modules=[{...module('engine',1,0,2),cooldown:0},{...module('cannon',2,0),cooldown:0}];m.modules=[...m.modules];const speed=m.maxSpeed,manifest=m.combatManifest();const hit=structuralHit(manifest,{x:1,y:0},1000,'cannon',1),event={seq:1,life:m.salvageState.life,hit};m.applyCombatReceipt('ledger',event);
 assert.ok(m.maxSpeed<speed);assert.equal(m.installedWeapons,0);assert.equal(m.modules.length,1);assert.equal(m.modules[0].offline,true);assert.equal(m.dead,false);
 m.update(.1,{...idle,fire:true});assert.equal(m.bullets.filter(b=>!b.enemy).length,0);
 const loaded=GameModel.fromSave(JSON.parse(saveText(m)));loaded.applyCombatReceipt('ledger',event);assert.equal(loaded.modules.length,1);assert.equal(loaded.salvageState.receipts.ledger,1);
});

test('recovered modules require paid repair, then install or finite scrapping through a station',()=>{
 const m=new GameModel('salvage-yard');m.modules=[];m.stored.iron=1000;m.stored.copper=1000;
 m.salvageState.modules=[{id:'part',kind:'cannon',level:1,integrity:0,invested:{iron:100,copper:20}}];assert.equal(m.installSalvage('part',1,0),false);const before=m.stored.iron;assert.equal(m.repairSalvage('part'),true);assert.ok(m.stored.iron<before);assert.equal(m.installSalvage('part',1,0),true);assert.equal(m.salvageState.modules.length,0);assert.equal(m.installSalvage('part',0,1),false);
 m.salvageState.modules=[{id:'scrap',kind:'cannon',level:1,integrity:0,invested:{iron:100,copper:20}}];const stored=m.stored.iron;assert.equal(m.scrapSalvage('scrap'),true);assert.equal(m.stored.iron-stored,Math.floor(100*MODULAR_PVP.scrapFraction));assert.equal(m.scrapSalvage('scrap'),false);
});

function arenaFixture(path?:string){const poses=new Map<string,ReturnType<PvpContextPose>>();function PvpContextPose(){return {room:'pvp-unit',x:9000,y:9000,vx:0,vy:0,angle:0};}const arena=new PvpArena({pose:id=>poses.get(id),allies:()=>false,rock:()=>undefined},path);let now=1000;const add=(id:string,s:CombatShip)=>{poses.set(id,{room:'pvp-unit',x:s.x,y:s.y,vx:0,vy:0,angle:0});arena.sync(id,'pvp-unit',s,now);};const advance=(seconds=.5)=>{for(let t=0;t<seconds;t+=.05){now+=.05;arena.tick(.05,now);}};const ack=(id:string)=>{const state=arena.snapshot(id);for(const e of state.events)arena.ack(id,e.seq,e.hit?.released??e.cargo,e.hit?.detached.map(m=>`${m.x},${m.y}`));};return {arena,poses,add,advance,ack,now:()=>now};}
function wreckCargo(f:ReturnType<typeof arenaFixture>){f.add('a',ship([module('cannon',1,0)]));const target=ship([module('cargo',-1,0)],9180);target.cargo.iron=180;f.add('b',target);for(let i=0;i<10&&!Object.values(f.arena.inspect().objects).length;i++){f.arena.fire('a',1,0,0,f.now());f.advance(.5);f.ack('b');}return Object.values(f.arena.inspect().objects);}

test('server shots derive damage from installed weapons, reject nonexistent guns and cooldown spam, and escrow real cargo once',()=>{
 const f=arenaFixture();assert.equal(f.arena.fire('a',9,9,0,1000),false);const objects=wreckCargo(f);assert.ok(objects.some(o=>o.module?.kind==='cargo'));assert.equal(objects.reduce((n,o)=>n+o.cargo.iron,0),60);assert.equal(f.arena.inspect().pilots.b.ship.cargo.iron,120);
 assert.equal(f.arena.fire('a',1,0,0,f.now()),true);assert.equal(f.arena.fire('a',1,0,0,f.now()),true);assert.equal(f.arena.fire('a',1,0,0,f.now()),false);const before=Object.keys(f.arena.inspect().objects).length;f.arena.ack('b',1,{iron:60});assert.equal(Object.keys(f.arena.inspect().objects).length,before);
});

test('server tractors arbitrate simultaneous pickups and leave partial cargo in the original container',()=>{
 const f=arenaFixture();const objects=wreckCargo(f),cargo=objects.find(o=>o.cargo.iron>0)!;
 const collector=ship([module('tractor',1,0)],cargo.x-16);collector.y=cargo.y;collector.cargo.iron=115;f.add('c',collector);const rival=ship([module('tractor',1,0)],cargo.x-16);rival.y=cargo.y;f.add('d',rival);
 f.arena.tractors('c',[{x:1,y:0,ids:[cargo.id]}],f.now());f.advance(.05);
 const first=f.arena.snapshot('c').events[0];assert.equal(first.cargo!.iron,5);assert.equal(f.arena.snapshot('d').events.length,0);f.ack('c');assert.equal(f.arena.inspect().objects[cargo.id].cargo.iron,55);
 f.arena.tractors('d',[{x:1,y:0,ids:[cargo.id]}],f.now());f.advance(.05);const second=f.arena.snapshot('d').events[0];assert.equal(second.cargo!.iron,55);f.ack('d');assert.equal(f.arena.inspect().objects[cargo.id],undefined);
});

test('cargo pickup capacity changes refund unaccepted minerals to the same container; grant replay does not duplicate',()=>{
 const f=arenaFixture(),cargo=wreckCargo(f).find(o=>o.cargo.iron>0)!;const collector=ship([module('tractor',1,0)],cargo.x-16);collector.y=cargo.y;f.add('c',collector);f.arena.tractors('c',[{x:1,y:0,ids:[cargo.id]}],f.now());f.advance(.05);const event=f.arena.snapshot('c').events[0];f.arena.ack('c',event.seq,{iron:2});assert.equal(f.arena.inspect().objects[cargo.id].cargo.iron,58);f.arena.ack('c',event.seq,{iron:60});assert.equal(f.arena.inspect().objects[cargo.id].cargo.iron,58);
});

test('ledger restart retains pending receipts and first-winner collection; expiration returns rather than deletes minerals',()=>{
 const dir=mkdtempSync(join(tmpdir(),'voidforge-pvp-'));try{const path=join(dir,'ledger.json'),f=arenaFixture(path),cargo=wreckCargo(f).find(o=>o.cargo.iron>0)!;const reloaded=new PvpArena({pose:id=>f.poses.get(id),allies:()=>false},path);assert.equal(reloaded.inspect().objects[cargo.id].cargo.iron,60);reloaded.tick(.05,f.now()+MODULAR_PVP.lifetime+1);assert.equal(Object.keys(reloaded.inspect().objects).length,0);const receipts=reloaded.inspect().pilots.b.outbox;assert.equal(receipts.reduce((n,e)=>n+(e.cargo?.iron??0),0),60);assert.ok(receipts.some(e=>e.module));}finally{rmSync(dir,{recursive:true,force:true});}
});

test('malformed combat inventories and overlapping layouts are rejected',()=>{const s=ship([module('cannon',1,0)]);assert.ok(readCombatShip(s));s.modules.push(module('cargo',1,0));assert.equal(readCombatShip(s),undefined);s.modules.pop();s.cargo.iron=NaN;assert.equal(readCombatShip(s),undefined);});

test('server core defeat credits one kill, preserves existing rebuild rules and never auto-awards cargo',()=>{
 const f=arenaFixture();f.add('a',ship([module('cannon',1,0)]));const victim=ship([],9180);victim.health=1;victim.cargo.crystal=10;f.add('b',victim);f.arena.fire('a',1,0,0,f.now());f.advance(.5);
 const event=f.arena.snapshot('b').events[0];assert.ok(event.hit?.defeat);assert.equal(f.arena.snapshot('a').events.filter(e=>e.kill).length,1);assert.equal(f.arena.inspect().pilots.a.ship.cargo.crystal,0);
 const m=new GameModel('core-receipt');const receipt={...event,life:m.salvageState.life};m.applyCombatReceipt('core-ledger',receipt);m.applyCombatReceipt('core-ledger',receipt);assert.equal(m.deaths,1);assert.ok(m.dead&&m.rebuildDue);m.respawn();assert.ok(m.dead);f.ack('b');
});

test('competing tractors cannot reserve or grant the same full container twice',()=>{
 const f=arenaFixture(),cargo=wreckCargo(f).find(o=>o.cargo.iron>0)!;
 for(const id of ['c','d']){const s=ship([module('tractor',1,0)],cargo.x-16);s.y=cargo.y;f.add(id,s);f.arena.tractors(id,[{x:1,y:0,ids:[cargo.id]}],f.now());}f.advance(.05);
 const events=[...f.arena.snapshot('c').events,...f.arena.snapshot('d').events];assert.equal(events.reduce((n,e)=>n+(e.cargo?.iron??0),0),60);assert.equal(events.filter(e=>(e.cargo?.iron??0)>0).length,1);
});

test('source escrow cannot publish more cargo/modules than actually debited',()=>{
 const f=arenaFixture();f.add('a',ship([module('cannon',1,0)]));const b=ship([module('cargo',-1,0)],9180);b.modules[0].integrity=1;b.cargo.iron=180;f.add('b',b);f.arena.fire('a',1,0,0,f.now());f.advance(.5);const e=f.arena.snapshot('b').events[0];assert.ok(e.hit?.detached.length);assert.ok(Object.values(f.arena.inspect().objects).every(o=>o.pending));f.arena.ack('b',e.seq,{iron:4},[]);const objects=Object.values(f.arena.inspect().objects);assert.equal(objects.reduce((n,o)=>n+o.cargo.iron,0),4);assert.ok(objects.every(o=>!o.module));
});

test('recovered paid-shot counters survive repair, installation and save/load',()=>{
 const m=new GameModel('counter-salvage');m.stored.iron=999;m.stored.copper=999;m.coreLevel=5;m.modules=[];
 m.salvageState.modules.push({id:'paid',kind:'rail',level:5,integrity:0,ability:{shots:17,cooldown:4,active:0,sustained:0,mining:0,phase:0}});assert.ok(m.repairSalvage('paid'));assert.ok(m.installSalvage('paid',1,0));const loaded=GameModel.fromSave(JSON.parse(saveText(m)));assert.equal(loaded.modules[0].ability?.shots,17);assert.equal(loaded.modules[0].ability?.cooldown,4);
});

test('safe stations, allies and ore cover block server-authoritative shots',()=>{
 const poses=new Map<string,{room:string;x:number;y:number;vx:number;vy:number;angle:number}>();let allied=true,blocked=false;
 const a=new PvpArena({pose:id=>poses.get(id),allies:()=>allied,rock:()=>blocked?0:undefined});const first=ship([module('cannon',1,0)]),second=ship([module('cargo',-1,0)],9180);
 for(const [id,s]of [['a',first],['b',second]] as const){poses.set(id,{room:'covered',x:s.x,y:s.y,vx:0,vy:0,angle:0});a.sync(id,'covered',s,1000);}a.fire('a',1,0,0,1000);for(let i=0;i<10;i++)a.tick(.05,1000+i*.05);assert.equal(a.snapshot('b').events.length,0);
 allied=false;blocked=true;a.fire('a',1,0,0,1001);for(let i=0;i<10;i++)a.tick(.05,1001+i*.05);assert.equal(a.snapshot('b').events.length,0);
 const base=new ChunkWorld('covered').spec.bases[0];Object.assign(poses.get('a')!,{x:base.x,y:base.y});a.sync('a','covered',{...first,x:base.x,y:base.y},1002);assert.equal(a.fire('a',1,0,0,1002),false);
});

test('client never acknowledges a grant until save succeeds; lost/repeated receipts award once',async()=>{
 const {PvpClient}=await import('../src/pvpClient.ts');const m=new GameModel('client-receipts');m.salvageState.life='known';let saves=0,acks=0;const net={connected:true,modularPvp:true,pilotId:'p',modularRequest:async(action:string)=>{if(action==='ack'){acks++;return{};}return{ledger:'client-ledger',events:[{seq:1,life:'known',cargo:{...minerals(),iron:8},target:'cargo'}],objects:[]};}};
 const client=new PvpClient(net as unknown as import('../src/net.ts').NetClient,()=>m,async()=>++saves===2?'save failed':undefined);
 client.frame(m,1);for(let i=0;i<10;i++)await new Promise(r=>setTimeout(r,1));assert.equal(m.cargo.iron,8);assert.equal(acks,0);assert.ok(client.pending);
 client.frame(m,2);for(let i=0;i<10;i++)await new Promise(r=>setTimeout(r,1));assert.equal(m.cargo.iron,8);assert.equal(acks,1);assert.equal(client.pending,false);
});

test('a normal purchased bridge reconnects intact offline components without duplicating cargo',()=>{
 const m=new GameModel('reconnect-hull');m.modules=[{...module('cargo',2,0),offline:true,cooldown:0}];m.stored.iron=1000;m.stored.copper=1000;assert.equal(m.cargoCapacity,SHIP_SYSTEMS.cargoCapacity);assert.equal(m.installModule('cannon',1,0),true);assert.equal(m.modules.find(n=>n.kind==='cargo')!.offline,false);assert.equal(m.cargoCapacity,SHIP_SYSTEMS.cargoCapacity+MODULES.cargo.levels[0].cargo!);assert.equal(m.cargoUsed,0);
});
