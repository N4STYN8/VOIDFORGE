import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GameModel,type Enemy} from '../src/model.ts';
import {ENEMIES,ENEMY_ARCHETYPES,MAJOR_BOSSES,BOSS,type EnemyKind} from '../src/data.ts';
import {FACTIONS,enemyScaling} from '../src/fleetConfig.ts';
import {fixtureModel} from './fixtures.ts';
const input={x:0,y:0,aim:{x:5500,y:5000},fire:false,mine:false,dock:false};
function arena(){const m=fixtureModel();m.player.x=5000;m.player.y=5000;m.asteroids=[];return m;}
// Reach the real combat entry points rather than duplicating their implementations.
const combat=(m:GameModel)=>m as unknown as {spawnEnemy:(kind:EnemyKind,x:number,y:number,a:number,extra?:Partial<Enemy>)=>Enemy;hitEnemy:(enemy:Enemy,damage:number)=>void;enemyShot:(enemy:Enemy,w:typeof ENEMIES.raider.weapons[number],angle:number)=>void;operate:(energy:number,heat:number)=>boolean};
function wake(kind:EnemyKind){const m=arena(),site=m.bossSites.find(s=>s.kind===kind)!;assert.ok(site);m.player.x=site.x-700;m.player.y=site.y;m.update(.01,input);const boss=m.enemies.find(e=>e.kind===kind)!;assert.ok(boss);m.enemies=m.enemies.filter(e=>e===boss||e.parent===boss.id);return {m,boss,parts:()=>m.enemies.filter(e=>e.mount&&e.parent===boss.id)};}
test('twelve archetypes and three fleet factions have usable loadouts and bounded scaling',()=>{
 assert.equal(new Set(ENEMY_ARCHETYPES).size,12);assert.equal(Object.keys(FACTIONS).length,3);
 for(const kind of ENEMY_ARCHETYPES){const d=ENEMIES[kind];assert.ok(d.health>0&&d.speed>0&&d.range>=d.stop&&d.weapons.length>0);assert.ok(Object.values(d.loot).some(n=>n>0));}
 for(const faction of Object.values(FACTIONS))for(const fleet of faction.fleets){assert.equal(fleet.length,3);for(const kind of fleet)assert.ok(ENEMIES[kind]);}
 assert.deepEqual(enemyScaling(1,5),enemyScaling(1,1));assert.ok(enemyScaling(99,99).health<=1.35);assert.ok(enemyScaling(99,99).damage<=1.17);
});
test('all requested bosses wake, change phases, retain mounted components and pay once',()=>{
 for(const kind of MAJOR_BOSSES){const {m,boss,parts}=wake(kind),d=ENEMIES[kind],c=combat(m);assert.equal(parts().length,d.boss!.parts.length);
 boss.health=d.health*d.boss!.phaseAt-1;m.update(.01,input);assert.equal(boss.phase2,true);
 if(d.boss!.finalAt){boss.health=d.health*d.boss!.finalAt-1;m.update(.01,input);assert.equal(boss.phase3,true);}
 boss.shield=0;c.hitEnemy(boss,1e8);if(d.boss!.meltdown){assert.ok(boss.meltdown!>0);m.player.x=boss.x-1800;m.player.health=10000;m.enemies=[boss];m.bullets=[];for(let i=0;i<80;i++)m.update(.05,input);}
 assert.ok(boss.rewarded,kind+JSON.stringify({health:boss.health,meltdown:boss.meltdown,disabled:boss.disabledFor}));const amount=m.drops.reduce((n,d)=>n+d.amount,0);c.hitEnemy(boss,1e8);assert.equal(m.drops.reduce((n,d)=>n+d.amount,0),amount);assert.ok(amount>0);
 }
});
test('shield carrier protects only living nearby allies and its loss ends protection',()=>{
 const m=arena(),c=combat(m),target=c.spawnEnemy('scrapDrone',5500,5000,0,{health:1000}),carrier=c.spawnEnemy('shieldCarrier',5600,5000,0,{faction:'void'});
 c.hitEnemy(target,100);assert.ok(Math.abs(target.health-935.65)<1e-6);carrier.health=0;c.hitEnemy(target,100);assert.ok(Math.abs(target.health-836.65)<1e-6);
});
test('marauder mines finite ore, collects real drops and preserves its cargo through save/load',()=>{
 const m=arena(),c=combat(m),e=c.spawnEnemy('marauder',5600,5000,0);m.asteroids=[{id:90001,x:5680,y:5000,radius:30,vx:0,vy:0,amount:40,health:40,ore:'iron'}];m.drops=[{id:90002,x:5600,y:5000,ore:'copper',amount:6}];
 for(let i=0;i<15;i++)m.update(.05,input);assert.ok((e.cargo?.iron??0)>0);assert.equal((e.cargo?.iron??0)+m.asteroids[0].amount,40);assert.equal((e.cargo?.copper??0)+m.drops.reduce((n,d)=>n+(d.ore==='copper'?d.amount:0),0),6);
 const restored=GameModel.fromSave(JSON.parse(JSON.stringify(m.toSave())));assert.deepEqual(restored.enemies.find(other=>other.id===e.id)?.cargo,e.cargo);
 e.shield=0;c.hitEnemy(e,1e6);const loot=m.drops.filter(d=>d.ore==='iron').reduce((n,d)=>n+d.amount,0);assert.ok(loot<=5+(e.cargo?.iron??0));
});
test('drone bays stop spawning when destroyed and components gate cutting weapons',()=>{
 const {m,boss,parts}=wake('rustLeviathan');boss.cooldown3=0;m.update(.01,input);assert.ok(m.enemies.some(e=>e.parent===boss.id&&e.kind==='scrapDrone'));
 for(const p of parts())if(p.kind==='bossBay')p.health=0;m.enemies=m.enemies.filter(e=>e.kind!=='scrapDrone');boss.cooldown3=0;m.update(.01,input);assert.equal(m.enemies.some(e=>e.kind==='scrapDrone'),false);
 const h=wake('harvester');for(const p of h.parts())if(p.kind==='bossMiner')p.health=0;h.boss.cooldown=0;h.boss.cooldown2=100;h.m.update(.01,input);assert.equal(h.boss.charge,undefined);assert.equal(h.m.enemyBeams.length,0);
});
test('cutting beams stop at carved ore, remove only real material and cannot hit through it',()=>{
 const m=arena(),c=combat(m),boss=c.spawnEnemy('harvester',5600,5000,Math.PI);m.asteroids=[{id:90001,x:5300,y:5000,radius:45,vx:0,vy:0,amount:40,health:40,ore:'iron'}];const hp=m.player.health;
 c.enemyShot(boss,ENEMIES.harvester.weapons[0],Math.PI);assert.equal(m.player.health,hp);assert.ok(m.enemyBeams[0].end.x>5300);assert.equal(m.asteroids[0].amount+(boss.cargo?.iron??0),40);assert.ok(m.asteroids[0].amount<40);
 m.asteroids=[];c.enemyShot(boss,ENEMIES.harvester.weapons[0],Math.PI);assert.ok(m.player.health<hp);
});
test('temporary EMP suppresses paid systems without removing movement and persists safely',()=>{
 const m=arena(),e=combat(m).spawnEnemy('disruptor',5200,5000,Math.PI);e.empCharge=.01;m.update(.02,input);assert.ok(m.systemsDisabled>0);assert.equal(combat(m).operate(1,0),false);const restored=GameModel.fromSave(JSON.parse(JSON.stringify(m.toSave())));assert.equal(restored.systemsDisabled,m.systemsDisabled);
 m.enemies=[];const x=m.player.x;for(let i=0;i<30;i++)m.update(.05,{...input,x:1});assert.ok(m.player.x>x);assert.equal(m.systemsDisabled,0);assert.equal(combat(m).operate(1,0),true);
});
test('electrical hazards telegraph before dealing damage and disappear with their coils',()=>{
 const {m,boss,parts}=wake('storm');boss.empTimer=100;boss.clock=.1;m.update(.01,input);assert.ok(m.enemyHazards.length>0);assert.ok(m.enemyHazards.every(h=>!h.active));
 for(const p of parts())if(p.kind==='bossCoil')p.health=0;m.update(.01,input);assert.equal(m.enemyHazards.length,0);
});
test('hostile splash damages player without awarding friendly kills and shots retain attacker identity',()=>{
 const m=arena(),c=combat(m),e=c.spawnEnemy('bomber',5500,5000,Math.PI);e.cooldown=100;e.cooldown2=100;c.enemyShot(e,{...ENEMIES.bomber.weapons[0],charge:undefined},Math.PI);assert.equal(m.bullets[0].attackerId,e.id);const health=m.player.health;for(let i=0;i<40;i++)m.update(.05,input);assert.ok(m.player.health<health);assert.equal(m.kills,0);
});
test('hostile projectile pool resets homing and splash and respects the active budget',()=>{
 const m=arena(),c=combat(m),e=c.spawnEnemy('escort',5500,5000,Math.PI);e.cooldown=100;e.cooldown2=100;c.enemyShot(e,{...ENEMIES.escort.weapons[1],count:1,lifetime:.01,splash:60},Math.PI);const original=m.bullets[0];original.life=0;m.update(.02,input);assert.equal(m.bullets.length,0);c.enemyShot(e,ENEMIES.raider.weapons[0],Math.PI);assert.equal(m.bullets[0],original);assert.equal(m.bullets[0].homing,undefined);assert.equal(m.bullets[0].splash,undefined);assert.equal(m.bullets[0].rocket,false);
 for(let i=0;i<300;i++)c.enemyShot(e,ENEMIES.raider.weapons[0],Math.PI);assert.equal(m.bullets.length,256);
});
test('breaking a mining rig during its charge cancels that body attack',()=>{
 const {m,boss,parts}=wake('harvester');boss.cooldown=0;boss.cooldown2=100;m.update(.01,input);assert.ok(boss.charge);for(const p of parts())if(p.kind==='bossMiner')p.health=0;m.update(.01,input);assert.equal(boss.charge,undefined);assert.equal(m.enemyBeams.length,0);
});

test('each archetype can run its combat loadout through the real AI update',()=>{
 for(const kind of ENEMY_ARCHETYPES){const m=arena(),c=combat(m),e=c.spawnEnemy(kind,5300,5000,Math.PI,{cooldown:0,cooldown2:0,memory:3,lastSeen:{x:5000,y:5000}});m.update(.02,input);assert.ok(e.charge||m.bullets.some(b=>b.enemy&&b.attackerId===e.id),kind+' did not attack');}
});
test('destroying an engine slows its boss and new gunships receive real armor',()=>{
 const speed=(engineAlive:boolean)=>{const m=arena(),c=combat(m);m.player.health=10000;const boss=c.spawnEnemy('harvester',5900,5000,Math.PI,{cooldown:100,cooldown2:100}),engine=c.spawnEnemy('bossEngine',5978,5000,Math.PI,{parent:boss.id,mount:{x:-78,y:0},health:engineAlive?220:0});m.enemies=[boss,engine];for(let i=0;i<50;i++)m.update(.05,input);return Math.hypot(boss.sx??0,boss.sy??0);};assert.ok(speed(false)<speed(true)*.7);
 const m=arena(),c=combat(m),tank=c.spawnEnemy('tank',5600,5000,0,{health:1000});tank.shield=0;c.hitEnemy(tank,100);assert.equal(tank.health,930);
});
