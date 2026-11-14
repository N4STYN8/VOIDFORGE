export type MusicState='menu'|'boss'|'pvp'|'pve'|'station'|'mining'|'exploration';
export type MusicSignals={menu:boolean;station?:boolean;mining?:boolean;pve?:boolean;pvp?:boolean;boss?:boolean;paused?:boolean};
export function musicFade(from:MusicState,to:MusicState,rotation=false){if(rotation)return 8;if(from==='menu'||to==='menu')return 4;if(to==='boss'||to==='pvp')return 1;if(to==='pve')return 1.5;return 6;}
export class MusicStateController{
 state:MusicState='menu';private pve=0;private pvp=0;private mine=0;private idle=15;private mining=false;
 reset(){this.pve=this.pvp=this.mine=0;this.idle=15;this.mining=false;}
 update(dt:number,s:MusicSignals):MusicState{
  dt=Math.max(0,Math.min(1,dt));if(s.menu){this.reset();return this.state='menu';}if(s.paused)return this.state;
  this.pve=s.pve?12:Math.max(0,this.pve-dt);this.pvp=s.pvp?15:Math.max(0,this.pvp-dt);
  if(s.mining){this.mine+=dt;this.idle=0;if(this.mine>=5)this.mining=true;}else{this.idle+=dt;if(!this.mining)this.mine=0;if(this.idle>=15){this.mining=false;this.mine=0;}}
  return this.state=s.boss?'boss':this.pvp>0?'pvp':this.pve>0?'pve':s.station?'station':this.mining?'mining':'exploration';
 }
}
export class ShuffleTracks{
 private bags=new Map<string,string[]>();private last=new Map<string,string>();
 private random:()=>number;
 constructor(random= Math.random){this.random=random;}
 next(category:string,tracks:readonly string[]){if(!tracks.length)return undefined;let bag=this.bags.get(category)?.filter(t=>tracks.includes(t));if(!bag?.length){bag=[...tracks];for(let i=bag.length-1;i>0;i--){const j=Math.floor(this.random()*(i+1));[bag[i],bag[j]]=[bag[j],bag[i]];}if(bag.length>1&&bag.at(-1)===this.last.get(category)){[bag[0],bag[bag.length-1]]=[bag[bag.length-1],bag[0]];}}const next=bag.pop()!;this.bags.set(category,bag);this.last.set(category,next);return next;}
}
/** Equal-power interpolation, also valid when interrupting a previous fade. */
export function musicEnvelope(from:number,to:number,t:number){const a=Math.min(1,Math.max(0,t))*Math.PI/2;return Math.sqrt(from*from*Math.cos(a)**2+to*to*Math.sin(a)**2);}
