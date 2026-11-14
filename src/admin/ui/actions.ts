import { ENEMIES } from '../../data.ts';
import { sectorLabel } from '../../sectorGrid.ts';
import type { BulkAction } from '../../adminProtocol.ts';
import type { Place } from '../map.ts';
import { $, ask, confirmDo, esc, nameOf, pilotById, send, store, toast } from '../state.ts';

/**
 * Admin actions shared by the roster, the pilot drawer and the map: per-pilot and per-sector actions, bulk
 * actions on a selection, context menus, and the "click a destination" pick mode.
 */
export const SPAWNABLE = Object.entries(ENEMIES).filter(([, d]) => !d.boss && !d.part).map(([k, d]) => ({ value: k, label: d.label }));
const BAN_TIMES = [['60', '1 hour'], ['1440', '1 day'], ['10080', '1 week'], ['525600', '1 year']].map(([value, label]) => ({ value, label }));

export type Pick = { kind: 'teleport'; ids: string[] } | { kind: 'sendTo'; ids: string[] } | { kind: 'spawn'; enemy: string; count: number };
export let pick: Pick | undefined;
export function setPick(next: Pick | undefined, text = '') {
  pick = next;
  const el = $('#hint'); el.textContent = text; el.hidden = !text;
  $('#map').classList.toggle('picking', Boolean(next));
}

export function follow(id: string | undefined) {
  store.map.followed = id;
  if (id && store.map.cam.scale < 1500) store.map.cam.scale = 6000;
}
/** Single-pilot actions. */
export async function pilotAction(act: string, id: string) {
  const p = pilotById(id); if (!p) return;
  switch (act) {
    case 'follow': follow(store.map.followed === id ? undefined : id); return;
    case 'message': { const v = await ask(`Message ${p.name}`, [{ name: 'text', label: 'Message (shown in their game)', type: 'textarea' }], 'Send'); if (v?.text) send({ t: 'broadcast', to: { pilot: id }, text: v.text }, 'Message'); return; }
    case 'rename': { const v = await ask(`Rename ${p.name}`, [{ name: 'name', label: 'New name', value: p.name }], 'Rename'); if (v?.name) send({ t: 'rename', id, name: v.name }, 'Rename'); return; }
    case 'teleport': setPick({ kind: 'teleport', ids: [id] }, `Click a point to move ${p.name} there (any sector). Esc cancels.`); return;
    case 'sendTo': setPick({ kind: 'sendTo', ids: [id] }, `Click another pilot to send ${p.name} to them. Esc cancels.`); return;
    case 'cell': {
      const v = await ask(`Move ${p.name} within their own grid`, [{ name: 'x', label: 'Cell x (east +)', type: 'number', value: 0 }, { name: 'y', label: 'Cell y (south +)', type: 'number', value: 0 }], 'Move');
      if (v) send({ t: 'teleport', id, x: 3200, y: 3330, cell: [Math.round(Number(v.x)), Math.round(Number(v.y))] }, `Move ${p.name}`); return;
    }
    case 'evict': if (await confirmDo(`Send ${p.name} home?`)) void bulk('evict-pilot', [id]); return;
    case 'kick': { const v = await ask(`Kick ${p.name}?`, [{ name: 'reason', label: 'Reason (shown to them)' }], 'Kick', true, 'Their address is also blocked for 2 minutes, since the game reconnects by itself.'); if (v) send({ t: 'kick', id, reason: v.reason || undefined }, `Kick ${p.name}`); return; }
    case 'ban': {
      const v = await ask(`Ban ${p.name} (${p.ip})`, [{ name: 'minutes', label: 'Duration', type: 'select', value: '1440', options: BAN_TIMES }, { name: 'reason', label: 'Reason' }], 'Ban', true);
      if (v) send({ t: 'ban', id, minutes: Number(v.minutes), reason: v.reason || undefined }, `Ban ${p.name}`); return;
    }
  }
}
/** One action for many pilots, sent as a single `bulk` request. */
export async function bulk(action: BulkAction, ids: string[]) {
  if (!ids.length) return;
  const who = ids.length === 1 ? nameOf(ids[0]) : `${ids.length} pilots`;
  switch (action) {
    case 'message': { const v = await ask(`Message ${who}`, [{ name: 'text', label: 'Message (shown in their game)', type: 'textarea' }], 'Send'); if (v?.text) send({ t: 'bulk', ids, action, text: v.text }, 'Bulk message'); return; }
    case 'kick': { const v = await ask(`Kick ${who}?`, [{ name: 'reason', label: 'Reason (shown to them)' }], `Kick ${ids.length}`, true); if (v) send({ t: 'bulk', ids, action, reason: v.reason || undefined }, 'Bulk kick'); return; }
    case 'ban': { const v = await ask(`Ban ${who}?`, [{ name: 'minutes', label: 'Duration', type: 'select', value: '1440', options: BAN_TIMES }, { name: 'reason', label: 'Reason' }], `Ban ${ids.length}`, true, 'Bans are by address: pilots sharing one address are all affected. Local addresses are skipped.'); if (v) send({ t: 'bulk', ids, action, minutes: Number(v.minutes), reason: v.reason || undefined }, 'Bulk ban'); return; }
    case 'evict-pilot': send({ t: 'bulk', ids, action }, 'Bulk send home'); return;
    case 'teleport': setPick({ kind: 'teleport', ids }, `Click a point to move ${who} there. Esc cancels.`); return;
  }
}
/** Sends pilots to a clicked place: a point in their current sector, a cell of their own grid (kept), or a visit elsewhere. */
export function teleportTo(ids: string[], place: Place) {
  const world = store.map.worldAt(place.home, place.gx, place.gy), x = Math.round(place.wx), y = Math.round(place.wy);
  if (ids.length > 1) { send({ t: 'bulk', ids, action: 'teleport', x, y, world }, `Bulk move to ${sectorLabel(place.gx, place.gy)}`); return; }
  const p = pilotById(ids[0]); if (!p) return;
  if (world.seed === p.room) send({ t: 'teleport', id: p.id, x, y }, `Move ${p.name}`);
  else if (p.profile && place.home === p.profile.home) send({ t: 'teleport', id: p.id, x, y, cell: [place.gx, place.gy] }, `Move ${p.name}`);
  else send({ t: 'teleport', id: p.id, x, y, world }, `Send ${p.name}`);
}
export async function sectorAction(act: string, place: Place) {
  const world = store.map.worldAt(place.home, place.gx, place.gy), seed = world.seed, label = sectorLabel(place.gx, place.gy);
  const room = store.rooms.find(r => r.seed === seed);
  switch (act) {
    case 'zoom': { follow(undefined); const c = store.map.universe(place.home, place.gx, place.gy, place.wx, place.wy); Object.assign(store.map.cam, { x: c.x, y: c.y, scale: Math.max(store.map.cam.scale, 2400) }); return; }
    case 'lock': if (room?.locked || await confirmDo(`Lock ${label}?`, 'Everyone but its owner is sent home, and newcomers are turned away until you unlock it or the relay restarts.')) send({ t: 'lock', seed, locked: !room?.locked }, room?.locked ? 'Unlock' : 'Lock'); return;
    case 'evict': if (await confirmDo(`Send everyone in ${label} home?`, 'The sector owner stays.')) send({ t: 'evict', seed }, 'Evict'); return;
    case 'clear': if (await confirmDo(`Clear enemies in ${label}?`, 'Bosses and their parts stay.')) send({ t: 'clear', seed }, 'Clear enemies'); return;
    case 'message': { const v = await ask(`Message everyone in ${label}`, [{ name: 'text', label: 'Message', type: 'textarea' }], 'Send'); if (v?.text) send({ t: 'broadcast', to: { room: seed }, text: v.text }, 'Message'); return; }
    case 'spawn': {
      const v = await ask(`Spawn enemies in ${label}`, [{ name: 'enemy', label: 'Enemy', type: 'select', value: 'raider', options: SPAWNABLE }, { name: 'count', label: 'Count (1-12)', type: 'number', value: 3 }], 'Pick a spot');
      if (v) setPick({ kind: 'spawn', enemy: v.enemy, count: Math.max(1, Math.min(12, Math.round(Number(v.count) || 1))) }, 'Click where they should appear (in a sector with a pilot). Esc cancels.');
      return;
    }
    case 'bring': {
      const v = await ask(`Bring a pilot to ${label}`, [{ name: 'id', label: 'Pilot', type: 'select', options: [...store.pilots].sort((a, b) => a.name.localeCompare(b.name)).map(p => ({ value: p.id, label: p.name })) }], 'Teleport');
      if (v?.id) teleportTo([v.id], place); return;
    }
  }
}
/** Completes a pick-mode click on the map. Returns true when a pick was pending. */
export function finishPick(place: Place | undefined, shipId: string | undefined) {
  const current = pick; if (!current) return false;
  if (current.kind === 'sendTo') {
    const target = shipId ? pilotById(shipId) : undefined, ship = shipId ? store.map.ships.get(shipId) : undefined;
    if (!target?.world || !ship || current.ids.includes(target.id)) { toast('Click another pilot.', false); return true; }
    for (const id of current.ids) { const mover = pilotById(id); send({ t: 'teleport', id, x: Math.round(ship.dx + 120), y: Math.round(ship.dy + 80), ...(target.room === mover?.room ? {} : { world: target.world }) }, `Send ${nameOf(id)} to ${target.name}`); }
  } else {
    if (!place) { toast('Click inside a sector.', false); return true; }
    if (current.kind === 'teleport') teleportTo(current.ids, place);
    else send({ t: 'spawn', seed: store.map.worldAt(place.home, place.gx, place.gy).seed, kind: current.enemy, count: current.count, x: Math.round(place.wx), y: Math.round(place.wy) }, `Spawn ${current.count} ${current.enemy}`);
  }
  setPick(undefined); return true;
}

// ---------- context menu ----------
type Item = [label: string, run: () => void, danger?: boolean] | '-';
export function menu(x: number, y: number, title: string, items: Item[]) {
  const el = $('#menu');
  el.innerHTML = `<div class="menu-title">${esc(title)}</div>` + items.map((it, i) => it === '-' ? '<hr>' : `<button data-i="${i}" class="${it[2] ? 'danger' : ''}">${esc(it[0])}</button>`).join('');
  el.hidden = false;
  el.style.left = `${Math.max(4, Math.min(x, innerWidth - el.offsetWidth - 8))}px`; el.style.top = `${Math.max(4, Math.min(y, innerHeight - el.offsetHeight - 8))}px`;
  el.onclick = e => { const b = (e.target as HTMLElement).closest('button'); if (!b) return; el.hidden = true; const it = items[Number(b.dataset.i)]; if (it !== '-') it[1](); };
}
export const hideMenu = () => { $('#menu').hidden = true; };
export function pilotMenu(x: number, y: number, id: string, open: (id: string) => void) {
  const p = pilotById(id); if (!p) return;
  menu(x, y, p.name, [
    ['Open details', () => open(id)],
    [store.map.followed === id ? 'Stop following' : 'Follow on map', () => follow(store.map.followed === id ? undefined : id)],
    ['Message…', () => void pilotAction('message', id)],
    ['Rename…', () => void pilotAction('rename', id)], '-',
    ['Teleport to a point…', () => void pilotAction('teleport', id)],
    ['Send to another pilot…', () => void pilotAction('sendTo', id)],
    ['Move to own grid cell…', () => void pilotAction('cell', id)],
    ['Send home', () => void pilotAction('evict', id)], '-',
    ['Kick…', () => void pilotAction('kick', id), true],
    ['Ban…', () => void pilotAction('ban', id), true],
  ]);
}
export function sectorMenu(x: number, y: number, place: Place) {
  const world = store.map.worldAt(place.home, place.gx, place.gy), room = store.rooms.find(r => r.seed === world.seed);
  store.map.selectedSeed = world.seed;
  menu(x, y, sectorLabel(place.gx, place.gy), [
    ['Zoom in here', () => void sectorAction('zoom', place)],
    ['Bring a pilot here…', () => void sectorAction('bring', place)],
    ['Message sector…', () => void sectorAction('message', place)], '-',
    ['Spawn enemies…', () => void sectorAction('spawn', place)],
    ['Clear enemies', () => void sectorAction('clear', place), true],
    [room?.locked ? 'Unlock sector' : 'Lock sector', () => void sectorAction('lock', place), !room?.locked],
    ['Evict everyone', () => void sectorAction('evict', place), true],
  ]);
}
