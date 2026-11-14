import { RESOURCES, type Resource } from '../../data.ts';
import type { CargoTarget } from '../../adminProtocol.ts';
import type { ShipBlock } from '../../netProtocol.ts';
import { shipImage } from '../art.ts';
import { isBot } from '../roster.ts';
import { $, ago, confirmDo, esc, nameOf, pilotById, send, store, toast } from '../state.ts';
import { follow, pilotAction } from './actions.ts';
import { eventLine } from './activity.ts';
import { where } from './roster.ts';

/**
 * The pilot drawer: a live mini-map of their sector drawn with the game's art, a ship preview from their block
 * layout, connection and status details, one-click actions, and tabs for their recent activity and the
 * inspector (cargo, storage, stations and outposts, answered by their own game).
 */
type Report = { simulated?: boolean; ship: string; coreLevel: number; hull: number; sector: string; at: { x: number; y: number }; kills: number; deaths: number; cargo: Record<Resource, number>; stored: Record<Resource, number>;
  bases: { index: number; name: string; unlocked: boolean }[]; outposts: { id: number; name: string; stored?: Record<Resource, number>; blocks: [number, string, number, number, number][] }[]; truncated?: boolean };
const ORES = Object.keys(RESOURCES) as Resource[];
let tab: 'activity' | 'inspector' = 'activity', report: Report | undefined, asked = '', zoom = 0.09;
/** The inspector holds editable inputs, so it is rebuilt only when a new report arrives or its tab opens, never on the 1 s refresh. */
let inspectorDirty = true;

export function openDrawer(id: string) {
  if (store.drawer !== id) { report = undefined; asked = ''; inspectorDirty = true; }
  store.drawer = id; $('#drawer').hidden = false;
  void send({ t: 'pilot', id })?.then(m => { const r = m as { t: string; blocks?: ShipBlock[]; paint?: number } | undefined; if (r?.t === 'pilot') store.map.setLayout(id, r.blocks, r.paint); });
  if (tab === 'inspector') inspect();
  render();
}
export function closeDrawer() { store.drawer = undefined; $('#drawer').hidden = true; }
function inspect() { const id = store.drawer; if (!id || asked === id) return; asked = id; send({ t: 'inspect', id }); }
export function onReport(id: string, data: unknown) { if (id === store.drawer) { report = data as Report; inspectorDirty = true; if (tab === 'inspector') renderTab(); } }

export function initDrawer() {
  const el = $('#drawer');
  el.addEventListener('click', async e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button'), id = store.drawer; if (!b || !id) return;
    if (b.dataset.close !== undefined) { closeDrawer(); return; }
    if (b.dataset.tab) { tab = b.dataset.tab as typeof tab; inspectorDirty = true; if (tab === 'inspector') inspect(); render(); return; }
    if (b.dataset.zoom) { zoom = Math.max(0.02, Math.min(0.5, zoom * (b.dataset.zoom === 'in' ? 1.6 : 1 / 1.6))); return; }
    if (b.dataset.act) { if (b.dataset.act === 'follow') follow(store.map.followed === id ? undefined : id); else void pilotAction(b.dataset.act, id); render(); return; }
    if (b.dataset.refresh !== undefined) { asked = ''; inspect(); return; }
    if (b.dataset.ores !== undefined) {
      const box = b.closest('.ores') as HTMLElement, raw = box.dataset.target!, target: CargoTarget = raw.startsWith('outpost:') ? { outpost: Number(raw.slice(8)) } : raw as 'cargo' | 'stored';
      const delta: Partial<Record<Resource, number>> = {};
      for (const input of Array.from(box.querySelectorAll<HTMLInputElement>('input[data-ore]'))) { const d = Math.round(Number(input.value) || 0) - Number(input.dataset.was); if (d) delta[input.dataset.ore as Resource] = d; }
      if (!Object.keys(delta).length) { toast('No changes.', false); return; }
      send({ t: 'cargo', id, target, delta }, `Edit minerals of ${nameOf(id)}`); return;
    }
    const action = b.dataset.block === undefined && b.dataset.outpost === undefined ? undefined : b.dataset.do as 'repair' | 'upgrade' | 'destroy';
    if (action) {
      const outpost = Number(b.dataset.outpost), block = b.dataset.block === undefined ? undefined : Number(b.dataset.block);
      if (action === 'destroy' && !await confirmDo(block === undefined ? 'Destroy this whole outpost?' : 'Destroy this block?', 'Its stored minerals move to station storage.')) return;
      send({ t: 'structure', id, outpost, structure: block, action }, `${action} for ${nameOf(id)}`);
    }
  });
  el.addEventListener('change', e => {
    const input = e.target as HTMLInputElement; if (!input.dataset.station || !store.drawer) return;
    send({ t: 'station', id: store.drawer, index: Number(input.dataset.station), unlocked: input.checked }, `${input.checked ? 'Unlock' : 'Lock'} station`);
  });
}

/** Re-renders the drawer's text parts (once a second, and on changes). The mini-map and preview draw every frame. */
export function render() {
  const id = store.drawer; if (!id) return;
  const p = pilotById(id);
  if (!p) { $('#drawer-head').innerHTML = `<b>Pilot left</b><span class="grow"></span><button class="icon" data-close title="Close">✕</button>`; $('#drawer-stats').innerHTML = '<p class="empty">This pilot is no longer online.</p>'; return; }
  $('#drawer-head').innerHTML = `<div><b>${esc(p.name)}</b> ${p.authority ? '<span class="tag">AUTH</span>' : ''}${p.dead ? '<span class="tag red">DEAD</span>' : ''}${isBot(p) ? '<span class="tag dim">BOT</span>' : ''}<div class="sub">${esc(where(p))}</div></div><span class="grow"></span><button class="icon" data-close title="Close (Esc)">✕</button>`;
  const stat = (k: string, v: string) => `<div><span>${k}</span><b>${v}</b></div>`;
  $('#drawer-stats').innerHTML = [stat('Address', esc(p.ip)), stat('Online', ago(p.since)), stat('Ping', p.ping === undefined ? '–' : `${p.ping} ms`), stat('Messages', `${p.rate}/s`),
    stat('Power', p.profile ? String(Math.round(p.profile.power)) : '–'), stat('Lobby', p.lobby ? esc(p.lobby) : '–'), stat('Position', p.at ? `${Math.round(p.at.x)}, ${Math.round(p.at.y)}` : '–'), stat('Id', esc(p.id))].join('');
  $('#drawer-actions').innerHTML = [['follow', store.map.followed === id ? 'Unfollow' : 'Follow (F)'], ['message', 'Message'], ['teleport', 'Teleport'], ['sendTo', 'Send to…'], ['evict', 'Send home'], ['rename', 'Rename']]
    .map(([a, l]) => `<button data-act="${a}">${l}</button>`).join('') + '<span class="grow"></span><button class="danger" data-act="kick">Kick</button><button class="danger" data-act="ban">Ban</button>';
  document.querySelectorAll<HTMLElement>('#drawer-tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  if (tab === 'activity' || inspectorDirty) renderTab();
}
function renderTab() {
  const id = store.drawer!, box = $('#drawer-tab');
  if (tab === 'activity') {
    const name = nameOf(id), mine = store.events.filter(e => e.id === id || e.kind === 'admin' && e.name === name).slice(-60).reverse();
    box.innerHTML = mine.length ? `<ul class="feed">${mine.map(eventLine).join('')}</ul>` : '<p class="empty">No activity recorded for this pilot yet.</p>';
    return;
  }
  if (!report) { box.innerHTML = '<p class="empty">Asking the pilot\'s game… (no answer means an older game version)</p>'; return; }
  inspectorDirty = false;
  if (report.simulated) { box.innerHTML = '<p class="empty">This is a simulated pilot: it has no inspectable game state.</p>'; return; }
  const r = report;
  const ores = (title: string, target: string, values?: Record<Resource, number>) => `<div class="ores" data-target="${esc(target)}"><h4>${esc(title)}</h4>${ORES.map(o => `<label><span style="color:#${RESOURCES[o].color.toString(16).padStart(6, '0')}">${RESOURCES[o].label}</span><input type="number" step="1" min="0" data-ore="${o}" data-was="${Math.floor(values?.[o] ?? 0)}" value="${Math.floor(values?.[o] ?? 0)}"></label>`).join('')}<button data-ores>Apply</button></div>`;
  const n = (v: unknown) => esc(Number(v) || 0);
  box.innerHTML = `<div class="row"><span class="sub">${esc(r.sector)} · ${n(r.at?.x)}, ${n(r.at?.y)} · core L${n(r.coreLevel)} · hull ${n(r.hull)} · ${n(r.kills)} kills / ${n(r.deaths)} deaths</span><span class="grow"></span><button data-refresh>Refresh</button></div>
    <p class="warn">Mineral edits create or remove minerals. Every change is logged.</p>
    ${ores('Ship cargo', 'cargo', r.cargo)}${ores('Station storage', 'stored', r.stored)}
    <h4>Stations</h4><ul class="stations">${r.bases.map(b => `<li><label><input type="checkbox" data-station="${n(b.index)}" ${b.unlocked ? 'checked' : ''} ${b.index === 0 ? 'disabled' : ''}> ${esc(b.name)}</label></li>`).join('')}</ul>
    <h4>Outposts</h4>${r.outposts.length ? r.outposts.map(o => `<div class="card"><div class="row"><b>${esc(o.name)}</b><span class="grow"></span><button data-outpost="${n(o.id)}" data-do="repair">Repair all</button><button data-outpost="${n(o.id)}" data-do="upgrade">Upgrade all</button><button class="danger" data-outpost="${n(o.id)}" data-do="destroy">Destroy</button></div>
      ${ores('Outpost storage', `outpost:${n(o.id)}`, o.stored)}
      <table class="blocks">${o.blocks.map(([bid, kind, level, hp, max]) => `<tr><td>${esc(kind)}</td><td>L${n(level)}</td><td>${n(hp)}/${n(max)}</td><td><button data-outpost="${n(o.id)}" data-block="${n(bid)}" data-do="repair">Repair</button><button data-outpost="${n(o.id)}" data-block="${n(bid)}" data-do="upgrade">+1</button><button class="danger" data-outpost="${n(o.id)}" data-block="${n(bid)}" data-do="destroy">✕</button></td></tr>`).join('')}</table></div>`).join('') : '<p class="empty">None.</p>'}
    ${r.truncated ? '<p class="sub">Lists were shortened to fit.</p>' : ''}`;
}

/** Draws the mini-map and ship preview (every frame while open). */
export function frame(now: number, watched: Set<string>) {
  const id = store.drawer; if (!id) return;
  const mini = $<HTMLCanvasElement>('#minimap'), dpr = devicePixelRatio || 1, w = mini.clientWidth, h = mini.clientHeight;
  if (mini.width !== Math.round(w * dpr) || mini.height !== Math.round(h * dpr)) { mini.width = Math.round(w * dpr); mini.height = Math.round(h * dpr); }
  const ctx = mini.getContext('2d')!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cam = store.map.cameraOn(id, zoom);
  if (cam) store.map.draw(ctx, w, h, now, watched, cam, false); else { ctx.fillStyle = '#050911'; ctx.fillRect(0, 0, w, h); }
  const ship = store.map.ships.get(id), preview = $<HTMLCanvasElement>('#shippreview'), pw = preview.clientWidth, ph = preview.clientHeight;
  if (preview.width !== Math.round(pw * dpr)) { preview.width = Math.round(pw * dpr); preview.height = Math.round(ph * dpr); }
  const pc = preview.getContext('2d')!; pc.setTransform(dpr, 0, 0, dpr, 0, 0); pc.clearRect(0, 0, pw, ph); pc.imageSmoothingEnabled = false;
  const art = ship?.blocks ? shipImage(ship.blocks, ship.paint) : undefined;
  if (art) {
    const scale = Math.max(1, Math.floor(Math.min(pw / art.canvas.height, ph / art.canvas.width) * 0.9));
    pc.save(); pc.translate(pw / 2, ph / 2); pc.rotate(-Math.PI / 2); pc.drawImage(art.canvas, -art.canvas.width * scale / 2, -art.canvas.height * scale / 2, art.canvas.width * scale, art.canvas.height * scale); pc.restore();
  } else { pc.fillStyle = '#8191ab'; pc.font = '12px ui-monospace, Consolas, monospace'; pc.textAlign = 'center'; pc.fillText('Layout unknown', pw / 2, ph / 2); pc.textAlign = 'left'; }
}
