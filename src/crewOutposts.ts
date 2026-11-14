import type {GameModel} from './model.ts';
import type {NetClient} from './net.ts';
import {OUTPOST,STRUCTURES,SHIP,DRONES,type StructureKind} from './data.ts';
import {cellCenter,outpostFor,outpostCenter,structureAt,type Outpost} from './outposts.ts';
import {encodeRock} from './shared.ts';
import {worldRef} from './sectors.ts';
import type {CrewResult} from './crewProtocol.ts';
type Net=Pick<NetClient,'crewSupported'|'crewState'|'pilotId'|'crewRequest'>;
type Pending={id:string;kind:'transfer'|'dock'|'claim';seed:string;source?:Outpost;outpostId:number;result?:CrewResult};
const sectorKey=(m:GameModel)=>{const w=worldRef(m);return JSON.stringify([w.home,w.x,w.y,w.seed]);};
/** Interactive server-owned copies: never inserted into model.outposts or locally simulated/saved. */
export class CrewOutpostClient{
 outposts:Outpost[]=[];note='';busy=false;private journal?:Pending;private loaded?:string;
 private net:Net;private model:()=>GameModel;private save:(m:GameModel)=>Promise<string|undefined>;private lastSync=0;private retryAt=0;private rockCursor=0;
 constructor(net:Net,model:()=>GameModel,save:(m:GameModel)=>Promise<string|undefined>){this.net=net;this.model=model;this.save=save;}
 get pending(){return Boolean(this.journal);}
 get available(){return Boolean(this.net.crewSupported&&this.net.crewState?.crew);}
 get crewLabel(){return this.net.crewState?.crew?.name??'Crew';}
 private key(){return `voidforge.crewOutposts.${this.net.pilotId}`;}
 private persist(){if(this.journal)localStorage.setItem(this.key(),JSON.stringify(this.journal));else localStorage.removeItem(this.key());}
 frame(){if(this.loaded!==this.net.pilotId&&this.net.pilotId){this.loaded=this.net.pilotId;try{this.journal=JSON.parse(localStorage.getItem(this.key())??'null')??undefined;}catch{this.note='Cannot read pending outpost transfer.';}}
  const view=this.net.crewState?.outpostView as {sectorKey?:string;outposts?:Outpost[]}|undefined;this.outposts=this.available&&view?.sectorKey===sectorKey(this.model())&&Array.isArray(view.outposts)?view.outposts:[];
  if(this.journal&&!this.busy&&this.net.crewSupported&&Date.now()>=this.retryAt)void this.recover();
  if(this.available&&Date.now()-this.lastSync>5000&&!this.busy){this.lastSync=Date.now();void this.net.crewRequest('outpost-sync',{rocks:this.miningBaseline()}).catch(()=>{});}
 }
 private miningBaseline(){const hangars=this.outposts.flatMap(o=>o.structures.filter(s=>STRUCTURES[s.kind].drones));if(!hangars.length)return [];const rocks=this.model().asteroids.filter(a=>hangars.some(h=>Math.hypot(a.x-cellCenter(h.cx),a.y-cellCenter(h.cy))<DRONES.range+a.radius));if(!rocks.length)return [];const result=[];let bytes=0;for(let i=0;i<Math.min(12,rocks.length);i++){const rock=rocks[this.rockCursor++%rocks.length],patch=encodeRock(rock,rock.id),size=JSON.stringify(patch).length;if(bytes+size>9000)break;result.push(patch);bytes+=size;}return result;}
 placeError(kind:StructureKind,cx:number,cy:number){const m=this.model();if(!this.available)return 'Connect to your crew first.';if(this.busy||this.pending)return 'Wait for the pending crew action.';const error=m.buildModeError;if(error)return error;if(!Number.isSafeInteger(cx)||!Number.isSafeInteger(cy))return 'Invalid grid cell.';
  const point={x:cellCenter(cx),y:cellCenter(cy)};if(Math.hypot(point.x-m.player.x,point.y-m.player.y)>m.builder!.range)return 'Out of construction range.';
  if(structureAt([...m.outposts,...this.outposts],cx,cy))return 'That cell is occupied.';if(m.bases.some(b=>Math.hypot(b.x-point.x,b.y-point.y)<OUTPOST.baseClearance))return 'Too close to a station.';
  if(m.asteroids.some(a=>Math.hypot(a.x-point.x,a.y-point.y)<a.radius+OUTPOST.cell/2))return 'An asteroid is in the way.';
  if(Math.hypot(point.x-m.player.x,point.y-m.player.y)<SHIP.radius+OUTPOST.cell/2)return 'Your ship is in the way.';
  if(kind!=='outpostCore'&&!outpostFor(this.outposts,cx,cy))return 'Attach to an existing crew outpost.';
 }
 private async command(action:string,data:Record<string,unknown>){if(!this.available)throw Error('Connect to your crew first.');if(this.pending||this.busy)throw Error('Wait for the pending crew action.');this.busy=true;try{const reply=await this.net.crewRequest(action,data);if(!reply.ok)throw Error(reply.error??'Crew action rejected.');this.note=String((reply.result as any)?.message??'Crew outpost updated.');return reply;}finally{this.busy=false;}}
 place(kind:StructureKind,cx:number,cy:number,rot=0){const error=this.placeError(kind,cx,cy);if(error)return Promise.reject(Error(error));return this.command('outpost-place',{kind,cx,cy,rot});}
 upgrade(outpostId:number,structureId:number){return this.command('outpost-upgrade',{outpostId,structureId});}
 repair(outpostId:number,structureId:number){return this.command('outpost-repair',{outpostId,structureId});}
 bankDeposit(outpostId:number,minerals:Record<string,number>){return this.command('outpost-bank-deposit',{outpostId,minerals});}
 bankWithdraw(outpostId:number,minerals:Record<string,number>){return this.command('outpost-bank-withdraw',{outpostId,minerals});}
 async claimPersonal(outpostId:number){await this.stage({id:crypto.randomUUID(),kind:'claim',seed:this.model().seed,outpostId});}
 async dock(outpostId:number){await this.stage({id:crypto.randomUUID(),kind:'dock',seed:this.model().seed,outpostId});}
 async transferPersonal(outpostId:number){const m=this.model(),source=m.outposts.find(o=>o.id===outpostId);if(!source)throw Error('Select your own personal outpost.');await this.stage({id:crypto.randomUUID(),kind:'transfer',seed:m.seed,outpostId,source:structuredClone(source)});}
 private async stage(entry:Pending){if(!this.available||this.pending||this.busy)throw Error('Connect to your crew and finish pending actions first.');this.journal=entry;try{this.persist();}catch(error){this.journal=undefined;throw error;}await this.recover();}
 private mark(m:GameModel,id:string,phase:'debited'|'applied'|'refunded'){const mark=m.crewEconomyMarks.find(x=>x.id===id);if(mark)mark.phase=phase;else m.crewEconomyMarks.push({id,phase});}
 private async recover(){if(this.busy||!this.journal)return;this.busy=true;const p=this.journal,m=this.model();try{if(m.seed!==p.seed)throw Error('Load the sector save that initiated this crew outpost action.');let mark=m.crewEconomyMarks.find(x=>x.id===p.id);
   if(mark?.phase==='applied'||mark?.phase==='refunded'){const error=await this.save(m);if(error)throw Error(error);this.journal=undefined;this.persist();return;}
   if(!mark){if(p.kind==='transfer')m.outposts=m.outposts.filter(o=>o.id!==p.outpostId);this.mark(m,p.id,'debited');const error=await this.save(m);if(error){if(p.source&&!m.outposts.some(o=>o.id===p.source!.id))m.outposts.push(structuredClone(p.source));m.crewEconomyMarks=m.crewEconomyMarks.filter(x=>x.id!==p.id);throw Error(error);}}
   const data=p.kind==='transfer'?{outpost:p.source}:{outpostId:p.outpostId,integrity:m.modules.map(x=>x.integrity)};p.result??=await this.net.crewRequest(p.kind==='transfer'?'outpost-transfer':p.kind==='claim'?'outpost-claim-personal':'outpost-dock',data,p.id);this.persist();
   if(!p.result.ok){if(p.source&&!m.outposts.some(o=>o.id===p.source!.id))m.outposts.push(structuredClone(p.source));this.mark(m,p.id,'refunded');this.note=p.result.error??'Crew outpost action rejected.';}
   else{const result=p.result.result as {personalOutpost?:Outpost;shipRepair?:{health:number;shield:number;modules:{x:number;y:number;integrity:number}[]}};if(result?.personalOutpost){const copy=structuredClone(result.personalOutpost),ids=new Map<number,number>();let next=Math.max(m.toSave().id,...m.outposts.flatMap(o=>[o.id,...o.structures.map(s=>s.id),...(o.drones??[]).map(d=>d.id)]))+1;copy.id=next++;for(const s of copy.structures){const old=s.id;s.id=next++;ids.set(old,s.id);}for(const d of copy.drones??[]){d.id=next++;d.hangar=ids.get(d.hangar)!;}m.outposts.push(copy);(m as any).id=next;}if(result?.shipRepair){m.player.health=Math.min(m.maxHealth,result.shipRepair.health);m.shield=Math.min(m.maxShield,result.shipRepair.shield);for(const repair of result.shipRepair.modules??[]){const block=m.modules.find(b=>b.x===repair.x&&b.y===repair.y);if(block)block.integrity=Math.min(m.moduleMaxIntegrity(block),repair.integrity);}}this.mark(m,p.id,'applied');this.note=p.kind==='transfer'?'Outpost now belongs to your crew.':p.kind==='claim'?'Crew outpost reclaimed as your personal outpost.':'Crew dock repairs completed.';}
   const error=await this.save(m);if(error)throw Error(error);this.journal=undefined;this.persist();
  }catch(error){this.retryAt=Date.now()+3000;this.note=`${(error as Error).message} Pending action retained for safe retry.`;m.message=this.note;}finally{this.busy=false;}}
}
