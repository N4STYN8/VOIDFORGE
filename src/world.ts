import { BASES, WORLD, type Resource } from './data.ts';
import type { Asteroid } from './mining.ts';
export const CHUNK_SIZE = 1200;
const CHUNKS = Math.ceil(WORLD.width / CHUNK_SIZE), CANDIDATES = 64;
export function hashSeed(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}
export class SeedRandom {
  state: number;
  constructor(seed: string | number) { this.state = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed); }
  next = () => { this.state += 0x6d2b79f5; this.state >>>= 0; let t = this.state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function randomWorldSeed(): string { return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; }
export type Belt = { x: number; y: number; angle: number; length: number; width: number; curve: number; phase: number; density: number; ore: Resource };
export type Cluster = { x: number; y: number; radius: number; density: number; ore: Resource };
export type WorldSpec = { version: 1; seed: string; bases: typeof BASES; belts: Belt[]; clusters: Cluster[]; exitAngle: number; starter: Asteroid[] };
const distance = (a: {x:number;y:number}, b: {x:number;y:number}) => Math.hypot(a.x-b.x,a.y-b.y);
function noise(seed: string, x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y), sx = x - ix, sy = y - iy;
  const tx = sx*sx*(3-2*sx), ty = sy*sy*(3-2*sy);
  const at = (a:number,b:number) => hashSeed(`${seed}:${a}:${b}`)/4294967296;
  return (at(ix,iy)*(1-tx)+at(ix+1,iy)*tx)*(1-ty)+(at(ix,iy+1)*(1-tx)+at(ix+1,iy+1)*tx)*ty;
}
export function fieldAt(spec: WorldSpec, x: number, y: number) {
  let density = 0.015, ore: Resource = 'iron', strongest = 0;
  for (const belt of spec.belts) {
    const dx = x-belt.x,dy=y-belt.y,along=dx*Math.cos(belt.angle)+dy*Math.sin(belt.angle),side=-dx*Math.sin(belt.angle)+dy*Math.cos(belt.angle);
    const curve = Math.sin(along/belt.length*Math.PI*2+belt.phase)*belt.curve;
    const edge = Math.max(0,1-Math.max(0,Math.abs(along)-belt.length*0.35)/(belt.length*0.15));
    const value = Math.exp(-(((side-curve)/belt.width)**2))*belt.density*edge;
    density += value; if(value>strongest){strongest=value;ore=belt.ore;}
  }
  for(const cluster of spec.clusters){const value=Math.exp(-((distance({x,y},cluster)/cluster.radius)**2)*2)*cluster.density;density+=value;if(value>strongest){strongest=value;ore=cluster.ore;}}
  density *= 0.55 + noise(spec.seed,x/1500,y/1500)*0.75;
  if(distance({x,y},spec.bases[0])<1600) ore=noise(spec.seed+'common',x/500,y/500)>0.5?'copper':'iron';
  return {density:Math.min(0.9,density),ore};
}
function inCorridor(spec: WorldSpec, x:number,y:number,radius:number) {
  const home=spec.bases[0],dx=x-home.x,dy=y-home.y;
  const along=dx*Math.cos(spec.exitAngle)+dy*Math.sin(spec.exitAngle),side=-dx*Math.sin(spec.exitAngle)+dy*Math.cos(spec.exitAngle);
  return Math.abs(along)<1350&&Math.abs(side)<100+radius;
}
export function generateChunk(spec: WorldSpec, cx: number, cy: number): Asteroid[] {
  if(cx<0||cy<0||cx>=CHUNKS||cy>=CHUNKS)return [];
  const rng=new SeedRandom(`${spec.seed}:chunk:${cx}:${cy}`), result:Asteroid[]=[];
  for(let i=0;i<CANDIDATES;i++) {
    const x=cx*CHUNK_SIZE+((i%8)+0.2+rng.next()*0.6)*150,y=cy*CHUNK_SIZE+(Math.floor(i/8)+0.2+rng.next()*0.6)*150;
    const radius=23+rng.next()*22,field=fieldAt(spec,x,y),roll=rng.next();
    if(roll>field.density||spec.bases.some(base=>distance({x,y},base)<280+radius)||inCorridor(spec,x,y,radius)||spec.starter.some(a=>distance({x,y},a)<a.radius+radius+15))continue;
    const common=distance({x,y},spec.bases[0])<1600;
    const ore:Resource=rng.next()<0.72?field.ore:common?(rng.next()<0.6?'iron':'copper'):(['iron','copper','crystal','ice','radioactive'] as Resource[])[Math.floor(rng.next()*5)];
    const amount=25+Math.floor(rng.next()*46)+(field.ore==='radioactive'?15:0);
    result.push({id:10000+(cy*CHUNKS+cx)*128+i,x,y,vx:0,vy:0,radius,ore,amount,health:amount,originalAmount:amount,originX:x,originY:y,shapeSeed:hashSeed(`${spec.seed}:shape:${cx}:${cy}:${i}`)});
  }
  for(const asteroid of spec.starter)if(Math.floor(asteroid.x/CHUNK_SIZE)===cx&&Math.floor(asteroid.y/CHUNK_SIZE)===cy)result.push(structuredClone(asteroid));
  return result;
}
export function validateStart(spec: WorldSpec) {
  const home=spec.bases[0],ship={x:home.x+Math.cos(spec.exitAngle)*130,y:home.y+Math.sin(spec.exitAngle)*130};
  if(home.x<1400||home.y<1400||home.x>WORLD.width-1400||home.y>WORLD.height-1400)return false;
  const rocks:Asteroid[]=[];
  for(let x=Math.floor((home.x-1400)/CHUNK_SIZE);x<=Math.floor((home.x+1400)/CHUNK_SIZE);x++)for(let y=Math.floor((home.y-1400)/CHUNK_SIZE);y<=Math.floor((home.y+1400)/CHUNK_SIZE);y++)rocks.push(...generateChunk(spec,x,y));
  if(rocks.some(a=>distance(a,home)<260+a.radius||distance(a,ship)<50+a.radius))return false;
  if(!['iron','copper'].every(ore=>rocks.some(a=>a.ore===ore&&distance(a,ship)<=240)))return false;
  for(let d=250;d<=1250;d+=100){const p={x:home.x+Math.cos(spec.exitAngle)*d,y:home.y+Math.sin(spec.exitAngle)*d};if(rocks.some(a=>distance(a,p)<55+a.radius))return false;}
  return true;
}
export function createWorld(seed: string): WorldSpec {
  const rng=new SeedRandom(seed+':geography'),resources:Resource[]=['iron','copper','crystal','ice','radioactive'];
  const belts:Belt[]=Array.from({length:3+Math.floor(rng.next()*5)},()=>({x:1000+rng.next()*(WORLD.width-2000),y:1000+rng.next()*(WORLD.height-2000),angle:rng.next()*Math.PI*2,length:5000+rng.next()*10000,width:300+rng.next()*650,curve:(rng.next()-.5)*2200,phase:rng.next()*Math.PI*2,density:0.4+rng.next()*0.5,ore:resources[Math.floor(rng.next()*resources.length)]}));
  const clusters:Cluster[]=Array.from({length:9+Math.floor(rng.next()*10)},()=>({x:700+rng.next()*(WORLD.width-1400),y:700+rng.next()*(WORLD.height-1400),radius:500+rng.next()*1400,density:0.5+rng.next()*0.5,ore:resources[Math.floor(rng.next()*resources.length)]}));
  for(let attempt=0;attempt<64;attempt++){
    const home={x:1600+rng.next()*(WORLD.width-3200),y:1600+rng.next()*(WORLD.height-3200)},exitAngle=rng.next()*Math.PI*2;
    const bases=BASES.map((base,i)=>({...base,x:i===0?home.x:0,y:i===0?home.y:0}));
    for(let i=1;i<bases.length;i++){for(let tries=0;tries<100;tries++){const candidate={x:800+rng.next()*(WORLD.width-1600),y:800+rng.next()*(WORLD.height-1600)};if(bases.slice(0,i).every(base=>distance(base,candidate)>2500)){bases[i].x=candidate.x;bases[i].y=candidate.y;break;}}}
    const starter:Asteroid[]=Array.from({length:8},(_,i)=>{const side=i%2===0?1:-1,angle=exitAngle+side*(0.55+Math.floor(i/2)*0.18),r=310+Math.floor(i/2)*110,x=home.x+Math.cos(angle)*r,y=home.y+Math.sin(angle)*r,amount=45+Math.floor(rng.next()*25);return{id:i+1,x,y,vx:0,vy:0,radius:27+rng.next()*7,ore:i%2===0?'iron':'copper',amount,health:amount,originalAmount:amount,originX:x,originY:y,shapeSeed:hashSeed(seed+':starter:'+i)};});
    const localCluster:Cluster={x:home.x+Math.cos(exitAngle+1.3)*700,y:home.y+Math.sin(exitAngle+1.3)*700,radius:500+rng.next()*250,density:0.6+rng.next()*0.3,ore:'iron'};
    const spec:WorldSpec={version:1,seed,bases,belts,clusters:[...clusters,localCluster],exitAngle,starter};
    if(validateStart(spec))return spec;
  }
  throw new Error('Unable to generate a navigable starting area for this seed.');
}
export type WorldSnapshot = { spec: WorldSpec; changes: [number, Asteroid | null][]; surveyed: AsteroidMarker[] };
export type AsteroidMarker = {id:number;x:number;y:number;ore:Resource};
export class ChunkWorld {
  readonly spec: WorldSpec;
  changes=new Map<number,Asteroid|null>();
  surveyed=new Map<number,AsteroidMarker>();
  private activeKey='';
  constructor(seed:string,snapshot?:WorldSnapshot){this.spec=snapshot?.spec??createWorld(seed);if(snapshot){this.changes=new Map(snapshot.changes);this.surveyed=new Map(snapshot.surveyed.map(a=>[a.id,a]));}}
  capture(asteroids:Asteroid[]){for(const a of asteroids)if(a.amount!==(a.originalAmount??a.amount)||a.health!==(a.originalAmount??a.health)||Math.abs(a.x-(a.originX??a.x))>.01||Math.abs(a.y-(a.originY??a.y))>.01||(a.geometry?.revision??0)>0)this.changes.set(a.id,structuredClone(a));}
  activate(point:{x:number;y:number},current:Asteroid[],force=false){
    const cx=Math.floor(point.x/CHUNK_SIZE),cy=Math.floor(point.y/CHUNK_SIZE),key=`${cx},${cy}`;
    if(!force&&key===this.activeKey)return current;
    this.capture(current);this.activeKey=key;const active:Asteroid[]=[];
    for(let x=cx-2;x<=cx+2;x++)for(let y=cy-2;y<=cy+2;y++)for(const original of generateChunk(this.spec,x,y)){
      const state=this.changes.get(original.id);if(state===null)continue;active.push(state?structuredClone(state):original);
    }
    return active;
  }
  destroy(id:number){this.changes.set(id,null);this.surveyed.delete(id);}
  snapshot(asteroids:Asteroid[]):WorldSnapshot{this.capture(asteroids);return{spec:this.spec,changes:[...this.changes.entries()],surveyed:[...this.surveyed.values()]};}
}
