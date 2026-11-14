import type {GameModel} from './model.ts';
import {minerals,type Minerals} from './economy.ts';
import type {CrewClientState,CrewResult} from './crewProtocol.ts';
import type {CrewPurchaseIntent} from './crewEconomyTypes.ts';
type Net={pilotId?:string;crewSupported?:boolean;crewState?:CrewClientState;crewRequest(action:string,data:unknown,requestId?:string):Promise<CrewResult>};
type Account='cargo'|'stored';
type Entry={id:string;action:string;data:Record<string,unknown>;amount:Minerals;source?:Account;target?:Account;intent?:CrewPurchaseIntent;phase:'staged'|'sent';result?:CrewResult};
const ores=['iron','copper','crystal','ice','radioactive'] as const;
function amount(value:Partial<Minerals>):Minerals{const out=minerals();for(const ore of ores){const n=value[ore]??0;if(!Number.isSafeInteger(n)||n<0)throw Error('Choose whole positive mineral amounts.');out[ore]=n;}if(!ores.some(ore=>out[ore]>0))throw Error('Choose minerals to transfer.');return out;}
/** Transfer journal and model receipt markers are independent: retries never re-credit a saved operation. */
export class CrewEconomy{
 enabled=false;busy=false;note='';private entries:Entry[]=[];private loaded?:string;private active?:GameModel;private retryAt=0;
 private net:Net;private model:()=>GameModel;private save:(model:GameModel)=>Promise<string|undefined>;
 constructor(net:Net,model:()=>GameModel,save:(model:GameModel)=>Promise<string|undefined>){this.net=net;this.model=model;this.save=save;try{this.enabled=localStorage.getItem('voidforge.crewFunding')==='true';}catch{}}
 setEnabled(enabled:boolean){this.enabled=enabled;try{localStorage.setItem('voidforge.crewFunding',String(enabled));}catch{}this.frame();}
 get pending(){return this.entries.length>0;}
 private key(){return `voidforge.crewEconomy.${this.net.pilotId}`;}
 private persist(){if(typeof localStorage==='undefined')throw Error('Persistent browser storage is required for crew transfers.');localStorage.setItem(this.key(),JSON.stringify(this.entries));}
 frame(){const m=this.model();if(this.active&&this.active!==m){this.active.crewPool={};this.active.crewFund=undefined;}this.active=m;
  if(this.loaded!==this.net.pilotId&&this.net.pilotId){this.loaded=this.net.pilotId;try{this.entries=JSON.parse(localStorage.getItem(this.key())??'[]');if(!Array.isArray(this.entries))this.entries=[];}catch{this.entries=[];this.note='Cannot read pending crew transfers.';}}
  m.crewPool=this.enabled?this.net.crewState?.crew?.resources??{}:{};m.crewFund=this.enabled&&this.net.crewSupported&&this.net.crewState?.crew?(intent,short)=>{if(this.pending){m.message='A crew transfer is already pending.';return;}void this.purchase(intent,short).catch(error=>{m.message=(error as Error).message;});}:undefined;
  if(this.pending&&!this.busy&&this.net.crewSupported&&Date.now()>=this.retryAt)void this.process();
 }
 deposit(source:Account,value:Partial<Minerals>){return this.transfer('deposit',{source},value,source);}
 withdraw(target:Account,value:Partial<Minerals>){return this.transfer('withdraw',{target},value,undefined,target);}
 purchase(intent:CrewPurchaseIntent,value:Partial<Minerals>){return this.transfer('purchase',{intent},value,undefined,'stored',intent);}
 /** Other authoritative services may use the same escrow journal for mineral transfers. */
 async transfer(action:string,data:Record<string,unknown>,value:Partial<Minerals>,source?:Account,target?:Account,intent?:CrewPurchaseIntent){
  if(!this.net.pilotId||!this.net.crewSupported||!this.net.crewState?.crew)throw Error('Connect to your crew first.');if(this.pending||this.busy)throw Error('A crew transfer is already pending.');
  const approved=amount(value),m=this.model();if(source&&ores.some(ore=>m[source][ore]<approved[ore]))throw Error('Insufficient personal minerals.');
  if(target==='cargo'&&Object.values(approved).reduce((n,x)=>n+x,0)>m.cargoCapacity-m.cargoUsed)throw Error('Not enough cargo space.');
  const entry:Entry={id:crypto.randomUUID(),action,data:{...data,minerals:approved},amount:approved,source,target,intent,phase:'staged'};this.entries=[entry];try{this.persist();}catch(error){this.entries=[];throw error;}await this.process();
 }
 private mark(m:GameModel,id:string,phase:'debited'|'applied'|'refunded'){const old=m.crewEconomyMarks.find(x=>x.id===id);if(old)old.phase=phase;else m.crewEconomyMarks.push({id,phase});}
 private execute(m:GameModel,intent:CrewPurchaseIntent){switch(intent.kind){case 'install':return m.installModule(intent.module,intent.x,intent.y);case 'upgrade':return m.upgradeModule(intent.x,intent.y);case 'ship':return m.buyShip();case 'repair':return m.repairShip();}}
 private async process(){if(this.busy||!this.entries.length)return;this.busy=true;const entry=this.entries[0],m=this.model();try{
  let mark=m.crewEconomyMarks.find(x=>x.id===entry.id);
  if(mark?.phase==='applied'||mark?.phase==='refunded'){const error=await this.save(m);if(error)throw Error(error);this.entries.shift();this.persist();return;}
  if(!mark){if(entry.phase==='sent')throw Error('Load the save that initiated this pending crew transfer before recovery.');if(entry.source&&ores.some(ore=>m[entry.source!][ore]<entry.amount[ore]))throw Error('Personal transfer funds are no longer available.');
   if(entry.source)for(const ore of ores)m[entry.source][ore]-=entry.amount[ore];this.mark(m,entry.id,'debited');const error=await this.save(m);if(error){if(entry.source)for(const ore of ores)m[entry.source][ore]+=entry.amount[ore];m.crewEconomyMarks=m.crewEconomyMarks.filter(x=>x.id!==entry.id);throw Error(error);}mark=m.crewEconomyMarks.find(x=>x.id===entry.id);
  }
  if(this.model()!==m)throw Error('Return to the save that started this transfer to complete recovery.');
  entry.phase='sent';this.persist();const reply=entry.result??await this.net.crewRequest(entry.action,entry.data,entry.id);entry.result=reply;this.persist();if(this.model()!==m)throw Error('Return to the save that started this transfer to complete recovery.');
  if(!reply.ok){if(entry.source)for(const ore of ores)m[entry.source][ore]+=entry.amount[ore];this.mark(m,entry.id,'refunded');const error=await this.save(m);if(error){if(entry.source)for(const ore of ores)m[entry.source][ore]-=entry.amount[ore];this.mark(m,entry.id,'debited');throw Error(error);}this.note=reply.error??'Crew transfer rejected.';}
  else{const delivered=(reply.result as {minerals?:Partial<Minerals>})?.minerals??entry.amount;
   for(const ore of ores)if(!Number.isSafeInteger(delivered[ore])||delivered[ore]!<0||delivered[ore]!>entry.amount[ore])throw Error('Invalid server mineral receipt.');
   if(entry.source)for(const ore of ores)m[entry.source][ore]+=entry.amount[ore]-delivered[ore]!;
   if(entry.target)for(const ore of ores){const n=delivered[ore]!;if(entry.target==='cargo'){const fit=Math.max(0,Math.min(n,m.cargoCapacity-m.cargoUsed));m.cargo[ore]+=fit;m.stored[ore]+=n-fit;}else m.stored[ore]+=n;}
   if(entry.intent){const hook=m.crewFund;m.crewFund=undefined;try{this.execute(m,entry.intent);}finally{m.crewFund=hook;}}this.mark(m,entry.id,'applied');const error=await this.save(m);if(error)throw Error(error);this.note='Crew transaction complete.';
  }
  this.entries.shift();this.persist();
 }catch(error){this.retryAt=Date.now()+3000;this.note=`${(error as Error).message} Pending transaction retained for safe retry.`;m.message=this.note;}finally{this.busy=false;}}
 dispose(){if(this.active){this.active.crewPool={};this.active.crewFund=undefined;}this.active=undefined;}
}
