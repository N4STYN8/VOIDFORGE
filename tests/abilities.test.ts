import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureModel } from './fixtures.ts';
import { GameModel, type ShipModule, type Enemy, type Bullet } from '../src/model.ts';
import { CORE,MODULES,MODULE_DURABILITY,equipment,upgradeCost,type ModuleKind,type EquipmentKind } from '../src/data.ts';
import { ABILITIES,SPECIAL } from '../src/abilityConfig.ts';
import { freshAbility,onFire,onMiningHit,onDamageTaken,onEnergyDeficit,onOverheat,onBoost } from '../src/abilities.ts';
import { outfitterMarkup,type OutfitterState } from '../src/outfitter.ts';
const idle={x:0,y:0,aim:{x:5600,y:5000},fire:false,mine:false,dock:false};
function ship(kind:ModuleKind,level=5){
 const m=fixtureModel();m.modules=[];m.asteroids=[];m.enemies=[];m.coreLevel=5;m.stored={iron:1e6,copper:1e6,crystal:1e6,ice:1e6,radioactive:1e6};
 assert.ok(m.installModule(kind,1,0));for(let i=1;i<level;i++)assert.ok(m.upgradeModule(1,0));
 m.player.x=5000;m.player.y=5000;m.player.angle=0;m.energy=m.maxEnergy;m.player.health=m.maxHealth;return m;
}
const enemy=(id:number,x=5200,y=5000):Enemy=>({id,x,y,kind:'tank',health:2000,angle:0,cooldown:100,disabledFor:100});
const shot=(kind:ModuleKind,extra:Partial<Bullet>={}):Bullet=>({id:991,x:5100,y:5000,vx:2200,vy:0,life:1,enemy:false,damage:100,weapon:kind as Bullet['weapon'],level:5,...extra});
function incoming(m:GameModel,damage:number,attackerId?:number){m.bullets=[shot('cannon',{x:m.player.x-60,y:m.player.y,vx:1800,enemy:true,damage,attackerId})];m.update(.05,{...idle,aim:{x:m.player.x+100,y:m.player.y}});}
function run(m:GameModel,frames:number,input=idle){for(let i=0;i<frames;i++)m.update(.05,input);}

test('all 16 types upgrade through five real tiers with exact costs and legacy statistics intact',()=>{
 assert.equal(Object.keys(MODULES).length+1,16);assert.equal(MODULES.cargo.levels[2].cargo,200);assert.equal(MODULES.cannon.levels[0].damage,20);
 for(const kind of ['core',...Object.keys(MODULES)] as EquipmentKind[]){
  const m=fixtureModel();m.modules=[];m.stored={iron:1e6,copper:1e6,crystal:1e6,ice:1e6,radioactive:1e6};
  if(kind!=='core'){for(let i=1;i<5;i++)assert.ok(m.upgradeModule(0,0));assert.ok(m.installModule(kind,1,0));}
  assert.equal(equipment(kind).levels.length,5);assert.ok(ABILITIES[kind].name);
  for(let level=1;level<5;level++){
   const before={...m.stored},cost=upgradeCost(kind,level);assert.ok(m.upgradeModule(kind==='core'?0:1,0));
   for(const ore of Object.keys(cost) as (keyof typeof cost)[])assert.equal(before[ore]-m.stored[ore],cost[ore]);
  }
  assert.equal(m.upgradeModule(kind==='core'?0:1,0),false);assert.match(m.message,/Maximum/);
  if(kind!=='core')assert.equal(m.moduleMaxIntegrity(m.modules[0]),MODULE_DURABILITY[kind][4]);
 }
 const gated=ship('miner',4);gated.coreLevel=4;assert.equal(gated.upgradeModule(1,0),false);
});

test('Command Overclock lowers real operation costs, respects cooldown and cannot bypass building',()=>{
 const m=ship('cannon'),energy=m.energy;m.update(.05,{...idle,overclock:true,fire:true});
 assert.equal(m.coreAbility.active,6);assert.equal(m.coreAbility.cooldown,30);
 assert.ok(Math.abs(m.energy-(energy-SPECIAL.core.power+m.powerGeneration*.05-9*.75))<1e-8);
 m.update(.05,{...idle,overclock:true});assert.ok(m.coreAbility.cooldown<30&&m.coreAbility.cooldown>29);
 assert.equal(m.installModule('cannon',20,20),false);
 const low=ship('cannon');low.energy=0;low.update(.001,{...idle,overclock:true});assert.equal(low.coreAbility.active,0);
});

test('Gatling Fury ramps sustained fire and resets after release independently per cannon',()=>{
 const m=ship('cannon'),block=m.modules[0];m.update(.05,{...idle,fire:true});const first=block.cooldown;
 for(let i=0;i<70;i++){m.energy=m.maxEnergy;m.heat=0;m.update(.05,{...idle,fire:true});}
 assert.ok(block.ability!.sustained>=3);assert.ok(block.cooldown<=first/1.6+.05);
 m.update(.05,idle);assert.equal(block.ability!.sustained,0);
});

test('Chain Lightning arcs to one secondary only and does not recurse',()=>{
 const m=ship('pulse');m.enemies=[enemy(1),enemy(2,5200,5090),enemy(3,5200,5180)];m.bullets=[shot('pulse')];m.update(.05,idle);
 assert.equal(m.enemies[0].health,1900);assert.equal(m.enemies[1].health,1960);assert.equal(m.enemies[2].health,2000);assert.ok(m.effects.some(e=>e.type==='arc'));
});

test('Hypervelocity Round unlocks every fourth rail shot and pierces three enemies with falloff once',()=>{
 const m=ship('rail');m.modules[0].ability={...freshAbility(),shots:3};m.update(.05,{...idle,fire:true});assert.ok(m.bullets[0].enhanced);
 m.enemies=[enemy(1,5100),enemy(2,5140),enemy(3,5180),enemy(4,5240)];m.bullets=[shot('rail',{x:5050,vx:3000,penetrating:3,enhanced:true,hitIds:[]})];m.update(.05,idle);
 assert.equal(m.enemies[0].health,1900);assert.equal(m.enemies[1].health,1930);assert.equal(m.enemies[2].health,1951);assert.equal(m.enemies[3].health,2000);assert.equal(m.bullets.length,0);
});

test('Plasma Nova persists, caps fields and overlapping fields apply only strongest damage',()=>{
 const m=ship('plasma');m.enemies=[enemy(1)];m.bullets=[shot('plasma',{splash:70})];m.update(.05,idle);assert.equal(m.novaFields.length,1);
 const before=m.enemies[0].health;m.novaFields.push({...m.novaFields[0]});m.update(.05,idle);assert.ok(Math.abs(before-m.enemies[0].health-1)<1e-8);
 for(let i=0;i<12;i++){m.bullets=[shot('plasma',{splash:70})];m.update(.05,idle);}assert.equal(m.novaFields.length,8);
 run(m,65);assert.equal(m.novaFields.length,0);
});

test('Swarm Strike creates guided missiles with cooldown, turning, lifetime and global cap',()=>{
 const m=ship('rocket');m.enemies=[enemy(1,5500,5300)];m.update(.05,{...idle,fire:true});
 assert.equal(m.bullets.filter(b=>b.guided).length,3);const missile=m.bullets.find(b=>b.guided)!,vy=missile.vy;
 m.update(.05,idle);assert.ok(missile.vy>vy);assert.ok(m.modules[0].ability!.cooldown>5);
 m.modules[0].cooldown=0;m.update(.05,{...idle,fire:true});assert.equal(m.bullets.filter(b=>b.guided).length,3);
 m.modules[0].ability!.cooldown=0;m.modules[0].cooldown=0;
 m.bullets=Array.from({length:24},(_,i)=>shot('rocket',{id:200+i,x:5300,y:5000,guided:true,vx:100,age:0}));
 m.update(.05,{...idle,fire:true});assert.equal(m.bullets.filter(b=>b.guided).length,24);
 m.bullets.forEach(b=>{b.age=4;});m.update(.05,idle);assert.equal(m.bullets.filter(b=>b.guided).length,0);
});

test('Shrapnel Storm fragments once on impact and children expire without further generations',()=>{
 const m=ship('flak');m.enemies=[enemy(1)];m.bullets=[shot('flak')];m.update(.05,idle);
 assert.equal(m.bullets.filter(b=>b.fragment).length,2);assert.ok(m.bullets.every(b=>b.damage===25));
 m.update(.05,idle);assert.ok(m.bullets.length<=2);run(m,14);assert.equal(m.bullets.length,0);
});

test('System Cascade spreads weaker disable and damage only once per secondary target',()=>{
 const m=ship('emp');m.enemies=[enemy(1,5055),enemy(2,5130),enemy(3,5210)];
 m.empPulses=[{x:5000,y:5000,radius:0,maxRadius:60,damage:100,stun:4,hits:[],cascade:true,secondary:0}];
 run(m,4);assert.equal(m.enemies[0].health,1900);assert.equal(m.enemies[1].health,1965);assert.equal(m.enemies[2].health,2000);
});

test('Deep Core Extraction removes bonus ore from finite reserves and is more efficient',()=>{
 const m=ship('miner');m.modules[0].ability={...freshAbility(),mining:1.99};m.asteroids=[{id:1,x:5160,y:5000,vx:0,vy:0,radius:35,ore:'iron',amount:40,health:40}];
 m.update(.05,{...idle,mine:true});assert.ok(m.asteroids[0].amount<=34);
 for(let i=0;i<30;i++){m.energy=m.maxEnergy;m.heat=0;m.update(.05,{...idle,mine:true});}
 assert.equal(m.asteroids.length,0);assert.equal(m.cargoUsed+m.drops.reduce((n,d)=>n+d.amount,0),40);
});

test('five tractor levels have exact slots/speeds; Magnetic Sweep extends range without duplicate claims',()=>{
 for(let level=1;level<=5;level++){
  const m=ship('tractor',level),source=m.modulePoint(m.modules[0]);m.drops=Array.from({length:7},(_,i)=>({id:100+i,x:source.x+200+i,y:source.y,ore:'iron',amount:1}));
  if(level===1)m.drops.forEach(d=>d.x-=100);
  const before=m.drops[0].x;m.update(.05,idle);assert.equal(m.tractorLinks.length,level);assert.ok(Math.abs(before-m.drops[0].x-(75+75*level)*.05)<1e-8);
 }
 const m=ship('tractor');m.modules.push({...m.modules[0],x:2,ability:freshAbility()});m.drops=Array.from({length:12},(_,i)=>({id:200+i,x:5800+i,y:5000,ore:'copper',amount:1}));
 m.update(.05,idle);assert.equal(m.tractorLinks.length,10);assert.equal(new Set(m.tractorLinks.map(l=>l.targetId)).size,10);
 assert.equal(m.modules[0].ability!.cooldown,10);run(m,62);assert.ok(m.modules[0].ability!.active===0);assert.ok(m.tractorLinks.every(l=>Math.hypot(l.to.x-l.from.x,l.to.y-l.from.y)<=MODULES.tractor.levels[4].tractor!));
});

test('Quantum Compression adds 500 immediately, combines holds and survives saves',()=>{
 const m=ship('cargo');assert.equal(m.cargoCapacity,620);m.modules.push({...m.modules[0],x:2});assert.equal(m.cargoCapacity,1120);
 const save=JSON.parse(JSON.stringify(m.toSave())),loaded=GameModel.fromSave(save);assert.equal(loaded.cargoCapacity,1120);
 assert.deepEqual(MODULES.cargo.levels.map(s=>s.cargo),[60,120,200,300,500]);
});

test('Reactive Armor reduces subsequent hits only, does not multiply across plates and has cooldown',()=>{
 const m=ship('armor');m.modules.push({...m.modules[0],x:2,ability:freshAbility()});m.player.health=m.maxHealth;const health=m.player.health;
 incoming(m,30);assert.equal(health-m.player.health,30);const after=m.player.health;incoming(m,30);assert.ok(Math.abs(after-m.player.health-19.5)<1e-8);
 run(m,62);const before=m.player.health;incoming(m,30);assert.equal(before-m.player.health,30);assert.ok(m.modules[0].ability!.cooldown>0);
});

test('Reflective Barrier reflects absorbed projectile damage once to original attacker',()=>{
 const m=ship('shield');m.enemies=[enemy(42,5300)];m.modules.push({...m.modules[0],x:2});m.shield=m.maxShield;
 incoming(m,40,42);assert.equal(m.enemies[0].health,1990);assert.equal(m.shield,m.maxShield-40);assert.equal(m.player.health,m.maxHealth);
});

test('Phase Dash avoids damage initially, then expires while the paid burst and cooldown remain',()=>{
 const m=ship('engine');m.update(.05,{...idle,boost:true});assert.equal(m.modules[0].ability!.phase,.3);const health=m.player.health;
 incoming(m,30);assert.equal(m.player.health,health);run(m,6);incoming(m,30);assert.equal(m.player.health,health-30);
 assert.ok(m.modules[0].boostRemaining!>0);assert.ok(m.modules[0].boostCooldown!>0);
});

test('Emergency Overdrive and Cryogenic Purge have independent bounded heat/energy effects and cooldowns',()=>{
 const m=ship('reactor');m.modules.push({x:2,y:0,kind:'rail',level:5,cooldown:0,integrity:200});m.modules.push({x:3,y:0,kind:'rail',level:5,cooldown:0,integrity:200});
 for(let i=4;i<=8;i++)m.modules.push({x:i,y:0,kind:'rail',level:5,cooldown:0,integrity:200});m.energy=1;m.heat=100;const normal=m.basePowerGeneration;m.update(.05,idle);
 assert.ok(m.powerGeneration>normal);assert.ok(m.heat>100-m.coolingRate*.05);assert.equal(m.modules[0].ability!.cooldown,14);run(m,82);assert.equal(m.powerGeneration,normal);
 const cool=ship('cooler');cool.heat=cool.heatCapacity*.9;const before=cool.heat;cool.update(.05,idle);assert.ok(cool.heat<before-cool.heatCapacity*.29);assert.equal(cool.modules[0].ability!.cooldown,12);
 cool.heat=cool.heatCapacity*.9;cool.update(.05,idle);assert.ok(cool.heat>cool.heatCapacity*.8);
});

test('level-five runtime timers, special projectiles/fields and old level-three saves roundtrip',()=>{
 const m=ship('engine');m.coreAbility={...freshAbility(),active:2,cooldown:20};m.modules[0].ability={...freshAbility(),phase:.2,cooldown:8};m.novaFields=[{x:5000,y:5000,radius:80,life:1,damage:20}];
 m.bullets=[shot('rail',{enhanced:true,penetrating:2,hitIds:[12]})];const saved=JSON.parse(JSON.stringify(m.toSave()));const loaded=GameModel.fromSave(saved);
 assert.deepEqual(loaded.toSave(),saved);
 const old=ship('miner',3).toSave();old.coreLevel=3;delete old.coreAbility;delete old.novaFields;assert.equal(GameModel.fromSave(old).modules[0].level,3);
});

test('every outfitter module shows accurate level-five ability, cooldown and normal stat comparisons',()=>{
 const s:OutfitterState={selectedModule:'miner',selectedCell:{x:1,y:0},mode:'module',query:'',category:'All',center:{x:0,y:0},radius:3,moving:false,failed:false};
 for(const kind of Object.keys(MODULES) as ModuleKind[]){const m=ship(kind,4),html=outfitterMarkup(m,s,new Map());assert.ok(html.includes(ABILITIES[kind].name));assert.ok(html.includes('/ 5 max'));assert.ok(html.includes('Upgrade to level 5'));assert.ok(html.includes('LOCKED UNTIL LEVEL 5'));}
 const m=ship('cargo');m.player.x=m.bases[0].x;m.player.y=m.bases[0].y;const html=outfitterMarkup(m,s,new Map());assert.ok(html.includes('UNLOCKED'));assert.ok(html.includes('Maximum level reached'));assert.ok(html.includes('500'));
});


test('special hooks stay locked below level five and keep separate module timers',()=>{
 for(const kind of Object.keys(MODULES) as ModuleKind[]){
  const module:ShipModule={x:1,y:0,kind,level:4,cooldown:0,integrity:100};
  assert.deepEqual(onFire(module),{rate:1,penetrating:false,swarm:false});assert.equal(onMiningHit(module,10),0);
  assert.equal(onDamageTaken(module,100),false);assert.equal(onEnergyDeficit(module,0,100,1000,10),false);assert.equal(onOverheat(module,100,100),false);
  onBoost(module);assert.equal(module.ability,undefined);
 }
 const a:ShipModule={x:1,y:0,kind:'rocket',level:5,cooldown:0,integrity:100},b={...a,x:2};
 assert.equal(onFire(a).swarm,true);assert.equal(onFire(a).swarm,false);assert.equal(onFire(b).swarm,true);assert.notEqual(a.ability,b.ability);
});

test('fragmentation budget remains global across simultaneous level-five flak hits',()=>{
 const m=ship('flak');m.enemies=[enemy(1)];m.enemies[0].health=1e6;
 m.bullets=Array.from({length:80},(_,i)=>shot('flak',{id:10000+i}));m.update(.05,idle);
 assert.equal(m.bullets.filter(b=>b.fragment).length,96);
});
