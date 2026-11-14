import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameModel, type Input } from '../src/model.ts';
import { CARGO_EJECTION, RESOURCES } from '../src/data.ts';
import { flightHud } from '../src/hud.ts';
import { saveText } from '../src/persistence.ts';
const idle = (m: GameModel): Input => ({x:0,y:0,aim:{...m.player},fire:false,mine:false,dock:false});

test('ejection moves only selected carried cargo into bounded radial piles without RNG changes', () => {
  for (const ore of Object.keys(RESOURCES) as (keyof typeof RESOURCES)[]) {
    const m = new GameModel('ejection'); m.enemies=[];
    m.cargo.iron=7; m.cargo[ore]=113.5; m.stored[ore]=999;
    const before={...m.cargo}, rng=m.rng.state;
    assert.equal(m.ejectCargo(ore),113.5);
    assert.equal(m.cargo[ore],0);assert.equal(m.stored[ore],999);
    for(const other of Object.keys(RESOURCES) as (keyof typeof RESOURCES)[]) if(other!==ore)assert.equal(m.cargo[other],before[other]);
    assert.equal(m.drops.reduce((n,d)=>n+d.amount,0),113.5);
    assert.ok(m.drops.length<=CARGO_EJECTION.maxStacks);
    assert.ok(m.drops.every(d=>d.discarded&&d.ore===ore));
    assert.ok(m.drops.some(d=>d.x<m.player.x));assert.ok(m.drops.some(d=>d.x>m.player.x));
    assert.ok(m.drops.some(d=>d.y<m.player.y));assert.ok(m.drops.some(d=>d.y>m.player.y));
    assert.equal(m.rng.state,rng);
    assert.equal(m.ejectCargo(ore),0);
  }
});

test('discarded cargo cannot be picked up or targeted by tractors even after save/load', () => {
  let m = new GameModel('ejection-collect');m.enemies=[];m.cargo.iron=24;m.ejectCargo('iron');
  m = GameModel.fromSave(JSON.parse(saveText(m))); m.enemies=[];
  m.modules.push({kind:'tractor',x:1,y:0,level:5,integrity:100,targetIds:[m.drops[0].id]});
  for(const drop of m.drops){Object.assign(drop,{x:m.player.x,y:m.player.y,vx:0,vy:0});}
  m.drops.push({id:m.id++,ore:'copper',amount:3,x:m.player.x,y:m.player.y});
  for(let i=0;i<10;i++)m.update(.05,idle(m));
  assert.equal(m.cargo.iron,0);assert.equal(m.cargo.copper,3);
  assert.equal(m.drops.filter(d=>d.discarded).reduce((n,d)=>n+d.amount,0),24);
  assert.ok(m.tractorLinks.every(link=>!m.drops.find(d=>d.id===link.targetId)?.discarded));
  // Fresh ore must not be merged into unrecoverable piles.
  m['releaseOre'](m.player,'iron',5);
  m.update(.05,idle(m));assert.equal(m.cargo.iron,5);
});

test('ejection rejects invalid requests and dead ships; confirmation quantity cannot eject newly acquired cargo', () => {
  const m=new GameModel('ejection-guards');m.cargo.iron=10;
  for(const amount of [0,-1,NaN,Infinity])assert.equal(m.ejectCargo('iron',amount),0);
  m.player.health=0;assert.equal(m.ejectCargo('iron'),0);m.respawn();
  m.cargo.iron=20;assert.equal(m.ejectCargo('iron',10),10);assert.equal(m.cargo.iron,10);
  assert.equal(m.ejectCargo('iron',100),10);assert.equal(m.cargo.iron,0);
  assert.equal(m.drops.reduce((n,d)=>n+d.amount,0),20);
});

test('HUD places accessible per-type eject actions beside carried values and disables empty holds', () => {
  const m=new GameModel('ejection-hud');m.cargo.iron=5;m.stored.copper=100;
  const html=flightHud(m,{base:m.bases[0],direction:'',zoom:1,muted:false,effects:true,detailsOpen:false});
  assert.match(html, /aria-label="Eject carried iron"/);
  assert.match(html, /data-eject="copper"[^>]*disabled/);
  assert.doesNotMatch(html, /data-eject="iron"[^>]*disabled/);
});
