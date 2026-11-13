import Phaser from 'phaser';
import type { Asteroid } from './model.ts';
import { ensureAsteroidGeometry } from './mining.ts';
import { containsPoint, type Vertex } from './asteroidGeometry.ts';
import { RESOURCES, WORLD, type ModuleKind } from './data.ts';

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
  }else{
    rect(-5,-4,10,8,0x515c71);rect(-4,-3,8,6,0x9680ae);for(const y of [-2,1])rect(-4,y,8,1,0x4d405e);rect(-2,-4,1,8,0xd0c1de);rect(2,-4,1,8,0xd0c1de);
  }
  // Distinct tier bars and restrained corner fasteners stay legible at flight scale.
  rect(-5,5,10,1,0x0b121b);
  for(let i=0;i<level;i++)rect(-5+i*(10/Math.max(3,level)),5,Math.min(2.5,8/level),1,level>=3?0xffd58c:level===2?0x83deff:0xa7c2d0);
  rect(-6,-6,1,1,0xc1d0d8);rect(5,5,1,1,0x788d9d);
  g.restore();
}

export function drawAsteroid(g: Phaser.GameObjects.Graphics, a: Asteroid, origin = { x: a.x, y: a.y }) {
  const shape = ensureAsteroidGeometry(a), color = RESOURCES[a.ore].color;
  const vertices = shape.vertices, points = vertices.map(v => new Phaser.Geom.Point(origin.x + v.x, origin.y + v.y));
  const fraction = a.amount / Math.max(1, a.originalAmount!), base = shape.baseRadius;
  const shades = a.ore === 'ice' ? [0x748b9c, 0x92b4c9, 0x5d7285, 0x647b91] : [0x63656c, 0x555860, 0x40464f, 0x4b505a];
  for (let i = 0; i < points.length; i++) {
    const next = points[(i + 1) % points.length];
    g.fillStyle(shades[(i + Math.abs(a.id % 3)) % shades.length]);
    g.fillTriangle(origin.x, origin.y, points[i].x, points[i].y, next.x, next.y);
  }
  g.lineStyle(1, 0x9ba1aa, 0.5); g.strokePoints(points, true);
  const scale = Math.sqrt(Math.max(0.01, fraction));
  const featureInside = (point: Vertex, radius: number) => [[0, 0], [radius, 0], [-radius, 0], [0, radius], [0, -radius]].every(([x, y]) => containsPoint({ x: point.x + x, y: point.y + y }, vertices));
  for (let i = 0; i < 5; i++) {
    const angle = a.id * 1.7 + i * 2.4;
    const local = { x: Math.cos(angle) * base * 0.45 * scale, y: Math.sin(angle) * base * 0.45 * scale };
    const r = base * (0.09 + (i % 3) * 0.035) * scale;
    if (!featureInside(local, r * 1.2)) continue;
    const x = origin.x + local.x, y = origin.y + local.y;
    g.fillStyle(0x8b919b, 0.6); g.fillEllipse(x, y + 1, r * 2.2, r * 1.7);
    g.fillStyle(0x282f39, 0.85); g.fillEllipse(x, y - 1, r * 2, r * 1.5);
    g.fillStyle(0x404751); g.fillEllipse(x + 1, y, r * 1.2, r * 0.8);
  }
  // Additional seams become visible as outer rock is carved off.
  const deposits = 2 + Math.floor((1 - fraction) * 5);
  for (let i = 0; i < deposits; i++) {
    const angle = a.id + i * 2.1;
    const local = { x: Math.cos(angle) * base * 0.34 * scale, y: Math.sin(angle) * base * 0.34 * scale };
    if (!featureInside(local, 5 * scale)) continue;
    const x = origin.x + local.x, y = origin.y + local.y;
    g.lineStyle(3 * scale, 0x252b34); g.lineBetween(x - 4 * scale, y + 3 * scale, x + 4 * scale, y - 3 * scale);
    g.lineStyle(Math.max(1, 1.7 * scale), color, 0.85); g.lineBetween(x - 3 * scale, y + 2 * scale, x + 3 * scale, y - 2 * scale);
    if (a.ore === 'crystal' || a.ore === 'radioactive') { g.fillStyle(color, 0.75); g.fillTriangle(x, y - 4 * scale, x + 3 * scale, y + scale, x - 2 * scale, y + 2 * scale); }
  }
  if (fraction < 0.6) {
    g.lineStyle(1, color, 0.35 + (1 - fraction) * 0.4);
    const count = fraction < 0.3 ? 5 : 3;
    for (let i = 0; i < count; i++) {
      const p = vertices[(i * 3 + Math.abs(a.id)) % vertices.length];
      g.lineBetween(origin.x, origin.y, origin.x + p.x * 0.85, origin.y + p.y * 0.85);
    }
  }
}

export function drawStation(g: Phaser.GameObjects.Graphics, base = { x: WORLD.stationX, y: WORLD.stationY, unlocked: true }) {
  const { x, y } = base;
  const accent = base.unlocked ? 0x65d49c : 0xd6a661;
  g.lineStyle(1, accent, 0.18); g.strokeCircle(x, y, 220);
  for (let i = 0; i < 16; i++) {
    const a = i * Math.PI / 8;
    g.lineStyle(2, accent, 0.5); g.lineBetween(x + Math.cos(a) * 214, y + Math.sin(a) * 214, x + Math.cos(a) * 220, y + Math.sin(a) * 220);
  }
  g.fillStyle(0x101e2a); g.fillRoundedRect(x - 66, y - 50, 132, 100, 8);
  g.lineStyle(2, 0x52798a); g.strokeRoundedRect(x - 66, y - 50, 132, 100, 8);
  g.fillStyle(0x1c3742); g.fillRect(x - 45, y - 32, 90, 64);
  g.lineStyle(1, accent, 0.6); g.strokeRect(x - 45, y - 32, 90, 64);
  g.lineStyle(2, accent); g.strokeCircle(x, y, 20);
  g.lineBetween(x - 10, y, x + 10, y); g.lineBetween(x, y - 10, x, y + 10);
  for (const side of [-1, 1]) {
    g.fillStyle(0x264459); g.fillRect(x + side * 83 - 13, y - 40, 26, 80);
    g.lineStyle(1, 0x52798a); g.strokeRect(x + side * 83 - 13, y - 40, 26, 80);
    for (let row = -30; row <= 30; row += 15) { g.lineStyle(1, 0x6495ad, 0.5); g.lineBetween(x + side * 83 - 10, y + row, x + side * 83 + 10, y + row); }
    g.fillStyle(0x90edbd); g.fillRect(x + side * 57 - 2, y - 40, 4, 10); g.fillRect(x + side * 57 - 2, y + 30, 4, 10);
  }
}
