import type {Minerals} from './economy.ts';
export const CREW={version:1,maxMembers:10,maxName:32,inviteLifetime:7*24*60*60*1000} as const;
export type CrewRole='owner'|'admin'|'moderator'|'member';
export const CREW_RANK:Record<CrewRole,number>={owner:3,admin:2,moderator:1,member:0};
export type CrewMember={pilotId:string;name:string;role:CrewRole;joined:number;online?:boolean;socketIds?:string[]};
export type CrewInvite={id:string;crewId:string;crewName:string;from:string;at:number;expires:number};
export type CrewLogEntry={id:string;at:number;pilotId:string;action:string;minerals?:Minerals;message?:string};
export type CrewView={id:string;name:string;revision:number;members:CrewMember[];resources:Minerals;log:CrewLogEntry[]};
export type CrewClientState={pilotId:string;crew?:CrewView;invitations:CrewInvite[];onlinePilots:{pilotId:string;name:string;socketId:string}[];crewPeerIds:string[];outpostView?:unknown};
export type CrewResult={requestId:string;ok:boolean;error?:string;result?:unknown};
export type CrewRequest={t:'crew';requestId:string;action:string;data:unknown};
export function validCrewRequest(value:Record<string,unknown>):value is Record<string,unknown>&CrewRequest{return typeof value.requestId==='string'&&/^[a-zA-Z0-9._:-]{1,100}$/.test(value.requestId)&&typeof value.action==='string'&&/^[a-zA-Z][a-zA-Z0-9-]{0,50}$/.test(value.action);}

/** Reject malformed snapshots before they reach UI/permission code. Outpost payloads have their own codec. */
export function readCrewClientState(value:unknown):CrewClientState|undefined{
 const s=value as CrewClientState;if(!s||typeof s!=='object'||typeof s.pilotId!=='string'||!Array.isArray(s.invitations)||s.invitations.length>1000||!Array.isArray(s.onlinePilots)||s.onlinePilots.length>100||!Array.isArray(s.crewPeerIds)||s.crewPeerIds.length>100||!s.crewPeerIds.every(id=>typeof id==='string'))return;
 if(!s.onlinePilots.every(p=>p&&typeof p.pilotId==='string'&&typeof p.name==='string'&&typeof p.socketId==='string')||!s.invitations.every(i=>i&&typeof i.id==='string'&&typeof i.crewId==='string'&&typeof i.crewName==='string'&&typeof i.from==='string'&&Number.isFinite(i.at)&&Number.isFinite(i.expires)))return;
 if(s.crew){const c=s.crew;if(typeof c.id!=='string'||typeof c.name!=='string'||!Number.isSafeInteger(c.revision)||!Array.isArray(c.members)||c.members.length>CREW.maxMembers||!c.members.length||!c.members.every(m=>m&&typeof m.pilotId==='string'&&typeof m.name==='string'&&Object.hasOwn(CREW_RANK,m.role)&&Number.isFinite(m.joined)&&(m.socketIds===undefined||Array.isArray(m.socketIds)&&m.socketIds.every(id=>typeof id==='string')))||c.members.filter(m=>m.role==='owner').length!==1||!c.resources||!['iron','copper','crystal','ice','radioactive'].every(ore=>Number.isSafeInteger(c.resources[ore as keyof Minerals])&&c.resources[ore as keyof Minerals]>=0)||!Array.isArray(c.log)||c.log.length>200||!c.log.every(l=>l&&typeof l.id==='string'&&typeof l.pilotId==='string'&&typeof l.action==='string'&&Number.isFinite(l.at)))return;}
 return s;
}
