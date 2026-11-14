import {test} from 'node:test';
import assert from 'node:assert/strict';
import {flightWorldPoint} from '../src/flightCamera.ts';
test('immediate zoom changes preserve aim direction at distant world coordinates',()=>{
 const c={x:0,y:0,width:1600,height:900,scrollX:49000,scrollY:48000,zoom:1.35};const center={x:c.scrollX+800,y:c.scrollY+450};
 for(const zoom of [.55,.731,1.35,1.917,2.2]){c.zoom=zoom;const point=flightWorldPoint(c,1100,550);assert.ok(Math.abs(Math.atan2(point.y-center.y,point.x-center.x)-Math.atan2(100,300))<1e-10);assert.deepEqual(flightWorldPoint(c,800,450),center);}
});
test('projection respects viewport offsets and fractional scroll',()=>{const c={x:20,y:30,width:800,height:600,scrollX:333.25,scrollY:888.5,zoom:2};assert.deepEqual(flightWorldPoint(c,620,430),{x:833.25,y:1238.5});});
