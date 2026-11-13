import type { WeaponKind } from './data.ts';
export type SoundCue='shieldReady'|'deposit'|'depositHeavy'|'pickupHeavy'|'dock'|'cargoLoad'|'moduleInstall'|'moduleUpgrade'|'upgradeUltimate'|'moduleMove'|'moduleRemove'|'repair'|'outfitterOpen'|'outfitterClose'|'shieldDown'|'lowEnergy'|'overheat'|'reactorOverdrive'|'overclock'|'warp'|'coolingSurge'|'fortress'|'aegis'|'vortex'|'excavator'|'respawn'|'constructionDone'|'structureHit'|'uiOpen'|'uiConfirm'|'uiCancel'|'uiLaunch'|'ultimate'|'uiHover'|'uiClick'|'uiWarning'|'fail'|'hit'|'fire'|'pulse'|'rail'|'plasma'|'rocket'|'flak'|'emp'|'mine'|'impact'|'shield'|'explosion'|'collect'|'boost'|'build'
  |'railCharge'|'lock'|'drone'|'alert'|'bossWarning'|'bossPhase'|'bossDown'|'surge'|'empCharge'|'moduleLost'|'hull'|'death'|'hordeAlarm';
/**
 * Bounded synthesized layers per cue: oscillators sweep start -> (peak) -> end over duration.
 * `noise` mixes in a filtered noise burst (thumps, hiss, crunch) at `noiseTone` Hz; `repeat` plays
 * the tone several times `every` seconds apart (alarms, lock beeps); `gap` is the minimum time
 * between two plays of the same cue. Gains stay at or below 0.15 so nothing dominates the mix.
 */
export type SoundLayer={delay?:number;start:number;end:number;duration:number;wave:OscillatorType;gain:number;noise?:number;noiseTone?:number;repeat?:number;every?:number;peak?:number};
export type SoundProfile={priority?:0|1|2;layers?:SoundLayer[];start:number;end:number;duration:number;wave:OscillatorType;gain:number;peak?:number;noise?:number;noiseTone?:number;repeat?:number;every?:number;gap?:number};
export const SOUND_PROFILES:Record<SoundCue,SoundProfile>={
  deposit:{start:105,end:42,duration:.22,wave:'triangle',gain:.13,noise:.08,noiseTone:850,gap:.65,priority:2,layers:[{delay:.12,start:720,end:170,duration:.08,wave:'square',gain:.035,repeat:3,every:.075,noise:.035,noiseTone:2200},{delay:.4,start:620,end:1240,duration:.16,wave:'sine',gain:.075}]},
  depositHeavy:{start:76,end:28,duration:.33,wave:'triangle',gain:.14,noise:.10,noiseTone:650,gap:.65,priority:2,layers:[{delay:.13,start:590,end:120,duration:.09,wave:'square',gain:.035,repeat:4,every:.09,noise:.04,noiseTone:1800},{delay:.54,start:520,end:1100,duration:.18,wave:'sine',gain:.08}]},
  pickupHeavy:{start:320,end:760,duration:.13,wave:'triangle',gain:.065,noise:.025,noiseTone:1800,gap:.15,priority:0},
  dock:{start:140,end:65,duration:.13,wave:'triangle',gain:.07,noise:.025,noiseTone:800,gap:.8,priority:1},
  cargoLoad:{start:180,end:360,duration:.18,wave:'triangle',gain:.07,noise:.03,noiseTone:1500,gap:.3},
  moduleInstall:{start:145,end:70,duration:.16,wave:'triangle',gain:.085,noise:.055,noiseTone:1400,gap:.12,layers:[{delay:.12,start:460,end:900,duration:.12,wave:'sine',gain:.05}]},
  moduleUpgrade:{start:180,peak:750,end:230,duration:.25,wave:'triangle',gain:.08,noise:.035,noiseTone:2200,gap:.15},
  upgradeUltimate:{start:100,peak:1100,end:190,duration:.5,wave:'triangle',gain:.12,noise:.07,noiseTone:1500,gap:.5,priority:2,layers:[{delay:.32,start:650,end:1400,duration:.24,wave:'sine',gain:.07}]},
  moduleMove:{start:250,end:120,duration:.1,wave:'triangle',gain:.06,noise:.025,noiseTone:1100,gap:.1},
  moduleRemove:{start:320,end:65,duration:.18,wave:'triangle',gain:.075,noise:.04,noiseTone:1400,gap:.12},
  repair:{start:190,end:430,duration:.14,wave:'triangle',gain:.06,noise:.035,noiseTone:2600,gap:.8,repeat:2,every:.11},
  outfitterOpen:{start:170,end:650,duration:.15,wave:'triangle',gain:.055,noise:.018,noiseTone:1500,gap:.2},
  outfitterClose:{start:520,end:160,duration:.12,wave:'triangle',gain:.05,gap:.2},
  shieldReady:{start:220,end:820,duration:.2,wave:'sine',gain:.06,gap:2},
  shieldDown:{start:920,end:45,duration:.35,wave:'sawtooth',gain:.09,noise:.045,noiseTone:2200,gap:1,priority:2},
  lowEnergy:{start:360,end:290,duration:.11,wave:'triangle',gain:.055,repeat:2,every:.18,gap:6,priority:2},
  overheat:{start:180,end:90,duration:.22,wave:'square',gain:.055,noise:.025,noiseTone:2700,gap:6,priority:2},
  reactorOverdrive:{start:85,end:290,duration:.45,wave:'triangle',gain:.08,noise:.025,noiseTone:900,gap:2,priority:2},
  overclock:{start:170,peak:1300,end:500,duration:.38,wave:'triangle',gain:.095,gap:1,priority:2},
  warp:{start:130,end:620,duration:.32,wave:'triangle',gain:.1,noise:.045,noiseTone:1700,gap:.3,priority:2},
  coolingSurge:{start:450,end:80,duration:.32,wave:'sine',gain:.06,noise:.065,noiseTone:4000,gap:1,priority:2},
  fortress:{start:110,end:54,duration:.23,wave:'triangle',gain:.1,noise:.055,noiseTone:900,gap:1,priority:2},
  aegis:{start:310,end:1050,duration:.3,wave:'sine',gain:.08,gap:1,priority:2},
  vortex:{start:80,end:240,duration:.38,wave:'triangle',gain:.07,gap:1,priority:1},
  excavator:{start:230,end:80,duration:.13,wave:'triangle',gain:.045,noise:.025,noiseTone:2400,gap:1.1,priority:0},
  respawn:{start:190,end:950,duration:.4,wave:'sine',gain:.08,gap:1,priority:2},
  constructionDone:{start:240,end:760,duration:.22,wave:'triangle',gain:.065,noise:.025,noiseTone:1200,gap:.3},
  structureHit:{start:140,end:45,duration:.12,wave:'triangle',gain:.06,noise:.04,noiseTone:1500,gap:.2},
  uiOpen:{start:350,end:680,duration:.09,wave:'sine',gain:.035,gap:.15,priority:0},
  uiConfirm:{start:500,end:1050,duration:.12,wave:'triangle',gain:.055,gap:.1},
  uiCancel:{start:540,end:280,duration:.08,wave:'sine',gain:.04,gap:.1,priority:0},
  uiLaunch:{start:160,end:700,duration:.25,wave:'triangle',gain:.065,noise:.02,noiseTone:900,gap:.5},
  ultimate:{start:100,peak:950,end:160,duration:.28,wave:'triangle',gain:.085,noise:.04,noiseTone:1400,gap:.4,priority:2},

  uiHover:{start:780,end:1080,duration:.045,wave:'sine',gain:.025,gap:.09},
  uiClick:{start:1050,end:520,duration:.085,wave:'triangle',gain:.07,gap:.07},
  uiWarning:{start:420,end:250,duration:.16,wave:'triangle',gain:.065,gap:.15},
  fail:{start:220,end:120,duration:.12,wave:'triangle',gain:.05},hit:{start:440,end:85,duration:.09,wave:'triangle',gain:.12},
  fire:{start:550,end:100,duration:.07,wave:'square',gain:.04,noise:.025,noiseTone:2400},pulse:{start:1300,end:420,duration:.11,wave:'sine',gain:.08},
  rail:{start:240,peak:1600,end:55,duration:.25,wave:'sawtooth',gain:.085,noise:.04,noiseTone:3000,layers:[{delay:.045,start:85,end:30,duration:.18,wave:'triangle',gain:.075,noise:.035,noiseTone:800}]},plasma:{start:160,peak:340,end:42,duration:.3,wave:'triangle',gain:.10,noise:.02,noiseTone:950},
  rocket:{start:130,end:32,duration:.28,wave:'sawtooth',gain:.08,noise:.05,noiseTone:1800,layers:[{delay:.055,start:60,end:180,duration:.16,wave:'triangle',gain:.055,noise:.025,noiseTone:2800}]},flak:{start:250,end:55,duration:.15,wave:'triangle',gain:.07,noise:.055,noiseTone:1600,layers:[{delay:.03,start:400,end:90,duration:.045,wave:'square',gain:.025,repeat:2,every:.035}]},emp:{start:110,peak:850,end:230,duration:.4,wave:'triangle',gain:.085,noise:.025,noiseTone:1500},
  mine:{start:260,end:310,duration:.12,wave:'triangle',gain:.025},impact:{start:100,end:30,duration:.14,wave:'sawtooth',gain:.1},
  shield:{start:720,end:180,duration:.16,wave:'sine',gain:.08},explosion:{priority:2,start:80,end:18,duration:.32,wave:'sawtooth',gain:.11,noise:.08,noiseTone:700},
  collect:{start:600,end:1050,duration:.08,wave:'triangle',gain:.04,noise:.018,noiseTone:2800,gap:.13},boost:{start:110,end:380,duration:.3,wave:'triangle',gain:.09},build:{start:390,end:780,duration:.18,wave:'sine',gain:.08},
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
  private last:Partial<Record<SoundCue,number>>={};private active=new Set<{node:AudioScheduledSourceNode;priority:number}>();
  private get voices(){return this.active.size;}
  private pickupAmount=0;private pickupStep=0;private lastDeposit=-10;
  private loops=new Map<'mine'|'tractor',{nodes:AudioScheduledSourceNode[];gain:GainNode}>();
  constructor(){try{const settings=JSON.parse(localStorage.getItem('voidforge.audio')??'null');if(settings){this.masterVolume=Math.max(0,Math.min(1,settings.master??.85));this.effectsVolume=Math.max(0,Math.min(1,settings.effects??.9));this.musicVolume=Math.max(0,Math.min(1,settings.music??.45));this.muted=Boolean(settings.muted);}}catch{/* Defaults work without storage. */}
    if(typeof document!=='undefined')document.addEventListener('visibilitychange',()=>{if(document.hidden){this.track?.pause();this.setLoop('mine',0);this.setLoop('tractor',0);}else this.startMusic();});
  }
  unlock(){
    if(!this.context){if(typeof AudioContext==='undefined')return;this.context=new AudioContext();this.master=this.context.createGain();this.effects=this.context.createGain();this.effects.connect(this.master);
      this.music=this.context.createGain();this.music.connect(this.master);
      this.track=new Audio(new URL('./Deep Space Patrol.mp3',import.meta.url).href);this.track.loop=true;this.track.preload='none';
      this.context.createMediaElementSource(this.track).connect(this.music);const limiter=this.context.createDynamicsCompressor();limiter.threshold.value=-10;limiter.ratio.value=8;limiter.attack.value=.003;limiter.release.value=.15;this.master.connect(limiter);limiter.connect(this.context.destination);this.applyVolumes();}
    if(this.context.state!=='running')void this.context.resume().then(()=>this.startMusic()).catch(()=>{});
    else this.startMusic();
  }
  private startMusic(){if(this.track&&this.track.paused&&!document.hidden&&!this.muted&&this.musicVolume>0)void this.track.play().catch(()=>{});}
  private applyVolumes(){if(this.context&&this.master&&this.effects){this.master.gain.setTargetAtTime(this.muted?0:this.masterVolume,this.context.currentTime,.03);this.effects.gain.setTargetAtTime(this.effectsVolume,this.context.currentTime,.03);this.music?.gain.setTargetAtTime(this.musicVolume,this.context.currentTime,.03);if(this.muted||this.musicVolume===0)this.track?.pause();else this.startMusic();}}
  setVolume(kind:'master'|'effects'|'music',value:number){if(kind==='master')this.masterVolume=Math.max(0,Math.min(1,value));else if(kind==='effects')this.effectsVolume=Math.max(0,Math.min(1,value));else this.musicVolume=Math.max(0,Math.min(1,value));this.applyVolumes();this.persist();}
  private persist(){try{localStorage.setItem('voidforge.audio',JSON.stringify({master:this.masterVolume,effects:this.effectsVolume,music:this.musicVolume,muted:this.muted}));}catch{/* Volume controls still work. */}}
  toggleMute(){this.pickupAmount=0;this.muted=!this.muted;if(this.muted){this.setLoop('mine',0);this.setLoop('tractor',0);}this.applyVolumes();this.persist();}
  playWeapon(kind:WeaponKind,pitch=1,volume=1,level=1,ultimate=false){const depth=pitch*(1-.055*(Math.max(1,Math.min(5,level))-1));this.play(kind==='cannon'?'fire':kind,depth,volume);if(ultimate)this.play('ultimate',depth,volume*.85);}
  deposit(amount:number){const now=this.context?.currentTime??0;if(amount<=0||this.muted||now-this.lastDeposit<.65)return;this.lastDeposit=now;this.play(amount>=100?'depositHeavy':'deposit',amount>=500?.85:1);}
  pickup(amount:number){if(this.muted||this.masterVolume<=0||this.effectsVolume<=0){this.pickupAmount=0;return;}this.pickupAmount=Math.min(1000,this.pickupAmount+Math.max(0,amount));const now=this.context?.currentTime??0;if(now-(this.last.collect??-10)<.15)return;const total=this.pickupAmount;this.pickupAmount=0;this.last.collect=now;const cue=total>=20?'pickupHeavy':'collect';if(cue==='collect')delete this.last.collect;this.play(cue,1+(this.pickupStep++%4)*.035);}
  private noise?:AudioBuffer;
  private noiseBuffer(){const c=this.context!;if(!this.noise){this.noise=c.createBuffer(1,c.sampleRate,c.sampleRate);const data=this.noise.getChannelData(0);let seed=1;for(let i=0;i<data.length;i++){seed=(seed*16807)%2147483647;data[i]=seed/1073741823.5-1;}}return this.noise;}
  /** Reserve voices for critical events; preempt only lower-priority voices, never exceed 24 nodes. */
  play(cue:SoundCue,pitch=1,volume=1){
    const c=this.context,s=SOUND_PROFILES[cue];if(!c||c.state!=='running'||this.muted||this.masterVolume<=0||this.effectsVolume<=0||volume<=.02)return;
    const now=c.currentTime;if(now-(this.last[cue]??-10)<(s.gap??.07))return;
    const priority=(cue==='deposit'||cue==='depositHeavy')?3:s.priority??(['hull','death','moduleLost','bossWarning','bossDown','hordeAlarm'].includes(cue)?2:['collect','uiHover'].includes(cue)?0:1);
    const layers=[s,...(s.layers??[])],needed=layers.reduce((n,l)=>n+(l.repeat??1)+(l.noise?1:0),0),limit=priority>=2?24:priority===1?16:10;
    if(this.voices+needed>limit)for(const voice of [...this.active]){if(voice.priority<priority){this.active.delete(voice);try{voice.node.stop();}catch{/* Already ended. */}if(this.voices+needed<=limit)break;}}
    if(this.voices+needed>limit)return;this.last[cue]=now;
    const release=(node:AudioScheduledSourceNode,...rest:AudioNode[])=>{const voice={node,priority};this.active.add(voice);node.onended=()=>{this.active.delete(voice);node.disconnect();for(const r of rest)r.disconnect();};};
    for(const layer of layers){const start=now+('delay' in layer?(layer.delay??0):0);
      for(let i=0;i<(layer.repeat??1);i++){
        const at=start+i*(layer.every??0),o=c.createOscillator(),gain=c.createGain();o.type=layer.wave;o.frequency.setValueAtTime(layer.start*pitch,at);
        if(layer.peak)o.frequency.exponentialRampToValueAtTime(layer.peak*pitch,at+.04);o.frequency.exponentialRampToValueAtTime(layer.end*pitch,at+layer.duration);
        gain.gain.setValueAtTime(.0001,at);gain.gain.exponentialRampToValueAtTime(layer.gain*Math.min(1,volume),at+.008);gain.gain.exponentialRampToValueAtTime(.0001,at+layer.duration);
        o.connect(gain);gain.connect(this.effects!);release(o,gain);o.start(at);o.stop(at+layer.duration+.01);
      }
      if(layer.noise){const source=c.createBufferSource(),filter=c.createBiquadFilter(),gain=c.createGain(),length=Math.min(1,layer.duration*.8);
        source.buffer=this.noiseBuffer();filter.type='lowpass';filter.frequency.setValueAtTime((layer.noiseTone??1000)*pitch,start);filter.frequency.exponentialRampToValueAtTime(Math.max(60,(layer.noiseTone??1000)*pitch*.25),start+length);
        gain.gain.setValueAtTime(layer.noise*Math.min(1,volume),start);gain.gain.exponentialRampToValueAtTime(.0001,start+length);source.connect(filter);filter.connect(gain);gain.connect(this.effects!);release(source,filter,gain);source.start(start);source.stop(start+length+.01);
      }
    }
  }

  setLoop(kind:'mine'|'tractor',count:number){
    const c=this.context;if(!c)return;const old=this.loops.get(kind);
    if(count<=0||this.muted||document.hidden){if(old){old.gain.gain.setTargetAtTime(.0001,c.currentTime,.035);for(const node of old.nodes)node.stop(c.currentTime+.16);this.loops.delete(kind);}return;}
    if(c.state!=='running')return;let loop=old;
    if(!loop){const gain=c.createGain();gain.gain.value=0;gain.connect(this.effects!);const nodes:AudioScheduledSourceNode[]=[];
      for(let i=0;i<2;i++){const o=c.createOscillator();o.type=kind==='mine'&&i===0?'triangle':'sine';o.frequency.value=(kind==='mine'?170:95)*(i===0?1:kind==='mine'?3:2);o.connect(gain);o.start();nodes.push(o);}
      let grit:GainNode|undefined,filter:BiquadFilterNode|undefined;
      if(kind==='mine'){const source=c.createBufferSource();source.buffer=this.noiseBuffer();source.loop=true;filter=c.createBiquadFilter();filter.type='bandpass';filter.frequency.value=1350;filter.Q.value=.6;grit=c.createGain();grit.gain.value=.3;source.connect(filter);filter.connect(grit);grit.connect(gain);source.start();nodes.push(source);}
      let ended=0;for(const node of nodes)node.onended=()=>{node.disconnect();if(++ended===nodes.length){gain.disconnect();grit?.disconnect();filter?.disconnect();}};loop={gain,nodes};this.loops.set(kind,loop);
    }
    loop.gain.gain.setTargetAtTime((kind==='mine'?.020:.012)*Math.min(2.5,Math.sqrt(count)),c.currentTime,.07);
  }
}
