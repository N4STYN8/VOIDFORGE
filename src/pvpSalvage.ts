import type {AbilityState} from './abilities.ts';
import {SPECIAL} from './abilityConfig.ts';
/** Pure shared modular combat geometry and finite cargo allocation. No Phaser, DOM or sockets. */
import {BUILD_GRID,MODULES,MODULE_DURABILITY,RESOURCES,MODULAR_PVP,SHIP_SYSTEMS,WORLD,type ModuleKind,type Resource,type WeaponKind} from './data.ts';
import {minerals,type Minerals} from './economy.ts';
export type CombatModule={x:number;y:number;kind:ModuleKind;level:number;integrity:number;offline?:boolean;ability?:AbilityState;invested?:Partial<Minerals>};
export type CombatShip={life:string;x:number;y:number;vx:number;vy:number;angle:number;health:number;shield:number;coreLevel:number;modules:CombatModule[];cargo:Minerals};
export type RecoveredModule={id:string;kind:ModuleKind;level:number;integrity:number;ability?:AbilityState;invested?:Partial<Minerals>};
export type SalvageObject={id:string;owner:string;room:string;x:number;y:number;vx:number;vy:number;angle:number;spin:number;expires:number;cargo:Minerals;module?:RecoveredModule;pending?:number;sourceCell?:string};
export type ModuleDamage={x:number;y:number;amount:number;detach?:boolean};
export type StructuralHit={damage:ModuleDamage[];coreDamage:number;shieldDamage:number;released:Minerals;detached:CombatModule[];disabled:{x:number;y:number}[];defeat:boolean;point:{x:number;y:number}};
export const key=(m:{x:number;y:number})=>`${m.x},${m.y}`;
export const mineralTotal=(m:Partial<Minerals>)=>Object.values(m).reduce((n,v)=>n+(v??0),0);
export function modulePoint(ship:Pick<CombatShip,'x'|'y'|'angle'>,m:{x:number;y:number}) {const c=Math.cos(ship.angle),s=Math.sin(ship.angle);return{x:ship.x+(m.x*c-m.y*s)*BUILD_GRID.cellSize,y:ship.y+(m.x*s+m.y*c)*BUILD_GRID.cellSize};}
export function connectedModules(modules:CombatModule[]) {const found=new Set(['0,0']);let changed=true;while(changed){changed=false;for(const m of modules)if(m.integrity>0&&!found.has(key(m))&&[[1,0],[-1,0],[0,1],[0,-1]].some(([x,y])=>found.has(`${m.x+x},${m.y+y}`))){found.add(key(m));changed=true;}}return found;}
/** Core storage fills first, then holds in stable grid order, using the real cargo capacities. */
export function cargoAllocation(ship:Pick<CombatShip,'cargo'|'modules'>){const remaining={...ship.cargo},out=new Map<string,Minerals>();const bays=[{x:0,y:0,capacity:SHIP_SYSTEMS.cargoCapacity},...ship.modules.filter(m=>m.kind==='cargo'&&!m.offline&&m.integrity>0).sort((a,b)=>a.x-b.x||a.y-b.y).map(m=>({...m,capacity:MODULES.cargo.levels[m.level-1].cargo??0}))];for(const bay of bays){let room=bay.capacity;const stock=minerals();for(const ore of Object.keys(RESOURCES) as Resource[]){const n=Math.min(room,remaining[ore]);stock[ore]=n;remaining[ore]-=n;room-=n;}out.set(key(bay),stock);}out.set('overflow',remaining);return out;}
/** Swept intersection with rotated grid cells, including the core; the earliest occupied cell wins. */
export function shipIntersection(ship:CombatShip,start:{x:number;y:number},end:{x:number;y:number}){
 const c=Math.cos(ship.angle),s=Math.sin(ship.angle),local=(p:{x:number;y:number})=>({x:(p.x-ship.x)*c+(p.y-ship.y)*s,y:-(p.x-ship.x)*s+(p.y-ship.y)*c}),a=local(start),b=local(end);
 let best:{t:number;x:number;y:number;point:{x:number;y:number}}|undefined;
 for(const m of [{x:0,y:0},...ship.modules]){const half=BUILD_GRID.cellSize*.5+2,px=m.x*BUILD_GRID.cellSize,py=m.y*BUILD_GRID.cellSize;let lo=0,hi=1;
  for(const axis of ['x','y'] as const){const d=b[axis]-a[axis],center=axis==='x'?px:py;if(Math.abs(d)<1e-9){if(Math.abs(a[axis]-center)>half){hi=-1;break;}}else{const u=(center-half-a[axis])/d,v=(center+half-a[axis])/d;lo=Math.max(lo,Math.min(u,v));hi=Math.min(hi,Math.max(u,v));}}
  if(lo<=hi&&lo>=0&&lo<=1&&(!best||lo<best.t))best={t:lo,x:m.x,y:m.y,point:{x:start.x+(end.x-start.x)*lo,y:start.y+(end.y-start.y)*lo}};
 }return best;
}
/** Mutates only the provided authoritative ship; exterior hits never subtract core hull. */
export function structuralHit(ship:CombatShip,cell:{x:number;y:number;point?:{x:number;y:number}},damage:number,weapon:WeaponKind,level:number):StructuralHit{
 const result:StructuralHit={damage:[],coreDamage:0,shieldDamage:0,released:minerals(),detached:[],disabled:[],defeat:false,point:cell.point??modulePoint(ship,cell)};
 if(ship.health<=0||!Number.isFinite(damage)||damage<=0)return result;
 const armored=ship.modules.some(m=>m.kind==='armor'&&m.level>=5&&!m.offline&&m.integrity>0);const scaled=damage*MODULAR_PVP.damageScale*(armored?1-SPECIAL.armor.passive:1);result.shieldDamage=Math.min(ship.shield,scaled);ship.shield-=result.shieldDamage;let remaining=scaled-result.shieldDamage;if(remaining<=0)return result;
 if(cell.x===0&&cell.y===0){result.coreDamage=Math.min(ship.health,remaining);ship.health-=result.coreDamage;}
 else{
  const primary=ship.modules.find(m=>key(m)===key(cell));if(!primary)return result;
  const before=cargoAllocation(ship);
  const candidates=[{m:primary,damage:remaining}];
  // Focused L1–3 shots affect one component; higher-tier rail/blast weapons may stress one neighbour.
  if(level>=4&&['rail','plasma','rocket','flak'].includes(weapon)){const adjacent=ship.modules.filter(m=>m!==primary&&Math.abs(m.x-primary.x)+Math.abs(m.y-primary.y)===1).sort((a,b)=>a.integrity-b.integrity||a.x-b.x||a.y-b.y)[0];if(adjacent)candidates.push({m:adjacent,damage:remaining*MODULAR_PVP.adjacentFraction});}
  for(const {m,damage:hit}of candidates){const amount=Math.min(m.integrity,hit);m.integrity=Math.max(0,m.integrity-hit);const detach=m.integrity<=0&&result.detached.length<(level>=5?MODULAR_PVP.maxDetach:1);result.damage.push({x:m.x,y:m.y,amount,detach});if(detach)result.detached.push({...m});}
  ship.modules=ship.modules.filter(m=>!result.detached.some(d=>key(d)===key(m)));
  const connected=connectedModules(ship.modules);
  for(const m of ship.modules){const was=m.offline;m.offline=!connected.has(key(m));if(m.offline&&!was)result.disabled.push({x:m.x,y:m.y});}
  for(const m of [...result.detached,...ship.modules.filter(m=>result.disabled.some(d=>key(d)===key(m)))])if(m.kind==='cargo'){for(const ore of Object.keys(RESOURCES) as Resource[])result.released[ore]+=(before.get(key(m))?.[ore]??0);}
 }
 if(ship.health<=0){result.defeat=true;result.detached.push(...ship.modules.map(m=>({...m})));ship.modules=[];result.released={...ship.cargo};}
 for(const ore of Object.keys(RESOURCES) as Resource[]){result.released[ore]=Math.min(result.released[ore],ship.cargo[ore]);ship.cargo[ore]-=result.released[ore];}
 return result;
}
const validAbility=(v:AbilityState|undefined)=>!v||['shots','active','cooldown','sustained','mining','phase'].every(k=>Number.isFinite(v[k as keyof AbilityState])&&v[k as keyof AbilityState]>=0&&v[k as keyof AbilityState]<1e9);
export function readCombatShip(value:unknown):CombatShip|undefined{
 const v=value as CombatShip;if(!v||typeof v.life!=='string'||v.life.length>100||![v.x,v.y,v.vx,v.vy,v.angle,v.health,v.shield].every(Number.isFinite)||v.health<0||v.health>1e7||v.shield<0||v.shield>1e7||!Number.isInteger(v.coreLevel)||v.coreLevel<1||v.coreLevel>5||!Array.isArray(v.modules))return;
 const occupied=new Set(['0,0']);for(const m of v.modules){if(!m||!Object.hasOwn(MODULES,m.kind)||!Number.isInteger(m.level)||m.level<1||m.level>5||![m.x,m.y].every(n=>Number.isSafeInteger(n)&&Math.abs(n)*BUILD_GRID.cellSize<=Math.max(WORLD.width,WORLD.height)/2)||occupied.has(key(m))||!Number.isFinite(m.integrity)||m.integrity<0||m.integrity>MODULE_DURABILITY[m.kind][m.level-1])return;occupied.add(key(m));if(!validAbility(m.ability))return;if(m.invested&&Object.values(m.invested).some(n=>!Number.isFinite(n)||n!<0||n!>1e8))return;}
 if(!v.cargo||Object.keys(v.cargo).some(k=>!Object.hasOwn(RESOURCES,k))||Object.values(v.cargo).some(n=>!Number.isFinite(n)||n<0||n>1e8))return;
 return structuredClone({...v,cargo:{...minerals(),...v.cargo}});
}

export type CombatReceipt={seq:number;life:string;hit?:StructuralHit;cargo?:Minerals;module?:RecoveredModule;target?:'cargo'|'stored';drafts?:string[];pickup?:string;pickupOrigin?:SalvageObject;kill?:boolean};

export function validSalvageState(raw:unknown):boolean{
 const s=raw as {life?:unknown;receipts?:Record<string,number>;modules?:RecoveredModule[];lastDebit?:{ledger:string;seq:number;actual:Minerals;removed?:string[]}};
 if(!s||typeof s.life!=='string'||s.life.length>100||!s.receipts||typeof s.receipts!=='object'||!Array.isArray(s.modules)||Object.values(s.receipts).some(n=>!Number.isSafeInteger(n)||n<0))return false;
 const ids=new Set<string>();for(const m of s.modules){if(!m||typeof m.id!=='string'||m.id.length>150||ids.has(m.id)||!Object.hasOwn(MODULES,m.kind)||!Number.isInteger(m.level)||m.level<1||m.level>5||!Number.isFinite(m.integrity)||m.integrity<0||m.integrity>MODULE_DURABILITY[m.kind][m.level-1]||m.invested&&Object.values(m.invested).some(n=>!Number.isFinite(n)||n!<0))return false;if(!validAbility(m.ability))return false;ids.add(m.id);}
 if(s.lastDebit?.removed&&(!Array.isArray(s.lastDebit.removed)||s.lastDebit.removed.some(v=>typeof v!=='string')))return false;
 if(s.lastDebit&&(!Number.isSafeInteger(s.lastDebit.seq)||typeof s.lastDebit.ledger!=='string'||!s.lastDebit.actual||Object.values(s.lastDebit.actual).some(n=>!Number.isFinite(n)||n<0)))return false;return true;
}
