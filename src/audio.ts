import type { WeaponKind } from './data.ts';
export type SoundCue='uiHover'|'uiClick'|'uiWarning'|'fail'|'hit'|'fire'|'pulse'|'rail'|'plasma'|'rocket'|'flak'|'emp'|'mine'|'impact'|'shield'|'explosion'|'collect'|'boost'|'build'
  |'railCharge'|'lock'|'drone'|'alert'|'bossWarning'|'bossPhase'|'bossDown'|'surge'|'empCharge'|'moduleLost'|'hull'|'death'|'hordeAlarm';
/**
 * One synthesized voice per cue: an oscillator sweeping start -> (peak) -> end over `duration`.
 * `noise` mixes in a filtered noise burst (thumps, hiss, crunch) at `noiseTone` Hz; `repeat` plays
 * the tone several times `every` seconds apart (alarms, lock beeps); `gap` is the minimum time
 * between two plays of the same cue. Gains stay at or below 0.15 so nothing dominates the mix.
 */
export type SoundProfile={start:number;end:number;duration:number;wave:OscillatorType;gain:number;peak?:number;noise?:number;noiseTone?:number;repeat?:number;every?:number;gap?:number};
export const SOUND_PROFILES:Record<SoundCue,SoundProfile>={
  uiHover:{start:780,end:1080,duration:.045,wave:'sine',gain:.025,gap:.09},
  uiClick:{start:1050,end:520,duration:.085,wave:'triangle',gain:.07,gap:.07},
  uiWarning:{start:420,end:250,duration:.16,wave:'triangle',gain:.065,gap:.15},
  fail:{start:220,end:120,duration:.12,wave:'triangle',gain:.05},hit:{start:440,end:85,duration:.09,wave:'triangle',gain:.12},
  fire:{start:740,end:170,duration:.07,wave:'square',gain:.045},pulse:{start:1300,end:420,duration:.11,wave:'sine',gain:.08},
  rail:{start:240,peak:1600,end:55,duration:.25,wave:'sawtooth',gain:.085,noise:.04,noiseTone:3000},plasma:{start:160,end:42,duration:.3,wave:'triangle',gain:.12},
  rocket:{start:130,end:32,duration:.28,wave:'sawtooth',gain:.08,noise:.05,noiseTone:1800},flak:{start:360,end:60,duration:.12,wave:'square',gain:.06,noise:.03,noiseTone:900},emp:{start:110,peak:850,end:230,duration:.4,wave:'sine',gain:.1},
  mine:{start:260,end:310,duration:.12,wave:'triangle',gain:.025},impact:{start:100,end:30,duration:.14,wave:'sawtooth',gain:.1},
  shield:{start:720,end:180,duration:.16,wave:'sine',gain:.08},explosion:{start:80,end:18,duration:.32,wave:'sawtooth',gain:.11,noise:.08,noiseTone:700},
  collect:{start:600,end:1050,duration:.1,wave:'sine',gain:.055,gap:.13},boost:{start:110,end:380,duration:.3,wave:'triangle',gain:.09},build:{start:390,end:780,duration:.18,wave:'sine',gain:.08},
  // Enemy and boss cues.
  railCharge:{start:180,end:1900,duration:1,wave:'sawtooth',gain:.045,gap:.5},lock:{start:1500,end:1500,duration:.06,wave:'square',gain:.045,repeat:3,every:.13,gap:.8},
  drone:{start:500,end:1400,duration:.16,wave:'triangle',gain:.06,gap:.3},alert:{start:880,end:1320,duration:.09,wave:'square',gain:.035,gap:1.5},
  bossWarning:{start:220,end:150,duration:.38,wave:'sawtooth',gain:.1,repeat:3,every:.46,gap:4},bossPhase:{start:90,peak:700,end:60,duration:.7,wave:'sawtooth',gain:.12,noise:.07,noiseTone:500,gap:1},
  bossDown:{start:70,end:14,duration:1.1,wave:'sawtooth',gain:.14,noise:.14,noiseTone:450,gap:1},surge:{start:400,end:900,duration:.3,wave:'sine',gain:.06,repeat:2,every:.28,gap:2},
  empCharge:{start:120,end:1200,duration:1.6,wave:'sine',gain:.06,gap:2},moduleLost:{start:300,end:50,duration:.22,wave:'square',gain:.09,noise:.07,noiseTone:1200,gap:.15},
  hordeAlarm:{start:560,end:380,duration:.3,wave:'square',gain:.085,repeat:2,every:.36,gap:1.2},
  hull:{start:150,end:40,duration:.16,wave:'sawtooth',gain:.11,noise:.06,noiseTone:600},death:{start:110,end:16,duration:1,wave:'sawtooth',gain:.14,noise:.14,noiseTone:500,gap:1},
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
  playWeapon(kind:WeaponKind,pitch=1,volume=1){this.play(kind==='cannon'?'fire':kind,pitch,volume);}
  private noise?:AudioBuffer;
  /** `pitch` scales every frequency (bigger ships sound deeper); `volume` 0-1 fades distant sources. */
  play(cue:SoundCue,pitch=1,volume=1){
    const c=this.context,s=SOUND_PROFILES[cue];if(!c||c.state!=='running'||this.muted||volume<=.02||this.voices>=14)return;
    const now=c.currentTime;if(now-(this.last[cue]??-10)<(s.gap??.07))return;this.last[cue]=now;
    const level=s.gain*Math.min(1,volume),release=(node:AudioScheduledSourceNode,...rest:AudioNode[])=>{this.voices++;node.onended=()=>{this.voices=Math.max(0,this.voices-1);node.disconnect();for(const r of rest)r.disconnect();};};
    for(let i=0;i<(s.repeat??1);i++){
      const at=now+i*(s.every??0),o=c.createOscillator(),gain=c.createGain();o.type=s.wave;o.frequency.setValueAtTime(s.start*pitch,at);
      if(s.peak)o.frequency.exponentialRampToValueAtTime(s.peak*pitch,at+.04);
      o.frequency.exponentialRampToValueAtTime(s.end*pitch,at+s.duration);
      gain.gain.setValueAtTime(.0001,at);gain.gain.exponentialRampToValueAtTime(level,at+.008);gain.gain.exponentialRampToValueAtTime(.0001,at+s.duration);
      o.connect(gain);gain.connect(this.effects!);release(o,gain);o.start(at);o.stop(at+s.duration+.01);
    }
    if(s.noise){
      // Shared white-noise buffer, band-limited per cue: launch hiss, explosion body, hull crunch.
      if(!this.noise){this.noise=c.createBuffer(1,c.sampleRate,c.sampleRate);const data=this.noise.getChannelData(0);let seed=1;for(let i=0;i<data.length;i++){seed=(seed*16807)%2147483647;data[i]=seed/1073741823.5-1;}}
      const source=c.createBufferSource(),filter=c.createBiquadFilter(),gain=c.createGain(),length=Math.min(1,s.duration*.8);
      source.buffer=this.noise;filter.type='lowpass';filter.frequency.setValueAtTime((s.noiseTone??1000)*pitch,now);filter.frequency.exponentialRampToValueAtTime(Math.max(60,(s.noiseTone??1000)*pitch*.25),now+length);
      gain.gain.setValueAtTime(s.noise*Math.min(1,volume),now);gain.gain.exponentialRampToValueAtTime(.0001,now+length);
      source.connect(filter);filter.connect(gain);gain.connect(this.effects!);release(source,filter,gain);source.start(now);source.stop(now+length+.01);
    }
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
