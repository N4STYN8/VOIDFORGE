import Phaser from 'phaser';
import type { ModuleKind } from './data.ts';

// Primitive-only presentation helpers. All dimensions here are visual, not physics.
export function drawModule(g: Phaser.GameObjects.Graphics, x: number, y: number, angle: number, kind: ModuleKind | 'core', color: number, level = 1) {
  g.save(); g.translateCanvas(x,y); g.rotateCanvas(angle);
  const plate=[{x:-7.5,y:-5.5},{x:-5.5,y:-7.5},{x:5.5,y:-7.5},{x:7.5,y:-5.5},{x:7.5,y:5.5},{x:5.5,y:7.5},{x:-5.5,y:7.5},{x:-7.5,y:5.5}];
  // Beveled metal housing: shared silhouette makes adjacent cubes read as a ship.
  g.fillStyle(0x02060c,.85);g.fillRoundedRect(-7, -6,16,15,2);
  g.fillStyle(0x384957);g.fillPoints(plate,true);
  g.lineStyle(.8,0x8194a2);g.strokePoints(plate,true);
  g.fillStyle(0x14212e);g.fillRoundedRect(-6,-6,12,12,1.5);
  g.lineStyle(1,0x0a121c);g.lineBetween(-5,6,5,6);g.lineBetween(6,-5,6,5);
  g.lineStyle(.7,0xa6bfcb,.65);g.lineBetween(-5,-6,5,-6);g.lineBetween(-6,-5,-6,4);
  g.fillStyle(color,.7);g.fillRect(-5,-5,2,1);g.fillRect(3,-5,2,1);
  const rect=(x:number,y:number,w:number,h:number,c:number)=>{g.fillStyle(c);g.fillRect(x,y,w,h);};
  const lens=(r:number)=>{g.fillStyle(0x06111b);g.fillCircle(0,0,r+1);g.lineStyle(1,color);g.strokeCircle(0,0,r);g.fillStyle(color,.4);g.fillCircle(0,0,r-1);g.fillStyle(0xecffff);g.fillCircle(-.7,-.7,1);};
  const barrel=(y:number,length=10)=>{rect(-1,y-1.8,length,3.6,0x8a9ca9);rect(0,y-1,length-1,1.3,color);rect(length-2,y-2,2,4,0x354551);rect(length-1,y-1,1,2,0xd9e7ec);};
  if(kind==='core'){
    g.fillStyle(0x304f68);g.fillPoints([{x:-5,y:-4},{x:1,y:-5},{x:6,y:0},{x:1,y:5},{x:-5,y:4}],true);
    g.fillStyle(0x7be2ff);g.fillTriangle(5,0,-2,-3.5,-2,3.5);
    g.fillStyle(0xe8fbff);g.fillTriangle(3,0,-1,-1.5,-1,1.5);
    rect(-5,-3,2,6,0x0c1824);rect(-5,-2,1,4,color);
  }else if(kind==='cannon'){
    g.fillStyle(0x667785);g.fillCircle(-1,0,4.5);g.lineStyle(1,0xb7c8d0);g.strokeCircle(-1,0,3.5);
    barrel(0);rect(-3,-2,3,4,0x394958);rect(-2,-1,1,2,color);
  }else if(kind==='rail'){
    rect(-4,-4,5,8,0x3d5264);rect(-2,-4,13,2,0x9cb7c8);rect(-2,2,13,2,0x9cb7c8);rect(0,-1,10,2,color);
    for(let i=0;i<3;i++){rect(-1+i*3,-4,1,2,0x4a677e);rect(-1+i*3,2,1,2,0x4a677e);}
  }else if(kind==='flak'){
    rect(-4,-5,7,10,0x596a77);for(const y of [-3,0,3])barrel(y,9);rect(-4,-3,2,6,0x263746);
  }else if(kind==='pulse'||kind==='plasma'){
    lens(3.5);barrel(0,9);for(const y of [-3,2])rect(1,y,4,1,color);
    if(kind==='plasma'){g.lineStyle(1,color);g.strokeCircle(-1,0,4.5);}
  }else if(kind==='miner'){
    rect(-5,-3,3,6,0x4e706a);lens(3.5);rect(3,-2.5,5,5,0x486b66);rect(6,-1.5,2,3,color);rect(7,-.5,1,1,0xf1ffef);
  }else if(kind==='tractor'){
    lens(3);g.lineStyle(1.5,color);g.lineBetween(1,-4,6,-4);g.lineBetween(6,-4,7,-2);g.lineBetween(1,4,6,4);g.lineBetween(6,4,7,2);
    rect(4,-1,3,2,0xf2c7ff);
  }else if(kind==='rocket'){
    rect(-5,-5,11,10,0x53616b);for(const y of [-2.5,2.5]){
      rect(-4,y-1.5,9,3,0x0a111a);rect(-3,y-1,6,2,0xc7d1d7);g.fillStyle(color);g.fillTriangle(3,y-1.5,6,y,3,y+1.5);
    }
  }else if(kind==='shield'){
    g.fillStyle(color,.18);g.fillCircle(0,0,5);g.lineStyle(1,color);g.strokeCircle(0,0,5);
    const shield=[{x:-3.5,y:-3.5},{x:3.5,y:-3.5},{x:3,y:1},{x:0,y:4},{x:-3,y:1}];g.fillStyle(0x3d657f);g.fillPoints(shield,true);g.lineStyle(.8,0xc7f5ff);g.strokePoints(shield,true);rect(-.5,-2,1,4,color);
  }else if(kind==='emp'){
    lens(3);g.lineStyle(1,color);g.strokeCircle(0,0,5);for(const [x,y]of [[-5,0],[5,0],[0,-5],[0,5]]){rect(x-1,y-1,2,2,0xdbeaff);}
  }else if(kind==='reactor'){
    rect(-5,-4,10,8,0x435164);lens(3);for(const y of [-4,3]){rect(-3,y,6,1,color);}rect(-5,-2,1,4,0xa9b7c4);rect(4,-2,1,4,0xa9b7c4);
  }else if(kind==='cooler'){
    rect(-5,-4,10,8,0x0a1521);for(let i=-4;i<=4;i+=2){rect(i,-4,1,8,0x718b9c);rect(i,-3,1,5,color);}rect(-5,-1,10,2,0xb3cbd6);
  }else if(kind==='armor'){
    g.fillStyle(0x718696);g.fillPoints([{x:-5,y:-3},{x:-3,y:-5},{x:3,y:-5},{x:5,y:-3},{x:5,y:3},{x:3,y:5},{x:-3,y:5},{x:-5,y:3}],true);
    g.lineStyle(1,0xb9cbd6);g.lineBetween(-4,-3,3,-3);g.lineBetween(-4,-3,-4,3);g.lineStyle(1,0x3b4c5b);g.lineBetween(-2,4,4,4);g.lineBetween(4,-2,4,4);rect(-2,-1,4,2,0x516677);
  }else if(kind==='engine'){
    rect(-5,-4,9,8,0x8295a3);rect(-3,-3,7,6,0x36516b);rect(-6,-3,3,6,0x0a1621);rect(-6,-2,1,4,color);
    g.fillStyle(color,.5);g.fillTriangle(-7,-2.5,-12,0,-7,2.5);g.fillStyle(0xd7f8ff);g.fillTriangle(-7,-1.2,-10,0,-7,1.2);
    rect(1,-3,2,1,0xc9e2ec);rect(1,2,2,1,0xc9e2ec);
  }else if(kind==='builder'){
    // Brass fabricator: gear housing with a copper construction arm.
    rect(-5,-4,10,8,0x4a3b22);g.fillStyle(0x1a140c);g.fillCircle(-1,0,4.4);g.lineStyle(1.4,color);g.strokeCircle(-1,0,3.1);
    for(const [dx,dy]of [[0,-4.4],[0,3.4],[-4.4,-.5],[3.4,-.5]])rect(-1+dx-.5,dy,1,1,color);
    g.fillStyle(0xf2d489);g.fillCircle(-1,0,1.2);rect(2,-1,6,2,0xb87333);rect(7,-2.5,1.5,5,0xe8d9b0);
  }else{
    rect(-5,-4,10,8,0x515c71);rect(-4,-3,8,6,0x9680ae);for(const y of [-2,1])rect(-4,y,8,1,0x4d405e);rect(-2,-4,1,8,0xd0c1de);rect(2,-4,1,8,0xd0c1de);
  }
  if(level>=5){
    // Ultimate hardware: paired bus rails, extra vents and four bright corner contacts, baked with the module.
    for(const x of [-6,5]){rect(x,-4,1,3,color);rect(x,1,1,3,color);}
    for(const x of [-5,4]){rect(x,-6,2,1,0xdff8fa);rect(x,5,2,1,color);}
    rect(-2,-6,4,1,color);
  }
  // Distinct tier bars and restrained corner fasteners stay legible at flight scale.
  rect(-5,5,10,1,0x0b121b);
  for(let i=0;i<level;i++)rect(-5+i*(10/Math.max(3,level)),5,Math.min(2.5,8/level),1,level>=3?0xffd58c:level===2?0x83deff:0xa7c2d0);
  rect(-6,-6,1,1,0xc1d0d8);rect(5,5,1,1,0x788d9d);
  g.restore();
}
