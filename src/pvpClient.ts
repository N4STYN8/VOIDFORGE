import type {NetClient} from './net.ts';
import type {GameModel} from './model.ts';
import {MODULAR_PVP,MODULES} from './data.ts';
import {modulePoint,type CombatReceipt,type SalvageObject} from './pvpSalvage.ts';
/** Capability-gated relay adapter. Receipt marks are saved before acknowledgement, including retry outcomes. */
export class PvpClient{
 pending=false;note='';private inFlight=false;private at=-Infinity;private previous=0;private manifests=new WeakMap<GameModel,string>();private initialized=new WeakSet<GameModel>();
 private net:NetClient;private model:()=>GameModel;private save:(m:GameModel)=>Promise<string|undefined>;
 constructor(net:NetClient,model:()=>GameModel,save:(m:GameModel)=>Promise<string|undefined>){this.net=net;this.model=model;this.save=save;}
 frame(m:GameModel,now:number){const dt=Math.min(.1,Math.max(0,now-this.previous));this.previous=now;for(const o of m.salvageObjects){o.x+=o.vx*dt;o.y+=o.vy*dt;o.angle+=o.spin*dt;}
  if(!this.net.connected||!this.net.modularPvp||!this.net.pilotId){m.modularCombat=false;m.salvageLinks=[];m.salvageObjects=[];return;}
  const rows:{x:number;y:number;ids:string[]}[]=[],claimed=new Set<string>();m.salvageLinks=[];
  for(const module of m.operationalModules.filter(module=>!m.dead&&module.kind==='tractor')){const stats=MODULES.tractor.levels[module.level-1],source=modulePoint(m.player,module),free=Math.max(0,stats.targets!-(module.targetIds?.length??0));const objects=m.salvageObjects.filter(o=>!claimed.has(o.id)&&Math.hypot(o.x-source.x,o.y-source.y)<=stats.tractor!&&(o.module||m.cargoUsed<m.cargoCapacity)).sort((a,b)=>Math.hypot(a.x-source.x,a.y-source.y)-Math.hypot(b.x-source.x,b.y-source.y)).slice(0,free);
   if(!objects.length||!m.runSalvageTractor(module,dt))continue;rows.push({x:module.x,y:module.y,ids:objects.map(o=>o.id)});for(const o of objects){claimed.add(o.id);let hash=0;for(const char of o.id)hash=(hash*31+char.charCodeAt(0))|0;m.salvageLinks.push({from:source,to:{x:o.x,y:o.y},level:module.level,targetId:hash,moduleX:module.x,moduleY:module.y});}}
  if(this.inFlight||now-this.at<MODULAR_PVP.sync)return;this.at=now;this.inFlight=true;
  void this.exchange(m,rows).catch(error=>{this.manifests.delete(m);this.note=(error as Error).message;}).finally(()=>{this.inFlight=false;});
 }
 private async exchange(m:GameModel,tractors:{x:number;y:number;ids:string[]}[]){
  // Persist combat-life identity before the server can enqueue damage for it.
  if(!this.initialized.has(m)){if(!m.salvageState.life)m.salvageState.life=globalThis.crypto.randomUUID();const error=await this.save(m);if(error)throw Error(error);this.initialized.add(m);}
  this.pending=true;
  const fire=m.combatFire.splice(0,64);
  const ship=m.combatManifest(),signature=JSON.stringify(ship.modules);const report=this.manifests.get(m)===signature?{...ship,modules:undefined}:ship;
  const reply=await this.net.modularRequest('sync',{ship:report,worldSpec:report.modules?m.world.spec:undefined,fire,tractors}) as {ledger:string;events:CombatReceipt[];objects:SalvageObject[]};
  if(this.model()!==m)throw Error('Combat response belongs to the previous ship.');
  this.manifests.set(m,signature);m.modularCombat=true;
  if(typeof reply.ledger!=='string'||!Array.isArray(reply.events)||!Array.isArray(reply.objects))throw Error('Invalid combat ledger response.');
  m.salvageObjects=reply.objects;
  for(const event of reply.events){if(!Number.isSafeInteger(event.seq)||event.seq<1)throw Error('Invalid combat receipt.');const actual=m.applyCombatReceipt(reply.ledger,event);const error=await this.save(m);if(error)throw Error(error);await this.net.modularRequest('ack',{seq:event.seq,actual,removed:m.salvageState.lastDebit?.removed??[]});}
  this.pending=false;this.note='';
 }
}
