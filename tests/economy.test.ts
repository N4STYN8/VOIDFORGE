import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixtureModel} from './fixtures.ts';
import {GameModel} from '../src/model.ts';
import {MODULES,upgradeCost,type ModuleKind} from '../src/data.ts';
import {ECONOMY,minerals,legacyInvestment} from '../src/economy.ts';
import {createWorld,asteroidYield,generateChunk} from '../src/world.ts';
import {outfitterMarkup} from '../src/outfitter.ts';
const rich=()=>minerals(1e7,1e7,1e7,1e7,1e7);
test('tier costs escalate, common-only purchases and L2 upgrades avoid mineral deadlocks',()=>{
 for(const kind of Object.keys(MODULES) as ModuleKind[]){const d=MODULES[kind];assert.equal(d.levels.length,5);assert.equal(d.cost.crystal+d.cost.ice+d.cost.radioactive,0);let last=0;
 for(let l=1;l<5;l++){const price=upgradeCost(kind,l),total=Object.values(price).reduce((a,b)=>a+b,0);assert.ok(total>last);last=total;assert.ok(Object.values(price).every(n=>Number.isInteger(n)&&n>=0));if(l===1)assert.equal(price.crystal+price.ice+price.radioactive,0);if(l===4)assert.ok(price.radioactive>=150);}
 }
 assert.deepEqual([1,2,3,4].map(l=>upgradeCost('core',l)),ECONOMY.coreUpgrades);
 assert.throws(()=>upgradeCost('core',5),RangeError);
});
test('legacy modules retain their old refund and future upgrades add only actual paid investment',()=>{
 const m=fixtureModel();m.coreLevel=5;m.stored=rich();const old=m.modules[0];old.level=3;old.integrity=m.moduleMaxIntegrity(old);
 assert.deepEqual(m.moduleRefund(old),legacyInvestment('cannon',3));const before={...m.stored},refund=m.moduleRefund(old),price=upgradeCost('cannon',3);
 assert.ok(m.upgradeModule(old.x,old.y));for(const ore of Object.keys(price) as (keyof typeof price)[]){assert.equal(before[ore]-m.stored[ore],price[ore]);assert.equal(m.moduleRefund(old)[ore],refund[ore]+price[ore]);}
 const loaded=GameModel.fromSave(JSON.parse(JSON.stringify(m.toSave())));assert.deepEqual(loaded.moduleRefund(loaded.modules[0]),m.moduleRefund(old));
});
test('repeated buy upgrade recycle cannot multiply minerals and failed operations charge nothing',()=>{
 const m=fixtureModel();m.modules=[];m.coreLevel=5;m.stored=rich();const before={...m.stored};
 for(let n=0;n<4;n++){assert.ok(m.installModule('cannon',1,0));for(let l=1;l<5;l++)assert.ok(m.upgradeModule(1,0));assert.ok(m.removeModule(1,0));assert.deepEqual(m.stored,before);}
 m.stored=minerals();assert.equal(m.installModule('miner',1,0),false);assert.match(m.message,/45 iron, 30 copper/);assert.deepEqual(m.stored,minerals());
});
test('outfitter shows required available and exact missing minerals from the charged pool',()=>{
 const m=fixtureModel();m.stored=minerals(10,5);const html=outfitterMarkup(m,{selectedModule:'cannon',selectedCell:{x:1,y:0},mode:'install',query:'',category:'All',center:{x:0,y:0},radius:3,moving:false,failed:false},new Map());
 assert.match(html,/Required/);assert.match(html,/Stored/);assert.match(html,/Missing/);assert.match(html,/50 iron, 25 copper/);assert.match(html,/Bullet Storm/);
});
test('new world fields guarantee all exploration minerals and larger rocks yield more; legacy yields stay exact',()=>{
 for(let i=0;i<8;i++){const spec=createWorld('economy-world-'+i);assert.equal(spec.economyVersion,2);for(const ore of ['crystal','ice','radioactive'])assert.ok(spec.clusters.some(c=>c.ore===ore));assert.ok(asteroidYield(spec,44,.5,'iron')>asteroidYield(spec,24,.5,'iron'));
 const old={...spec};delete old.economyVersion;assert.equal(asteroidYield(old,44,.5,'iron'),48);assert.equal(asteroidYield(old,24,.5,'iron'),48);
 const cx=Math.floor(spec.bases[0].x/1200),cy=Math.floor(spec.bases[0].y/1200);assert.deepEqual(generateChunk(spec,cx,cy),generateChunk(JSON.parse(JSON.stringify(spec)),cx,cy));}
});
