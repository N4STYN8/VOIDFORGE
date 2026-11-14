import './admin.css';
import { ENEMIES, RESOURCES, type Resource } from '../data.ts';
import { sectorLabel } from '../sectorGrid.ts';
import type { AdminLobby, AdminPilot, AdminRequest, AdminServerMessage, AuditEntry, BanEntry, CargoTarget } from '../adminProtocol.ts';
import { UniverseMap, type Place } from './map.ts';
import { applyCast, pruneLive } from './sectorView.ts';

/**
 * Relay admin console page. Talks to the relay's /admin/ws socket (same origin, session cookie), shows
 * live pilots, lobbies, bans and the audit log, and drives the universe map. Every action is a request the
 * relay validates and logs; changes to a pilot's game are carried out by that pilot's own client.
 */
type Distribute<T> = T extends unknown ? Omit<T, 'ref'> : never;
type Request = Distribute<AdminRequest>;
const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const ORES = Object.keys(RESOURCES) as Resource[];
const SPAWNABLE = Object.entries(ENEMIES).filter(([, d]) => !d.boss && !d.part).map(([k, d]) => ({ value: k, label: d.label }));

const map = new UniverseMap();
const canvas = $<HTMLCanvasElement>('#map'), ctx = canvas.getContext('2d')!;
let socket: WebSocket | undefined, refs = 0, retry = 1000;
let pilots: AdminPilot[] = [], lobbies: AdminLobby[] = [], bans: BanEntry[] = [], log: AuditEntry[] = [], stats: Record<string, number> = {};
const labels = new Map<number, string>();
let watching: string[] = [];
let inspecting: string | undefined;
let pick: { kind: 'teleport' | 'sendTo'; pilot: string } | { kind: 'spawn'; enemy: string; count: number } | undefined;

// ---------- socket ----------
function connect() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/admin/ws`);
  socket = ws;
  status('Connecting…');
  ws.onopen = () => { retry = 1000; status('Live'); watching = []; };
  ws.onmessage = e => receive(JSON.parse(String(e.data)) as AdminServerMessage);
  ws.onclose = () => {
    if (socket !== ws) return;
    status('Disconnected, retrying…', true);
    // A dead session makes the socket fail: check, and go to the login page if so.
    fetch('/admin/', { redirect: 'manual', cache: 'no-store' }).then(r => { if (r.type === 'opaqueredirect' || r.status === 302) location.href = '/admin/login'; }).catch(() => {});
    setTimeout(connect, retry); retry = Math.min(15000, retry * 2);
  };
}
function send(request: Request, label?: string) {
  if (socket?.readyState !== WebSocket.OPEN) { toast('Not connected.', false); return; }
  const ref = ++refs; if (label) labels.set(ref, label);
  socket.send(JSON.stringify({ ...request, ref }));
  return ref;
}
function receive(m: AdminServerMessage) {
  const now = performance.now() / 1000;
  switch (m.t) {
    case 'overview':
      pilots = m.pilots; lobbies = m.lobbies; bans = m.bans; stats = m.stats;
      map.setOverview(m.pilots, m.rooms, now);
      if (map.followed && !pilots.some(p => p.id === map.followed)) map.followed = undefined;
      renderPanels(); return;
    case 'log': log.push(...m.entries); if (log.length > 200) log = log.slice(-200); renderLog(); return;
    case 'result': { const label = labels.get(m.ref); labels.delete(m.ref); if (label || !m.ok) toast(`${label ?? 'Action'}: ${m.ok ? 'done' : 'failed'}${m.message ? `, ${m.message}` : ''}`, m.ok); return; }
    case 'report': if (m.id === inspecting || !inspecting) { inspecting = m.id; renderInspector(m.data as Report); } return;
    case 'obs': {
      const o = m.m;
      if (o.t === 'state') map.setState(m.r, o.id, o.name, (o as unknown as { s: unknown }).s, now);
      else if (o.t === 'cast') applyCast(m.r, o.from, o.k, o.d, now);
      return;
    }
  }
}

// ---------- chrome ----------
function status(text: string, bad = false) { const el = $('#status'); el.textContent = text; el.classList.toggle('bad', bad); }
function toast(text: string, ok = true) {
  const el = document.createElement('div'); el.className = `toast ${ok ? 'ok' : 'bad'}`; el.textContent = text;
  $('#toasts').append(el); setTimeout(() => el.remove(), 4500);
}
const pilotName = (id?: string) => pilots.find(p => p.id === id)?.name ?? id ?? '';
const where = (p: AdminPilot) => p.world ? `${map.homes.get(p.world.home)?.label ?? p.world.home.slice(0, 8)} · ${sectorLabel(p.world.x, p.world.y)}` : 'menu / no sector';
const ago = (t: number) => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h${Math.floor(s / 60) % 60}m`; };

function renderPanels() {
  $('#stats').textContent = `${pilots.length} online · ${stats.rooms ?? 0} sectors · ${lobbies.length} lobbies · relay ${stats.rssMb ?? '?'} MB · ${stats.admins ?? 1} admin${stats.admins === 1 ? '' : 's'}`;
  $('#count-pilots').textContent = String(pilots.length); $('#count-lobbies').textContent = String(lobbies.length); $('#count-bans').textContent = String(bans.length);
  const sorted = [...pilots].sort((a, b) => a.name.localeCompare(b.name));
  $('#pilots').innerHTML = sorted.length ? sorted.map(p => `<tr data-pilot="${esc(p.id)}" class="${p.id === map.followed ? 'sel' : ''}">
    <td><b>${esc(p.name)}</b>${p.authority ? ' <span class="tag" title="Runs this sector\'s enemies">AUTH</span>' : ''}${p.dead ? ' <span class="tag red">DEAD</span>' : ''}<div class="sub">${esc(p.ip)} · ${ago(p.since)}</div></td>
    <td>${esc(where(p))}${p.lobby ? `<div class="sub">lobby ${esc(p.lobby)}</div>` : ''}</td>
    <td class="num">${p.ping ?? '–'}<div class="sub">${p.rate}/s</div></td>
    <td class="num">${p.profile ? Math.round(p.profile.power) : '–'}</td>
    <td><button data-act="menu" title="Actions">⋯</button></td></tr>`).join('') : '<tr><td colspan="5" class="empty">No pilots online.</td></tr>';
  $('#lobbies').innerHTML = lobbies.length ? lobbies.map(l => `<div class="card"><div class="row"><b>${esc(l.code)}</b><span class="tag ${l.open ? '' : 'dim'}">${l.open ? 'OPEN' : 'PRIVATE'}</span><span class="grow"></span>
    <button data-lobby="${esc(l.code)}" data-act="lobby-msg">Message</button><button data-lobby="${esc(l.code)}" data-act="lobby-open">${l.open ? 'Make private' : 'Make open'}</button><button class="danger" data-lobby="${esc(l.code)}" data-act="disband">Disband</button></div>
    <ul>${l.members.map(m => `<li>${esc(m.name)}${m.id === l.host ? ' <span class="tag">HOST</span>' : ''}<button class="link" data-lobby="${esc(l.code)}" data-member="${esc(m.id)}" data-act="remove">remove</button></li>`).join('')}</ul></div>`).join('') : '<p class="empty">No lobbies.</p>';
  $('#bans').innerHTML = bans.length ? bans.map(b => `<tr><td>${esc(b.ip)}<div class="sub">${esc(b.name)}</div></td><td>${esc(b.reason)}</td><td>${new Date(b.until).toLocaleString()}</td><td><button data-unban="${esc(b.ip)}">Unban</button></td></tr>`).join('') : '<tr><td colspan="4" class="empty">No bans.</td></tr>';
  const f = map.followed && map.ships.get(map.followed), fp = f && pilots.find(p => p.id === f.id);
  $('#follow').innerHTML = fp ? `Following <b>${esc(fp.name)}</b> · ${esc(where(fp))}${fp.at ? ` · ${Math.round(fp.at.x)}, ${Math.round(fp.at.y)}` : ''} <button id="unfollow">Stop</button>` : '';
  $('#follow').hidden = !fp;
}
function renderLog() {
  $('#log').innerHTML = [...log].reverse().map(e => `<li><time>${new Date(e.at).toLocaleTimeString()}</time> <b>${esc(e.action)}</b> ${esc(e.target)} <span class="sub">${esc(e.detail ?? '')}</span></li>`).join('');
}

// ---------- modal form ----------
type Field = { name: string; label: string; type?: 'text' | 'number' | 'select'; value?: string | number; options?: { value: string; label: string }[] };
function ask(title: string, fields: Field[], confirmText = 'OK', danger = false): Promise<Record<string, string> | null> {
  const modal = $('#modal');
  modal.innerHTML = `<form class="dialog"><h3>${esc(title)}</h3>${fields.map(f => `<label>${esc(f.label)}${f.type === 'select'
    ? `<select name="${f.name}">${f.options!.map(o => `<option value="${esc(o.value)}"${o.value === f.value ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`
    : `<input name="${f.name}" type="${f.type ?? 'text'}" value="${esc(f.value ?? '')}" ${f.type === 'number' ? 'step="any"' : 'maxlength="200"'}>`}</label>`).join('')}
    <div class="row"><span class="grow"></span><button type="button" data-cancel>Cancel</button><button class="${danger ? 'danger' : 'primary'}">${esc(confirmText)}</button></div></form>`;
  modal.hidden = false;
  (modal.querySelector('input,select') as HTMLElement | null)?.focus();
  return new Promise(resolve => {
    const form = modal.querySelector('form')!;
    const done = (v: Record<string, string> | null) => { modal.hidden = true; modal.innerHTML = ''; resolve(v); };
    form.onsubmit = e => { e.preventDefault(); const out: Record<string, string> = {}; new FormData(form).forEach((v, k) => { out[k] = String(v); }); done(out); };
    (form.querySelector('[data-cancel]') as HTMLElement).onclick = () => done(null);
    form.onkeydown = e => { if (e.key === 'Escape') done(null); };
  });
}
const confirmDo = (title: string) => ask(title, [], 'Confirm', true).then(v => v !== null);

// ---------- actions ----------
async function pilotAction(act: string, id: string) {
  const p = pilots.find(x => x.id === id); if (!p) return;
  switch (act) {
    case 'follow': follow(id); return;
    case 'inspect': inspecting = id; renderInspector(undefined); send({ t: 'inspect', id }, `Inspect ${p.name}`); return;
    case 'message': { const v = await ask(`Message ${p.name}`, [{ name: 'text', label: 'Message' }], 'Send'); if (v?.text) send({ t: 'broadcast', to: { pilot: id }, text: v.text }, 'Message'); return; }
    case 'rename': { const v = await ask(`Rename ${p.name}`, [{ name: 'name', label: 'New name', value: p.name }], 'Rename'); if (v?.name) send({ t: 'rename', id, name: v.name }, 'Rename'); return; }
    case 'teleport': pick = { kind: 'teleport', pilot: id }; hint(`Click a point to move ${p.name} there (any sector). Esc cancels.`); return;
    case 'sendTo': pick = { kind: 'sendTo', pilot: id }; hint(`Click another pilot to send ${p.name} to them. Esc cancels.`); return;
    case 'cell': {
      const v = await ask(`Move ${p.name} within their own grid`, [{ name: 'x', label: 'Cell x (east +)', type: 'number', value: 0 }, { name: 'y', label: 'Cell y (south +)', type: 'number', value: 0 }], 'Move');
      if (v) send({ t: 'teleport', id, x: 3200, y: 3330, cell: [Math.round(Number(v.x)), Math.round(Number(v.y))] }, `Move ${p.name}`); return;
    }
    case 'kick': { const v = await ask(`Kick ${p.name}?`, [{ name: 'reason', label: 'Reason (shown to them)' }], 'Kick', true); if (v) send({ t: 'kick', id, reason: v.reason || undefined }, `Kick ${p.name}`); return; }
    case 'ban': {
      const v = await ask(`Ban ${p.name} (${p.ip})`, [{ name: 'minutes', label: 'Duration', type: 'select', value: '1440', options: [['60', '1 hour'], ['1440', '1 day'], ['10080', '1 week'], ['525600', '1 year']].map(([value, label]) => ({ value, label })) }, { name: 'reason', label: 'Reason' }], 'Ban', true);
      if (v) send({ t: 'ban', id, minutes: Number(v.minutes), reason: v.reason || undefined }, `Ban ${p.name}`); return;
    }
  }
}
async function sectorAction(act: string, place: Place) {
  const world = map.worldAt(place.home, place.gx, place.gy), seed = world.seed, label = sectorLabel(place.gx, place.gy);
  const room = map.rooms.find(r => r.seed === seed);
  switch (act) {
    case 'zoom': map.followed = undefined; { const c = map.universe(place.home, place.gx, place.gy, place.wx, place.wy); map.cam.x = c.x; map.cam.y = c.y; map.cam.scale = Math.max(map.cam.scale, 700); } return;
    case 'lock': if (room?.locked || await confirmDo(`Lock ${label}? Everyone but its owner is sent home.`)) send({ t: 'lock', seed, locked: !room?.locked }, room?.locked ? 'Unlock' : 'Lock'); return;
    case 'evict': if (await confirmDo(`Send everyone in ${label} home (owner stays)?`)) send({ t: 'evict', seed }, 'Evict'); return;
    case 'clear': if (await confirmDo(`Clear enemies in ${label}? (bosses stay)`)) send({ t: 'clear', seed }, 'Clear enemies'); return;
    case 'message': { const v = await ask(`Message everyone in ${label}`, [{ name: 'text', label: 'Message' }], 'Send'); if (v?.text) send({ t: 'broadcast', to: { room: seed }, text: v.text }, 'Message'); return; }
    case 'spawn': {
      const v = await ask(`Spawn enemies in ${label}`, [{ name: 'enemy', label: 'Enemy', type: 'select', value: 'raider', options: SPAWNABLE }, { name: 'count', label: 'Count (1-12)', type: 'number', value: 3 }], 'Pick spot');
      if (v) { pick = { kind: 'spawn', enemy: v.enemy, count: Math.max(1, Math.min(12, Math.round(Number(v.count) || 1))) }; hint('Click where they should appear (in a sector with a pilot). Esc cancels.'); }
      return;
    }
    case 'bring': {
      const v = await ask(`Bring a pilot to ${label}`, [{ name: 'id', label: 'Pilot', type: 'select', options: pilots.map(p => ({ value: p.id, label: p.name })) }], 'Teleport');
      if (v?.id) teleportTo(v.id, place); return;
    }
  }
}
/** Sends a pilot to a clicked place: a point here, a cell of their own grid (kept), or a visit to another grid. */
function teleportTo(id: string, place: Place) {
  const p = pilots.find(x => x.id === id); if (!p) return;
  const world = map.worldAt(place.home, place.gx, place.gy), x = Math.round(place.wx), y = Math.round(place.wy);
  if (world.seed === p.room) send({ t: 'teleport', id, x, y }, `Move ${p.name}`);
  else if (p.profile && place.home === p.profile.home) send({ t: 'teleport', id, x, y, cell: [place.gx, place.gy] }, `Move ${p.name}`);
  else send({ t: 'teleport', id, x, y, world }, `Send ${p.name}`);
}
function follow(id: string | undefined) {
  map.followed = id;
  if (id && map.cam.scale < 1500) map.cam.scale = 6000;
  renderPanels();
}
function hint(text = '') { const el = $('#hint'); el.textContent = text; el.hidden = !text; canvas.classList.toggle('picking', Boolean(text)); }

// ---------- context menu ----------
function menu(x: number, y: number, items: ([string, () => void, boolean?] | '-')[]) {
  const el = $('#menu');
  el.innerHTML = items.map((it, i) => it === '-' ? '<hr>' : `<button data-i="${i}" class="${it[2] ? 'danger' : ''}">${esc(it[0])}</button>`).join('');
  el.hidden = false;
  el.style.left = `${Math.min(x, innerWidth - 220)}px`; el.style.top = `${Math.min(y, innerHeight - el.offsetHeight - 8)}px`;
  el.onclick = e => { const b = (e.target as HTMLElement).closest('button'); if (!b) return; el.hidden = true; const it = items[Number(b.dataset.i)]; if (it !== '-') it[1](); };
}
const hideMenu = () => { $('#menu').hidden = true; };
function pilotMenu(x: number, y: number, id: string) {
  const p = pilots.find(q => q.id === id); if (!p) return;
  menu(x, y, [
    [map.followed === id ? 'Stop following' : 'Follow', () => follow(map.followed === id ? undefined : id)],
    ['Inspect bases & cargo', () => void pilotAction('inspect', id)],
    ['Message…', () => void pilotAction('message', id)],
    ['Rename…', () => void pilotAction('rename', id)], '-',
    ['Teleport to a point…', () => void pilotAction('teleport', id)],
    ['Send to another pilot…', () => void pilotAction('sendTo', id)],
    ['Move to own grid cell…', () => void pilotAction('cell', id)], '-',
    ['Kick…', () => void pilotAction('kick', id), true],
    ['Ban…', () => void pilotAction('ban', id), true],
  ]);
}
function sectorMenu(x: number, y: number, place: Place) {
  const world = map.worldAt(place.home, place.gx, place.gy), room = map.rooms.find(r => r.seed === world.seed);
  map.selectedSeed = world.seed;
  menu(x, y, [
    ['Zoom in here', () => void sectorAction('zoom', place)],
    ['Bring a pilot here…', () => void sectorAction('bring', place)],
    ['Message sector…', () => void sectorAction('message', place)], '-',
    ['Spawn enemies…', () => void sectorAction('spawn', place)],
    ['Clear enemies', () => void sectorAction('clear', place), true],
    [room?.locked ? 'Unlock sector' : 'Lock sector', () => void sectorAction('lock', place), !room?.locked],
    ['Evict everyone', () => void sectorAction('evict', place), true],
  ]);
}

// ---------- inspector ----------
type Report = { ship: string; coreLevel: number; hull: number; sector: string; at: { x: number; y: number }; kills: number; deaths: number; cargo: Record<Resource, number>; stored: Record<Resource, number>;
  bases: { index: number; name: string; unlocked: boolean }[]; outposts: { id: number; name: string; stored?: Record<Resource, number>; blocks: [number, string, number, number, number][] }[]; truncated?: boolean };
const oreEditor = (title: string, target: string, values?: Record<Resource, number>) => `<div class="ores" data-target="${esc(target)}"><h4>${esc(title)}</h4>${ORES.map(o => `<label><span style="color:#${RESOURCES[o].color.toString(16).padStart(6, '0')}">${RESOURCES[o].label}</span><input type="number" step="1" min="0" data-ore="${o}" data-was="${Math.floor(values?.[o] ?? 0)}" value="${Math.floor(values?.[o] ?? 0)}"></label>`).join('')}<button data-act="ores">Apply</button></div>`;
function renderInspector(r: Report | undefined) {
  const el = $('#inspector'), p = pilots.find(x => x.id === inspecting);
  if (!inspecting) { el.hidden = true; return; }
  el.hidden = false;
  if (!r) { el.innerHTML = `<header><b>${esc(p?.name ?? inspecting)}</b><span class="grow"></span><button data-act="close">✕</button></header><p class="empty">Asking the pilot's game… (no answer means an older game version)</p>`; return; }
  el.innerHTML = `<header><b>${esc(p?.name ?? '')}</b> · ${esc(r.ship)}<span class="grow"></span><button data-act="refresh">Refresh</button><button data-act="close">✕</button></header>
    <p class="sub">${esc(r.sector)} · ${r.at.x}, ${r.at.y} · core L${r.coreLevel} · hull ${r.hull} · ${r.kills} kills / ${r.deaths} deaths</p>
    <p class="warn">Mineral edits create or remove minerals. Every change is logged.</p>
    ${oreEditor('Ship cargo', 'cargo', r.cargo)}${oreEditor('Station storage', 'stored', r.stored)}
    <h4>Stations</h4><ul class="stations">${r.bases.map(b => `<li><label><input type="checkbox" data-station="${b.index}" ${b.unlocked ? 'checked' : ''} ${b.index === 0 ? 'disabled' : ''}> ${esc(b.name)}</label></li>`).join('')}</ul>
    <h4>Outposts</h4>${r.outposts.length ? r.outposts.map(o => `<div class="card"><div class="row"><b>${esc(o.name)}</b><span class="grow"></span><button data-outpost="${o.id}" data-act="repair">Repair all</button><button data-outpost="${o.id}" data-act="upgrade">Upgrade all</button><button class="danger" data-outpost="${o.id}" data-act="destroy">Destroy</button></div>
      ${oreEditor('Outpost storage', `outpost:${o.id}`, o.stored)}
      <table class="blocks">${o.blocks.map(([id, kind, level, hp, max]) => `<tr><td>${esc(kind)}</td><td>L${level}</td><td>${hp}/${max}</td><td><button data-outpost="${o.id}" data-block="${id}" data-act="repair">Repair</button><button data-outpost="${o.id}" data-block="${id}" data-act="upgrade">+1</button><button class="danger" data-outpost="${o.id}" data-block="${id}" data-act="destroy">✕</button></td></tr>`).join('')}</table></div>`).join('') : '<p class="empty">None.</p>'}
    ${r.truncated ? '<p class="sub">Block lists were shortened to fit.</p>' : ''}`;
}
$('#inspector').addEventListener('click', async e => {
  const b = (e.target as HTMLElement).closest('button'), id = inspecting; if (!b || !id) return;
  const name = pilotName(id);
  switch (b.dataset.act) {
    case 'close': inspecting = undefined; renderInspector(undefined); return;
    case 'refresh': send({ t: 'inspect', id }); return;
    case 'ores': {
      const box = b.closest('.ores') as HTMLElement, raw = box.dataset.target!, target: CargoTarget = raw.startsWith('outpost:') ? { outpost: Number(raw.slice(8)) } : raw as 'cargo' | 'stored';
      const delta: Partial<Record<Resource, number>> = {};
      for (const input of Array.from(box.querySelectorAll<HTMLInputElement>('input[data-ore]'))) { const d = Math.round(Number(input.value) || 0) - Number(input.dataset.was); if (d) delta[input.dataset.ore as Resource] = d; }
      if (!Object.keys(delta).length) { toast('No changes.', false); return; }
      send({ t: 'cargo', id, target, delta }, `Edit minerals of ${name}`); return;
    }
    default: {
      const action = b.dataset.act as 'repair' | 'upgrade' | 'destroy', outpost = Number(b.dataset.outpost), block = b.dataset.block === undefined ? undefined : Number(b.dataset.block);
      if (action === 'destroy' && !await confirmDo(block === undefined ? 'Destroy this whole outpost?' : 'Destroy this block?')) return;
      send({ t: 'structure', id, outpost, structure: block, action }, `${action} for ${name}`);
    }
  }
});
$('#inspector').addEventListener('change', e => {
  const input = e.target as HTMLInputElement; if (!input.dataset.station || !inspecting) return;
  send({ t: 'station', id: inspecting, index: Number(input.dataset.station), unlocked: input.checked }, `${input.checked ? 'Unlock' : 'Lock'} station`);
});

// ---------- panel events ----------
$('#pilots').addEventListener('click', e => {
  const row = (e.target as HTMLElement).closest('tr') as HTMLElement | null, id = row?.dataset.pilot; if (!id) return;
  const button = (e.target as HTMLElement).closest('button');
  if (button) { const r = button.getBoundingClientRect(); pilotMenu(r.left - 190, r.bottom, id); } else follow(id);
});
$('#lobbies').addEventListener('click', async e => {
  const b = (e.target as HTMLElement).closest('button') as HTMLElement | null; if (!b) return;
  const code = b.dataset.lobby!, lobby = lobbies.find(l => l.code === code);
  if (b.dataset.act === 'disband' && await confirmDo(`Disband lobby ${code}?`)) send({ t: 'disband', code }, `Disband ${code}`);
  if (b.dataset.act === 'lobby-open' && lobby) send({ t: 'lobby-open', code, open: !lobby.open }, lobby.open ? 'Make private' : 'Make open');
  if (b.dataset.act === 'remove' && await confirmDo(`Remove ${pilotName(b.dataset.member)} from ${code}?`)) send({ t: 'remove', code, id: b.dataset.member! }, 'Remove member');
  if (b.dataset.act === 'lobby-msg') { const v = await ask(`Message lobby ${code}`, [{ name: 'text', label: 'Message' }], 'Send'); if (v?.text) send({ t: 'broadcast', to: { lobby: code }, text: v.text }, 'Message'); }
});
$('#bans').addEventListener('click', e => { const ip = (e.target as HTMLElement).closest('button')?.dataset.unban; if (ip) send({ t: 'unban', ip }, `Unban ${ip}`); });
document.querySelectorAll<HTMLButtonElement>('nav button[data-tab]').forEach(b => b.onclick = () => {
  document.querySelectorAll('nav button[data-tab]').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll<HTMLElement>('.tab').forEach(t => t.hidden = t.id !== `tab-${b.dataset.tab}`);
});
$('#broadcast').onclick = async () => { const v = await ask('Message every pilot online', [{ name: 'text', label: 'Message' }], 'Send to all'); if (v?.text) send({ t: 'broadcast', to: { all: true }, text: v.text }, 'Broadcast'); };
$('#fit').onclick = () => fit();
$('#follow').addEventListener('click', e => { if ((e.target as HTMLElement).id === 'unfollow') follow(undefined); });

// ---------- map input ----------
let drag: { x: number; y: number; moved: boolean } | undefined;
const size = () => ({ w: canvas.clientWidth, h: canvas.clientHeight });
const local = (e: MouseEvent) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
canvas.addEventListener('mousedown', e => { if (e.button === 0) drag = { ...local(e), moved: false }; hideMenu(); });
addEventListener('mousemove', e => {
  if (!drag) return;
  const p = local(e), dx = p.x - drag.x, dy = p.y - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < 4) return;
  drag.moved = true; map.followed = undefined;
  map.cam.x -= dx / map.cam.scale; map.cam.y -= dy / map.cam.scale; drag.x = p.x; drag.y = p.y;
});
addEventListener('mouseup', e => {
  const was = drag; drag = undefined;
  if (!was || was.moved || e.target !== canvas) return;
  const p = local(e), { w, h } = size();
  if (pick) {
    const current = pick;
    if (current.kind === 'sendTo') {
      const target = map.shipAt(p.x, p.y, w, h), tp = target && pilots.find(q => q.id === target.id);
      if (!target || !tp?.world || target.id === current.pilot) { toast('Click another pilot.', false); return; }
      const mover = pilots.find(q => q.id === current.pilot);
      send({ t: 'teleport', id: current.pilot, x: Math.round(target.dx + 120), y: Math.round(target.dy + 80), ...(tp.room === mover?.room ? {} : { world: tp.world }) }, `Send ${pilotName(current.pilot)} to ${tp.name}`);
    } else {
      const place = map.place(p.x, p.y, w, h); if (!place) { toast('Click inside a sector.', false); return; }
      if (current.kind === 'teleport') teleportTo(current.pilot, place);
      else if (current.kind === 'spawn') send({ t: 'spawn', seed: map.worldAt(place.home, place.gx, place.gy).seed, kind: current.enemy, count: current.count, x: Math.round(place.wx), y: Math.round(place.wy) }, `Spawn ${current.count} ${current.enemy}`);
    }
    pick = undefined; hint(); return;
  }
  const ship = map.shipAt(p.x, p.y, w, h);
  if (ship) { follow(ship.id); return; }
  const place = map.place(p.x, p.y, w, h);
  map.selectedSeed = place ? map.worldAt(place.home, place.gx, place.gy).seed : undefined;
});
canvas.addEventListener('contextmenu', e => {
  e.preventDefault();
  const p = local(e), { w, h } = size(), ship = map.shipAt(p.x, p.y, w, h);
  if (ship) { pilotMenu(e.clientX, e.clientY, ship.id); return; }
  const place = map.place(p.x, p.y, w, h); if (place) sectorMenu(e.clientX, e.clientY, place);
});
canvas.addEventListener('wheel', e => { e.preventDefault(); const p = local(e), { w, h } = size(); map.zoomAt(p.x, p.y, w, h, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
addEventListener('keydown', e => { if (e.key === 'Escape') { pick = undefined; hint(); hideMenu(); } });
addEventListener('click', e => { if (!(e.target as HTMLElement).closest('#menu')) hideMenu(); }, true);

function fit() {
  map.followed = undefined;
  const homes = [...map.homes.values()];
  if (!homes.length) { map.cam = { x: 0.5, y: 0.5, scale: 200 }; return; }
  const xs = homes.map(h => h.ox), ys = homes.map(h => h.oy), { w, h } = size();
  const minX = Math.min(...xs) - 2, maxX = Math.max(...xs) + 3, minY = Math.min(...ys) - 2, maxY = Math.max(...ys) + 3;
  map.cam.x = (minX + maxX) / 2; map.cam.y = (minY + maxY) / 2; map.cam.scale = Math.min(400, Math.min(w / (maxX - minX), h / (maxY - minY)));
}

// ---------- frame loop ----------
let last = performance.now() / 1000, fitted = false, lastWatch = 0;
function frame() {
  const now = performance.now() / 1000, dt = Math.min(0.1, now - last); last = now;
  const dpr = devicePixelRatio || 1, { w, h } = size();
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (!fitted && map.homes.size) { fit(); fitted = true; }
  map.step(now, dt); pruneLive(now);
  // Watch the followed pilot's sector and the sectors in view (up to three), so their traffic flows here.
  if (now - lastWatch > 0.5) {
    lastWatch = now;
    const f = map.followed ? pilots.find(p => p.id === map.followed)?.room : undefined;
    const want = [...new Set([...(f ? [f] : []), ...map.visibleSeeds(w, h)])].slice(0, 3);
    if (want.join('|') !== watching.join('|') && socket?.readyState === WebSocket.OPEN) { watching = want; send({ t: 'watch', rooms: want }); }
  }
  map.draw(ctx, w, h, now, new Set(watching));
  requestAnimationFrame(frame);
}
connect();
requestAnimationFrame(frame);
