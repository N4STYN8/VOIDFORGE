import './admin.css';
import type { AdminServerMessage } from '../adminProtocol.ts';
import { applyCast, pruneLive } from './sectorView.ts';
import { shipBakes } from './art.ts';
import { $, ask, confirmDo, esc, nameOf, prefs, send, settle, store } from './state.ts';
import { finishPick, follow, hideMenu, pick, pilotMenu, sectorMenu, setPick } from './ui/actions.ts';
import { addEvents, initActivity, render as renderActivity, showAlerts } from './ui/activity.ts';
import { closeDrawer, frame as drawerFrame, initDrawer, onReport, openDrawer, render as renderDrawer } from './ui/drawer.ts';
import { filterBy, initRoster, render as renderRoster, selectedIds } from './ui/roster.ts';
import { bulk } from './ui/actions.ts';

/**
 * Relay admin console page. Talks to the relay's /admin/ws socket (same origin, session cookie) and wires the
 * panels: the universe map (src/admin/map.ts), roster, pilot drawer, activity feed, lobbies, bans and audit log.
 * Every action is a request the relay validates and logs; changes to a game run in that pilot's own client.
 */
const map = store.map, canvas = $<HTMLCanvasElement>('#map'), ctx = canvas.getContext('2d')!;
let retry = 1000, watching: string[] = [];

// ---------- socket ----------
function connect() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/admin/ws`);
  store.socket = ws; status('Connecting…');
  ws.onopen = () => { retry = 1000; status('Live'); watching = []; store.events = []; };
  ws.onmessage = e => receive(JSON.parse(String(e.data)) as AdminServerMessage);
  ws.onclose = () => {
    if (store.socket !== ws) return;
    status('Reconnecting…', true);
    // A dead session makes the socket fail: check, and go to the login page if so.
    fetch('/admin/', { redirect: 'manual', cache: 'no-store' }).then(r => { if (r.type === 'opaqueredirect' || r.status === 302) location.href = '/admin/login'; }).catch(() => {});
    setTimeout(connect, retry); retry = Math.min(15000, retry * 2);
  };
}
function receive(m: AdminServerMessage) {
  const now = performance.now() / 1000;
  switch (m.t) {
    case 'overview':
      store.pilots = m.pilots; store.lobbies = m.lobbies; store.bans = m.bans; store.stats = m.stats; store.rooms = m.rooms;
      map.setOverview(m.pilots, m.rooms, now);
      if (map.followed && !m.pilots.some(p => p.id === map.followed)) map.followed = undefined;
      renderAll(); return;
    case 'log': store.log.push(...m.entries); if (store.log.length > 200) store.log = store.log.slice(-200); renderLog(); return;
    case 'events': addEvents(m.entries); if (store.drawer) renderDrawer(); return;
    case 'result': case 'pilot': settle(m.ref, m); return;
    case 'report': onReport(m.id, m.data); return;
    case 'obs': {
      const o = m.m;
      if (o.t === 'state') map.setState(m.r, o.id, o.name, (o as unknown as { s: unknown }).s, now);
      else if (o.t === 'cast') applyCast(m.r, o.from, o.k, o.d, now);
      return;
    }
  }
}
function status(text: string, bad = false) { const el = $('#status'); el.textContent = text; el.classList.toggle('bad', bad); }

// ---------- panels ----------
function renderAll() {
  const s = store.stats, bots = store.pilots.filter(p => p.name.startsWith('Sim ')).length;
  $('#stat-online').textContent = String(store.pilots.length);
  $('#stat-online-sub').textContent = bots ? `${store.pilots.length - bots} players · ${bots} bots` : 'players';
  $('#stat-sectors').textContent = String(s.rooms ?? 0); $('#stat-lobbies').textContent = String(store.lobbies.length);
  $('#stat-relay').textContent = `${s.rssMb ?? '?'} MB`; $('#stat-relay-sub').textContent = `${s.admins ?? 1} admin${s.admins === 1 ? '' : 's'} · ${s.skipped ?? 0} skipped`;
  $('#count-roster').textContent = String(store.pilots.length); $('#count-lobbies').textContent = String(store.lobbies.length); $('#count-bans').textContent = String(store.bans.length);
  renderRoster(); renderDrawer();
  $('#lobbies').innerHTML = store.lobbies.length ? store.lobbies.map(l => `<div class="card"><div class="row"><b class="mono">${esc(l.code)}</b><span class="tag ${l.open ? '' : 'dim'}">${l.open ? 'OPEN' : 'PRIVATE'}</span><span class="sub">${l.members.length} pilot${l.members.length === 1 ? '' : 's'}</span><span class="grow"></span>
    <button data-lobby="${esc(l.code)}" data-act="show">Show</button><button data-lobby="${esc(l.code)}" data-act="msg">Message</button><button data-lobby="${esc(l.code)}" data-act="open">${l.open ? 'Make private' : 'Make open'}</button><button class="danger" data-lobby="${esc(l.code)}" data-act="disband">Disband</button></div>
    <ul class="members">${l.members.map(m => `<li><a href="#" data-pilot="${esc(m.id)}">${esc(m.name)}</a>${m.id === l.host ? ' <span class="tag">HOST</span>' : ''}<button class="link" data-lobby="${esc(l.code)}" data-member="${esc(m.id)}" data-act="remove">remove</button></li>`).join('')}</ul></div>`).join('') : '<p class="empty">No lobbies.</p>';
  $('#bans').innerHTML = store.bans.length ? store.bans.map(b => `<tr><td class="mono">${esc(b.ip)}<div class="sub">${esc(b.name)}</div></td><td>${esc(b.reason)}</td><td>${new Date(b.until).toLocaleString()}</td><td><button data-unban="${esc(b.ip)}">Unban</button></td></tr>`).join('') : '<tr><td colspan="4" class="empty">No bans.</td></tr>';
  const f = map.followed && store.pilots.find(p => p.id === map.followed);
  $('#follow').innerHTML = f ? `<span class="dot"></span>Following <b>${esc(f.name)}</b><button id="unfollow" class="icon" title="Stop following">✕</button>` : '';
  $('#follow').hidden = !f;
}
function renderLog() { $('#log').innerHTML = [...store.log].reverse().map(e => `<li><time>${new Date(e.at).toLocaleTimeString()}</time> <b>${esc(e.action)}</b> ${esc(e.target)} <span class="sub">${esc(e.detail ?? '')}</span></li>`).join(''); }
function setTab(name: string) {
  document.querySelectorAll<HTMLElement>('nav.tabs button[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  document.querySelectorAll<HTMLElement>('.tab').forEach(t => t.hidden = t.id !== `tab-${name}`);
  prefs.set('tab', name); if (name === 'roster') renderRoster(); if (name === 'activity') renderActivity();
}
const openPilot = (id: string) => { openDrawer(id); renderRoster(); };

$('#lobbies').addEventListener('click', async e => {
  const t = e.target as HTMLElement, pilotLink = t.closest<HTMLElement>('[data-pilot]');
  if (pilotLink) { e.preventDefault(); openPilot(pilotLink.dataset.pilot!); return; }
  const b = t.closest<HTMLElement>('button'); if (!b) return;
  const code = b.dataset.lobby!, lobby = store.lobbies.find(l => l.code === code);
  if (b.dataset.act === 'show') { filterBy('lobby', code); setTab('roster'); }
  if (b.dataset.act === 'disband' && await confirmDo(`Disband lobby ${code}?`, 'Members stay online and fly home.')) send({ t: 'disband', code }, `Disband ${code}`);
  if (b.dataset.act === 'open' && lobby) send({ t: 'lobby-open', code, open: !lobby.open }, lobby.open ? 'Make private' : 'Make open');
  if (b.dataset.act === 'remove' && await confirmDo(`Remove ${nameOf(b.dataset.member)} from ${code}?`)) send({ t: 'remove', code, id: b.dataset.member! }, 'Remove member');
  if (b.dataset.act === 'msg') { const v = await ask(`Message lobby ${code}`, [{ name: 'text', label: 'Message', type: 'textarea' }], 'Send'); if (v?.text) send({ t: 'broadcast', to: { lobby: code }, text: v.text }, 'Message'); }
});
$('#bans').addEventListener('click', e => { const ip = (e.target as HTMLElement).closest<HTMLElement>('button')?.dataset.unban; if (ip) send({ t: 'unban', ip }, `Unban ${ip}`); });
document.querySelectorAll<HTMLButtonElement>('nav.tabs button[data-tab]').forEach(b => b.onclick = () => setTab(b.dataset.tab!));
$('#broadcast').onclick = async () => { const v = await ask('Message every pilot online', [{ name: 'text', label: 'Message (shown in every game)', type: 'textarea' }], 'Send to all'); if (v?.text) send({ t: 'broadcast', to: { all: true }, text: v.text }, 'Broadcast'); };
$('#fit').onclick = () => fit();
$('#alerts').onclick = () => { setTab('activity'); showAlerts(); };
$('#follow').addEventListener('click', e => { if ((e.target as HTMLElement).closest('#unfollow')) follow(undefined); });

// ---------- resizable side panel ----------
const aside = $('#side'), divider = $('#divider');
aside.style.width = `${prefs.get('side', 460)}px`;
divider.onmousedown = e => {
  e.preventDefault(); const startX = e.clientX, start = aside.offsetWidth; divider.classList.add('drag');
  const move = (ev: MouseEvent) => { aside.style.width = `${Math.max(340, Math.min(innerWidth * 0.6, start + startX - ev.clientX))}px`; };
  const up = () => { divider.classList.remove('drag'); removeEventListener('mousemove', move); removeEventListener('mouseup', up); prefs.set('side', aside.offsetWidth); };
  addEventListener('mousemove', move); addEventListener('mouseup', up);
};

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
  const p = local(e), { w, h } = size(), ship = map.shipAt(p.x, p.y, w, h), place = map.place(p.x, p.y, w, h);
  if (finishPick(place, ship?.id)) return;
  if (ship) { openPilot(ship.id); follow(ship.id); return; }
  map.selectedSeed = place ? map.worldAt(place.home, place.gx, place.gy).seed : undefined;
});
canvas.addEventListener('contextmenu', e => {
  e.preventDefault();
  const p = local(e), { w, h } = size(), ship = map.shipAt(p.x, p.y, w, h);
  if (ship) { pilotMenu(e.clientX, e.clientY, ship.id, openPilot); return; }
  const place = map.place(p.x, p.y, w, h); if (place) sectorMenu(e.clientX, e.clientY, place);
});
canvas.addEventListener('wheel', e => { e.preventDefault(); const p = local(e), { w, h } = size(); map.zoomAt(p.x, p.y, w, h, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
addEventListener('click', e => { if (!(e.target as HTMLElement).closest('#menu')) hideMenu(); }, true);

// ---------- keyboard ----------
addEventListener('keydown', e => {
  const typing = (e.target as HTMLElement).closest('input, textarea, select') !== null;
  if (!$('#modal').hidden) return;
  if (e.key === 'Escape') { if (pick) setPick(undefined); else if (!$('#menu').hidden) hideMenu(); else if (store.drawer) closeDrawer(); else if (typing) (e.target as HTMLElement).blur(); return; }
  if (typing) return;
  if (e.key === '/') { e.preventDefault(); setTab('roster'); $<HTMLInputElement>('#search').focus(); }
  else if ((e.key === 'f' || e.key === 'F') && store.drawer) { follow(map.followed === store.drawer ? undefined : store.drawer); renderAll(); }
  else if ((e.key === 'i' || e.key === 'I') && store.drawer) $<HTMLButtonElement>('#drawer-tabs [data-tab=inspector]').click();
  else if (e.key === 'Delete') { const ids = selectedIds(); if (ids.length) void bulk('kick', ids); else if (store.drawer) void bulk('kick', [store.drawer]); }
});

function fit() {
  map.followed = undefined;
  const homes = [...map.homes.values()];
  if (!homes.length) { map.cam = { x: 0.5, y: 0.5, scale: 200 }; return; }
  const xs = homes.map(h => h.ox), ys = homes.map(h => h.oy), { w, h } = size();
  const minX = Math.min(...xs) - 2, maxX = Math.max(...xs) + 3, minY = Math.min(...ys) - 2, maxY = Math.max(...ys) + 3;
  Object.assign(map.cam, { x: (minX + maxX) / 2, y: (minY + maxY) / 2, scale: Math.min(400, Math.min(w / (maxX - minX), h / (maxY - minY))) });
}

// ---------- frame loop ----------
let last = performance.now() / 1000, fitted = false, lastWatch = 0;
function frame() {
  const now = performance.now() / 1000, dt = Math.min(0.1, now - last); last = now;
  const dpr = devicePixelRatio || 1, { w, h } = size();
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (!fitted && map.homes.size) { fit(); fitted = true; }
  map.step(now, dt); pruneLive(now); shipBakes.left = 6;
  // Watch order: the open drawer's sector, the followed pilot's, then sectors in view; the relay allows three.
  if (now - lastWatch > 0.5) {
    lastWatch = now;
    const room = (id?: string) => id ? store.pilots.find(p => p.id === id)?.room : undefined;
    const want = [...new Set([room(store.drawer), room(map.followed), ...map.visibleSeeds(w, h)].filter((s): s is string => Boolean(s)))].slice(0, 3);
    if (want.join('|') !== watching.join('|') && store.socket?.readyState === WebSocket.OPEN) { watching = want; send({ t: 'watch', rooms: want }); }
  }
  const watched = new Set(watching);
  map.draw(ctx, w, h, now, watched);
  drawerFrame(now, watched);
  requestAnimationFrame(frame);
}
initRoster(openPilot); initDrawer(); initActivity(openPilot);
setTab(prefs.get('tab', 'roster'));
connect();
requestAnimationFrame(frame);
