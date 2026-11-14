import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixtureModel} from './fixtures.ts';
import {MISSILE_DEFENSE} from '../src/data.ts';
import type {Bullet} from '../src/model.ts';
const idle={x:0,y:0,aim:{x:0,y:0},fire:false,mine:false,dock:false};
function setup(){const m=fixtureModel();m.asteroids=[];m.enemies=[];const missile:Bullet={id:800,x:m.player.x+200,y:m.player.y,vx:0,vy:0,life:5,enemy:true,rocket:true,damage:30,splash:90};m.bullets=[missile];return {m,missile};}
function shot(m:ReturnType<typeof fixtureModel>,damage=12){m.bullets.push({id:900,x:m.player.x+100,y:m.player.y,vx:2000,vy:0,life:1,enemy:false,damage});}
test('missiles survive multiple shots then explode exactly once without rewards or splash damage',()=>{
 const {m,missile}=setup();const health=m.player.health,kills=m.kills;
 for(let i=0;i<7;i++){shot(m);m.update(.1,idle);assert.ok(m.bullets.includes(missile));}
 assert.equal(missile.missileHealth,MISSILE_DEFENSE.health-84);shot(m);m.update(.1,idle);assert.ok(!m.bullets.includes(missile));assert.equal(m.effects.filter(e=>e.type==='explosion').length,1);assert.ok(m.effects.some(e=>e.cue==='explosion'));assert.equal(m.player.health,health);assert.equal(m.kills,kills);assert.equal(m.drops.length,0);
});
test('fast shots intercept a crossing missile before it reaches the ship regardless of bullet order',()=>{
 const {m,missile}=setup();missile.vx=-2000;shot(m,100);m.update(.1,idle);assert.ok(!m.bullets.includes(missile));assert.equal(m.player.health,100);
});
test('a rock in front of a missile stops the defensive shot',()=>{
 const {m,missile}=setup();m.asteroids=[{id:11,x:m.player.x+150,y:m.player.y,radius:25,vx:0,vy:0,ore:'iron',amount:100,health:100}];shot(m,100);m.update(.1,idle);assert.ok(m.bullets.includes(missile));assert.equal(missile.missileHealth,undefined);
});
test('ordinary hostile bullets cannot be intercepted and visual-only remote shots cannot damage missiles',()=>{
 const {m,missile}=setup();missile.rocket=false;shot(m,100);m.update(.1,idle);assert.ok(m.bullets.includes(missile));assert.equal(missile.missileHealth,undefined);
 m.bullets=[missile];missile.rocket=true;shot(m,100);m.bullets.at(-1)!.remote=true;m.update(.1,idle);assert.equal(missile.missileHealth,undefined);
});
