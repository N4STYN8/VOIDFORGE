import {test} from 'node:test';
import assert from 'node:assert/strict';
import {soundIsVisible} from '../src/soundVisibility.ts';
import {fixtureModel} from './fixtures.ts';
import {AUDIO_MIX,SOUND_PROFILES} from '../src/audio.ts';
test('world sounds are audible only inside the exact viewport, not its visual preload margin',()=>{
 const view={x:100,y:200,width:300,height:150};for(const p of [{x:100,y:200},{x:400,y:350},{x:250,y:275}])assert.ok(soundIsVisible(p,view));
 for(const p of [{x:99.99,y:250},{x:400.01,y:250},{x:250,y:199.99},{x:250,y:350.01},{x:-1000,y:-1000}])assert.equal(soundIsVisible(p,view),false);
 assert.ok(soundIsVisible({x:-1000,y:-1000,localSound:true},view));
});
test('enemy hit and death audio carries the target position instead of a global counter',()=>{
 const m=fixtureModel(),e={id:900,x:m.player.x+600,y:m.player.y,kind:'raider' as const,health:9,cooldown:100,angle:0};m.enemies=[e];(m as any).hitEnemy(e,100);
 const hit=m.effects.find(e=>e.cue==='hit')!,explosion=m.effects.find(e=>e.cue==='explosion')!;assert.ok(hit&&explosion);assert.equal(hit.x,e.x);assert.equal(explosion.x,e.x);assert.equal(soundIsVisible(hit,{x:m.player.x-200,y:m.player.y-200,width:400,height:400}),false);
});
test('effects receive substantial mix headroom and mechanical cues contain inharmonic resonances',()=>{
 assert.ok(AUDIO_MIX.effectsBoost>=2);assert.ok(AUDIO_MIX.criticalDuck<AUDIO_MIX.weaponDuck);for(const cue of ['deposit','depositHeavy','fire','hit','hull'] as const)assert.ok(SOUND_PROFILES[cue].metal!>0,cue);
});
