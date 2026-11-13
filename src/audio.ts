import type { WeaponKind } from './data.ts';
export type SoundCue='fail'|'hit'|'fire'|'pulse'|'rail'|'plasma'|'rocket'|'flak'|'emp'|'mine'|'impact'|'shield'|'explosion'|'collect'|'boost'|'build';
export const SOUND_PROFILES:Record<SoundCue,{start:number;end:number;duration:number;wave:OscillatorType;gain:number;peak?:number}>={
  fail:{start:220,end:120,duration:.12,wave:'triangle',gain:.05},hit:{start:440,end:85,duration:.09,wave:'triangle',gain:.12},
  fire:{start:740,end:170,duration:.07,wave:'square',gain:.045},pulse:{start:1300,end:420,duration:.11,wave:'sine',gain:.08},
  rail:{start:240,peak:1600,end:55,duration:.25,wave:'sawtooth',gain:.085},plasma:{start:160,end:42,duration:.3,wave:'triangle',gain:.12},
  rocket:{start:130,end:32,duration:.28,wave:'sawtooth',gain:.08},flak:{start:360,end:60,duration:.12,wave:'square',gain:.06},emp:{start:110,peak:850,end:230,duration:.4,wave:'sine',gain:.1},
  mine:{start:260,end:310,duration:.12,wave:'triangle',gain:.025},impact:{start:100,end:30,duration:.14,wave:'sawtooth',gain:.1},
  shield:{start:720,end:180,duration:.16,wave:'sine',gain:.08},explosion:{start:80,end:18,duration:.32,wave:'sawtooth',gain:.11},
  collect:{start:600,end:1050,duration:.1,wave:'sine',gain:.055},boost:{start:110,end:380,duration:.3,wave:'triangle',gain:.09},build:{start:390,end:780,duration:.18,wave:'sine',gain:.08},
};
export class GameAudio{
  muted=false;masterVolume=.85;effectsVolume=.9;musicVolume=.45;
  private track?:HTMLAudioElement;private music?:GainNode;
  private context?:AudioContext;private master?:GainNode;private effects?:GainNode;
  private last:Partial<Record<SoundCue,number>>={};private voices=0;
  private loops=new Map<'mine'|'tractor',{nodes:OscillatorNode[];gain:GainNode}>();
  constructor(){try{const settings=JSON.parse(localStorage.getItem('voidforge.audio')??'null');if(settings){this.masterVolume=Math.max(0,Math.min(1,settings.master??.85));this.effectsVolume=Math.max(0,Math.min(1,settings.effects??.9));this.musicVolume=Math.max(0,Math.min(1,settings.music??.45));this.muted=Boolean(settings.muted);}}catch{/* Defaults work without storage. */}
    if(typeof document!=='undefined')document.addEventListener('visibilitychange',()=>{if(document.hidden)this.track?.pause();else this.startMusic();});
  }
  unlock(){
    if(!this.context){if(typeof AudioContext==='undefined')return;this.context=new AudioContext();this.master=this.context.createGain();this.effects=this.context.createGain();this.effects.connect(this.master);
      this.music=this.context.createGain();this.music.connect(this.master);
      this.track=new Audio(new URL('./Deep Space Patrol.mp3',import.meta.url).href);this.track.loop=true;this.track.preload='none';
      this.context.createMediaElementSource(this.track).connect(this.music);const limiter=this.context.createDynamicsCompressor();limiter.threshold.value=-10;limiter.ratio.value=4;this.master.connect(limiter);limiter.connect(this.context.destination);this.applyVolumes();}
    if(this.context.state!=='running')void this.context.resume().then(()=>this.startMusic()).catch(()=>{});
    else this.startMusic();
  }
  private startMusic(){if(this.track&&this.track.paused&&!document.hidden&&!this.muted&&this.musicVolume>0)void this.track.play().catch(()=>{});}
  private applyVolumes(){if(this.context&&this.master&&this.effects){this.master.gain.setTargetAtTime(this.muted?0:this.masterVolume,this.context.currentTime,.03);this.effects.gain.setTargetAtTime(this.effectsVolume,this.context.currentTime,.03);this.music?.gain.setTargetAtTime(this.musicVolume,this.context.currentTime,.03);if(this.muted||this.musicVolume===0)this.track?.pause();else this.startMusic();}}
  setVolume(kind:'master'|'effects'|'music',value:number){if(kind==='master')this.masterVolume=Math.max(0,Math.min(1,value));else if(kind==='effects')this.effectsVolume=Math.max(0,Math.min(1,value));else this.musicVolume=Math.max(0,Math.min(1,value));this.applyVolumes();this.persist();}
  private persist(){try{localStorage.setItem('voidforge.audio',JSON.stringify({master:this.masterVolume,effects:this.effectsVolume,music:this.musicVolume,muted:this.muted}));}catch{/* Volume controls still work. */}}
  toggleMute(){this.muted=!this.muted;if(this.muted){this.setLoop('mine',0);this.setLoop('tractor',0);}this.applyVolumes();this.persist();}
  playWeapon(kind:WeaponKind){this.play(kind==='cannon'?'fire':kind);}
  play(cue:SoundCue){
    const c=this.context;if(!c||c.state!=='running'||this.muted||this.voices>=14)return;
    const now=c.currentTime;if(now-(this.last[cue]??-10)<(cue==='collect'?.13:.07))return;this.last[cue]=now;
    const s=SOUND_PROFILES[cue],o=c.createOscillator(),gain=c.createGain();this.voices++;o.type=s.wave;o.frequency.setValueAtTime(s.start,now);
    if(s.peak)o.frequency.exponentialRampToValueAtTime(s.peak,now+.04);
    o.frequency.exponentialRampToValueAtTime(s.end,now+s.duration);
    gain.gain.setValueAtTime(.0001,now);gain.gain.exponentialRampToValueAtTime(s.gain,now+.008);gain.gain.exponentialRampToValueAtTime(.0001,now+s.duration);
    o.connect(gain);gain.connect(this.effects!);o.start(now);o.stop(now+s.duration+.01);o.onended=()=>{this.voices=Math.max(0,this.voices-1);o.disconnect();gain.disconnect();};
  }
  setLoop(kind:'mine'|'tractor',count:number){
    const c=this.context;if(!c||c.state!=='running')return;
    const old=this.loops.get(kind);
    if(count<=0||this.muted){if(old){old.gain.gain.setTargetAtTime(.0001,c.currentTime,.035);for(const o of old.nodes)o.stop(c.currentTime+.16);this.loops.delete(kind);}return;}
    let loop=old;
    if(!loop){const gain=c.createGain();gain.gain.value=0;gain.connect(this.effects!);const nodes=[c.createOscillator(),c.createOscillator()];nodes.forEach((o,i)=>{o.type=kind==='mine'&&i===0?'triangle':'sine';o.frequency.value=(kind==='mine'?170:95)*(i===0?1:kind==='mine'?3:2);o.connect(gain);o.start();});let ended=0;for(const o of nodes)o.onended=()=>{o.disconnect();if(++ended===nodes.length)gain.disconnect();};loop={gain,nodes};this.loops.set(kind,loop);}
    loop.gain.gain.setTargetAtTime((kind==='mine'?.014:.012)*Math.min(2.5,Math.sqrt(count)),c.currentTime,.07);
  }
}
