import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixtureModel} from './fixtures.ts';
import {SOUND_PROFILES} from '../src/audio.ts';
import {cellOf} from '../src/outposts.ts';
import {upgradeCost} from '../src/data.ts';
const idle={x:0,y:0,aim:{x:3380,y:3330},fire:false,mine:false,dock:false};
test('Forge deposits emit exactly one amount-carrying action cue only after a real transfer',()=>{
 const m=fixtureModel();m.cargo.iron=12;m.cargo.copper=3;const before=m.stored.iron;m.update(.01,{...idle,dock:true});
 assert.equal(m.cargoUsed,0);assert.equal(m.stored.iron,before+12);assert.equal(m.actionSounds.filter(e=>e.cue==='deposit').length,1);assert.equal(m.actionSounds.find(e=>e.cue==='deposit')!.amount,15);
 m.actionSounds=[];m.update(.01,{...idle,dock:true});assert.equal(m.actionSounds.some(e=>e.cue==='deposit'),false);
 m.cargo.iron=100;m.player.x=5000;m.update(.01,{...idle,dock:true});assert.equal(m.cargo.iron,100);assert.equal(m.actionSounds.some(e=>e.cue==='deposit'),false);
});
test('outpost deposit cue reports only material that fits and never sounds for full storage',()=>{
 const m=fixtureModel(),cx=cellOf(m.player.x),cy=cellOf(m.player.y);const outpost={id:900,name:'Audio test',cx,cy,revision:0,stored:{iron:195,copper:0,crystal:0,ice:0,radioactive:0},structures:[{id:901,kind:'outpostCore' as const,cx,cy,rot:0,level:1,health:600,progress:1}]};m.outposts=[outpost];m.cargo.iron=12;
 assert.equal(m.depositToOutpost(outpost),5);assert.equal(m.cargo.iron,7);assert.equal(m.actionSounds[0].amount,5);m.actionSounds=[];assert.equal(m.depositToOutpost(outpost),0);assert.equal(m.actionSounds.length,0);
});
test('outfitter action cues survive effect resets, charge normal prices and never sound on failed actions',()=>{
 const m=fixtureModel();assert.equal(m.installModule('cannon',-1,0),false);assert.equal(m.actionSounds.length,0);m.stored={iron:1e6,copper:1e6,crystal:1e6,ice:1e6,radioactive:1e6};const before={...m.stored};
 assert.ok(m.installModule('cannon',-1,0));assert.equal(m.actionSounds[0].cue,'moduleInstall');m.update(.01,idle);assert.equal(m.actionSounds[0].cue,'moduleInstall');assert.ok(m.stored.iron<before.iron);
 m.coreLevel=5;const price=upgradeCost('cannon',1),iron=m.stored.iron;assert.ok(m.upgradeModule(-1,0));assert.equal(iron-m.stored.iron,price.iron);assert.equal(m.actionSounds.at(-1)!.cue,'moduleUpgrade');
 const save=m.toSave();assert.equal('actionSounds' in save,false);
});
test('layered deposits have clamps, a short rattle and a delayed confirmation, with bounded levels',()=>{
 for(const kind of ['deposit','depositHeavy'] as const){const s=SOUND_PROFILES[kind];assert.equal(s.priority,2);assert.ok(s.noise!>0);assert.ok(s.layers!.some(l=>(l.repeat??0)>=3));assert.ok(s.layers!.some(l=>l.delay!>.3&&l.end>l.start));for(const layer of [s,...s.layers!]){assert.ok(layer.gain<=.15);const end=('delay' in layer?(layer.delay??0):0)+layer.duration+((layer.repeat??1)-1)*(layer.every??0);assert.ok(end<1);}}
});

test('repair cues require real successful work, and paid ultimate activation has its own cue',()=>{
 const m=fixtureModel();m.player.health=60;assert.equal(m.repairShip(),false);assert.equal(m.actionSounds.length,0);m.stored.iron=1000;m.stored.copper=1000;assert.ok(m.repairShip());assert.equal(m.actionSounds.at(-1)!.cue,'repair');m.actionSounds=[];assert.ok(m.repairShip());assert.equal(m.actionSounds.length,0);
 m.coreLevel=5;m.energy=0;m.update(.001,{...idle,overclock:true});assert.equal(m.effects.some(e=>e.cue==='overclock'),false);m.energy=m.maxEnergy;m.update(.001,{...idle,overclock:true});assert.equal(m.effects.filter(e=>e.cue==='overclock').length,1);
});
test('construction completion sounds once, not on subsequent completed-block frames',()=>{
 const m=fixtureModel(),cx=cellOf(m.player.x),cy=cellOf(m.player.y);m.outposts=[{id:910,name:'Completion',cx,cy,revision:0,structures:[{id:911,kind:'outpostCore',cx,cy,rot:0,level:1,health:600,progress:.999}]}];
 m.update(.05,idle);assert.equal(m.actionSounds.filter(e=>e.cue==='constructionDone').length,1);m.actionSounds=[];m.update(.05,idle);assert.equal(m.actionSounds.some(e=>e.cue==='constructionDone'),false);
});

test('switching ships sounds the actual automatic unload once, without manufacturing resources',()=>{
 const m=fixtureModel();m.stored={iron:10000,copper:10000,crystal:10000,ice:0,radioactive:0};assert.ok(m.buyShip());m.actionSounds=[];m.cargo.iron=20;const before=m.stored.iron;assert.ok(m.switchShip(m.hangar[0].id));assert.equal(m.stored.iron,before+20);assert.equal(m.cargoUsed,0);assert.equal(m.actionSounds.filter(e=>e.cue==='deposit').length,1);assert.equal(m.actionSounds.find(e=>e.cue==='deposit')!.amount,20);
});
