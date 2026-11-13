import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureModel } from './fixtures.ts';
import { MODULES, WEAPON_TYPES, type ModuleKind, type WeaponKind } from '../src/data.ts';
import { GameModel } from '../src/model.ts';
import { EffectPool } from '../src/effects.ts';
const idle={x:0,y:0,aim:{x:5500,y:5000},fire:false,mine:false,dock:false};
function prepared(){const m=fixtureModel();m.asteroids=[];m.enemies=[];m.player.angle=0;m.stored={iron:100000,copper:100000,crystal:100000,ice:100000,radioactive:100000};return m;}
function tractorShip(level:number,count=1){const m=prepared();m.coreLevel=3;for(let i=0;i<count;i++){m.installModule('tractor',-1-i,0);for(let n=1;n<level;n++)m.upgradeModule(-1-i,0);}m.player.x=5000;m.player.y=5000;return m;}
test('all module types may exceed their former limits and extend beyond the original grid',()=>{
  for(const kind of ['cannon','engine','miner','tractor','shield','cargo','reactor','cooler'] as ModuleKind[]){const m=prepared();for(let i=1;i<=12;i++)assert.equal(m.installModule(kind,-i,0),true,kind);assert.equal(m.modules.filter(block=>block.kind===kind).length,kind==='cannon'||kind==='miner'?13:12);assert.equal(m.installModule(kind,50,50),false);}
});
test('tractor levels have exactly 1/2/3 target slots and 150/225/300 pull speed',()=>{
  for(let level=1;level<=3;level++){
    const m=tractorShip(level),module=m.modules.find(m=>m.kind==='tractor')!,source=m.modulePoint(module);
    m.drops=Array.from({length:5},(_,i)=>({id:100+i,x:source.x+100+i*12,y:source.y,ore:'iron',amount:1}));
    const before=m.drops[0].x;m.update(.05,idle);
    assert.equal(m.tractorLinks.length,level);assert.equal(module.targetIds!.length,level);
    assert.ok(Math.abs(before-m.drops[0].x-[150,225,300][level-1]*.05)<1e-8);
    assert.equal(m.cargoUsed,0);assert.equal(m.tractorLinks[0].from.x,source.x);
  }
});
test('multiple tractors combine slots and never claim the same mineral',()=>{
  for(const [level,count,expected] of [[1,2,2],[2,2,4],[3,3,9]]){
    const m=tractorShip(level,count);m.drops=Array.from({length:12},(_,i)=>({id:100+i,x:m.player.x+100+i*4,y:m.player.y+25,ore:'copper',amount:1}));
    m.update(.05,idle);assert.equal(m.tractorLinks.length,expected);assert.equal(new Set(m.tractorLinks.map(link=>link.targetId)).size,expected);
  }
});
test('tractor slots persist, reassign missing targets, and release out-of-range minerals',()=>{
  const m=tractorShip(1),module=m.modules.find(m=>m.kind==='tractor')!,p=m.modulePoint(module);
  m.drops=[{id:1,x:p.x+120,y:p.y,ore:'iron',amount:1},{id:2,x:p.x+150,y:p.y,ore:'copper',amount:1}];m.update(.05,idle);assert.deepEqual(module.targetIds,[1]);
  m.drops[1].x=p.x+100;m.update(.05,idle);assert.deepEqual(module.targetIds,[1]);
  m.drops=m.drops.filter(d=>d.id!==1);m.update(.05,idle);assert.deepEqual(module.targetIds,[2]);
  m.drops[0].x=p.x+1000;m.update(.05,idle);assert.deepEqual(module.targetIds,[]);assert.equal(m.tractorLinks.length,0);
});
test('minerals collect at the module, respect a configured full cargo and never duplicate',()=>{
  const m=tractorShip(1),module=m.modules.find(m=>m.kind==='tractor')!,p=m.modulePoint(module);
  m.cargoCapacity=5;m.cargo.iron=5;m.drops=[{id:1,x:p.x+100,y:p.y,ore:'iron',amount:10}];
  m.update(.05,idle);assert.equal(m.tractorLinks.length,0);assert.equal(m.drops[0].x,p.x+100);
  m.cargo.iron=0;for(let i=0;i<30;i++)m.update(.05,idle);
  assert.equal(m.cargo.iron,5);assert.equal(m.drops[0].amount,5);assert.equal(m.tractorLinks.length,0);
  m.cargoCapacity=Infinity;for(let i=0;i<30;i++)m.update(.05,idle);
  assert.equal(m.cargo.iron,10);assert.equal(m.drops.length,0);
  for(let i=0;i<20;i++)m.update(.05,idle);assert.equal(m.cargo.iron,10);
});
test('reactors and cooling add independently; operation consumes exact energy and heat',()=>{
  const m=prepared();m.player.x=5000;m.player.y=5000;m.energy=10;m.heat=5;
  m.update(.05,{...idle,fire:true});assert.ok(Math.abs(m.energy-9.2)<1e-8);assert.ok(Math.abs(m.heat-5.6)<1e-8);
  m.player.x=3200;m.player.y=3330;const generation=m.powerGeneration,cooling=m.coolingRate,capacity=m.maxEnergy,mass=m.shipMass;
  m.installModule('reactor',-1,0);m.installModule('reactor',-2,0);m.installModule('cooler',0,1);m.installModule('cooler',0,2);
  assert.equal(m.powerGeneration,generation+70);assert.equal(m.coolingRate,cooling+36);assert.equal(m.maxEnergy,capacity+140);assert.ok(m.shipMass>mass);
});
test('power and thermal limits pause actual systems instead of imposing type counts',()=>{
  const m=prepared();m.player.x=5000;m.player.y=5000;m.heat=m.heatCapacity;
  m.update(.01,{...idle,fire:true});assert.equal(m.bullets.length,0);assert.equal(m.heatLimited,true);
  m.heat=0;m.energy=0;m.update(.01,{...idle,fire:true});assert.equal(m.bullets.length,0);assert.equal(m.powerLimited,true);
  m.energy=100;m.update(.01,{...idle,fire:true});assert.equal(m.bullets.length,1);
  const tractor=tractorShip(1,20);tractor.coreLevel=1;tractor.energy=0;
  tractor.drops=Array.from({length:30},(_,i)=>({id:i,x:tractor.player.x-140,y:tractor.player.y+100+i,ore:'iron',amount:1}));
  tractor.update(.05,idle);assert.equal(tractor.powerLimited,true);assert.ok(tractor.tractorLinks.length<20);
});
test('mass affects handling and powered engine upgrades improve their contribution',()=>{
  const m=prepared(),speed=m.maxSpeed,acceleration=m.acceleration;
  m.installModule('armor',-1,0);assert.ok(m.maxSpeed<speed);assert.ok(m.acceleration<acceleration);
  const slower=m.maxSpeed;m.installModule('engine',0,1);assert.ok(m.maxSpeed>slower);
  m.coreLevel=2;const first=m.maxSpeed;m.upgradeModule(0,1);assert.ok(m.maxSpeed>first);
});
test('each weapon fires from its installed module, with distinct speed or EMP behavior',()=>{
  for(const weapon of Object.keys(WEAPON_TYPES) as WeaponKind[]){
    const m=prepared();m.removeModule(1,0);m.installModule(weapon,1,0);m.player.x=5000;m.player.y=5000;
    m.update(.01,{...idle,fire:true});
    const event=m.effects.find(e=>e.type==='muzzle'&&e.weapon===weapon);assert.equal(event?.x,5026);assert.equal(event?.y,5000);
    if(weapon==='emp'){assert.equal(m.empPulses.length,1);assert.equal(m.empPulses[0].x,5016);continue;}
    assert.equal(m.bullets.length,WEAPON_TYPES[weapon].pellets);
    for(const b of m.bullets){assert.equal(b.weapon,weapon);assert.ok(Math.abs(Math.hypot(b.vx,b.vy)-WEAPON_TYPES[weapon].speed)<1e-6);const origin={x:b.x-b.vx*.01,y:b.y-b.vy*.01};assert.ok(Math.abs(Math.hypot(origin.x-5016,origin.y-5000)-10)<1e-6);}
  }
});
test('EMP pulses hit enemies once and temporarily disable their AI',()=>{
  const m=prepared();m.removeModule(1,0);m.installModule('emp',1,0);m.player.x=5000;m.player.y=5000;
  m.enemies=[{id:9,x:5060,y:5000,health:100,cooldown:100,angle:0}];
  m.update(.05,{...idle,fire:true});for(let i=0;i<5;i++)m.update(.05,idle);
  assert.equal(m.enemies[0].health,85);assert.ok(m.enemies[0].disabledFor!>0);
  const x=m.enemies[0].x;for(let i=0;i<10;i++)m.update(.05,idle);assert.equal(m.enemies[0].x,x);assert.equal(m.enemies[0].health,85);
});
test('old v1 saves load with safe power defaults; new saves retain energy, heat and target slots',()=>{
  const m=tractorShip(2);m.energy=45;m.heat=20;const saved=m.toSave();
  const restored=GameModel.fromSave(saved);assert.equal(restored.energy,45);assert.equal(restored.heat,20);
  const old={...saved};delete old.energy;delete old.heat;delete old.empPulses;
  const legacy=GameModel.fromSave(old);assert.equal(legacy.energy,legacy.maxEnergy);assert.equal(legacy.heat,0);
});
test('effect particles remain pooled, bounded, expire and favor nearby important events',()=>{
  const pool=new EffectPool(8),view={x:0,y:0,width:1000,height:1000},objects=[...pool.particles];
  for(let i=0;i<100;i++)pool.spawn({x:950,y:950,life:1,priority:0},view);
  assert.equal(pool.activeCount,8);assert.equal(pool.spawn({x:500,y:500,life:1,priority:3},view),true);
  assert.ok(pool.particles.some(p=>p.x===500));assert.equal(pool.spawn({x:10000,y:10000,life:1},view),false);
  pool.update(2,view);assert.equal(pool.activeCount,0);assert.ok(pool.particles.every((p,i)=>p===objects[i]));
});
test('disabling effects cleans them and cannot change gameplay, resource or weapon state',()=>{
  const a=prepared(),b=prepared(),on=new EffectPool(),off=new EffectPool();off.enabled=false;
  a.player.x=b.player.x=5000;a.player.y=b.player.y=5000;
  const view={x:4500,y:4500,width:1000,height:1000};
  for(let i=0;i<40;i++){a.update(.025,{...idle,fire:true});b.update(.025,{...idle,fire:true});on.update(.025,view);off.update(.025,view);on.consume(a.effects,view);off.consume(b.effects,view);}
  assert.deepEqual(a.toSave(),b.toSave());assert.ok(on.activeCount>0);assert.equal(off.activeCount,0);on.enabled=false;assert.equal(on.activeCount,0);
});

test('cargo holds add capacity, upgrades expand it, and full cargo pauses mining',()=>{
  const m=prepared();assert.equal(m.cargoCapacity,120);m.cargo.iron=120;
  m.asteroids=[{id:900,x:m.player.x+150,y:m.player.y,vx:0,vy:0,radius:30,ore:'iron',amount:30,health:30}];
  m.update(.05,{...idle,mine:true});assert.equal(m.asteroids[0].health,30);assert.equal(m.miningLinks.length,0);
  m.installModule('cargo',-1,0);assert.equal(m.cargoCapacity,180);m.update(.05,{...idle,mine:true});assert.ok(m.asteroids[0].health<30);
  m.coreLevel=2;m.upgradeModule(-1,0);assert.equal(m.cargoCapacity,240);m.coreLevel=3;m.upgradeModule(-1,0);assert.equal(m.cargoCapacity,320);
});
test('removing a loaded cargo hold is rejected and breaking it spills excess ore without loss',()=>{
  const m=prepared();m.removeModule(1,0);m.installModule('cargo',1,0);m.installModule('cargo',2,0);m.cargo.copper=200;
  assert.equal(m.removeModule(2,0),false);assert.equal(m.cargoCapacity,240);
  m.player.x=5000;m.player.y=5000;m.modules.find(m=>m.x===1&&m.y===0)!.integrity=1;
  m.bullets=[{id:900,x:5016,y:5000,vx:0,vy:0,enemy:true,damage:10,life:1}];m.update(.01,idle);
  assert.equal(m.cargoCapacity,120);assert.equal(m.cargoUsed,120);assert.equal(m.cargo.copper+m.drops.filter(d=>d.ore==='copper').reduce((n,d)=>n+d.amount,0),200);
});
test('loading older over-capacity inventory preserves the overflow as mineral pickups',()=>{
  const m=prepared();m.cargo.iron=500;const restored=GameModel.fromSave(m.toSave());
  assert.equal(restored.cargo.iron,120);assert.equal(restored.cargo.iron+restored.drops.filter(d=>d.ore==='iron').reduce((n,d)=>n+d.amount,0),500);
});
