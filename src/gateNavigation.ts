import type { GameModel } from './model.ts';
import type { NetClient } from './net.ts';
import { WORMHOLE } from './data.ts';
import { worldRef, warpTo } from './sectors.ts';
import { gatesFor, footprint, fitsGate, planGateRoute, travelError, gateCosts, sectorDistance, sameSector, targetSector, validSector, type Gate, type GateCharge } from './wormholes.ts';
import type { WorldRef } from './netProtocol.ts';
import type { Outpost } from './outposts.ts';
import './wormholes.css';

type Grant={id:string;from:WorldRef;to:WorldRef;near?:{x:number;y:number};spot?:{x:number;y:number};occupied?:{x:number;y:number;radius:number}[];outposts?:Outpost[]};
type Journey={id:string;seed:string;gate:Gate;to:WorldRef;crew:boolean;charge?:GateCharge;grant?:Grant;completeId:string;phase:'start'|'charge'|'complete'|'apply'};
type Hooks={model:()=>GameModel;save:(m:GameModel)=>Promise<string|undefined>;switchModel:(m:GameModel)=>void;canCommit:()=>boolean;suspend:(v:boolean)=>void;sound:(cue:'warp'|'collect'|'fail')=>void};
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
/** Per-pilot route and durable request journal; no crew state is edited in the browser. */
export class GateNavigation {
  readonly dialog=document.createElement('dialog');
  private net:NetClient;private hooks:Hooks;private journey?:Journey;private busy=false;private retryAt=0;private loaded='';private selected='';private crewIds=new Set<string>();private destination={x:0,y:0};private note='';private stamp='';private refreshed=0;private journalKey='';private mapCenter?:{home:string;x:number;y:number};private mapScale=42;
  constructor(net:NetClient,hooks:Hooks){this.net=net;this.hooks=hooks;this.dialog.className='warp-dialog';this.dialog.setAttribute('aria-label','Wormhole gate navigation');
    this.dialog.innerHTML='<header><div><small>VOIDFORGE / WORMHOLE CONTROL</small><h2>Gate navigation</h2></div><button data-warp="close" aria-label="Close gate navigation">×</button></header><div class="warp-body"><label>Departure gate<select data-gate></select></label><div class="warp-status" aria-live="polite"></div><div class="warp-destination"><label>Destination X<input data-x type="number" step="1" min="-999999999" max="999999999"></label><label>Destination Y<input data-y type="number" step="1" min="-999999999" max="999999999"></label></div><div class="warp-route"></div><p class="warp-warning">Each activation moves only your ship. Approach each intermediate gate and confirm again. A temporary arrival portal cannot take you back.</p><div class="warp-actions"><button data-warp="cancel" hidden>Cancel charge</button><button data-warp="review">Activate wormhole →</button></div><div class="warp-confirm" hidden><strong>Confirm wormhole activation?</strong><p></p><button data-warp="back">Keep planning</button><button data-warp="confirm">Charge & travel</button></div><p class="warp-note" role="status"></p></div>';
    document.body.append(this.dialog);
    this.dialog.addEventListener('pointerdown',e=>e.stopPropagation());
    this.dialog.addEventListener('cancel',e=>{e.preventDefault();this.dialog.close();});
    this.dialog.addEventListener('input',()=>{this.destination={x:Number(this.dialog.querySelector<HTMLInputElement>('[data-x]')!.value),y:Number(this.dialog.querySelector<HTMLInputElement>('[data-y]')!.value)};this.hideReview();this.fitRoute();this.refresh();});
    this.dialog.querySelector('select')!.addEventListener('change',e=>{this.selected=(e.target as HTMLSelectElement).value;this.mapCenter=undefined;this.hideReview();this.refresh();});
    this.dialog.addEventListener('click',e=>{const action=(e.target as HTMLElement).closest<HTMLButtonElement>('[data-warp]')?.dataset.warp;if(!action)return;
      if(action==='close')this.dialog.close();if(action==='back')this.hideReview();if(action==='cancel')void this.cancel();
      if(action==='review'){const g=this.gates.find(g=>g.id===this.selected),hop=g&&this.route(g)?.hops[0];if(!g||!hop)return;this.dialog.querySelector<HTMLElement>('.warp-confirm')!.hidden=false;this.dialog.querySelector('.warp-confirm p')!.textContent=`Depart ${g.name} for (${hop.to.x}, ${hop.to.y}). Spend ${hop.energy} outpost energy; charge ${gateCosts(g,sectorDistance(g.world,hop.to),this.ship).charge.toFixed(1)} s. Your ship remains vulnerable while charging.`;this.dialog.querySelector<HTMLButtonElement>('[data-warp="back"]')!.focus();}
      if(action==='confirm')void this.start();
    });
  }
  get pending(){return Boolean(this.journey);}
  get committing(){return this.journey?.phase==='complete'||this.journey?.phase==='apply';}
  private key(){return this.journalKey||`voidforge.warp.${this.net.pilotId||'personal'}`;}
  private persist(){if(this.journey)localStorage.setItem(this.key(),JSON.stringify(this.journey));else localStorage.removeItem(this.key());}
  private get ship(){const m=this.hooks.model();return footprint([['core',0,0,m.coreLevel],...m.modules.map(b=>[b.kind,b.x,b.y,b.level] as [string,number,number,number])],m.player.angle);}
  get gates(){const m=this.hooks.model(),view=this.net.crewState?.outpostView as {gates?:Gate[];wormholeProtocol?:number}|undefined;
    const crew=this.net.wormholes&&this.net.crewState?.crew&&view?.wormholeProtocol===1?view.gates??[]:[];this.crewIds=new Set(crew.map(g=>g.id));
    return [...m.outposts.flatMap(p=>gatesFor(p,worldRef(m))),...crew];
  }
  private route(g:Gate){return validSector(this.destination)?planGateRoute(this.gates,g.id,targetSector(g.world,this.destination.x,this.destination.y),this.ship):undefined;}
  open(id?:string){const gates=this.gates,current=worldRef(this.hooks.model());this.selected=id??gates.find(g=>sameSector(g.world,current))?.id??gates[0]?.id??'';
    const selected=gates.find(g=>g.id===this.selected);this.destination={x:selected?.world.x??current.x,y:(selected?.world.y??current.y)+1};
    this.dialog.querySelector<HTMLInputElement>('[data-x]')!.value=String(this.destination.x);this.dialog.querySelector<HTMLInputElement>('[data-y]')!.value=String(this.destination.y);this.mapCenter=undefined;this.hideReview();this.refresh();if(!this.dialog.open)this.dialog.show();
  }
  chooseSector(x:number,y:number){this.destination={x,y};this.dialog.querySelector<HTMLInputElement>('[data-x]')!.value=String(x);this.dialog.querySelector<HTMLInputElement>('[data-y]')!.value=String(y);this.hideReview();this.refresh();}
  private hideReview(){this.dialog.querySelector<HTMLElement>('.warp-confirm')!.hidden=true;}
  frame(){const identity=this.net.pilotId||'personal';if(identity!==this.loaded&&!this.journey){this.loaded=identity;try{this.journey=JSON.parse(localStorage.getItem(this.key())??'null')??undefined;if(this.journey)this.journalKey=this.key();}catch{this.note='Pending warp journal could not be read.';}}
    if(this.journey&&!this.busy&&this.hooks.model().dead&&!this.committing)void this.cancel();else if(this.journey&&!this.busy&&Date.now()>=this.retryAt)void this.advance();if(this.dialog.open&&Date.now()-this.refreshed>200){this.refreshed=Date.now();this.refresh();}
  }
  private refresh(){const gates=this.gates,g=gates.find(g=>g.id===this.selected),select=this.dialog.querySelector<HTMLSelectElement>('select')!,stamp=gates.map(g=>g.id+g.name).join('|');
    if(stamp!==this.stamp){select.innerHTML=gates.map(g=>`<option value="${esc(g.id)}">${esc(g.name)} · (${g.world.x}, ${g.world.y})${this.crewIds.has(g.id)?' · CREW':' · PRIVATE'}</option>`).join('');this.stamp=stamp;}select.value=this.selected;
    const route=g&&this.route(g),near=g&&sameSector(g.world,worldRef(this.hooks.model()))&&Math.hypot(this.hooks.model().player.x-g.x,this.hooks.model().player.y-g.y)<=WORMHOLE.useRange+Math.max(g.width,g.height)/2;
    this.dialog.querySelector('.warp-status')!.textContent=g?`${g.status} · Controller L${g.level} · Range ${g.range}\nOrigin (${g.world.x}, ${g.world.y}) · Grid ${g.world.home.slice(0,18)}\nOpening ${g.width} × ${g.height} · Ship ${Math.ceil(this.ship.width)} × ${Math.ceil(this.ship.height)} · ${fitsGate(g,this.ship)?'FITS':'DOES NOT FIT'}\nEnergy ${Math.floor(g.energy)} · Heat ${Math.round(g.heat)} / ${Math.round(g.heatCapacity)} · Cooldown ${g.cooldown.toFixed(1)} s\n${g.accessible?'Access permitted':'Access unavailable'}${near?' · In activation range':' · Approach this gate to activate'}`:'No gates available. Build a closed frame with one controller, or connect to your crew’s updated relay.';
    this.dialog.querySelector('.warp-route')!.textContent=route?`${route.hops.length} activation${route.hops.length===1?'':'s'} · Estimated energy ${route.energy}\n${route.hops.map(h=>`${h.gate.name} → (${h.to.x}, ${h.to.y}) · ${h.energy} energy`).join('\n')}`:`Destination unavailable: ${g&&validSector(this.destination)?travelError(g,targetSector(g.world,this.destination.x,this.destination.y),this.ship)??'No viable route':'Choose a departure gate and whole sector coordinates'}. No viable multi-hop route.`;
    this.dialog.querySelector<HTMLButtonElement>('[data-warp="review"]')!.disabled=!route||!near||this.pending||this.hooks.model().dead;
    this.dialog.querySelector<HTMLButtonElement>('[data-warp="cancel"]')!.hidden=!this.journey||this.committing;
    this.dialog.querySelector('.warp-note')!.textContent=this.pending?`${this.journey!.phase==='charge'?'Charging wormhole…':'Resolving departure…'} ${this.note}`:this.note;
  }
  private async start(){if(this.pending||this.busy)return;const g=this.gates.find(g=>g.id===this.selected),hop=g&&this.route(g)?.hops[0];if(!g||!hop)return;
    this.journalKey=this.key();this.journey={id:crypto.randomUUID(),completeId:crypto.randomUUID(),seed:this.hooks.model().seed,gate:g,to:hop.to,crew:this.crewIds.has(g.id),phase:'start'};
    try{this.persist();this.hideReview();await this.advance();}catch(error){this.note=(error as Error).message;this.journey=undefined;}this.refresh();
  }
  private checkApproach(g:Gate){const m=this.hooks.model();if(m.dead)throw Error('A living ship is required.');if(!sameSector(g.world,worldRef(m))||Math.hypot(m.player.x-g.x,m.player.y-g.y)>WORMHOLE.useRange+Math.max(g.width,g.height)/2)throw Error('Approach the departure gate.');}
  private personal(){const m=this.hooks.model(),j=this.journey!,post=m.outposts.find(p=>p.id===j.gate.outpostId),controller=post?.structures.find(s=>s.id===j.gate.controllerId);if(!post||!controller)throw Error('Departure gate no longer exists.');return {m,post,controller};}
  private async advance(){const j=this.journey;if(!j||this.busy)return;this.busy=true;
    try{const m=this.hooks.model(),mark=m.crewEconomyMarks.find(r=>r.id===j.id);if(mark?.phase==='applied'){const error=await this.hooks.save(m);if(error)throw Error(error);this.finish();return;}
      if(m.seed!==j.seed)throw Error('Load the save that started this departure.');
      if(j.phase==='start'){const error=await this.hooks.save(m);if(error)throw Error(error);
        if(j.crew){if(!this.net.wormholes)throw Error('The relay needs the wormhole update.');const r=await this.net.crewRequest('outpost-warp-start',{outpostId:j.gate.outpostId,controllerId:j.gate.controllerId,to:{x:j.to.x,y:j.to.y}},j.id);if(!r.ok){this.note=r.error??'Departure rejected.';this.finish();return;}j.charge=(r.result as any).charge;}
        else{const {post,controller}=this.personal(),gate=gatesFor(post,worldRef(m)).find(g=>g.controllerId===controller.id)!;
          if(controller.gateCharge?.id===j.id)j.charge=controller.gateCharge;else{this.checkApproach(gate);const error=travelError(gate,j.to,this.ship);if(error)throw Error(error);const cost=gateCosts(gate,sectorDistance(gate.world,j.to),this.ship);post.energy!-=cost.energy;post.heat=(post.heat??0)+cost.heat;controller.gateCharge=j.charge={id:j.id,pilotId:'personal',to:j.to,readyAt:Date.now()+cost.charge*1000,expiresAt:Date.now()+WORMHOLE.reservationLifetime*1000,energy:cost.energy};const saveError=await this.hooks.save(m);if(saveError)throw Error(saveError);}}
        j.phase='charge';this.persist();this.hooks.sound('warp');
      }
      if(j.phase==='charge'){if(Date.now()<j.charge!.readyAt)return;this.hooks.suspend(true);if(!this.hooks.canCommit())return;j.phase='complete';this.persist();}
      if(j.phase==='complete'){if(!this.hooks.canCommit())return;
        if(j.crew){const r=await this.net.crewRequest('outpost-warp-complete',{outpostId:j.gate.outpostId,controllerId:j.gate.controllerId,ticketId:j.id},j.completeId);if(!r.ok){const rejection=r.error??'Departure rejected.';j.phase='charge';this.busy=false;await this.cancel();this.note=rejection;return;}j.grant=(r.result as any).warp;}
        else{const {post,controller}=this.personal(),g=gatesFor(post,worldRef(m)).find(g=>g.controllerId===controller.id)!;this.checkApproach(g);const error=travelError(g,j.to,this.ship,true);if(error)throw Error(error);if(Date.now()>j.charge!.expiresAt)throw Error('Gate charge expired; cancel it.');if(gateCosts(g,sectorDistance(g.world,j.to),this.ship).energy>j.charge!.energy)throw Error('Ship changed; cancel and recharge.');if(controller.gateCharge?.id!==j.id)throw Error('Gate charge no longer exists.');warpTo(m,j.to);j.grant={id:j.id,from:g.world,to:j.to};}
        j.phase='apply';this.persist();
      }
      if(j.phase==='apply'){if(!j.crew){const {controller}=this.personal();controller.gateCharge=undefined;controller.gateCooldown=gateCosts(j.gate,sectorDistance(j.gate.world,j.to),this.ship).cooldown;}const grant=j.grant!,next=warpTo(m,grant.to,grant.near,grant.outposts,grant.occupied,grant.spot);next.crewEconomyMarks.push({id:j.id,phase:'applied'});
        this.net.independentTravel=true;this.hooks.switchModel(next);if(this.hooks.model()!==next)throw Error('Another transfer is still pending.');
        const error=await this.hooks.save(next);if(error)throw Error(error);this.hooks.sound('collect');this.note='Arrived. Confirm each additional hop at its departure gate.';this.finish();this.dialog.close();
      }
    }catch(error){if(!j.crew&&j.phase==='complete')j.phase='charge';this.note=(error as Error).message;this.retryAt=Date.now()+3000;this.hooks.model().message=`${this.note} Warp journal retained for retry.`;}finally{this.busy=false;}
  }
  private finish(){this.journey=undefined;this.persist();this.journalKey='';this.hooks.suspend(false);}
  private async cancel(){const j=this.journey;if(!j||this.busy||this.committing)return;if(j.crew&&!j.charge){await this.advance();return;}this.busy=true;try{
    if(j.crew&&j.charge){const r=await this.net.crewRequest('outpost-warp-cancel',{outpostId:j.gate.outpostId,controllerId:j.gate.controllerId,ticketId:j.id},`${j.id}-cancel`);if(!r.ok&&!r.error?.includes('no longer')&&!r.error?.includes('membership')&&!r.error?.includes('Join a crew'))throw Error(r.error);}
    else if(!j.crew){const {post,controller,m}=this.personal();if(controller.gateCharge?.id===j.id){post.energy=Math.min((await import('./outposts.ts')).outpostStats(post).energyCapacity,(post.energy??0)+controller.gateCharge.energy);controller.gateCharge=undefined;const saveError=await this.hooks.save(m);if(saveError)throw Error(saveError);}}
    this.note='Charge cancelled.';this.finish();
  }catch(error){this.note=(error as Error).message;if(!j.crew&&this.note.includes('no longer exists'))this.finish();}finally{this.busy=false;this.refresh();}}
  private fitRoute(){const g=this.gates.find(g=>g.id===this.selected),route=g&&this.route(g);if(!g||!route)return;const points=[g.world,...route.hops.map(h=>h.to)],xs=points.map(w=>w.x),ys=points.map(w=>w.y);this.mapCenter={home:g.world.home,x:(Math.min(...xs)+Math.max(...xs))/2,y:(Math.min(...ys)+Math.max(...ys))/2};this.mapScale=Math.min(65,600/Math.max(6,Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys)));}
  private networkCenter(){const current=worldRef(this.hooks.model()),selected=this.gates.find(g=>g.id===this.selected);return this.mapCenter??={...(selected?.world??current)};}
  zoomNetwork(delta:number){this.mapScale=Math.max(20,Math.min(130,this.mapScale*Math.exp(-delta*.0015)));}
  panNetwork(dx:number,dy:number,width:number){const c=this.networkCenter();c.x-=dx/width*720/this.mapScale;c.y-=dy/width*720/this.mapScale;}
  drawNetwork(canvas:HTMLCanvasElement){
    const ctx=canvas.getContext('2d')!,gates=this.gates,current=worldRef(this.hooks.model()),selected=gates.find(g=>g.id===this.selected)??gates.find(g=>sameSector(g.world,current)),center=this.networkCenter(),size=canvas.width,scale=this.mapScale;
    ctx.fillStyle='#04121d';ctx.fillRect(0,0,size,size);ctx.font='12px monospace';ctx.textAlign='center';
    const point=(w:{x:number;y:number})=>({x:size/2+(w.x-center.x)*scale,y:size/2+(w.y-center.y)*scale});
    const span=Math.ceil(size/scale/2)+1;
    ctx.strokeStyle='#15303e';ctx.fillStyle='#73929f';
    for(let i=-span;i<=span;i++){
      const x=Math.round(center.x)+i,y=Math.round(center.y)+i,px=point({x,y:center.y}).x,py=point({x:center.x,y}).y;
      ctx.beginPath();ctx.moveTo(px,0);ctx.lineTo(px,size);ctx.moveTo(0,py);ctx.lineTo(size,py);ctx.stroke();ctx.fillText(String(x),px,16);ctx.fillText(String(y),18,py);
    }
    // Reachable cells use the real source cost/heat and ship aperture, not just a radius.
    if(selected)for(let dx=-selected.range;dx<=selected.range;dx++)for(let dy=-selected.range;dy<=selected.range;dy++){
      const to=targetSector(selected.world,selected.world.x+dx,selected.world.y+dy);if(travelError(selected,to,this.ship))continue;
      const p=point(to);ctx.fillStyle='#40d9ee18';ctx.fillRect(p.x-scale/2+1,p.y-scale/2+1,scale-2,scale-2);
    }
    const visible=gates.filter(g=>g.world.home===center.home&&Math.abs(g.world.x-center.x)<span&&Math.abs(g.world.y-center.y)<span);
    ctx.strokeStyle='#236576';ctx.lineWidth=1;
    for(const g of visible)for(const next of visible){if(g.id>=next.id||(travelError(g,next.world,this.ship)&&travelError(next,g.world,this.ship)))continue;const a=point(g.world),b=point(next.world);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
    const route=selected&&this.route(selected);ctx.strokeStyle='#99f5ff';ctx.lineWidth=3;
    for(const hop of route?.hops??[]){const a=point(hop.gate.world),b=point(hop.to);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
    for(const g of visible){const p=point(g.world);ctx.strokeStyle=g.status==='Operational'&&fitsGate(g,this.ship)?'#64e8ff':g.status==='Damaged'?'#ff9464':'#647482';ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(p.x,p.y,9,13,.4,0,Math.PI*2);ctx.stroke();ctx.fillStyle=ctx.strokeStyle;ctx.fillText(`${g.name.slice(0,20)} L${g.level}`,p.x,p.y+28);}
    if(current.home===center.home){const p=point(current);ctx.fillStyle='#ffd481';ctx.fillRect(p.x-3,p.y-3,6,6);ctx.fillText('YOUR SECTOR',p.x,p.y-21);}
    ctx.textAlign='left';ctx.fillStyle='#abd4df';ctx.fillText('WHEEL: ZOOM · DRAG: PAN · CLICK SECTOR: PLAN',20,size-20);
  }
  networkClick(u:number,v:number){const center={...this.networkCenter()},x=Math.round(center.x+(u-.5)*720/this.mapScale),y=Math.round(center.y+(v-.5)*720/this.mapScale);
    if(!this.dialog.open)this.open();this.mapCenter=center;this.chooseSector(x,y);
  }
}
