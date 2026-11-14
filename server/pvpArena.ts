import {readFileSync,writeFileSync,renameSync,mkdirSync,existsSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {MODULAR_PVP,MODULES,WEAPON_TYPES,RESOURCES,BASE_RADIUS,SHIP_SYSTEMS,MODULE_DURABILITY,WORLD,type Resource,type WeaponKind} from '../src/data.ts';
import {minerals,type Minerals} from '../src/economy.ts';
import {modulePoint,structuralHit,shipIntersection,readCombatShip,mineralTotal,type CombatReceipt,type CombatShip,type StructuralHit,type SalvageObject,type RecoveredModule} from '../src/pvpSalvage.ts';
import {createWorld} from '../src/world.ts';

type Pilot={room:string;ship:CombatShip;seq:number;acked:number;outbox:CombatReceipt[];combatAt:number};
type State={version:1;id:string;serial:number;pilots:Record<string,Pilot>;objects:Record<string,SalvageObject>};
type Shot={owner:string;room:string;x:number;y:number;vx:number;vy:number;life:number;damage:number;weapon:WeaponKind;level:number;travel:number;splash:number;ready?:number;homing?:number};
export type PvpContext={pose:(id:string)=>{room:string;x:number;y:number;vx:number;vy:number;angle:number;dead?:boolean}|undefined;allies:(a:string,b:string)=>boolean;members?:(room:string)=>string[];safe?:(room:string,p:{x:number;y:number})=>boolean;rock?:(room:string,start:{x:number;y:number},end:{x:number;y:number})=>number|undefined};
/** Server-owned shot validation, damage and finite salvage ledger. Personal save imports remain a documented trust boundary. */
export class PvpArena{
 private queuedHits:{attacker:string;victim:string;cell:{x:number;y:number;point?:{x:number;y:number}};damage:number;weapon:WeaponKind;level:number;now:number}[]=[];
 private state:State;private stable="";private shots:Shot[]=[];private lastFire=new Map<string,number>();private beams=new Map<string,{at:number;rows:{x:number;y:number;ids:string[]}[]}>();private worlds=new Map<string,ReturnType<typeof createWorld>>();private clock=0;
 private context:PvpContext;private path?:string;
 constructor(context:PvpContext,path?:string){this.context=context;this.path=path;this.state={version:1,id:randomUUID(),serial:0,pilots:{},objects:{}};if(path&&existsSync(path)){const s=JSON.parse(readFileSync(path,'utf8')) as State;if(s.version!==1||!s.id||!s.pilots||!s.objects)throw Error('Invalid PvP ledger.');this.state=s;}this.stable=JSON.stringify(this.state);}
 private save(){const text=JSON.stringify(this.state);try{if(this.path){mkdirSync(dirname(this.path),{recursive:true});const temp=this.path+'.tmp';writeFileSync(temp,text);renameSync(temp,this.path);}this.stable=text;}catch(error){this.state=JSON.parse(this.stable);throw error;}}
 private spec(room:string){let spec=this.worlds.get(room);if(!spec){spec=createWorld(room);this.worlds.set(room,spec);if(this.worlds.size>64)this.worlds.delete(this.worlds.keys().next().value!);}return spec;}
 private safe(room:string,p:{x:number;y:number}){if(this.context.safe)return this.context.safe(room,p);return this.spec(room).bases.some(b=>Math.hypot(b.x-p.x,b.y-p.y)<BASE_RADIUS);}
 private pose(id:string){const p=this.state.pilots[id],pose=this.context.pose(id);if(!p||!pose||pose.room!==p.room)return;if(pose.dead)p.ship.health=0;Object.assign(p.ship,{x:pose.x,y:pose.y,vx:pose.vx,vy:pose.vy,angle:pose.angle});return p;}
 private receipt(id:string,data:Omit<CombatReceipt,'seq'|'life'>){const p=this.state.pilots[id];if(!p)return;const r={...data,seq:++p.seq,life:p.ship.life};p.outbox.push(r);return r;}
 private id(){return this.state.id+':'+(++this.state.serial);}
 snapshot(id:string){const p=this.state.pilots[id],visible=this.pose(id);return{ledger:this.state.id,events:p?.outbox.slice(0,1)??[],objects:visible?Object.values(this.state.objects).filter(o=>o.room===p.room&&!o.pending&&Math.abs(o.x-p.ship.x)<MODULAR_PVP.snapshotRange&&Math.abs(o.y-p.ship.y)<MODULAR_PVP.snapshotRange).slice(0,MODULAR_PVP.roomSalvage):[]};}
 sync(id:string,room:string,raw:unknown,now:number){this.clock=now;const value=raw as Partial<CombatShip>;const existing=this.state.pilots[id];const ship=readCombatShip({...value,modules:value?.modules??(existing?.ship.life===value?.life?existing.ship.modules:undefined)});if(!ship)throw Error('Invalid ship manifest.');const old=this.state.pilots[id];
  if(old?.outbox.length)return this.snapshot(id);
  if(old&&old.ship.life!==ship.life&&!this.safe(room,ship))throw Error('Rebuild at a home station before starting a new combat life.');
  if(!old||old.ship.life!==ship.life){this.state.pilots[id]={room,ship,seq:old?.seq??0,acked:old?.acked??0,outbox:[],combatAt:-Infinity};this.save();}
  else {const locked=now-old.combatAt<MODULAR_PVP.combatLock&&!this.safe(room,ship);if(locked){
    // During combat a personal state report cannot repair/replace components or resurrect the core.
    ship.modules=old.ship.modules.map(m=>{const local=ship.modules.find(n=>n.x===m.x&&n.y===m.y&&n.kind===m.kind&&n.level===m.level);return{...m,ability:local?.ability??m.ability,integrity:Math.min(m.integrity,local?.integrity??m.integrity)};});ship.health=Math.min(old.ship.health,ship.health);ship.shield=Math.min(old.ship.shield,ship.shield);
   }old.room=room;old.ship=ship;}
  return this.snapshot(id);
 }
 /** Acknowledgement commits only minerals actually debited by the defender; replay never creates a second object. */
 ack(id:string,seq:number,actual:Partial<Minerals>={},removed:string[]=[]){const p=this.state.pilots[id];if(!p)return;const event=p.outbox[0];if(!event||event.seq!==seq)return;
  if(event.hit){const left=minerals();for(const ore of Object.keys(RESOURCES) as Resource[])left[ore]=Math.max(0,Math.min(event.hit.released[ore],Number.isFinite(actual[ore])?actual[ore]!:0));
   for(const draft of event.drafts??[]){const o=this.state.objects[draft];if(!o)continue;if(o.module&&!removed.includes(o.sourceCell??''))delete o.module;for(const ore of Object.keys(RESOURCES) as Resource[]){const n=Math.min(o.cargo[ore],left[ore]);o.cargo[ore]=n;left[ore]-=n;}delete o.pending;if(!o.module&&mineralTotal(o.cargo)<=0)delete this.state.objects[draft];}
  }
  if(event.pickup){let o=this.state.objects[event.pickup];for(const ore of Object.keys(RESOURCES) as Resource[]){const accepted=Number.isFinite(actual?.[ore])?Math.max(0,Math.min(event.cargo?.[ore]??0,actual[ore]!)):0,refund=Math.max(0,(event.cargo?.[ore]??0)-accepted);if(refund>0){if(!o&&event.pickupOrigin){o=structuredClone(event.pickupOrigin);o.cargo=minerals();delete o.module;delete o.pending;this.state.objects[o.id]=o;}if(o)o.cargo[ore]+=refund;p.ship.cargo[ore]=Math.max(0,p.ship.cargo[ore]-refund);}}}

  p.acked=seq;p.outbox.shift();this.save();
 }
 fire(id:string,x:number,y:number,angle:number,now:number){const p=this.pose(id);if(!p||p.outbox.length||p.ship.health<=0||this.safe(p.room,p.ship)||!Number.isFinite(angle))return false;
  const m=p.ship.modules.find(m=>m.x===x&&m.y===y&&!m.offline&&m.integrity>0),weapon=m&&MODULES[m.kind].weapon;if(!m||!weapon)return false;
  const stats=MODULES[m.kind].levels[m.level-1],type=WEAPON_TYPES[weapon],tag=id+':'+p.ship.life+':'+x+','+y;
  const fired=Math.max(now,(this.lastFire.get(tag)??-Infinity)+stats.cooldown!);if(fired>now+.25||weapon==='emp'&&fired>now+.001)return false;this.lastFire.set(tag,fired);
  const source=modulePoint(p.ship,m),count=type.pellets??1;
  if(this.shots.length+count>MODULAR_PVP.serverShots)return false;
  if(weapon==='emp'){if(fired>now+.001)return false;
   for(const [target,q]of Object.entries(this.state.pilots)){if(target===id||q.room!==p.room||this.context.allies(id,target)||q.outbox.length)continue;this.pose(target);if(this.safe(q.room,q.ship)||Math.hypot(q.ship.x-source.x,q.ship.y-source.y)>(stats.empRange??150))continue;const cells=q.ship.modules.map(m=>({m,point:modulePoint(q.ship,m)})).sort((a,b)=>Math.hypot(a.point.x-source.x,a.point.y-source.y)-Math.hypot(b.point.x-source.x,b.point.y-source.y));const cell=cells[0]?.m??{x:0,y:0};this.hit(id,target,cell,stats.damage??0,weapon,m.level,now);}return true;
  }
  for(let i=0;i<count;i++){const a=angle+(count>1?(i/(count-1)-.5)*type.spread:0);this.shots.push({owner:id,room:p.room,ready:fired,...source,vx:Math.cos(a)*type.speed,vy:Math.sin(a)*type.speed,life:1.1,travel:0,damage:stats.damage??0,weapon,level:m.level,splash:stats.splash??0});}return true;
 }
 private hit(attacker:string,victim:string,cell:{x:number;y:number;point?:{x:number;y:number}},damage:number,weapon:WeaponKind,level:number,now:number){const p=this.state.pilots[victim];if(!p||p.ship.health<=0||this.safe(p.room,p.ship)||this.context.allies(attacker,victim))return;if(p.outbox.length){if(this.queuedHits.length<MODULAR_PVP.maxQueuedHits)this.queuedHits.push({attacker,victim,cell,damage,weapon,level,now});return;}
  const result=structuralHit(p.ship,cell,damage,weapon,level);p.combatAt=now;const a=this.state.pilots[attacker];if(a)a.combatAt=now;
  const event=this.receipt(victim,{hit:result,drafts:[]})!;
  const create=(cargo:Minerals,module?:RecoveredModule,source?:{x:number;y:number})=>{const point=source,at=point?modulePoint(p.ship,point):result.point,angle=Math.atan2(at.y-p.ship.y,at.x-p.ship.x)+(this.state.serial%3-1)*.12;const id=this.id();this.state.objects[id]={id,owner:victim,room:p.room,x:at.x,y:at.y,vx:p.ship.vx*.5+Math.cos(angle)*MODULAR_PVP.drift,vy:p.ship.vy*.5+Math.sin(angle)*MODULAR_PVP.drift,angle,spin:MODULAR_PVP.spin*(this.state.serial%2?1:-1),expires:now+MODULAR_PVP.lifetime,cargo,module,sourceCell:source?`${source.x},${source.y}`:undefined,pending:event.seq};event.drafts!.push(id);};
  for(const m of result.detached)create(minerals(),{id:this.id(),kind:m.kind,level:m.level,integrity:Math.min(MODULE_DURABILITY[m.kind][m.level-1]*MODULAR_PVP.recoveredCondition,Math.max(0,m.integrity)),ability:m.ability?{...m.ability,active:0,phase:0,sustained:0}:undefined,invested:m.invested},m);
  if(mineralTotal(result.released)>0)create({...result.released});if(result.defeat)this.receipt(attacker,{kill:true});this.save();
 }
 tractors(id:string,rows:unknown,now:number){if(!Array.isArray(rows)||rows.length>399)return;this.beams.set(id,{at:now,rows:rows.filter(r=>r&&Number.isSafeInteger(r.x)&&Number.isSafeInteger(r.y)&&Array.isArray(r.ids)&&r.ids.length<=20&&r.ids.every((s:unknown)=>typeof s==='string'&&s.length<120))});}
 tick(dt:number,now:number){this.clock=now;dt=Math.max(0,Math.min(.1,dt));
  const pending=this.queuedHits;this.queuedHits=[];for(const h of pending)this.hit(h.attacker,h.victim,h.cell,h.damage,h.weapon,h.level,h.now);
  for(const shot of this.shots){if(shot.ready!==undefined&&now<shot.ready)continue;const p=this.pose(shot.owner);if(!p||p.room!==shot.room||p.ship.health<=0){shot.life=0;continue;}const end={x:shot.x+shot.vx*dt,y:shot.y+shot.vy*dt};let best:{id:string;hit:NonNullable<ReturnType<typeof shipIntersection>>}|undefined;
   for(const id of this.context.members?.(shot.room)??Object.keys(this.state.pilots)){const q=this.state.pilots[id];if(!q||id===shot.owner||q.room!==shot.room||q.ship.health<=0||this.context.allies(shot.owner,id)||!this.pose(id)||this.safe(q.room,q.ship))continue;const hit=shipIntersection(q.ship,shot,end);if(hit&&(!best||hit.t<best.hit.t))best={id,hit};}
   const rock=this.context.rock?.(shot.room,shot,end);if(rock!==undefined&&(!best||rock<=best.hit.t))shot.life=0;else if(best){this.hit(shot.owner,best.id,best.hit,shot.damage,shot.weapon,shot.level,now);shot.life=0;}
   shot.x=end.x;shot.y=end.y;shot.life-=dt;
  }this.shots=this.shots.filter(s=>s.life>0);
  for(const o of Object.values(this.state.objects)){if(o.pending)continue;o.x+=o.vx*dt;o.y+=o.vy*dt;o.angle+=o.spin*dt;if(o.x<0||o.x>WORLD.width){o.x=Math.max(0,Math.min(WORLD.width,o.x));o.vx*=-1;}if(o.y<0||o.y>WORLD.height){o.y=Math.max(0,Math.min(WORLD.height,o.y));o.vy*=-1;}}
  for(const [id,control]of this.beams){if(now-control.at>1){this.beams.delete(id);continue;}const p=this.pose(id);if(!p||p.outbox.length||p.ship.health<=0||now-control.at>1)continue;const claimed=new Set<string>();
   for(const row of control.rows){const m=p.ship.modules.find(m=>m.x===row.x&&m.y===row.y&&m.kind==='tractor'&&m.integrity>0&&!m.offline);if(!m)continue;const stats=MODULES.tractor.levels[m.level-1],source=modulePoint(p.ship,m);
    for(const target of row.ids.slice(0,stats.targets)){if(claimed.has(target))continue;claimed.add(target);const o=this.state.objects[target];if(!o||o.room!==p.room||o.pending)continue;const d=Math.hypot(o.x-source.x,o.y-source.y);if(d>stats.tractor!+32)continue;const move=Math.min(d,stats.pull!*dt);if(d>0){o.x+=(source.x-o.x)*move/d;o.y+=(source.y-o.y)*move/d;}if(d-move<=SHIP_SYSTEMS.collectionRadius){this.collect(id,o);if(p.outbox.length)break;}}
   }
  }
  const rooms=new Map<string,SalvageObject[]>();for(const o of Object.values(this.state.objects))if(!o.pending){const group=rooms.get(o.room)??[];group.push(o);rooms.set(o.room,group);}
  for(const active of rooms.values()){active.sort((a,b)=>a.expires-b.expires);for(let i=0;i<active.length;i++)if(active[i].expires<=now||active.length-i>MODULAR_PVP.roomSalvage){const o=active[i];this.receipt(o.owner,{cargo:{...o.cargo},module:o.module,target:'stored'});delete this.state.objects[o.id];this.save();}}
 }
 private collect(id:string,o:SalvageObject){const p=this.state.pilots[id];if(!p||p.outbox.length)return;const origin=structuredClone(o);const cap=SHIP_SYSTEMS.cargoCapacity+p.ship.modules.filter(m=>m.kind==='cargo'&&!m.offline&&m.integrity>0).reduce((n,m)=>n+(MODULES.cargo.levels[m.level-1].cargo??0),0);let room=Math.max(0,cap-mineralTotal(p.ship.cargo));const cargo=minerals();for(const ore of Object.keys(RESOURCES) as Resource[]){const n=Math.min(room,o.cargo[ore]);cargo[ore]=n;o.cargo[ore]-=n;p.ship.cargo[ore]+=n;room-=n;}const module=o.module;if(!module&&mineralTotal(cargo)<=0)return;delete o.module;this.receipt(id,{cargo,module,target:'cargo',pickup:o.id,pickupOrigin:{...origin,cargo:minerals(),module:undefined}});if(mineralTotal(o.cargo)<=0)delete this.state.objects[o.id];this.save();}
 /** For tests/inspection; mutations never enter through this API. */
 gateShip(id:string){const p=this.pose(id);if(!p)return;return {health:p.ship.health,blocks:[['core',0,0,p.ship.coreLevel],...p.ship.modules.map(m=>[m.kind,m.x,m.y,m.level])] as import('../src/netProtocol.ts').ShipBlock[]};}
 pendingReceipts(id:string){return Boolean(this.state.pilots[id]?.outbox.length);}
 hasPilot(id:string){return Boolean(this.state.pilots[id]);}
 inspect(){return structuredClone(this.state);}
}
