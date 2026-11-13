import {test} from 'node:test';
import assert from 'node:assert/strict';
import {tacticalReadout} from '../src/cockpit.ts';
import {fixtureModel} from './fixtures.ts';
import {EXPLORATION} from '../src/data.ts';
test('cockpit target readout only acquires live, explored, near, unobstructed aim contacts',()=>{
 const m=fixtureModel();m.player.x=5000;m.player.y=5000;m.asteroids=[];m.enemies=[{id:9001,kind:'raider',x:5300,y:5000,health:42,maxHealth:70,shield:12,cooldown:1,angle:0}];const aim={x:5300,y:5000};m.explored.clear();assert.match(tacticalReadout(m,aim).target,/No target/);
 m.explored.add(`${Math.floor(aim.x/EXPLORATION.cell)},${Math.floor(aim.y/EXPLORATION.cell)}`);let result=tacticalReadout(m,aim);assert.match(result.target,/Rust Raider/);assert.match(result.target,/42 \/ 70/);assert.match(result.target,/Shield 12/);
 assert.match(tacticalReadout(m,{x:5400,y:5100}).target,/No target/);
 m.asteroids=[{id:9002,x:5150,y:5000,radius:40,vx:0,vy:0,health:40,amount:40,ore:'iron'}];assert.match(tacticalReadout(m,aim).target,/No target/);m.asteroids=[];m.enemies[0].health=0;assert.equal(tacticalReadout(m,aim).contacts,0);
});
test('cockpit weapon status reflects intact installed items, cooldown and safe-zone lock',()=>{
 const m=fixtureModel();m.player.x=5000;m.player.y=5000;m.modules[0].cooldown=.4;let result=tacticalReadout(m,m.player);assert.match(result.weapons,/Autocannon ×1/);assert.match(result.weapons,/0 ready · 0.4s/);m.modules[0].cooldown=0;assert.match(tacticalReadout(m,m.player).weapons,/READY/);
 m.systemsDisabled=.5;assert.match(tacticalReadout(m,m.player).weapons,/EMP/);m.systemsDisabled=0;m.player.x=m.bases[0].x;m.player.y=m.bases[0].y;assert.match(tacticalReadout(m,m.player).weapons,/SAFE · LOCKED/);
 m.modules[0].integrity=0;assert.doesNotMatch(tacticalReadout(m,m.player).weapons,/Autocannon/);assert.match(tacticalReadout(m,m.player).weapons,/Mining beam/);
});
test('cockpit identifies actual nearby friendly stations without inventing station hull values',()=>{
 const m=fixtureModel();m.player.x=m.bases[0].x;m.player.y=m.bases[0].y+100;m.explored.add(`${Math.floor(m.bases[0].x/EXPLORATION.cell)},${Math.floor(m.bases[0].y/EXPLORATION.cell)}`);const result=tacticalReadout(m,m.player);assert.equal(result.station,true);assert.match(result.target,/Forge/);assert.match(result.target,/Friendly \/ active/);assert.match(result.target,/Distance 100 m/);assert.doesNotMatch(result.target,/100%|hull/);
});
