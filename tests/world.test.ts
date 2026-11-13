import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, generateChunk, validateStart, fieldAt, ChunkWorld, CHUNK_SIZE, randomWorldSeed } from '../src/world.ts';
import { WORLD } from '../src/data.ts';
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


test('expanded world streams deterministic outer regions, clips edges, and avoids legacy ID collisions',()=>{
  const world=new ChunkWorld('outer-tenfold'),spec=world.spec;
  assert.ok(WORLD.width>60000&&WORLD.height>60000);
  const seen=new Set<number>();let count=0;
  for(const [cx,cy] of [[15,15],[16,0],[0,16],[35,35],[49,49],[50,50]]){
    const rocks=generateChunk(spec,cx,cy);assert.deepEqual(generateChunk(spec,cx,cy),rocks);
    for(const rock of rocks){assert.ok(rock.x<WORLD.width&&rock.y<WORLD.height);assert.ok(!seen.has(rock.id));seen.add(rock.id);count++;}
  }
  assert.ok(count>0);assert.deepEqual(generateChunk(spec,51,51),[]);
  const far={x:WORLD.width-3000,y:WORLD.height-3000};
  const rocks=world.activate(far,[]);assert.ok(rocks.length<1600);
  const snapshot=world.snapshot(rocks),restored=new ChunkWorld(spec.seed,snapshot);
  assert.deepEqual(restored.activate(far,[],true),rocks);
});

test('legacy expansion keeps old chunk IDs and depleted rocks while adding persistent outer geography',()=>{
  const original=new ChunkWorld('legacy-expansion'),spec=structuredClone(original.spec);
  delete spec.generationSize;delete spec.expansion;delete spec.populationFields;
  // Restrict a legacy-style specimen to its former bounds.
  spec.bases.forEach((b,i)=>{b.x=3200+i*2000;b.y=3200;});spec.starter=[];
  spec.belts=[{x:9000,y:9000,angle:0,length:15000,width:3000,curve:0,phase:0,density:.9,ore:'crystal'}];spec.clusters=[];
  const before=generateChunk(spec,7,7);assert.ok(before.length>0);
  for(const rock of before)assert.ok(rock.id>=10000+(7*16+7)*128&&rock.id<10000+(7*16+7)*128+64);
  const destroyed=before[0].id,snapshot={spec,changes:[[destroyed,null]] as [number,null][],surveyed:[]};
  const migrated=new ChunkWorld(spec.seed,snapshot);
  assert.deepEqual(generateChunk(migrated.spec,7,7).filter(a=>a.id<200000000),before);
  assert.ok(migrated.spec.expansion?.belts.length);
  assert.ok(!migrated.activate({x:9000,y:9000},[]).some(a=>a.id===destroyed));
  const saved=migrated.snapshot([]),again=new ChunkWorld(spec.seed,saved);
  assert.deepEqual(again.spec,migrated.spec);assert.equal(again.changes.get(destroyed),null);
  assert.ok(Math.abs(fieldAt(migrated.spec,19200-.01,9000).density-fieldAt(migrated.spec,19200+.01,9000).density)<.001);
});

test('danger regions are seeded from ore geography, leave the start safe, and decide what spawns', async () => {
  const { createWorld, dangerAt } = await import('../src/world.ts');
  const { DANGER, ENEMIES, ENEMY_SPAWN, WORLD } = await import('../src/data.ts');
  const { GameModel } = await import('../src/model.ts');
  const profiles = new Set<string>();
  for (const seed of ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta']) {
    const spec = createWorld(seed), again = createWorld(seed), home = spec.bases[0], counts = [0, 0, 0, 0], ringLevels = new Set<number>();
    for (let x = 300; x < WORLD.width; x += 900) for (let y = 300; y < WORLD.height; y += 900) {
      const level = dangerAt(spec, x, y); counts[level - 1]++;
      assert.equal(level, dangerAt(again, x, y));
      const fromHome = Math.hypot(x - home.x, y - home.y);
      if (fromHome < DANGER.safeRadius) assert.equal(level, 1);
      if (fromHome < DANGER.calmRadius) assert.ok(level <= 2);
      if (fromHome > 12000 && fromHome < 16000) ringLevels.add(level);
    }
    // Danger is not a function of distance: one distance band holds several levels.
    assert.ok(ringLevels.size >= 2, `${seed} ring levels ${[...ringLevels]}`);
    assert.ok(counts[0] > counts[1] + counts[2] + counts[3]); assert.ok(counts[2] + counts[3] > 0);
    profiles.add(counts.join());
    // The richest ore in a field's core is rated at least as dangerous as common ore would be.
    spec.clusters.forEach(cluster => { if (Math.hypot(cluster.x - home.x, cluster.y - home.y) > DANGER.calmRadius + cluster.radius) assert.ok(dangerAt(spec, cluster.x, cluster.y) >= Math.max(1, DANGER.ore[cluster.ore] - 1)); });
  }
  assert.ok(profiles.size >= 5);
  assert.equal(ENEMY_SPAWN.normal.length, DANGER.labels.length); assert.equal(ENEMY_SPAWN.elite.length, DANGER.labels.length);
  // Low danger offers only threat-1 patrols; the toughest classes appear only at high or extreme danger.
  assert.ok(ENEMY_SPAWN.normal[0].every(kind => ENEMIES[kind].threat === 1)); assert.ok([...ENEMY_SPAWN.normal, ...ENEMY_SPAWN.elite].slice(0, 2).flat().every(kind => kind !== 'carrier' && kind !== 'defender'));
  const m = new GameModel('alpha'); assert.equal(m.danger, 1); assert.equal(m.dangerAt(m.bases[0]), 1);
  const restored = GameModel.fromSave(JSON.parse(JSON.stringify(m.toSave())));
  for (const point of [{ x: 9000, y: 30000 }, { x: 41000, y: 12000 }, { x: 52000, y: 52000 }]) assert.equal(restored.dangerAt(point), m.dangerAt(point));
});
