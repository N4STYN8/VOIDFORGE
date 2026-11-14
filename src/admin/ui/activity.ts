import type { AdminEvent, EventKind } from '../../adminProtocol.ts';
import { $, esc, pilotById, store } from '../state.ts';

/**
 * The activity feed: joins, leaves, sector changes, deaths, lobby changes and admin actions from the relay, with
 * category filters and click-to-open. Alerts (flooding, repeated deaths, banned addresses retrying, connection
 * bursts) are counted in the top bar until dismissed; that count lives only in this page.
 */
const GROUPS: Record<string, { label: string; kinds: EventKind[] | 'alert' | 'all' }> = {
  all: { label: 'All', kinds: 'all' }, alert: { label: 'Alerts', kinds: 'alert' }, people: { label: 'Joins & leaves', kinds: ['join', 'leave', 'rename'] },
  deaths: { label: 'Deaths', kinds: ['died', 'respawn'] }, moves: { label: 'Sectors', kinds: ['sector', 'authority'] }, lobbies: { label: 'Lobbies', kinds: ['lobby'] }, admin: { label: 'Admin', kinds: ['admin', 'kick', 'ban'] },
};
const ICON: Record<EventKind, string> = { join: '＋', leave: '－', rename: '✎', sector: '➜', died: '✖', respawn: '↻', lobby: '◎', authority: '★', kick: '⏏', ban: '⛔', admin: '⚙', flood: '⚠', deaths: '⚠', 'banned-retry': '⚠', 'join-burst': '⚠' };
const TEXT: Record<EventKind, (e: AdminEvent) => string> = {
  join: () => 'joined', leave: () => 'left', rename: e => `renamed (${e.detail ?? ''})`, sector: e => `entered sector ${(e.seed ?? '').slice(0, 18)}`,
  died: () => 'was destroyed', respawn: () => 'respawned', lobby: e => `${e.detail ?? 'changed'} lobby ${e.code ?? ''}`, authority: e => `now runs ${(e.seed ?? '').slice(0, 18)}`,
  kick: e => `kicked ${e.detail ?? ''}`, ban: e => `banned ${e.detail ?? ''}`, admin: e => e.detail ?? 'admin action',
  flood: e => `is flooding: ${e.detail ?? ''}`, deaths: e => e.detail ?? 'keeps dying', 'banned-retry': e => e.detail ?? 'banned address retried', 'join-burst': e => e.detail ?? 'connection burst',
};
let group = 'all', seenAlerts = 0;
const isAlert = (e: AdminEvent) => Boolean(e.alert);

/** Ids of pilots online, built once per render so each line is a set lookup rather than a scan of the roster. */
let onlineIds: Set<string> | undefined;
export function eventLine(e: AdminEvent) {
  const who = e.name ?? e.ip ?? '', online = e.id && (onlineIds ? onlineIds.has(e.id) : pilotById(e.id));
  return `<li class="ev ${isAlert(e) ? 'alert' : ''} k-${e.kind}" ${online ? `data-id="${esc(e.id)}"` : ''}><time>${new Date(e.at).toLocaleTimeString()}</time><span class="ico">${ICON[e.kind]}</span><span><b>${esc(who)}</b> ${esc(TEXT[e.kind](e))}</span></li>`;
}
export function initActivity(open: (id: string) => void) {
  $('#activity-groups').onclick = e => { const g = (e.target as HTMLElement).closest<HTMLElement>('[data-group]')?.dataset.group; if (g) { group = g; render(); } };
  $('#activity').onclick = e => { const id = (e.target as HTMLElement).closest<HTMLElement>('[data-id]')?.dataset.id; if (id) open(id); };
  $('#dismiss-alerts').onclick = () => { seenAlerts = store.events.filter(isAlert).length + dismissedBefore; updateAlerts(); };
}
let dismissedBefore = 0;
/** Adds events (bounded to the relay's own ring size) and refreshes the feed and alert count. */
export function addEvents(entries: AdminEvent[]) {
  store.events.push(...entries);
  if (store.events.length > 500) { const drop = store.events.length - 500; dismissedBefore += store.events.slice(0, drop).filter(isAlert).length; store.events.splice(0, drop); }
  schedule();
}
let queued = false;
/** Events arrive one frame each; the feed and alert count are redrawn at most once per animation frame. */
function schedule() { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; render(); updateAlerts(); }); }
export function showAlerts() { group = 'alert'; render(); }
function updateAlerts() {
  const total = store.events.filter(isAlert).length + dismissedBefore, open = Math.max(0, total - seenAlerts), btn = $('#alerts');
  btn.textContent = open ? `⚠ ${open} alert${open === 1 ? '' : 's'}` : 'No alerts'; btn.classList.toggle('hot', open > 0);
}
export function render() {
  $('#activity-groups').innerHTML = Object.entries(GROUPS).map(([k, g]) => `<button class="chip ${k === group ? 'on' : ''}" data-group="${k}">${g.label}</button>`).join('');
  const g = GROUPS[group].kinds, list = store.events.filter(e => g === 'all' || (g === 'alert' ? isAlert(e) : g.includes(e.kind))).slice(-300).reverse();
  onlineIds = new Set(store.pilots.map(p => p.id));
  $('#activity').innerHTML = list.length ? list.map(eventLine).join('') : '<li class="empty">Nothing yet.</li>';
  onlineIds = undefined;
}
