import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixtureModel} from './fixtures.ts';
import {ENEMIES,ENEMY_AI} from '../src/data.ts';
import type {Enemy} from '../src/model.ts';
const idle={x:0,y:0,aim:{x:0,y:0},fire:false,mine:false,dock:false};
function setup(){const m=fixtureModel();m.bases=[{...m.bases[0],x:1000,y:1000}];m.asteroids=[];const e:Enemy={id:987,x:m.player.x+ENEMIES.raider.detection+150,y:m.player.y,kind:'raider',health:ENEMIES.raider.health,cooldown:0,angle:0};m.enemies=[e];return {m,e};}
test('a surviving hit starts pursuit beyond detection and follows the moving shooter without firing blindly',()=>{
 const {m,e}=setup();(m as any).hitEnemy(e,1);assert.equal(e.retaliation,ENEMY_AI.retaliation);m.player.y+=200;const before=Math.hypot(e.x-m.player.x,e.y-m.player.y);m.update(.1,idle);
 assert.equal(e.state,'chase');assert.ok(Math.hypot(e.x-m.player.x,e.y-m.player.y)<before);assert.equal(e.lastSeen?.y,m.player.y);assert.equal(m.bullets.length,0);
});
test('safe zones cancel retaliation and retaliation expires when the shooter escapes',()=>{
 const {m,e}=setup();(m as any).hitEnemy(e,1);m.bases=[{id:'safe',x:m.player.x,y:m.player.y,unlocked:true} as any];m.update(.1,idle);assert.equal(e.retaliation,0);assert.notEqual(e.state,'chase');
 m.bases=[{...m.bases[0],x:1000,y:1000}];(m as any).hitEnemy(e,1);e.retaliation=.01;m.update(.1,idle);assert.equal(e.retaliation,0);assert.notEqual(e.state,'chase');
});
test('asteroid collision damage does not provoke retaliation',()=>{const {m,e}=setup();(m as any).damageEnemy(e,1,false);assert.equal(e.retaliation,undefined);m.update(.1,idle);assert.notEqual(e.state,'chase');});
import {sharedSector} from '../src/shared.ts';
test('authority pursues the remote shooter instead of a closer visible pilot',()=>{
 const {m,e}=setup();m.shared=sharedSector('authority',()=>true);const shooter={id:'shooter',x:e.x+ENEMIES.raider.detection+100,y:e.y,vx:0,vy:0,dead:false};m.shared.targets=[shooter];m.player.x=e.x-100;(m as any).hitEnemy(e,1,false,'shooter');const before=e.x;m.update(.1,idle);assert.equal(e.state,'chase');assert.equal(e.lastSeen?.x,shooter.x);assert.ok(e.x>before);
});
