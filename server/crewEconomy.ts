import {MODULES,CORE,FLEET,REPAIR,upgradeCost,type ModuleKind,type EquipmentKind} from '../src/data.ts';
import {minerals,type Minerals} from '../src/economy.ts';
import type {CrewLogEntry} from '../src/crewProtocol.ts';
import type {CrewPurchaseIntent} from '../src/crewEconomyTypes.ts';
export const CREW_ORES=['iron','copper','crystal','ice','radioactive'] as const;
export function cleanMinerals(value:unknown):Minerals{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid mineral amount.');const out=minerals();for(const [key,n]of Object.entries(value)){if(!CREW_ORES.includes(key as any)||!Number.isSafeInteger(n)||n<0||n>1e9)throw Error('Mineral amounts must be whole positive units.');out[key as keyof Minerals]=n;}if(!Object.values(out).some(n=>n>0))throw Error('Choose at least one mineral.');return out;}
function integer(n:unknown,max=1e7){return Number.isSafeInteger(n)&&Number(n)>=0&&Number(n)<=max;}
export function crewPurchasePrice(value:unknown):Minerals{const p=value as CrewPurchaseIntent;if(!p||typeof p!=='object')throw Error('Invalid purchase.');if(p.kind==='install'){if(!(Object.hasOwn(MODULES,p.module))||!integer(Math.abs(p.x))||!integer(Math.abs(p.y)))throw Error('Invalid module purchase.');return {...MODULES[p.module].cost};}if(p.kind==='upgrade'){if(!(Object.hasOwn(MODULES,p.module))&&p.module!=='core'||!integer(p.level,4)||p.level<1||!integer(Math.abs(p.x))||!integer(Math.abs(p.y)))throw Error('Invalid module upgrade.');return upgradeCost(p.module,p.level);}if(p.kind==='ship'){if(!integer(p.hangar,10000))throw Error('Invalid hangar size.');const cost=minerals();for(const ore of CREW_ORES)cost[ore]=Math.ceil(FLEET.cost[ore]*(1+p.hangar*FLEET.growth));return cost;}if(p.kind==='repair'){if(!integer(Math.ceil(p.hull))||!integer(Math.ceil(p.integrity))||p.hull<0||p.integrity<0)throw Error('Invalid repair.');return minerals(Math.ceil((p.hull+p.integrity)*REPAIR.ironPerHull),Math.ceil(p.integrity*REPAIR.copperPerModule));}throw Error('That purchase cannot use crew resources.');}
type EconomyCrew={resources:Minerals;log:CrewLogEntry[]};
/** Runs inside CrewStore's clone/apply/persist transaction. Request dedupe belongs to the store. */
export function applyCrewEconomy(crew:EconomyCrew,pilotId:string,action:string,data:unknown,context?:{requestId?:string}){
 if(!['deposit','withdraw','purchase'].includes(action))return undefined;
 const value=data as {minerals?:unknown;intent?:unknown;source?:unknown};const amount=cleanMinerals(value?.minerals);
 if(action==='purchase'){const price=crewPurchasePrice(value.intent);if(CREW_ORES.some(ore=>amount[ore]>price[ore]))throw Error('Requested funding exceeds the server purchase price.');}
 if(action!=='deposit'&&CREW_ORES.some(ore=>crew.resources[ore]<amount[ore]))throw Error('Crew storage has insufficient minerals.');
 for(const ore of CREW_ORES){const next=crew.resources[ore]+(action==='deposit'?amount[ore]:-amount[ore]);if(!Number.isSafeInteger(next)||next<0)throw Error('Crew mineral balance limit exceeded.');}
 for(const ore of CREW_ORES)crew.resources[ore]+=action==='deposit'?amount[ore]:-amount[ore];
 crew.log.push({id:context?.requestId??crypto.randomUUID(),at:Date.now(),pilotId,action,minerals:{...amount},message:action==='purchase'?`Crew funding: ${(value.intent as CrewPurchaseIntent).kind}`:undefined});if(crew.log.length>200)crew.log.splice(0,crew.log.length-200);
 return {minerals:amount,intent:action==='purchase'?value.intent:undefined};
}
