import { BUILD_GRID, OUTPOST, SHIP, WORMHOLE } from './data.ts';
import { cellCenter, connectedIds, maxHealth, outpostStats, type Outpost, type Structure } from './outposts.ts';
import type { ShipBlock, WorldRef } from './netProtocol.ts';
import { sectorSeed } from './sectorGrid.ts';

export type GateCharge = { id: string; pilotId: string; to: WorldRef; readyAt: number; expiresAt: number; energy: number };
export type Gate = { id: string; world: WorldRef; outpostId: number; controllerId: number; name: string; level: number; range: number; width: number; height: number; x: number; y: number; energy: number; heat: number; heatCapacity: number; cooldown: number; status: string; accessible: boolean };
export type Footprint = { width: number; height: number; radius: number; cells: number };
export const sameSector = (a: WorldRef, b: WorldRef) => a.home === b.home && a.x === b.x && a.y === b.y && a.seed === b.seed;
export const sectorDistance = (a: Pick<WorldRef,'home'|'x'|'y'>, b: Pick<WorldRef,'home'|'x'|'y'>) => a.home === b.home ? Math.abs(a.x-b.x)+Math.abs(a.y-b.y) : Infinity;
export const validSector = (v: unknown): v is {x:number;y:number} => Boolean(v && typeof v === 'object' && Number.isSafeInteger((v as any).x) && Number.isSafeInteger((v as any).y) && Math.abs((v as any).x)<1e9 && Math.abs((v as any).y)<1e9);
export const targetSector = (from: WorldRef, x: number, y: number): WorldRef => ({home:from.home,x,y,seed:sectorSeed(from.home,x,y)});
const gateBlock = (s: Structure) => s.kind === 'warpFrame' || s.kind === 'warpController';

/** Geometry comes from connected frame cells, never a block-count shortcut. */
export function gateGeometry(post: Outpost, controller: Structure) {
  const component = new Map<string,Structure>(), queue = [controller];
  const all = new Map(post.structures.filter(gateBlock).map(s=>[`${s.cx},${s.cy}`,s]));
  while(queue.length){const s=queue.pop()!,key=`${s.cx},${s.cy}`;if(component.has(key))continue;component.set(key,s);for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const n=all.get(`${s.cx+dx},${s.cy+dy}`);if(n&&!component.has(`${n.cx},${n.cy}`))queue.push(n);}}
  const blocks=[...component.values()], frames=blocks.filter(s=>s.kind==='warpFrame');
  let status='Operational', width=0,height=0,x=cellCenter(controller.cx),y=cellCenter(controller.cy);
  if(!frames.length)return {width,height,x,y,status:'Build a closed frame'};
  const minX=Math.min(...frames.map(s=>s.cx)),maxX=Math.max(...frames.map(s=>s.cx)),minY=Math.min(...frames.map(s=>s.cy)),maxY=Math.max(...frames.map(s=>s.cy));
  width=Math.max(0,(maxX-minX-1)*OUTPOST.cell);height=Math.max(0,(maxY-minY-1)*OUTPOST.cell);x=(minX+maxX+1)*OUTPOST.cell/2;y=(minY+maxY+1)*OUTPOST.cell/2;
  if(blocks.filter(s=>s.kind==='warpController').length!==1)status='One controller per assembly required';
  else if(!width||!height)status='Opening too small';
  else {
    for(let cy=minY;cy<=maxY;cy++)for(let cx=minX;cx<=maxX;cx++){
      const edge=cx===minX||cx===maxX||cy===minY||cy===maxY;
      if(edge&&!component.has(`${cx},${cy}`))status='Frame is open';
      if(!edge&&post.structures.some(s=>s.cx===cx&&s.cy===cy))status='Opening obstructed';
    }
  }
  const connected=connectedIds({...post,structures:post.structures.filter(s=>s.progress>=1&&s.health>0)});
  if(blocks.some(s=>!connected.has(s.id)))status='Disconnected from core';
  if(blocks.some(s=>s.progress<1))status='Under construction';
  if(blocks.some(s=>s.health<maxHealth(s)*WORMHOLE.criticalFraction))status='Damaged';
  return {width,height,x,y,status};
}

export function footprint(blocks: ShipBlock[], angle: number): Footprint {
  const heading=angle, c=Math.cos(heading),s=Math.sin(heading);
  let minX=-SHIP.radius,maxX=SHIP.radius,minY=-SHIP.radius,maxY=SHIP.radius,radius=SHIP.radius;
  for(const [kind,x,y] of blocks){if(kind==='core')continue;const px=(x*c-y*s)*BUILD_GRID.cellSize,py=(x*s+y*c)*BUILD_GRID.cellSize;
    // Rotated square envelope is conservative relative to the physical module contact circle.
    const r=12*(Math.abs(c)+Math.abs(s));minX=Math.min(minX,px-r);maxX=Math.max(maxX,px+r);minY=Math.min(minY,py-r);maxY=Math.max(maxY,py+r);radius=Math.max(radius,Math.hypot(px,py)+17);
  }
  return {width:maxX-minX+WORMHOLE.clearance*2,height:maxY-minY+WORMHOLE.clearance*2,radius:radius+WORMHOLE.clearance,cells:blocks.length};
}
export const fitsGate = (g: Gate, ship: Footprint) => ship.width<=g.width && ship.height<=g.height;
export function gateCosts(g: Pick<Gate,'level'>, distance: number, ship: Footprint){const l5=g.level===5;
  return {energy:Math.ceil((WORMHOLE.baseEnergy+WORMHOLE.sectorEnergy*distance+WORMHOLE.cellEnergy*ship.cells)*(l5?WORMHOLE.stabilization.energy:1)),heat:(WORMHOLE.baseHeat+WORMHOLE.sectorHeat*distance)*(l5?WORMHOLE.stabilization.heat:1),charge:WORMHOLE.charge*(l5?WORMHOLE.stabilization.charge:1),cooldown:WORMHOLE.cooldown*(l5?WORMHOLE.stabilization.cooldown:1)};
}
export function gatesFor(post: Outpost, world: WorldRef): Gate[]{const stats=outpostStats(post);return post.structures.filter(s=>s.kind==='warpController').map(s=>{
  const geometry=gateGeometry(post,s);let status=geometry.status;
  if(status==='Operational'&&s.gateCharge)status='Charging';else if(status==='Operational'&&(s.gateCooldown??0)>0)status='Cooling down';
  if((status==='Operational'||status==='Charging')&&(post.overheated||(post.heat??0)>=stats.heatCapacity))status='Overheated';
  if(status==='Operational'&&(post.energy??0)<gateCosts(s,1,{cells:1} as Footprint).energy)status='Unpowered';
  return {...geometry,id:JSON.stringify([world.home,world.seed,world.x,world.y,post.id,s.id]),world:{...world},outpostId:post.id,controllerId:s.id,name:post.name,level:s.level,range:WORMHOLE.range[s.level-1]??0,energy:post.energy??0,heat:post.heat??0,heatCapacity:stats.heatCapacity,cooldown:s.gateCooldown??0,status,accessible:true};
});}
export function travelError(g: Gate, to: WorldRef, ship: Footprint, reserved=false): string|undefined {
  if(!g.accessible)return 'Crew access required';
  if(g.status!=='Operational'&&!(reserved&&g.status==='Charging'))return g.status;
  if(!validSector(to))return 'Invalid sector';const distance=sectorDistance(g.world,to);
  if(distance<1||distance>g.range)return `Range is ${g.range} sector${g.range===1?'':'s'} (Manhattan)`;
  if(!fitsGate(g,ship))return 'Ship does not fit the opening';
  const cost=gateCosts(g,distance,ship);
  if(!reserved&&cost.energy>g.energy)return 'Insufficient outpost energy';
  if(!reserved&&g.heat+cost.heat>g.heatCapacity)return 'Insufficient heat headroom';
}
export type GateRoute = { hops: {gate:Gate;to:WorldRef;energy:number}[]; energy:number };
/** Minimum activations. Only actual operational departure gates form graph vertices. */
export function planGateRoute(gates: Gate[], startId: string, to: WorldRef, ship: Footprint): GateRoute|undefined {
  const start=gates.find(g=>g.id===startId);if(!start)return;
  const queue:{gate:Gate;hops:GateRoute['hops']}[]=[{gate:start,hops:[]}],seen=new Set([start.id]);
  for(let i=0;i<queue.length;i++){const {gate,hops}=queue[i];if(!travelError(gate,to,ship)){const route=[...hops,{gate,to,energy:gateCosts(gate,sectorDistance(gate.world,to),ship).energy}];return {hops:route,energy:route.reduce((n,h)=>n+h.energy,0)};}
    for(const next of gates){if(seen.has(next.id)||next.world.home!==gate.world.home||travelError(gate,next.world,ship)||!fitsGate(next,ship)||next.status!=='Operational'||!next.accessible)continue;seen.add(next.id);queue.push({gate:next,hops:[...hops,{gate,to:next.world,energy:gateCosts(gate,sectorDistance(gate.world,next.world),ship).energy}]});}
  }
}
