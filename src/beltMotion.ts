import { SeedRandom } from './random.ts';
import { BELT_MOTION } from './populationConfig.ts';
export { BELT_MOTION } from './populationConfig.ts';
import type { WorldSpec } from './world.ts';
import type { Asteroid } from './mining.ts';
import { WORLD,COLLISION } from './data.ts';
export type BeltKind='static'|'drifting'|'orbital'|'flowing';
export type BeltMotion={id:string;type:BeltKind;x:number;y:number;angle:number;length:number;width:number;curve:number;fieldPhase:number;speed:number;phase:number;amplitude:number;aspect:number;extent:number};
export type RockMotion={id:string;anchorX:number;anchorY:number;offsetX:number;offsetY:number;time:number;pathVx:number;pathVy:number;phase:number;rate:number;spin:number};

export function initializeBelts(spec:WorldSpec){
 if(spec.beltMotions)return;
 const belts=[...spec.belts,...(spec.expansion?.belts??[]),...(spec.populationFields?.belts??[])];
 const types:BeltKind[]=['static','drifting','orbital','flowing'],shuffle=new SeedRandom(spec.seed+':belt-types');for(let i=types.length-1;i>0;i--){const j=Math.floor(shuffle.next()*(i+1));[types[i],types[j]]=[types[j],types[i]];}
 spec.beltMotions=belts.map((belt,i)=>{const r=new SeedRandom(`${spec.seed}:belt-motion:${i}`),type=types[i%4],range=belt.length<10000?BELT_MOTION.smallSpeed:BELT_MOTION.largeSpeed,speed=range[0]+r.next()*(range[1]-range[0]);
 return{id:`belt-${i}`,type,x:belt.x,y:belt.y,angle:belt.angle,length:belt.length,width:belt.width,curve:belt.curve,fieldPhase:belt.phase,speed,phase:r.next()*Math.PI*2,amplitude:900+r.next()*1100,aspect:.65+r.next()*.25,extent:Math.hypot(belt.length*.6,belt.width*3+Math.abs(belt.curve))};});
}
function transform(m:BeltMotion,x:number,y:number,t:number,inverse=false){
 const omega=m.speed/(m.type==='orbital'?Math.max(1500,m.extent)*1.5:m.amplitude*2),theta=t*omega;
 if(m.type==='orbital'){
  const a=(inverse?-1:1)*theta,dx=x-m.x,dy=(y-m.y)/m.aspect,c=Math.cos(a),s=Math.sin(a);
  return {x:m.x+dx*c-dy*s,y:m.y+(dx*s+dy*c)*m.aspect};
 }
 const dx=m.amplitude*(Math.sin(theta+m.phase)-Math.sin(m.phase));
 const dy=m.type==='flowing'?m.amplitude*.65*(Math.sin(2*theta+m.phase)-Math.sin(m.phase)):m.amplitude*.35*(Math.sin(theta*.7+m.phase)-Math.sin(m.phase));
 return {x:x+(inverse?-dx:dx),y:y+(inverse?-dy:dy)};
}
function eligible(m:BeltMotion,a:Asteroid,spec:WorldSpec){
 const x=a.originX??a.x,y=a.originY??a.y;
 if(m.type==='orbital'){
  const radius=Math.hypot(x-m.x,(y-m.y)/m.aspect);
  if(m.x-radius<70||m.x+radius>WORLD.width-70||m.y-radius*m.aspect<70||m.y+radius*m.aspect>WORLD.height-70)return false;
  if(spec.bases.some(b=>Math.abs(Math.hypot(b.x-m.x,(b.y-m.y)/m.aspect)-radius)<800/m.aspect))return false;
 }else{
  const travel=m.amplitude*2.5;if(x<travel||y<travel||x>WORLD.width-travel||y>WORLD.height-travel||spec.bases.some(b=>Math.hypot(b.x-x,b.y-y)<travel+650))return false;
 }
 return true;
}
export function attachBelt(a:Asteroid,spec:WorldSpec){
 if(a.motionChecked)return;a.motionChecked=true;
 if(a.id>0&&a.id<10000)return;
 const x=a.originX??a.x,y=a.originY??a.y;let best:BeltMotion|undefined,weight=.12;
 for(const m of spec.beltMotions??[]){const dx=x-m.x,dy=y-m.y,along=dx*Math.cos(m.angle)+dy*Math.sin(m.angle),side=-dx*Math.sin(m.angle)+dy*Math.cos(m.angle);if(Math.abs(along)>m.length*.5)continue;const v=Math.exp(-(((side-Math.sin(along/m.length*Math.PI*2+m.fieldPhase)*m.curve)/m.width)**2));if(v>weight){weight=v;best=m;}}
 if(!best||best.type==='static'||!eligible(best,a,spec))return;
 const variation=new SeedRandom(`${a.shapeSeed??a.id}:variation`);
 a.motion={phase:variation.next()*Math.PI*2,rate:.006+variation.next()*.006,spin:(variation.next()-.5)*BELT_MOTION.spin*2,id:best.id,anchorX:x,anchorY:y,offsetX:a.x-x,offsetY:a.y-y,time:spec.motionEpoch??0,pathVx:0,pathVy:0};
}
const lookups=new WeakMap<WorldSpec,{list:BeltMotion[]|undefined;map:Map<string,BeltMotion>}>();
function definition(spec:WorldSpec,id:string){let lookup=lookups.get(spec);if(!lookup||lookup.list!==spec.beltMotions){lookup={list:spec.beltMotions,map:new Map((spec.beltMotions??[]).map(m=>[m.id,m]))};lookups.set(spec,lookup);}return lookup.map.get(id);}
export function motionPoint(a:Asteroid,spec:WorldSpec,time:number){
 attachBelt(a,spec);if(!a.motion)return{x:a.x,y:a.y};const b=a.motion,p=beltPosition(a,spec,time),decay=Math.exp(-COLLISION.asteroidDrag*Math.max(0,time-b.time));
 return{x:p.x+b.offsetX+(a.vx-b.pathVx)*(1-decay)/COLLISION.asteroidDrag,y:p.y+b.offsetY+(a.vy-b.pathVy)*(1-decay)/COLLISION.asteroidDrag};
}
export function beltPosition(a:Asteroid,spec:WorldSpec,time:number){
 const b=a.motion,m=b&&definition(spec,b.id);if(!b||!m)return {x:a.x,y:a.y};
 const t=time-(spec.motionEpoch??0),p=transform(m,b.anchorX,b.anchorY,t),phase=b.phase,rate=b.rate;
 return{x:p.x+BELT_MOTION.jitter*(Math.sin(t*rate+phase)-Math.sin(phase)),y:p.y+BELT_MOTION.jitter*(Math.cos(t*rate*.8+phase)-Math.cos(phase))};
}
export function motionVelocity(a:Asteroid,spec:WorldSpec,time:number){const before=beltPosition(a,spec,time-.1),after=beltPosition(a,spec,time+.1);return{x:(after.x-before.x)/.2,y:(after.y-before.y)/.2};}
export function placeBeltAtTime(a:Asteroid,spec:WorldSpec,time:number){
 attachBelt(a,spec);if(!a.motion)return;
 const b=a.motion,p=beltPosition(a,spec,time),velocity=motionVelocity(a,spec,time),elapsed=Math.max(0,time-b.time),decay=Math.exp(-COLLISION.asteroidDrag*elapsed);
 const excessX=a.vx-b.pathVx,excessY=a.vy-b.pathVy;b.offsetX+=excessX*(1-decay)/COLLISION.asteroidDrag;b.offsetY+=excessY*(1-decay)/COLLISION.asteroidDrag;a.vx=velocity.x+excessX*decay;a.vy=velocity.y+excessY*decay;
 a.x=p.x+b.offsetX;a.y=p.y+b.offsetY;b.time=time;b.pathVx=velocity.x;b.pathVy=velocity.y;
 a.rotation=(b.spin*(time-(spec.motionEpoch??0)))||0;
}
export function spinFor(a:Asteroid){const r=new SeedRandom(`${a.shapeSeed??a.id}:spin`);return (r.next()-.5)*BELT_MOTION.spin*2;}
export function advanceBelt(a:Asteroid,spec:WorldSpec,time:number,dt:number){
 const b=a.motion;if(!b)return false;
 const from=beltPosition(a,spec,time-dt),to=beltPosition(a,spec,time),velocity=motionVelocity(a,spec,time),decay=Math.exp(-COLLISION.asteroidDrag*dt);
 let excessX=a.vx-b.pathVx,excessY=a.vy-b.pathVy;if(Math.abs(excessX)<.001)excessX=0;if(Math.abs(excessY)<.001)excessY=0;
 a.x+=to.x-from.x+excessX*(1-decay)/COLLISION.asteroidDrag;a.y+=to.y-from.y+excessY*(1-decay)/COLLISION.asteroidDrag;
 a.vx=velocity.x+excessX*decay;a.vy=velocity.y+excessY*decay;b.pathVx=velocity.x;b.pathVy=velocity.y;b.time=time;
 a.rotation=(b.spin*(time-(spec.motionEpoch??0)))||0;return true;
}
export function captureBelt(a:Asteroid,spec:WorldSpec,time:number){if(!a.motion)return;if(a.motion.time<time)placeBeltAtTime(a,spec,time);const p=beltPosition(a,spec,time);a.motion.offsetX=a.x-p.x;a.motion.offsetY=a.y-p.y;}
export function sourceChunkCenters(spec:WorldSpec,point:{x:number;y:number},time:number){
 const result=[point],t=time-(spec.motionEpoch??0);
 for(const m of spec.beltMotions??[]){if(m.type==='static')continue;const p=transform(m,point.x,point.y,t,true);if(Math.hypot(p.x-m.x,p.y-m.y)<=m.extent+5000)result.push(p);}
 return result;
}
