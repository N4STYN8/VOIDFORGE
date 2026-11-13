import {cockpitIcon,frameMarkup} from './cockpitArt.ts';
import { DANGER, ENEMIES, EXPLORATION, MODULES, WEAPON_TYPES, OUTPOST } from './data.ts';
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
 const rows=[...Object.keys(WEAPON_TYPES),'miner'].flatMap(kind=>{const installed=weapons.filter(m=>m.kind===kind);if(!installed.length)return [];const ready=installed.filter(m=>m.cooldown<=0).length,status=kind==='miner'&&model.cargoUsed>=model.cargoCapacity?'CARGO FULL':kind==='miner'&&model.miningLinks.length?'MINING':model.atStation&&kind!=='miner'?'SAFE · LOCKED':model.systemsDisabled>0?'EMP · RECOVERING':model.heatLimited?'COOLING':model.powerLimited?'LOW ENERGY':ready===installed.length?'READY':`${ready} ready · ${Math.max(...installed.map(m=>m.cooldown)).toFixed(1)}s`;return [`<div><span>${esc(MODULES[installed[0].kind].label)} ×${installed.length}</span><b>${status}</b><i class="weapon-charge"><u style="width:${ready/installed.length*100}%"></u></i></div>`];}).join('');
 return {station:Boolean(station),target:`<div class="contact-readout ${target?'acquired':''}">${targetHtml}</div>`,weapons:rows||'<span>No weapon modules installed</span>',contacts:contacts.length};
}
export class Cockpit {
 readonly root=document.createElement('div');
 private navigation!:HTMLElement;private target!:HTMLElement;private weapons!:HTMLElement;private commands!:HTMLElement;private radar!:HTMLCanvasElement;private contactCount!:HTMLElement;
 private compact=false;
 private stationIcon='';
 setStationIcon(url:string){this.stationIcon=url;}
 constructor(session:HTMLElement,action:(action:CockpitAction)=>void){
  this.root.id='cockpit';
  this.root.innerHTML=`<svg id="cockpit-frame" aria-hidden="true" shape-rendering="crispEdges"></svg><div id="cockpit-brand">VOIDFORGE <span>///</span></div><div class="cockpit-rail rail-left" aria-hidden="true"></div><div class="cockpit-rail rail-right" aria-hidden="true"></div><header id="cockpit-top"><div id="navigation" aria-label="Navigation"></div><button id="hud-density" type="button" aria-pressed="false">Compact HUD</button><details id="cockpit-session"><summary>Systems</summary></details></header><aside id="tactical" aria-label="Tactical systems"><section class="cockpit-panel radar-panel"><header><span>RADAR / EXPLORED</span><b id="contact-count"></b></header><button type="button" data-command="map" class="radar-button" aria-label="Open explored sector map"><canvas width="240" height="240" aria-label="Explored radar map"></canvas><span>M · EXPAND MAP</span></button></section><section class="cockpit-panel target-panel"><header>TARGET / AIM CONTACT</header><div id="tactical-target"></div></section><section class="cockpit-panel weapon-panel"><header>WEAPONS / MINING</header><div id="weapon-status"></div></section></aside><nav id="command-console" aria-label="Ship commands"></nav>`;
  document.body.append(this.root);
  const resizeFrame=()=>{const style=getComputedStyle(document.body),left=parseFloat(style.getPropertyValue('--cockpit-left'))||258,right=parseFloat(style.getPropertyValue('--cockpit-right'))||218,frame=this.root.querySelector<SVGSVGElement>('#cockpit-frame')!;const l=this.root.querySelector('#tactical')!.getBoundingClientRect().width;const h=document.getElementById('hud')!.getBoundingClientRect().width;frame.setAttribute('viewBox',`0 0 ${innerWidth} ${innerHeight}`);frame.innerHTML=frameMarkup(innerWidth,innerHeight,h||left,l||right);};
  window.addEventListener('resize',resizeFrame);this.root.addEventListener('densitychange',resizeFrame);requestAnimationFrame(resizeFrame);
this.root.querySelector('#cockpit-session')!.append(session);
  this.navigation=this.root.querySelector('#navigation')!;this.target=this.root.querySelector('#tactical-target')!;this.weapons=this.root.querySelector('#weapon-status')!;this.commands=this.root.querySelector('#command-console')!;this.radar=this.root.querySelector('canvas')!;this.contactCount=this.root.querySelector('#contact-count')!;
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
  this.write(this.navigation,`<span>SECTOR <b>${Math.floor(p.x/EXPLORATION.cell)}:${Math.floor(p.y/EXPLORATION.cell)}</b></span><span class="nav-position">POS <b>${fmt(p.x)} / ${fmt(p.y)}</b></span><span class="${model.atStation?'safe':''}">${model.atStation?'SAFE ZONE':esc(DANGER.labels[model.danger-1].toUpperCase())}</span><span class="nav-destination">${esc(base.name)} · ${fmt(Math.hypot(base.x-p.x,base.y-p.y))} m</span>`);
  const tactical=tacticalReadout(model,aim);this.write(this.target,`${tactical.station&&this.stationIcon?`<img class="contact-icon" src="${this.stationIcon}" alt="">`:""}${tactical.target}`);this.write(this.weapons,tactical.weapons);this.contactCount.textContent=String(tactical.contacts).padStart(2,'0')+' CONTACTS';
  const engines=model.modules.filter(m=>m.kind==='engine'&&m.level>=2&&m.integrity>0),cooldown=Math.max(0,...engines.map(m=>m.boostCooldown??0));
  const commands:[CockpitAction,string,string,string,boolean][]=[['boost','Shift','Burst',model.boostActive?'ACTIVE':engines.length?(model.boostReady?'READY':`${Math.ceil(cooldown)}s`):'L2 ENGINE',!engines.length],['overclock','C','Overclock',model.coreLevel<5?'L5 CORE':model.coreAbility.active>0?`${Math.ceil(model.coreAbility.active)}s ACTIVE`:model.coreAbility.cooldown>0?`${Math.ceil(model.coreAbility.cooldown)}s`:'READY',model.coreLevel<5],['shop','Q','Outfitter',model.atStation?'DOCKED':'AT FORGE',!model.atStation],['build','F','Build mode',buildMode?'ACTIVE':model.builder?'AVAILABLE':'BUILD MODULE',!model.builder],['map','M','Sector map','EXPLORED',false],['dock','E','Dock / repair','MINERALS',false],['settings','⚙','Settings','AUDIO / VFX',false]];
  this.write(this.commands,commands.map(([action,key,label,status,locked])=>`<button type="button" data-command="${action}" ${blocked||model.dead||locked?'disabled':''} title="${esc(label)} · ${esc(status)}"><i class="command-icon">${cockpitIcon(action)}</i><span><kbd>${key}</kbd> ${label}<small>${status}</small></span></button>`).join(''));
 }
 drawRadar(model:GameModel,_view?:Point & {width:number;height:number}){
  const ctx=this.radar.getContext('2d');if(!ctx)return;const size=this.radar.width,c=size/2,r=c-12,range=1600;
  ctx.clearRect(0,0,size,size);ctx.save();ctx.beginPath();ctx.arc(c,c,r,0,Math.PI*2);ctx.clip();ctx.fillStyle='#05121c';ctx.fillRect(0,0,size,size);
  const plot=(p:Point)=>({x:c+(p.x-model.player.x)/range*r,y:c+(p.y-model.player.y)/range*r});
  // Fog is the same explored-cell knowledge as the sector map; no unseen contacts or ore are revealed.
  ctx.fillStyle='#0b2430';for(const key of model.explored){const [x,y]=key.split(',').map(Number),p=plot({x:x*EXPLORATION.cell,y:y*EXPLORATION.cell});const cell=EXPLORATION.cell/range*r;if(p.x+cell<0||p.y+cell<0||p.x>size||p.y>size)continue;ctx.fillRect(p.x,p.y,cell+1,cell+1);}
  ctx.strokeStyle='#19404d';ctx.lineWidth=1;for(let i=1;i<=4;i++){ctx.beginPath();ctx.arc(c,c,r*i/4,0,Math.PI*2);ctx.stroke();}for(let i=0;i<8;i++){const a=i*Math.PI/4;ctx.beginPath();ctx.moveTo(c,c);ctx.lineTo(c+Math.cos(a)*r,c+Math.sin(a)*r);ctx.stroke();}
  for(const rock of model.asteroids){if(!model.isExplored(rock)||Math.hypot(rock.x-model.player.x,rock.y-model.player.y)>range)continue;const p=plot(rock);ctx.fillStyle='#528c9b';ctx.fillRect(Math.round(p.x)-1,Math.round(p.y)-1,3,3);}
  for(const base of model.bases){if(!model.isExplored(base))continue;const p=plot(base);ctx.strokeStyle=base.unlocked?'#78dec0':'#e0c886';ctx.strokeRect(Math.round(p.x)-4,Math.round(p.y)-4,8,8);}
  for(const outpost of model.outposts){const p=plot({x:(outpost.cx+.5)*OUTPOST.cell,y:(outpost.cy+.5)*OUTPOST.cell});ctx.strokeStyle='#e0c886';ctx.strokeRect(Math.round(p.x)-3,Math.round(p.y)-3,6,6);}
  for(const e of model.enemies){if(e.health<=0||!model.isExplored(e)||Math.hypot(e.x-model.player.x,e.y-model.player.y)>1100)continue;const p=plot(e);ctx.fillStyle='#ee7f89';ctx.beginPath();ctx.moveTo(p.x,p.y-5);ctx.lineTo(p.x+4,p.y);ctx.lineTo(p.x,p.y+5);ctx.lineTo(p.x-4,p.y);ctx.closePath();ctx.fill();}
  ctx.translate(c,c);ctx.rotate(model.player.angle);ctx.fillStyle='#70dce8';ctx.beginPath();ctx.moveTo(9,0);ctx.lineTo(-6,-5);ctx.lineTo(-3,0);ctx.lineTo(-6,5);ctx.closePath();ctx.fill();ctx.restore();ctx.strokeStyle='#4fabb6';ctx.beginPath();ctx.arc(c,c,r,0,Math.PI*2);ctx.stroke();
 }
}
