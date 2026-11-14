import {mkdirSync,readFileSync,writeFileSync,renameSync,existsSync} from 'node:fs';
import {dirname} from 'node:path';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {CREW,CREW_RANK,type CrewRole,type CrewMember,type CrewInvite,type CrewLogEntry,type CrewClientState,type CrewResult} from '../src/crewProtocol.ts';
import type {Minerals} from '../src/economy.ts';
import type {WorldRef,ShipState} from '../src/netProtocol.ts';
export type CrewRecord={id:string;name:string;revision:number;members:CrewMember[];resources:Minerals;log:CrewLogEntry[];outposts?:unknown[]};
type Receipt={fingerprint:string;response:CrewResult};
type PilotRecord={id:string;name:string;credentialHash:string;receipts:Record<string,Receipt>};
type Database={version:1;pilots:Record<string,PilotRecord>;crews:Record<string,CrewRecord>;invites:Record<string,CrewInvite&{to:string}>};
export type CrewCommandContext={world?:WorldRef;ship?:ShipState;requestId:string;now:number};
export type CrewStoreOptions={path?:string;command?:(crew:CrewRecord,pilotId:string,action:string,data:unknown,context:CrewCommandContext)=>unknown;view?:(crew:CrewRecord,context:Partial<CrewCommandContext>)=>unknown};
export class CrewStore{
 private db:Database={version:1,pilots:{},crews:{},invites:{}};private options:CrewStoreOptions;
 constructor(options:CrewStoreOptions={}){this.options=options;if(options.path&&existsSync(options.path)){const data=JSON.parse(readFileSync(options.path,'utf8'));if(data.version!==1||!data.pilots||!data.crews||!data.invites)throw Error('Invalid crew persistence file; refusing to overwrite it.');this.db=data;}}
 private persist(){if(!this.options.path)return;mkdirSync(dirname(this.options.path),{recursive:true});const temp=this.options.path+'.tmp';writeFileSync(temp,JSON.stringify(this.db),{mode:0o600});renameSync(temp,this.options.path);}
 private hash(value:string){return createHash('sha256').update(value).digest('hex');}
 authenticate(credential:string|undefined,name:string){if(credential){const hash=this.hash(credential);const pilot=Object.values(this.db.pilots).find(p=>p.credentialHash===hash);if(!pilot)throw Error('Crew identity was not recognized. Restore the original pilot credential.');if(pilot.name!==name){const old=structuredClone(this.db);pilot.name=name;for(const c of Object.values(this.db.crews)){const m=c.members.find(m=>m.pilotId===pilot.id);if(m)m.name=name;}try{this.persist();}catch(e){this.db=old;throw e;}}return {pilotId:pilot.id,credential};}
  credential=randomBytes(32).toString('hex');const id=randomUUID();this.db.pilots[id]={id,name,credentialHash:this.hash(credential),receipts:{}};try{this.persist();}catch(e){delete this.db.pilots[id];throw e;}return {pilotId:id,credential};
 }
 crewOf(pilotId:string){return Object.values(this.db.crews).find(c=>c.members.some(m=>m.pilotId===pilotId));}
 sameCrew(a:string|undefined,b:string|undefined){if(!a||!b)return false;const crew=this.crewOf(a);return Boolean(crew?.members.some(m=>m.pilotId===b));}
 snapshot(pilotId:string,online:{pilotId:string;name:string;socketId:string}[],context:Partial<CrewCommandContext>={}):CrewClientState{
  const crew=this.crewOf(pilotId),now=Date.now();return {pilotId,crew:crew?{id:crew.id,name:crew.name,revision:crew.revision,members:crew.members.map(m=>({...m,online:online.some(p=>p.pilotId===m.pilotId),socketIds:online.filter(p=>p.pilotId===m.pilotId).map(p=>p.socketId)})),resources:{...crew.resources},log:structuredClone(crew.log.slice(-100))}:undefined,invitations:Object.values(this.db.invites).filter(i=>i.to===pilotId&&i.expires>now&&this.db.crews[i.crewId]).map(({to,...invite})=>({...invite,crewName:this.db.crews[invite.crewId].name})),onlinePilots:online.slice(0,100),crewPeerIds:crew?online.filter(p=>p.pilotId!==pilotId&&crew.members.some(m=>m.pilotId===p.pilotId)).map(p=>p.socketId):[],outpostView:crew?this.options.view?.(crew,context):undefined};
 }
 execute(pilotId:string,requestId:string,action:string,input:unknown,context:Partial<CrewCommandContext>={}):CrewResult{
  const pilot=this.db.pilots[pilotId];if(!pilot)return {requestId,ok:false,error:'Authenticate your crew identity first.'};const fingerprint=this.hash(JSON.stringify({action,input}));const previous=Object.hasOwn(pilot.receipts,requestId)?pilot.receipts[requestId]:undefined;if(previous)return previous.fingerprint===fingerprint?structuredClone(previous.response):{requestId,ok:false,error:'Request ID was already used for another action.'};
  const before=this.db;this.db=structuredClone(before);let response:CrewResult;
  try{const result=this.apply(pilotId,action,input,{...context,requestId,now:Date.now()});response=JSON.parse(JSON.stringify({requestId,ok:true,result}));const crew=this.crewOf(pilotId);if(crew){crew.revision++;crew.log=crew.log.slice(-200);}}
  catch(error){this.db=structuredClone(before);response={requestId,ok:false,error:error instanceof Error?error.message:'Crew command failed.'};}
  Object.defineProperty(this.db.pilots[pilotId].receipts,requestId,{value:{fingerprint,response},enumerable:true,writable:true,configurable:true});
  try{this.persist();return response;}catch(error){this.db=before;throw error;}

 }
 private apply(pilotId:string,action:string,input:unknown,context:CrewCommandContext):unknown{
  const data=(input&&typeof input==='object'?input:{}) as Record<string,unknown>,pilot=this.db.pilots[pilotId];let crew=this.crewOf(pilotId);const member=crew?.members.find(m=>m.pilotId===pilotId);const text=(value:unknown)=>typeof value==='string'?value.replace(/[<>\x00-\x1f]/g,'').trim():'';
  const log=(c:CrewRecord,message:string)=>c.log.push({id:randomUUID(),at:context.now,pilotId,action,message});
  if(action==='create'){if(crew)throw Error('Leave your existing crew first.');const name=text(data.name);if(!name||name.length>CREW.maxName)throw Error('Crew name must be 1–32 characters.');crew={id:randomUUID(),name,revision:0,members:[{pilotId,name:pilot.name,role:'owner',joined:context.now}],resources:{iron:0,copper:0,crystal:0,ice:0,radioactive:0},log:[]};this.db.crews[crew.id]=crew;log(crew,'Crew created.');return {crewId:crew.id};}
  if(action==='accept'||action==='decline'){const invitation=this.db.invites[text(data.inviteId)];if(!invitation||invitation.to!==pilotId||invitation.expires<=context.now)throw Error('Invitation is no longer available.');if(action==='decline'){delete this.db.invites[invitation.id];return;}
   if(crew)throw Error('You can belong to only one crew.');const invited=this.db.crews[invitation.crewId];if(!invited)throw Error('Crew no longer exists.');if(invited.members.length>=CREW.maxMembers)throw Error('Crew already has ten members.');invited.members.push({pilotId,name:pilot.name,role:'member',joined:context.now});invited.revision++;log(invited,'Member joined.');for(const [id,i]of Object.entries(this.db.invites))if(i.to===pilotId)delete this.db.invites[id];return;
  }
  if(!crew||!member)throw Error('Join a crew first.');
  if(action==='leave'){if(member.role==='owner')throw Error('Transfer ownership or explicitly disband before leaving.');crew.members=crew.members.filter(m=>m!==member);crew.revision++;log(crew,'Member left.');return;}
  if(action==='rename'){if(member.role!=='owner')throw Error('Only the crew owner can rename it.');const name=text(data.name);if(!name||name.length>CREW.maxName)throw Error('Crew name must be 1–32 characters.');crew.name=name;log(crew,'Crew renamed.');return;}
  if(action==='invite'){if(CREW_RANK[member.role]<1)throw Error('Only moderators, admins and the owner may invite.');const to=text(data.pilotId);if(!Object.hasOwn(this.db.pilots,to)||to===pilotId)throw Error('Choose a valid pilot.');if(this.crewOf(to))throw Error('Pilot already belongs to a crew.');if(crew.members.length>=CREW.maxMembers)throw Error('Crew already has ten members.');let invitation=Object.values(this.db.invites).find(i=>i.to===to&&i.crewId===crew!.id&&i.expires>context.now);if(!invitation){invitation={id:randomUUID(),crewId:crew.id,crewName:crew.name,from:pilotId,to,at:context.now,expires:context.now+CREW.inviteLifetime};this.db.invites[invitation.id]=invitation;}log(crew,'Pilot invited.');return {inviteId:invitation.id};}
  if(action==='kick'||action==='role'||action==='transferOwner'){
   const target=crew.members.find(m=>m.pilotId===data.pilotId);if(!target||target===member)throw Error('Choose another crew member.');if(action==='transferOwner'){if(member.role!=='owner')throw Error('Only the owner can transfer ownership.');member.role='admin';target.role='owner';log(crew,'Ownership transferred.');return;}
   if(CREW_RANK[member.role]<=CREW_RANK[target.role])throw Error('You cannot manage a member of equal or higher rank.');
   if(action==='kick'){if(CREW_RANK[member.role]<1)throw Error('Members cannot kick players.');crew.members=crew.members.filter(m=>m!==target);log(crew,'Member removed.');return;}
   const role=data.role as CrewRole;if(!['member','moderator','admin'].includes(role))throw Error('Invalid role.');if(role==='admin'&&member.role!=='owner')throw Error('Only the owner may appoint admins.');if(CREW_RANK[member.role]<2||CREW_RANK[role]>=CREW_RANK[member.role])throw Error('You cannot assign this role.');target.role=role;log(crew,'Member role changed.');return;
  }
  if(action==='disband'){if(member.role!=='owner')throw Error('Only the owner can disband a crew.');if(Object.values(crew.resources).some(n=>n>0)||crew.outposts?.some(record=>((record as {state?:{outposts?:unknown[]}}).state?.outposts?.length??0)>0))throw Error('Withdraw crew resources and remove or transfer outposts before disbanding.');delete this.db.crews[crew.id];for(const[id,i]of Object.entries(this.db.invites))if(i.crewId===crew.id)delete this.db.invites[id];return;}
  if(this.options.command)return this.options.command(crew,pilotId,action,input,context);
  throw Error('Crew command is not supported.');
 }
 inspectCrews(reader:(crew:CrewRecord)=>void){for(const crew of Object.values(this.db.crews))reader(crew);}
 /** Server automation runs against the same durable transaction boundary as member requests. */
 systemUpdate(update:(crews:CrewRecord[])=>boolean){const before=this.db;this.db=structuredClone(before);try{if(!update(Object.values(this.db.crews))){this.db=before;return false;}this.persist();return true;}catch(error){this.db=before;throw error;}}
}
