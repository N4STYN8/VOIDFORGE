import { GameAudio } from './audio.ts';
import { EffectPool } from './effects.ts';
export class GameSettings {
  private dialog=document.createElement('dialog');
  get open(){return this.dialog.open;}
  constructor(private audio:GameAudio,private effects:EffectPool,private changed:(open:boolean)=>void=()=>{}){
    try{const saved=JSON.parse(localStorage.getItem('voidforge.vfx')??'null');if(saved){effects.enabled=saved.enabled!==false;effects.density=saved.density===.35?.35:1;}}catch{/* Defaults if storage unavailable. */}
    this.dialog.id='settings-menu';this.dialog.setAttribute('aria-labelledby','settings-title');
    this.dialog.innerHTML=`<header><div><small>VOIDFORGE</small><h2 id="settings-title">Settings</h2></div><button data-close>Close · Esc</button></header><p>Game paused while settings are open.</p><h3>Audio</h3><p class="music-credit">Now playing: Deep Space Patrol<br><small>Music begins after your first click or key press.</small></p>${['master','music','effects'].map(kind=>`<label class="setting-row" for="volume-${kind}"><span>${kind==='master'?'Master volume':kind==='music'?'Music volume':'Sound effects'} <output data-output="${kind}"></output></span><input id="volume-${kind}" data-volume="${kind}" type="range" min="0" max="1" step="0.01"></label>`).join('')}<label class="setting-check"><input type="checkbox" data-mute> Mute all audio · N</label><h3>Visual effects</h3><label class="setting-check"><input type="checkbox" data-vfx> Enable VFX · V</label><label class="setting-row" for="particle-detail"><span>Particle density</span><select id="particle-detail"><option value="1">Full</option><option value="0.35">Reduced</option></select></label><p><small>Reduced density lowers sparks, debris and trails. Mining beams, projectiles and other gameplay indicators stay visible with VFX off.</small></p><p class="settings-saved">Changes save automatically on this browser.</p>`;
    document.body.append(this.dialog);
    this.dialog.querySelector('[data-close]')!.addEventListener('click',()=>this.dialog.close());
    this.dialog.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.dialog.close();}});
    this.dialog.addEventListener('close',()=>this.changed(false));
    this.dialog.addEventListener('pointerdown',e=>e.stopPropagation());
    this.dialog.addEventListener('input',e=>{
      const input=e.target as HTMLInputElement;
      if(input.dataset.volume){this.audio.setVolume(input.dataset.volume as 'master'|'music'|'effects',Number(input.value));}
      else if(input.hasAttribute('data-mute')){if(input.checked!==this.audio.muted)this.audio.toggleMute();}
      else if(input.hasAttribute('data-vfx'))this.effects.enabled=input.checked;
      else if(input.id==='particle-detail'){this.effects.density=Number(input.value);this.effects.clear();}
      this.persist();this.sync();
    });
    this.sync();
  }
  addMainMenu(handler:()=>void){const button=document.createElement('button');button.textContent='Main menu';button.dataset.mainMenu='true';button.addEventListener('click',()=>{this.dialog.close();handler();});this.dialog.append(button);}
  show(){this.audio.unlock();this.sync();this.dialog.showModal();this.changed(true);}
  persist(){try{localStorage.setItem('voidforge.vfx',JSON.stringify({enabled:this.effects.enabled,density:this.effects.density}));}catch{/* Controls work without storage. */}}
  sync(){
    for(const kind of ['master','music','effects'] as const){const value=kind==='master'?this.audio.masterVolume:kind==='music'?this.audio.musicVolume:this.audio.effectsVolume;this.dialog.querySelector<HTMLInputElement>(`[data-volume="${kind}"]`)!.value=String(value);this.dialog.querySelector(`[data-output="${kind}"]`)!.textContent=`${Math.round(value*100)}%`;}
    this.dialog.querySelector<HTMLInputElement>('[data-mute]')!.checked=this.audio.muted;
    this.dialog.querySelector<HTMLInputElement>('[data-vfx]')!.checked=this.effects.enabled;
    this.dialog.querySelector<HTMLSelectElement>('#particle-detail')!.value=String(this.effects.density);
  }
}
