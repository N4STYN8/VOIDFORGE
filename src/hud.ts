import {cockpitIcon} from './cockpitArt.ts';
import type { GameModel } from './model.ts';
import { DANGER } from './data.ts';
export type FlightHudState={base:GameModel['bases'][number];direction:string;zoom:number;muted:boolean;effects:boolean;detailsOpen:boolean};
const fmt=(n:number)=>Math.round(n).toLocaleString();
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function flightHud(model:GameModel,state:FlightHudState){
  const p=model.player,vitals:[string,number,number,string][]=[['Hull',p.health,model.maxHealth,'#78dec0'],['Shield',model.shield,model.maxShield,'#79dfff'],['Energy',model.energy,model.maxEnergy,'#e0c886'],['Heat',model.heat,model.heatCapacity,model.heat>model.heatCapacity*.8?'#ee937b':'#a8a2dc']];
  const rows=vitals.map(([label,n,max,color])=>`<div class="vital vital-${label.toLowerCase()}${label==='Hull'&&max&&n/max<.3?' low':''}${label==='Heat'&&max&&n/max>.8?' hot':''}" data-system="${label.toLowerCase()}"><span class="vital-icon">${cockpitIcon(label.toLowerCase())}</span><div><span>${label}</span><b>${fmt(n)} <small>/ ${fmt(max)}</small></b></div><div class="vital-bar"><i style="width:${Math.max(0,Math.min(100,max?n/max*100:0))}%;background:${color}"></i></div></div>`).join('');
  const colors:Record<string,string>={iron:'#b9bdc7',copper:'#d59460',crystal:'#8ad6ed',ice:'#c5ecff',radioactive:'#9fe63f'};
  const resources=Object.keys(model.cargo).map(ore=>`<tr><th><i style="background:${colors[ore]}"></i>${ore==='radioactive'?'Radioactive':ore[0].toUpperCase()+ore.slice(1)}</th><td><span class="carried-value">${fmt(model.cargo[ore as keyof typeof model.cargo])}</span><button type="button" class="cargo-eject" data-eject="${ore}" aria-label="Eject carried ${ore}" title="Eject carried ${ore} — cannot be recovered" ${model.dead||model.cargo[ore as keyof typeof model.cargo]<=0?'disabled':''}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2 2 10h12zM2 12h12v3H2z"/></svg></button></td><td>${fmt(model.stored[ore as keyof typeof model.stored])}</td></tr>`).join('');
  const distance=Math.hypot(p.x-state.base.x,p.y-state.base.y),hasBoost=model.modules.some(m=>m.kind==='engine'&&m.level>=2);
  return `<header class="flight-header"><div><strong>VOIDFORGE</strong><small>HULL LEVEL ${model.coreLevel}</small><span class="ship-id" title="${esc(model.shipName)}">${esc(model.shipName)}${model.fleetSize>1?` · Fleet ${model.fleetSize}`:''}</span></div><span class="zone-chip ${model.atStation?'safe':'threat-'+model.danger}" title="Threat comes from how rich the nearby ore fields are">${model.atStation?'SAFE':model.horde.warning>0?'ALERT · HORDE':model.hordeCount?'HORDE · '+model.hordeCount:'THREAT · '+DANGER.labels[model.danger-1].toUpperCase()}</span></header><section class="flight-vitals">${rows}</section>${hasBoost?`<div class="boost-status ${model.boostActive?'active':''}"><kbd>Shift</kbd> ${model.boostActive?'OVERDRIVE ACTIVE':model.boostReady?'Burst ready':'Boost cooling down'}</div>`:''}${model.coreLevel>=5?`<div class="boost-status"><kbd>C</kbd> ${model.coreAbility.active>0?`Command Overclock · ${Math.ceil(model.coreAbility.active)}s`:model.coreAbility.cooldown>0?`Overclock cooldown · ${Math.ceil(model.coreAbility.cooldown)}s`:'Command Overclock ready'}</div>`:''}${model.powerLimited||model.heatLimited?`<div class="system-warning">${model.heatLimited?'Cooling — some equipment paused':'Low energy — some equipment paused'}</div>`:''}<section class="resource-section"><div class="section-label">RESOURCES <small>${fmt(model.cargoUsed)} / ${fmt(model.cargoCapacity)} used${model.cargoUsed>=model.cargoCapacity?' · FULL':''}</small></div><div class="cargo-meter"><i style="width:${Math.min(100,model.cargoUsed/model.cargoCapacity*100)}%"></i></div><table class="resource-table"><thead><tr><th>Mineral</th><th>Carried</th><th>Stored</th></tr></thead><tbody>${resources}</tbody></table></section><div class="flight-summary"><div><span>Mining</span><b>${fmt(model.miningRate)} /s</b></div><div><span>Weapons</span><b>${model.installedWeapons}</b></div><div><span>Modules</span><b>${model.modules.length}</b></div><div><span>Mass</span><b>${fmt(model.shipMass)}</b></div></div><section class="base-readout"><div><b>${esc(state.base.name)}</b><span>${fmt(distance)} m ${state.direction.includes('unload')?'':esc(state.direction)}</span></div><p>${state.base.unlocked?'<kbd>E</kbd> Unload / paid repair <span>·</span> <kbd>Q</kbd> Outfitter':`<kbd>G</kbd> Unlock: ${Object.entries(state.base.cost).filter(([,n])=>n).map(([ore,n])=>`${fmt(n)} ${ore}`).join(' + ')}`}</p></section><details class="flight-details" ${state.detailsOpen?'open':''}><summary>Flight details & controls</summary><div><span>Position</span><b>${fmt(p.x)}, ${fmt(p.y)}</b><span>Speed / zoom</span><b>${fmt(Math.hypot(p.vx,p.vy))} / ${Math.round(state.zoom*100)}%</b><span>Reactor / cooling</span><b>${fmt(model.powerGeneration)} / ${fmt(model.coolingRate)} per s</b><span>Enemies destroyed</span><b>${model.kills}</b></div><p><kbd>M</kbd> Map · <kbd>N</kbd> Sound ${state.muted?'off':'on'} · <kbd>V</kbd> Effects ${state.effects?'on':'off'}</p></details>`;
}

/** Refresh readings without replacing live controls between pointer-down and click. */
export function updateFlightHud(root: HTMLElement, html: string) {
  const template = root.ownerDocument.createElement('template');
  template.innerHTML = html;
  const patch = (current: Node, desired: Node) => {
    if (current.nodeType !== desired.nodeType || current.nodeName !== desired.nodeName) {
      current.parentNode!.replaceChild(desired.cloneNode(true), current);
      return;
    }
    if (current.nodeType === 3) {
      if (current.nodeValue !== desired.nodeValue) current.nodeValue = desired.nodeValue;
      return;
    }
    if (current instanceof Element && desired instanceof Element) {
      for (const attribute of Array.from(current.attributes)) {
        if (!desired.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
      }
      for (const attribute of Array.from(desired.attributes)) {
        if (current.getAttribute(attribute.name) !== attribute.value) current.setAttribute(attribute.name, attribute.value);
      }
    }
    const children = Array.from(desired.childNodes);
    children.forEach((child, index) => {
      const existing = current.childNodes[index];
      if (existing) patch(existing, child);
      else current.appendChild(child.cloneNode(true));
    });
    while (current.childNodes.length > children.length) current.removeChild(current.lastChild!);
  };
  const desired = root.cloneNode(false);
  desired.appendChild(template.content);
  patch(root, desired);
}
