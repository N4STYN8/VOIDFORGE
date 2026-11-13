import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, generateChunk, validateStart, fieldAt, ChunkWorld, CHUNK_SIZE, randomWorldSeed } from '../src/world.ts';
import { GameModel } from '../src/model.ts';
import { mineMaterial, miningImpact } from '../src/mining.ts';
const idle={x:0,y:0,aim:{x:0,y:0},fire:false,mine:false,dock:false};
test('same seed reproduces geography and chunks; new seeds change homes and belts', () => {
  const a=createWorld('repeatable'),b=createWorld('repeatable'),c=createWorld('different');
  assert.deepEqual(a,b);assert.notDeepEqual(a.bases[0],c.bases[0]);assert.notDeepEqual(a.belts,c.belts);
  const x=Math.floor(a.bases[0].x/CHUNK_SIZE),y=Math.floor(a.bases[0].y/CHUNK_SIZE);
  assert.deepEqual(generateChunk(a,x,y),generateChunk(b,x,y));assert.notEqual(randomWorldSeed(),randomWorldSeed());
});
test('starting areas validate across seeds with accessible common ore and clear exits', () => {
  for(let i=0;i<35;i++){const spec=createWorld('spawn-check-'+i);assert.equal(validateStart(spec),true);assert.ok(spec.starter.every(a=>a.ore==='iron'||a.ore==='copper'));assert.ok(spec.bases.every(base=>base.x>0&&base.y>0));}
});
test('field density is continuous at chunk borders and chunk IDs do not depend on visit order', () => {
  const spec=createWorld('seam-check');
  for(let y=1000;y<18000;y+=777){const left=fieldAt(spec,CHUNK_SIZE*5-.01,y),right=fieldAt(spec,CHUNK_SIZE*5+.01,y);assert.ok(Math.abs(left.density-right.density)<.001);}
  const first=generateChunk(spec,4,5);generateChunk(spec,10,12);assert.deepEqual(generateChunk(spec,4,5),first);
  const ids=[...first,...generateChunk(spec,5,5)].map(a=>a.id);assert.equal(new Set(ids).size,ids.length);
});
test('chunk unloading preserves carved and destroyed asteroids without resetting ore', () => {
  const world=new ChunkWorld('chunk-persistence'),home=world.spec.bases[0];
  let rocks=world.activate(home,[]),a=rocks.find(a=>a.id===1)!,b=rocks.find(a=>a.id===2)!;
  const impact=miningImpact(a,{x:home.x,y:home.y},a);mineMaterial(a,10,impact);
  const expected=structuredClone(a);world.destroy(b.id);rocks=rocks.filter(a=>a.id!==b.id);
  const far={x:home.x<10000?17500:1500,y:home.y<10000?17500:1500};rocks=world.activate(far,rocks);assert.ok(rocks.length<800);
  rocks=world.activate(home,rocks);assert.deepEqual(rocks.find(a=>a.id===1),expected);assert.equal(rocks.some(a=>a.id===2),false);
});
test('save roundtrip restores the exact world, ship, minerals, discoveries, base unlocks and mining changes', () => {
  const m=new GameModel('save-roundtrip');m.enemies=[];m.squads=[];
  const a=m.asteroids.find(a=>a.id===1)!;mineMaterial(a,12,miningImpact(a,m.player,a));m.destroyAsteroid(2);
  m.cargo.ice=113;m.stored.iron=500;m.bases[1].unlocked=true;m.upgradeModule(0,0);
  const saved=JSON.parse(JSON.stringify(m.toSave())),loaded=GameModel.fromSave(saved);
  assert.deepEqual(loaded.player,m.player);assert.deepEqual(loaded.modules,m.modules);assert.deepEqual(loaded.cargo,m.cargo);assert.deepEqual(loaded.stored,m.stored);
  assert.deepEqual(loaded.bases,m.bases);assert.deepEqual([...loaded.explored],[...m.explored]);assert.deepEqual(loaded.world.spec,m.world.spec);
  assert.deepEqual(loaded.asteroids.find(a=>a.id===1),a);assert.equal(loaded.asteroids.some(a=>a.id===2),false);
  assert.deepEqual(loaded.toSave(),saved);assert.throws(()=>GameModel.fromSave({version:99}));
});
test('streaming keeps distant chunks unloaded and restores a stable field on return', () => {
  const m=new GameModel('streaming-check');m.enemies=[];m.squads=[];
  const home={x:m.player.x,y:m.player.y},initial=m.asteroids.map(a=>a.id).sort((a,b)=>a-b);
  m.player.x=home.x<10000?17500:1500;m.player.y=home.y<10000?17500:1500;m.update(.01,idle);
  assert.ok(m.asteroids.length<800);assert.notDeepEqual(m.asteroids.map(a=>a.id).sort((a,b)=>a-b),initial);
  m.player.x=home.x;m.player.y=home.y;m.update(.01,idle);assert.deepEqual(m.asteroids.map(a=>a.id).sort((a,b)=>a-b),initial);
});
