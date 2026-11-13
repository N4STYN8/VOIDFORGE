import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChunkWorld,CHUNK_SIZE,generateChunk,outsideView } from '../src/world.ts';
import { EnemyPopulation,enemyRegionKey,threatAt } from '../src/enemyPopulation.ts';
import { POPULATION } from '../src/populationConfig.ts';
import { GameModel,type Enemy } from '../src/model.ts';
import { mineMaterial,miningImpact,type Asteroid } from '../src/mining.ts';
import { ENEMIES } from '../src/data.ts';
function depleted(seed='regeneration-test'){
 const world=new ChunkWorld(seed),home=world.spec.bases[0];world.spec.populationFields={belts:[],clusters:[]};let rocks=world.activate(home,[]);
 const old=rocks.find(a=>a.id===1)!;mineMaterial(old,1e6,miningImpact(old,home,old));world.destroy(old.id,old);rocks=rocks.filter(a=>a.id!==old.id);
 const region=[...world.regions.values()].find(r=>r.slots.some(s=>s.sourceId===old.id))!;return {world,home,rocks,old,region,slot:region.slots.find(slot=>slot.sourceId===old.id)!};
}
function arrive(f:ReturnType<typeof depleted>){for(let i=0;i<15&&!f.slot.current;i++){f.world.advance(Math.max(0,f.slot.due-f.world.time)+.01);f.world.replenish(f.home,f.rocks);}}

test('mined deposits renew after cooldown at new seeded positions with fresh finite ore and drift',()=>{
 const f=depleted();assert.ok(f.slot.due>=120&&f.slot.due<=300);assert.equal(f.world.replenish(f.home,f.rocks),0);
 arrive(f);const a=f.slot.current!;assert.ok(a);assert.ok(a.id<0);assert.notEqual(a.id,f.old.id);assert.equal(a.ore,'iron');assert.ok(a.amount>=1&&a.amount<=150);assert.equal(a.amount,a.originalAmount);assert.equal(a.health,a.amount);assert.notEqual(a.shapeSeed,f.old.shapeSeed);
 assert.ok(Math.hypot(a.x-f.old.x,a.y-f.old.y)>a.radius+f.old.radius+24);assert.ok(Math.hypot(a.vx,a.vy)>=1&&Math.hypot(a.vx,a.vy)<=4);assert.ok(f.world.changes.get(1)===null);
 const before=f.rocks.length;f.world.advance(10000);for(let i=0;i<20;i++)f.world.replenish(f.home,f.rocks);assert.equal(f.rocks.length,before);
});

test('regeneration is deterministic, persists across reloads, and does not reset mined replacements',()=>{
 const a=depleted('regen-repeat'),b=depleted('regen-repeat');arrive(a);arrive(b);assert.deepEqual(a.slot.current,b.slot.current);
 const rock=a.slot.current!;mineMaterial(rock,7,miningImpact(rock,a.home,rock));const snapshot=JSON.parse(JSON.stringify(a.world.snapshot(a.rocks))),loaded=new ChunkWorld(a.world.spec.seed,snapshot);
 let rocks=loaded.activate(a.home,[],true);assert.deepEqual(rocks.find(x=>x.id===rock.id),rock);
 for(let i=0;i<4;i++){const again=new ChunkWorld(a.world.spec.seed,loaded.snapshot(rocks));rocks=again.activate(a.home,[],true);again.replenish(a.home,rocks);assert.equal(rocks.filter(x=>x.id===rock.id).length,1);assert.equal(rocks.find(x=>x.id===rock.id)!.amount,rock.amount);}
 loaded.destroy(rock.id,rock);rocks=rocks.filter(x=>x.id!==rock.id);const region=[...loaded.regions.values()][0],slot=region.slots[0];assert.equal(slot.current,null);assert.ok(slot.due>loaded.time);
 for(let i=0;i<15&&!slot.current;i++){loaded.advance(Math.max(0,slot.due-loaded.time)+.01);loaded.replenish(a.home,rocks);}
 assert.ok(slot.current);assert.notEqual(slot.current!.id,rock.id);assert.equal(loaded.changes.size,a.world.changes.size);
});

test('unloaded regions recover from elapsed game time without creating distant objects',()=>{
 const f=depleted('regen-unloaded'),far={x:59000,y:59000};let distant=f.world.activate(far,f.rocks);
 f.world.advance(1000);f.world.replenish(far,distant);assert.equal(f.slot.current,null);
 distant=f.world.activate(f.home,distant);for(let i=0;i<15&&!f.slot.current;i++){f.world.replenish(f.home,distant);f.world.advance(11);}
 assert.ok(f.slot.current);assert.ok(distant.some(a=>a.id===f.slot.current!.id));assert.ok(distant.length<=POPULATION.asteroidBudget);
});

test('visible regions and ship blockers defer arrivals; retries and timers survive loading',()=>{
 const f=depleted('regen-placement');f.world.advance(1000);
 const view={x:f.region.cx*CHUNK_SIZE-1000,y:f.region.cy*CHUNK_SIZE-1000,width:4000,height:4000};
 assert.equal(f.world.replenish(f.home,f.rocks,view),0);assert.equal(f.slot.current,null);assert.ok(f.slot.due>f.world.time);
 const before=f.slot.attempt,copy=new ChunkWorld(f.world.spec.seed,JSON.parse(JSON.stringify(f.world.snapshot(f.rocks))));assert.equal([...copy.regions.values()][0].slots[0].attempt,before);
 f.world.advance(11);const center={x:(f.region.cx+.5)*CHUNK_SIZE,y:(f.region.cy+.5)*CHUNK_SIZE,radius:3000};assert.equal(f.world.replenish(f.home,f.rocks,undefined,[center]),0);
 arrive(f);const rock=f.slot.current!;assert.ok(rock);for(const base of f.world.spec.bases)assert.ok(Math.hypot(rock.x-base.x,rock.y-base.y)>280+rock.radius);
 assert.ok(f.rocks.filter(a=>a!==rock).every(a=>Math.hypot(a.x-rock.x,a.y-rock.y)>a.radius+rock.radius+POPULATION.asteroidGap));
});

test('rare ore has longer cooldowns and regenerated regional mineral proportions do not upgrade rarity',()=>{
 const world=new ChunkWorld('rare-delay');let rare:Asteroid|undefined;
 for(let x=0;x<51&&!rare;x++)for(let y=0;y<51&&!rare;y++)rare=generateChunk(world.spec,x,y).find(a=>a.ore==='radioactive');
 assert.ok(rare);world.destroy(rare.id,rare);const region=[...world.regions.values()][0];assert.equal(region.slots[0].ore,'radioactive');assert.ok(region.slots[0].due>=480&&region.slots[0].due<=900);
 const oldSnapshot=world.snapshot([]);delete oldSnapshot.population;const migrated=new ChunkWorld(world.spec.seed,oldSnapshot);assert.ok([...migrated.regions.values()][0].slots[0].due>=480);
});

test('regeneration scheduling is gradual and constrained by each field target, not a global world cap',()=>{
 const f=depleted('regen-budget');const other=f.rocks.filter(a=>a.ore==='iron').slice(0,5);for(const a of other){f.world.destroy(a.id,a);f.rocks=f.rocks.filter(b=>b!==a);}f.world.advance(1000);
 const added=f.world.replenish(f.home,f.rocks);assert.ok(added<=POPULATION.asteroidArrivalsPerTick);
 const count=f.rocks.length;f.world.replenish(f.home,f.rocks,undefined,[{...f.home,radius:10000}]);assert.equal(f.rocks.length,count);
});

const idle={x:0,y:0,aim:{x:5500,y:5000},fire:false,mine:false,dock:false};
test('normal enemy defeats schedule reinforcements and rewards cannot duplicate',()=>{
 const m=new GameModel('enemy-recovery');m.asteroids=[];const original=m.enemies[0];assert.ok(original);
 // Kill through real combat; do not bypass reward/cooldown integration.
 m.player.x=original.x-200;m.player.y=original.y;m.player.angle=0;original.disabledFor=100;original.health=1;m.enemies=[original];m.squads=[];
 m.bullets=[{id:9000,x:original.x-80,y:original.y,vx:2000,vy:0,life:1,enemy:false,damage:20}];m.update(.05,idle);
 assert.equal(m.kills,1);assert.equal(m.enemies.length,0);const state=m.population.regions.get(original.populationRegion!)!;assert.equal(state.defeats,1);assert.ok(state.normalDue>=m.world.time+119);
 const loot=m.drops.reduce((n,d)=>n+d.amount,0),saved=JSON.parse(JSON.stringify(m.toSave())),loaded=GameModel.fromSave(saved);assert.equal(loaded.kills,1);assert.equal(loaded.drops.reduce((n,d)=>n+d.amount,0),loot);assert.equal(loaded.population.regions.get(state.key)!.normalDue,state.normalDue);
 const pop=loaded.population;let id=90000;let enemies:Enemy[]=[];let squads=loaded.squads;
 for(let t=state.normalDue;t<state.normalDue+200&&!enemies.some(e=>e.populationRegion===state.key);t+=5){const result=pop.update(t,loaded.player,undefined,[],loaded.bases,enemies,squads,()=>id++);enemies=result.enemies;squads=result.squads;}
 assert.ok(enemies.some(e=>e.populationRegion===state.key));assert.ok(enemies.every(e=>Math.hypot(e.x-loaded.player.x,e.y-loaded.player.y)>=900));
});

test('regional threats, elite intervals, spawn safety, and active/dormant entity budgets remain bounded',()=>{
 const world=new ChunkWorld('threats-and-budgets'),profiles=new Set<string>();
 for(let x=0;x<17;x++)for(let y=0;y<17;y++)profiles.add(threatAt(world.spec,`${x},${y}`));assert.deepEqual([...profiles].sort(),['high','low','medium']);
 const p={x:world.spec.bases[0].x,y:world.spec.bases[0].y},pop=new EnemyPopulation(world.spec);let enemies:Enemy[]=[],squads:GameModel['squads']=[],id=30000;
 const view={x:p.x-600,y:p.y-400,width:1200,height:800};
 for(let t=0;t<3600;t+=5){const result=pop.update(t,p,view,[],world.spec.bases.map((b,i)=>({...b,unlocked:i===0})),enemies,squads,()=>id++);enemies=result.enemies;squads=result.squads;}
 assert.ok(enemies.length<=POPULATION.enemyBudget&&enemies.length>0);const count=enemies.length;for(let t=4000;t<4500;t+=5){const result=pop.update(t,p,view,[],world.spec.bases.map(b=>({...b,unlocked:true})),enemies,squads,()=>id++);enemies=result.enemies;squads=result.squads;}assert.equal(enemies.length,count);
 for(const e of enemies){assert.ok(outsideView(e,view,p,ENEMIES[e.kind!].radius));for(const b of world.spec.bases)assert.ok(Math.hypot(e.x-b.x,e.y-b.y)>300);}
 const saved=pop.snapshot(),again=new EnemyPopulation(world.spec,saved);const result=again.update(4505,p,view,[],world.spec.bases.map(b=>({...b,unlocked:true})),enemies,squads,()=>id++);assert.equal(result.enemies.length,count);
 const far={x:p.x>30000?2000:59000,y:p.y>30000?2000:59000};const parked=again.update(4510,far,undefined,[],world.spec.bases.map(b=>({...b,unlocked:true})),enemies,squads,()=>id++);assert.ok([...again.regions.values()].some(r=>r.sleeping.length));assert.ok(parked.enemies.length<=POPULATION.enemyBudget);
 const wake=again.update(6000,p,view,[],world.spec.bases.map(b=>({...b,unlocked:true})),parked.enemies,parked.squads,()=>id++);assert.ok(wake.enemies.some(e=>enemies.some(old=>old.id===e.id)));
});

test('boss cooldown ledger preserves unique reward claims across repeat defeats and saves without inventing encounters',()=>{
 const world=new ChunkWorld('boss-ledger'),pop=new EnemyPopulation(world.spec);
 assert.deepEqual(pop.recordBossDefeat('warden',0),{accepted:true,uniqueReward:true});const due=pop.bosses.get('warden')!.readyAt;assert.ok(due>=1200&&due<=1800);assert.equal(pop.bossReady('warden',due-1),false);assert.equal(pop.recordBossDefeat('warden',10).accepted,false);
 const loaded=new EnemyPopulation(world.spec,pop.snapshot());assert.equal(loaded.bossReady('warden',due),true);assert.deepEqual(loaded.recordBossDefeat('warden',due),{accepted:true,uniqueReward:false});assert.equal(loaded.bosses.get('warden')!.defeats,2);
});


test('many renewal cycles reuse bounded regional records while providing new finite deposits',()=>{
 const f=depleted('endless-mining');const ids=new Set<number>();
 for(let cycle=0;cycle<60;cycle++){
  arrive(f);assert.ok(f.slot.current);const a=f.slot.current!;assert.ok(!ids.has(a.id));ids.add(a.id);
  const before=f.world.regions.size;f.world.destroy(a.id,a);f.rocks=f.rocks.filter(rock=>rock.id!==a.id);assert.equal(f.world.regions.size,before);assert.equal(f.world.changes.size,1);
 }
 assert.equal(f.slot.generation,60);assert.equal(f.region.slots.length,1);
 const saved=JSON.parse(JSON.stringify(f.world.snapshot(f.rocks))),restored=new ChunkWorld(f.world.spec.seed,saved);assert.deepEqual(restored.snapshot(f.rocks),saved);
});

test('elite defeat cooldowns remain 5–10 minutes and safe blocked entry points do not accumulate actors',()=>{
 const world=new ChunkWorld('elite-timers'),pop=new EnemyPopulation(world.spec),player={...world.spec.bases[0]},id=enemyRegionKey(player);
 const elite:Enemy={id:1,x:player.x+1500,y:player.y,health:0,angle:0,cooldown:0,kind:'tank',populationRegion:id,populationClass:'elite'};
 pop.recordDefeat(elite,100);const due=pop.regions.get(id)!.eliteDue;assert.ok(due>=400&&due<=700);
 let counter=100;for(let t=0;t<7200;t+=5){const result=pop.update(t,player,{x:0,y:0,width:100000,height:100000},[],world.spec.bases.map(b=>({...b,unlocked:true})),[],[],()=>counter++);assert.equal(result.enemies.length,0);}
 assert.equal(counter,100);
});


test('additional belts increase field populations without changing legacy rocks or spawning on camera',()=>{
 const world=new ChunkWorld('denser-fields'),legacy=structuredClone(world.spec);delete legacy.populationFields;
 const home=world.spec.bases[0];assert.ok(world.spec.populationFields!.belts.length>=3);assert.ok(world.spec.populationFields!.clusters.length>=9);
 let extra=0;
 for(let x=0;x<20;x+=2)for(let y=0;y<20;y+=3){const before=generateChunk(legacy,x,y),after=generateChunk(world.spec,x,y);assert.deepEqual(after.filter(a=>a.id<200000000),before);extra+=after.filter(a=>a.id>=200000000).length;}
 assert.ok(extra>0);
 const active=world.activate(home,[]);assert.ok(!active.some(a=>a.id>=200000000));
 const view={x:home.x-400,y:home.y-300,width:800,height:600};world.advance(6);world.replenish(home,active,view);
 assert.ok(active.some(a=>a.id<0));for(const a of active.filter(a=>a.id<0))assert.ok(outsideView(a,view,home,a.radius));
 const snapshot=JSON.parse(JSON.stringify(world.snapshot(active))),restored=new ChunkWorld(world.spec.seed,snapshot),loaded=restored.activate(home,[],true);
 assert.deepEqual(restored.snapshot(loaded),snapshot);assert.equal(new Set(loaded.map(a=>a.id)).size,loaded.length);
});

test('regional reinforcements use the enemy classes for the region danger and never manage encounter spawns',async()=>{
 const {regionDanger,isElite}=await import('../src/enemyPopulation.ts');
 const {ENEMIES,ENEMY_SPAWN}=await import('../src/data.ts');
 const {createWorld,dangerAt}=await import('../src/world.ts');
 const {GameModel}=await import('../src/model.ts');
 for(const seed of ['alpha','beta','gamma']){
  const spec=createWorld(seed),home=spec.bases[0],size=3600,levels=new Set<number>();
  assert.equal(regionDanger(spec,`${Math.floor(home.x/size)},${Math.floor(home.y/size)}`),1);
  for(let x=0;x<17;x++)for(let y=0;y<17;y++){const level=regionDanger(spec,`${x},${y}`);levels.add(level);assert.ok(level>=1&&level<=ENEMY_SPAWN.normal.length);assert.ok(level<=Math.max(...[[.2,.2],[.8,.2],[.5,.5],[.2,.8],[.8,.8]].map(([dx,dy])=>dangerAt(spec,(x+dx)*size,(y+dy)*size))));}
  assert.ok(levels.size>=2);
 }
 assert.equal(isElite('tank'),true);assert.equal(isElite('defender'),true);assert.equal(isElite('raider'),false);assert.equal(isElite(undefined),false);
 // A new game's opening patrols are all threat-1 pirates, and stay that way as the population ticks.
 const m=new GameModel('alpha');
 for(let i=0;i<120;i++)m.update(.25,{x:0,y:0,aim:{x:0,y:0},fire:false,mine:false,dock:false});
 assert.ok(m.enemies.length>0);for(const e of m.enemies)assert.equal(ENEMIES[e.kind??'raider'].threat,1);
 // Encounter spawns (boss, parts, escorts) are exempt: they are never put to sleep or counted against regional targets.
 const site=m.bossSites[0];m.player.x=site.x-700;m.player.y=site.y;m.update(.01,{x:0,y:0,aim:{x:0,y:0},fire:false,mine:false,dock:false});
 const family=m.enemies.filter(e=>e.populationExempt);assert.ok(family.some(e=>e.kind===site.kind));assert.ok(family.length>=1+ENEMIES[site.kind].boss!.parts.length);
 m.player.x=site.x-9000;for(let i=0;i<40;i++)m.update(.25,{x:0,y:0,aim:{x:0,y:0},fire:false,mine:false,dock:false});
 assert.ok(m.enemies.some(e=>e.kind===site.kind));assert.equal(m.population.snapshot().regions.some(r=>r.sleeping.some(e=>e.populationExempt)),false);
});
