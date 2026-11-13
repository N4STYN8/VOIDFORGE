import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureModel } from './fixtures.ts';
import { statComparison,outfitterMarkup,type OutfitterState } from '../src/outfitter.ts';
import { MODULES,WEAPON_TYPES,VFX } from '../src/data.ts';
import { SOUND_PROFILES } from '../src/audio.ts';
const idle={x:0,y:0,aim:{x:6000,y:5000},fire:false,mine:false,dock:false};
function engine(level:number){const m=fixtureModel();m.asteroids=[];m.enemies=[];m.coreLevel=3;m.stored={iron:1000,copper:1000,crystal:1000,ice:1000,radioactive:1000};m.installModule('engine',-1,0);for(let i=1;i<level;i++)m.upgradeModule(-1,0);m.player.x=5000;m.player.y=5000;m.player.angle=0;return m;}
test('Shift gives upgraded boosters a brief burst, then enforces cooldown',()=>{
  const m=engine(2),cruise=m.maxSpeed,energy=m.energy;
  m.update(.05,{...idle,boost:true});assert.ok(m.boostActive);assert.ok(m.maxSpeed>cruise);assert.ok(m.energy<energy);assert.ok(m.heat>0);assert.ok(m.player.vx>0);
  const booster=m.modules.find(m=>m.kind==='engine')!;assert.equal(booster.boostRemaining,MODULES.engine.levels[1].boostDuration);
  for(let i=0;i<40;i++)m.update(.05,idle);assert.equal(m.boostActive,false);assert.ok(Math.abs(m.maxSpeed-cruise)<1e-8);assert.ok(booster.boostCooldown!>0);
  m.update(.05,{...idle,boost:true});assert.equal(m.boostActive,false);
  for(let i=0;i<100;i++)m.update(.05,idle);m.update(.05,{...idle,boost:true});assert.equal(m.boostActive,true);
});
test('level 1 cannot burst, and a burst cannot start without energy',()=>{
  const first=engine(1);first.update(.05,{...idle,boost:true});assert.equal(first.boostActive,false);
  const empty=engine(2);empty.energy=0;empty.update(.01,{...idle,boost:true});assert.equal(empty.boostActive,false);assert.equal(empty.powerLimited,true);
});
test('upgrade comparisons use actual per-module statistics and weapon fire rate',()=>{
  const tractor=statComparison(MODULES.tractor.levels[0],MODULES.tractor.levels[1]);assert.equal(tractor.find(row=>row.key==='targets')?.current,1);assert.equal(tractor.find(row=>row.key==='targets')?.next,2);assert.equal(tractor.find(row=>row.key==='pull')?.delta,75);
  const cannon=statComparison(MODULES.cannon.levels[0],MODULES.cannon.levels[1]);assert.ok(Math.abs(cannon.find(row=>row.key==='cooldown')!.current-1/.18)<1e-8);
});
test('outfitter distinguishes installing, upgrading and filtering without quantity caps',()=>{
  const m=fixtureModel(),state:OutfitterState={selectedModule:'tractor',selectedCell:{x:0,y:0},mode:'install',query:'tractor',category:'All',center:{x:0,y:0},radius:3,moving:false,failed:false};
  const html=outfitterMarkup(m,state,new Map());assert.ok(html.includes('INSTALL NEW'));assert.ok(html.includes('Install cost'));assert.ok(html.includes('Tractor beam'));assert.ok(!html.includes('data-kind="cannon"'));assert.ok(html.includes('No module quantity caps'));
  state.mode='module';state.selectedCell={x:1,y:0};const selected=outfitterMarkup(m,state,new Map());assert.ok(selected.includes('INSTALLED MODULE'));assert.ok(selected.includes('Upgrade cost'));assert.ok(selected.includes('Move / swap module'));assert.ok(selected.includes('Remove module'));
});
test('tractor and mining palettes stay distinct at every level; weapon sounds are distinct',()=>{
  for(let i=0;i<3;i++)assert.notEqual(VFX.beamColors.tractor[i],VFX.beamColors.mining[i]);
  const profiles=Object.keys(WEAPON_TYPES).map(kind=>JSON.stringify(SOUND_PROFILES[kind==='cannon'?'fire':kind as keyof typeof SOUND_PROFILES]));assert.equal(new Set(profiles).size,7);
});
