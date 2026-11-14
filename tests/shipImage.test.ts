import {test} from 'node:test';
import assert from 'node:assert/strict';
import {shipImageLayout} from '../src/shipImage.ts';
const core={x:0,y:0,kind:'core' as const,level:1};
test('ship image anchors asymmetric negative-coordinate layouts on the fixed core',()=>{
 const blocks=[core,{x:-3,y:2,kind:'miner' as const,level:4},{x:2,y:-1,kind:'engine' as const,level:2}],before=JSON.stringify(blocks),art=shipImageLayout(blocks)!;
 assert.equal(art.width,128);assert.equal(art.height,96);assert.equal(art.originX*art.width,72);assert.equal(art.originY*art.height,40);assert.equal(JSON.stringify(blocks),before);
 for(const b of blocks){const x=art.offsetX+b.x*16,y=art.offsetY+b.y*16;assert.ok(x>=24&&x<=art.width-24);assert.ok(y>=24&&y<=art.height-24);}
});
test('texture budget rejects oversized/invalid canvases without imposing a ship building limit',()=>{
 assert.equal(shipImageLayout([]),null);assert.equal(shipImageLayout([core,{...core,x:1000}]),null);assert.equal(shipImageLayout([{...core,x:NaN}]),null);assert.ok(shipImageLayout([core,{...core,x:100}]));
});
