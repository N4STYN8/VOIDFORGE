import {isCombatMusic,musicEnvelope,musicFade,ShuffleTracks,type MusicState} from './musicState.ts';
type Voice={audio:HTMLAudioElement;source:MediaElementAudioSourceNode;gain:GainNode;track:string;state:MusicState;from:number;to:number;at:number;duration:number;ready:boolean;starting:boolean;blocked:boolean};
/** Bounded streaming voices through the existing GameAudio music bus. No decoded MP3 bank. */
export class MusicEngine{
 private voices:Voice[]=[];private shuffle=new ShuffleTracks();private failed=new Set<string>();
 private resume=new Map<MusicState,{track:string;time:number;at:number}>();
 private combatBookmark?:{state:MusicState;track:string;time:number};
 private transitionFrom:MusicState='menu';
 private desired:MusicState='menu';private current?:Voice;private enabled=true;
 private context:AudioContext;private output:AudioNode;private tracks:Record<MusicState,string[]>;private fallback:string;
 constructor(context:AudioContext,output:AudioNode,tracks:Record<MusicState,string[]>,fallback:string){this.context=context;this.output=output;this.tracks=tracks;this.fallback=fallback;}
 get debug(){return {state:this.desired,voices:this.voices.map(v=>({state:v.state,track:v.track,time:v.audio.currentTime,paused:v.audio.paused,gain:this.level(v),target:v.to})),failed:[...this.failed]};}
 private level(v:Voice){return musicEnvelope(v.from,v.to,(this.context.currentTime-v.at)/v.duration);}
 private ramp(v:Voice,to:number,duration:number){const from=this.level(v),now=this.context.currentTime;v.from=from;v.to=to;v.at=now;v.duration=duration;const curve=new Float32Array(65);for(let i=0;i<curve.length;i++)curve[i]=.55*musicEnvelope(from,to,i/(curve.length-1));v.gain.gain.cancelScheduledValues(now);v.gain.gain.setValueCurveAtTime(curve,now,duration);}
 private dispose(v:Voice){if(v.ready&&!v.audio.ended&&this.combatBookmark?.track===v.track&&this.combatBookmark.state===v.state)this.combatBookmark.time=v.audio.currentTime;if(v.ready&&!v.audio.ended)this.resume.set(v.state,{track:v.track,time:v.audio.currentTime,at:this.context.currentTime});v.audio.onloadedmetadata=v.audio.onended=v.audio.onerror=v.audio.oncanplay=null;v.audio.pause();v.audio.removeAttribute('src');v.audio.load();v.source.disconnect();v.gain.disconnect();this.voices=this.voices.filter(x=>x!==v);if(this.current===v)this.current=undefined;}
 setEnabled(enabled:boolean){if(enabled===this.enabled)return;this.enabled=enabled;const now=this.context.currentTime;if(!enabled){for(const v of this.voices){v.from=this.level(v);v.duration=Math.max(.05,v.duration-(now-v.at));v.at=now;v.gain.gain.cancelScheduledValues(now);v.gain.gain.setValueAtTime(v.from*.55,now);v.audio.pause();}}else{for(const v of this.voices){v.at=now;this.ramp(v,v.to,v.duration);v.blocked=false;this.play(v);}}}
 unlock(){for(const v of this.voices){v.blocked=false;this.play(v);}}
 private play(v:Voice){if(!this.enabled||v.starting||v.blocked||!v.audio.paused||this.context.state!=='running')return;v.starting=true;void v.audio.play().then(()=>{v.starting=false;if(!this.voices.includes(v))return;if(!this.enabled){v.audio.pause();return;}if(!v.ready){v.ready=true;this.activate(v);}}).catch(error=>{v.starting=false;if(error?.name==='NotAllowedError')v.blocked=true;else if(error?.name!=='AbortError')this.fail(v);});}
 private fail(v:Voice){if(!this.voices.includes(v))return;this.failed.add(v.track);this.dispose(v);}
 private activate(v:Voice){if(v.state!==this.desired){this.dispose(v);return;}const previous=this.current;const seconds=previous?musicFade(previous.state,v.state,previous.state===v.state):musicFade(this.transitionFrom,v.state);for(const old of this.voices)if(old!==v&&old.ready)this.ramp(old,0,seconds);this.current=v;this.ramp(v,1,seconds);if(!isCombatMusic(v.state))this.combatBookmark=undefined;}
 private start(state:MusicState,rotation=false){
  if(this.voices.some(v=>!v.ready))return;
  const existing=!rotation&&this.voices.find(v=>v.state===state&&v.ready&&!v.audio.ended);
  if(existing){this.activate(existing);return;}
  if(this.voices.length>=3){const oldest=this.voices.filter(v=>v!==this.current).sort((a,b)=>this.level(a)-this.level(b))[0];if(oldest&&oldest.to!==0)this.ramp(oldest,0,.2);else if(oldest&&oldest.duration>.2)this.ramp(oldest,0,.2);return;}
  const available=this.tracks[state].filter(t=>!this.failed.has(t));const bookmark=this.combatBookmark?.state===state?this.combatBookmark:undefined;const saved=bookmark?{...bookmark,at:this.context.currentTime}:this.resume.get(state);const track=!rotation&&saved&&this.context.currentTime-saved.at<30&&available.includes(saved.track)?saved.track:this.shuffle.next(state,available)??(!this.failed.has(this.fallback)?this.fallback:undefined);if(!track)return;
  const audio=new Audio();audio.preload='metadata';const gain=this.context.createGain();gain.gain.value=0;const source=this.context.createMediaElementSource(audio);source.connect(gain);gain.connect(this.output);
  const v:Voice={audio,gain,source,track,state,from:0,to:0,at:this.context.currentTime,duration:1,ready:false,starting:false,blocked:false};this.voices.push(v);
  audio.onerror=()=>this.fail(v);audio.oncanplay=()=>this.play(v);audio.onended=()=>{if(this.current===v){this.current=undefined;this.resume.delete(state);}this.dispose(v);};
  if(!rotation&&saved?.track===track)audio.onloadedmetadata=()=>{if(Number.isFinite(audio.duration)&&saved.time<audio.duration-.05)audio.currentTime=saved.time;audio.onloadedmetadata=null;};
  audio.src=track;this.play(v);
 }
 update(state:MusicState){if(state!==this.desired){this.transitionFrom=this.desired;if(isCombatMusic(state)&&!isCombatMusic(this.desired)&&this.current&&!isCombatMusic(this.current.state)&&this.current.state!=='menu')this.combatBookmark={state:this.current.state,track:this.current.track,time:this.current.audio.currentTime};if(state==='menu')this.combatBookmark=undefined;}this.desired=state;if(!this.enabled)return;
  for(const v of [...this.voices]){if(!v.ready&&!v.blocked&&this.context.currentTime-v.at>15){this.fail(v);continue;}if(!v.ready&&v.state!==state){this.dispose(v);continue;}if(v.ready&&v.to===0&&this.context.currentTime-v.at>=v.duration)this.dispose(v);}
  if(this.current?.state!==state)this.start(state);else if(this.current.ready&&Number.isFinite(this.current.audio.duration)&&this.current.audio.duration-this.current.audio.currentTime<=8&&!this.voices.some(v=>!v.ready))this.start(state,true);
 }
 disposeAll(){for(const v of [...this.voices])this.dispose(v);}
}
