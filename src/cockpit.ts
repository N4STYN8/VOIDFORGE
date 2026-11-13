import {cockpitIcon,frameMarkup} from './cockpitArt.ts';
import { DANGER, ENEMIES, EXPLORATION, MODULES, WEAPON_TYPES } from './data.ts';
import type { GameModel, Point } from './model.ts';
import { clearLineOfSight } from './enemyAI.ts';
export type CockpitAction='boost'|'overclock'|'shop'|'build'|'map'|'dock'|'settings';
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const fmt=(n:number)=>Math.round(n).toLocaleString();
/** Read-only presentation: a contact is acquired only under the cursor, in sensor range and with line of sight. */
export function tacticalReadout(model:GameModel,aim:Point){
 const contacts=model.enemies.filter(e=>e.health>0&&Math.hypot(e.x-model.player.x,e.y-model.player.y)<1100&&model.isExplored(e));
 const target=contacts.filter(e=>Math.hypot(e.x-aim.x,e.y-aim.y)<=ENEMIES[e.kind??'raider'].radius+18&&clearLineOfSight(model.player,e,model.asteroids)).sort((a,b)=>Math.hypot(a.x-aim.x,a.y-aim.y)-Math.hypot(b.x-aim.x,b.y-aim.y))[0];
 const def=target?ENEMIES[target.kind??'raider']:undefined;
 const station=!target?model.bases.filter(base=>model.isExplored(base)&&Math.hypot(base.x-model.player.x,base.y-model.player.y)<1100).sort((a,b)=>Math.hypot(a.x-model.player.x,a.y-model.player.y)-Math.hypot(b.x-model.player.x,b.y-model.player.y))[0]:undefined;
 const targetHtml=target?`<b>${esc(def!.label)}</b><span>${fmt(Math.hypot(target.x-model.player.x,target.y-model.player.y))} m · ${fmt(target.health)} / ${fmt(target.maxHealth??def!.health)} hull</span><span>Shield ${fmt(target.shield??0)} · ${esc(target.state??'patrol')}</span>`:station?`<b>${esc(station.name)}</b><span>Station · ${station.unlocked?'Friendly / active':'Locked'}</span><span>Distance ${fmt(Math.hypot(station.x-model.player.x,station.y-model.player.y))} m</span>`:'<b>No target acquired</b><span>Aim at a visible contact</span>';
 const weapons=model.modules.filter(m=>m.integrity>0&&(m.kind in WEAPON_TYPES||m.kind==='miner'));
 let group=0;
 const rows=[...Object.keys(WEAPON_TYPES),'miner'].flatMap(kind=>{const installed=weapons.filter(m=>m.kind===kind);if(!installed.length)return [];const slot=++group;const ready=installed.filter(m=>m.cooldown<=0).length,status=kind==='miner'&&model.cargoUsed>=model.cargoCapacity?'CARGO FULL':kind==='miner'&&model.miningLinks.length?'MINING':model.atStation&&kind!=='miner'?'SAFE · LOCKED':model.systemsDisabled>0?'EMP · RECOVERING':model.heatLimited?'COOLING':model.powerLimited?'LOW ENERGY':ready===installed.length?'READY':`${ready} ready · ${Math.max(...installed.map(m=>m.cooldown)).toFixed(1)}s`;return [`<div><span class="weapon-number" aria-label="Equipment group ${slot}">${slot}</span><span class="weapon-name">${esc(MODULES[installed[0].kind].label)} ×${installed.length}</span><b>${status}</b><i class="weapon-charge"><u style="width:${(model.atStation&&kind!=='miner'||model.systemsDisabled>0||model.heatLimited||model.powerLimited?0:ready/installed.length)*100}%"></u></i></div>`];}).join('');
 return {station:Boolean(station),target:`<div class="contact-readout ${target?'acquired':''}">${targetHtml}</div>`,weapons:rows||'<span>No weapon modules installed</span>',contacts:contacts.length};
}
export class Cockpit {
 readonly root=document.createElement('div');
 private navigation!:HTMLElement;private target!:HTMLElement;private weapons!:HTMLElement;private commands!:HTMLElement;private contactCount!:HTMLElement;
 private commandButtons=new Map<CockpitAction,{button:HTMLButtonElement;status:HTMLElement}>();
 private compact=false;
 private stationIcon='';
 setStationIcon(url:string){this.stationIcon=url;}
 constructor(session:HTMLElement,action:(action:CockpitAction)=>void){
  this.root.id='cockpit';
  this.root.innerHTML=`<svg id="cockpit-frame" aria-hidden="true" shape-rendering="crispEdges"></svg><div id="cockpit-brand">VOIDFORGE <span>///</span></div><div class="cockpit-rail rail-left" aria-hidden="true"></div><div class="cockpit-rail rail-right" aria-hidden="true"></div><header id="cockpit-top"><div id="navigation" aria-label="Navigation"></div><button id="hud-density" type="button" aria-pressed="false">Compact HUD</button><details id="cockpit-session"><summary>Systems</summary></details></header><aside id="tactical" aria-label="Tactical systems"><section class="cockpit-panel radar-panel"><header><span>RADAR</span><b id="contact-count"></b></header><button type="button" data-command="map" class="radar-button" aria-label="Open explored sector map"><canvas width="240" height="240" aria-label="Explored radar map"></canvas><span>M · EXPAND MAP</span></button></section><section class="cockpit-panel target-panel"><header>TARGET</header><div id="tactical-target"></div></section><section class="cockpit-panel weapon-panel"><header>WEAPONS / MINING</header><div id="weapon-status"></div></section></aside><nav id="command-console" aria-label="Ship commands"></nav>`;
  document.body.append(this.root);
  const resizeFrame=()=>{const style=getComputedStyle(document.body),left=parseFloat(style.getPropertyValue('--cockpit-left'))||258,right=parseFloat(style.getPropertyValue('--cockpit-right'))||218,frame=this.root.querySelector<SVGSVGElement>('#cockpit-frame')!;const l=this.root.querySelector('#tactical')!.getBoundingClientRect().width;const h=document.getElementById('hud')!.getBoundingClientRect().width;frame.setAttribute('viewBox',`0 0 ${innerWidth} ${innerHeight}`);frame.innerHTML=frameMarkup(innerWidth,innerHeight,h||left,l||right);};
  window.addEventListener('resize',resizeFrame);this.root.addEventListener('densitychange',resizeFrame);requestAnimationFrame(resizeFrame);
this.root.querySelector('#cockpit-session')!.append(session);const help=document.getElementById('help');if(help)session.append(help);
  this.navigation=this.root.querySelector('#navigation')!;this.target=this.root.querySelector('#tactical-target')!;this.weapons=this.root.querySelector('#weapon-status')!;this.commands=this.root.querySelector('#command-console')!;this.contactCount=this.root.querySelector('#contact-count')!;
  this.compact=window.matchMedia('(max-width: 1000px), (max-height: 720px)').matches;
  try{const saved=localStorage.getItem('voidforge-hud-compact');if(saved!==null)this.compact=saved==='true';}catch{/* Optional preference storage. */}
  this.applyDensity();this.root.querySelector('#hud-density')!.addEventListener('click',()=>{this.compact=!this.compact;this.applyDensity();(this.root.querySelector('#hud-density') as HTMLButtonElement).blur();try{localStorage.setItem('voidforge-hud-compact',String(this.compact));}catch{} });
  this.root.addEventListener('click',event=>{const button=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-command]');if(button){action(button.dataset.command as CockpitAction);button.blur();}});
  this.root.addEventListener('pointerdown',event=>event.stopPropagation());
 }
 private applyDensity(){document.body.classList.toggle('hud-compact',this.compact);const button=this.root.querySelector<HTMLButtonElement>('#hud-density')!;button.setAttribute('aria-pressed',String(this.compact));button.textContent=this.compact?'Full HUD':'Compact HUD';this.root.dispatchEvent(new Event('densitychange'));}
 private write(element:HTMLElement,html:string){if(element.innerHTML!==html)element.innerHTML=html;}
 update(model:GameModel,aim:Point,blocked:boolean,buildMode:boolean){
  const p=model.player,base=model.nearestUnlockedBase;
  this.write(this.navigation,`<span><i>${cockpitIcon('nav')}</i>Sector: <b>${Math.floor(p.x/EXPLORATION.cell)}:${Math.floor(p.y/EXPLORATION.cell)}</b></span><span class="nav-position">X / Y <b>${fmt(p.x)} / ${fmt(p.y)}</b></span><span class="nav-threat ${model.atStation?'safe':''}">${model.atStation?'SAFE ZONE':esc(DANGER.labels[model.danger-1].toUpperCase())}</span><span class="nav-destination"><i>${cockpitIcon('destination')}</i>${esc(base.name)} · ${fmt(Math.hypot(base.x-p.x,base.y-p.y))} m</span>`);
  const tactical=tacticalReadout(model,aim);this.write(this.target,`${tactical.station&&this.stationIcon?`<img class="contact-icon" src="${this.stationIcon}" alt="">`:""}${tactical.target}`);this.write(this.weapons,tactical.weapons);this.contactCount.textContent=String(tactical.contacts).padStart(2,'0')+' CONTACTS';
  const engines=model.modules.filter(m=>m.kind==='engine'&&m.level>=2&&m.integrity>0),cooldown=Math.max(0,...engines.map(m=>m.boostCooldown??0));
  const commands:[CockpitAction,string,string,string,boolean][]=[['boost','Shift','Burst',model.boostActive?'ACTIVE':engines.length?(model.boostReady?'READY':`${Math.ceil(cooldown)}s`):'L2 ENGINE',!engines.length],['overclock','C','Overclock',model.coreLevel<5?'L5 CORE':model.coreAbility.active>0?`${Math.ceil(model.coreAbility.active)}s ACTIVE`:model.coreAbility.cooldown>0?`${Math.ceil(model.coreAbility.cooldown)}s`:'READY',model.coreLevel<5],['shop','Q','Outfitter',model.atStation?'DOCKED':'AT FORGE',!model.atStation],['build','F','Build mode',buildMode?'ACTIVE':model.builder?'AVAILABLE':'BUILD MODULE',!model.builder],['map','M','Sector map','EXPLORED',false],['dock','E','Dock / repair','MINERALS',false],['settings','⚙','Settings','AUDIO / VFX',false]];
  // Keep native button identity across HUD ticks: replacing a pressed/focused node loses its click.
  for(const [action,key,label,status,locked] of commands){
   let entry=this.commandButtons.get(action);
   if(!entry){
    const button=document.createElement('button');button.type='button';button.dataset.command=action;
    button.innerHTML=`<i class="command-icon">${cockpitIcon(action)}</i><span><kbd>${key}</kbd> ${label}<small></small></span>`;
    entry={button,status:button.querySelector('small')!};this.commandButtons.set(action,entry);this.commands.append(button);
   }
   entry.button.disabled=(!['map','settings','shop'].includes(action)&&blocked)||(!['map','settings'].includes(action)&&(model.dead||locked));
   entry.button.title=`${label} · ${status}`;
   if(entry.status.textContent!==status)entry.status.textContent=status;
  }
 }
 mountRadar(radar:HTMLElement){
  this.root.querySelector('.radar-button')!.remove();
  this.root.querySelector('.radar-panel')!.append(radar);
 }
}
