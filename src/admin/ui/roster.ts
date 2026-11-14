import { sectorLabel } from '../../sectorGrid.ts';
import type { AdminPilot } from '../../adminProtocol.ts';
import { emptyFilter, filterPilots, isBot, Selection, sortPilots, type RosterFilter, type SortKey, type Status } from '../roster.ts';
import { $, ago, esc, prefs, store } from '../state.ts';
import { bulk, follow, pilotMenu } from './actions.ts';

/**
 * The pilot roster: search, filter chips, sortable columns, checkbox selection (shift-click for ranges, the
 * header box for "all matching") and a bulk bar. Rows are windowed, so hundreds of pilots cost the same as a
 * screenful, and the list is rebuilt from data only for the rows in view.
 */
const ROW = 48, BUFFER = 6;
const CHIPS: { status: Status; label: string }[] = [
  { status: 'humans', label: 'Players' }, { status: 'bots', label: 'Bots' }, { status: 'alive', label: 'Alive' }, { status: 'dead', label: 'Dead' },
  { status: 'solo', label: 'Solo' }, { status: 'lobby', label: 'In lobby' }, { status: 'sharing', label: 'Sharing sector' }, { status: 'authority', label: 'Authority' },
];
const saved = prefs.get<{ text: string; status: Status[]; sort: SortKey; dir: 1 | -1 }>('roster', { text: '', status: [], sort: 'name', dir: 1 });
export const filter: RosterFilter = { ...emptyFilter(), text: saved.text, status: new Set(saved.status) };
let sortKey: SortKey = saved.sort, sortDir: 1 | -1 = saved.dir, shown: AdminPilot[] = [], anchor: string | undefined;
export const selection = new Selection();
let openPilot: (id: string) => void = () => {};

export const homeLabel = (home: string) => store.map.homes.get(home)?.label ?? home.slice(0, 8);
export const where = (p: AdminPilot) => p.world ? `${homeLabel(p.world.home)} · ${sectorLabel(p.world.x, p.world.y)}` : 'Menu / no sector';
const persist = () => prefs.set('roster', { text: filter.text, status: [...filter.status], sort: sortKey, dir: sortDir });

export function initRoster(open: (id: string) => void) {
  openPilot = open;
  const search = $<HTMLInputElement>('#search'); search.value = filter.text;
  search.oninput = () => { filter.text = search.value; persist(); render(); };
  $('#chips').onclick = e => {
    const b = (e.target as HTMLElement).closest('button'); if (!b) return;
    if (b.dataset.clear === 'seed') filter.seed = undefined; else if (b.dataset.clear === 'lobby') filter.lobby = undefined;
    else if (b.dataset.status) { const s = b.dataset.status as Status; if (!filter.status.delete(s)) filter.status.add(s); }
    persist(); render();
  };
  $('#roster-head').onclick = e => {
    const t = e.target as HTMLElement;
    if (t.matches('input[type=checkbox]')) { const box = t as HTMLInputElement; if (box.checked) selection.setAll(shown.map(p => p.id)); else selection.clear(); render(); return; }
    const key = t.closest<HTMLElement>('[data-sort]')?.dataset.sort as SortKey | undefined; if (!key) return;
    if (sortKey === key) sortDir = sortDir === 1 ? -1 : 1; else { sortKey = key; sortDir = key === 'name' || key === 'where' ? 1 : -1; }
    persist(); render();
  };
  $('#roster-scroll').onscroll = () => drawRows();
  $('#roster-rows').onclick = e => {
    const t = e.target as HTMLElement, row = t.closest<HTMLElement>('[data-id]'), id = row?.dataset.id; if (!id) return;
    if (t.matches('input[type=checkbox]')) {
      if ((e as MouseEvent).shiftKey && anchor) selection.range(shown.map(p => p.id), anchor, id); else selection.toggle(id);
      anchor = id; render(); return;
    }
    if (t.closest('[data-menu]')) { const r = t.closest('button')!.getBoundingClientRect(); pilotMenu(r.left - 200, r.bottom + 2, id, openPilot); return; }
    openPilot(id); follow(id);
  };
  $('#bulkbar').onclick = e => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-bulk]')?.dataset.bulk; if (!act) return;
    const ids = selectedIds();
    if (act === 'clear') { selection.clear(); render(); return; }
    void bulk(act as Parameters<typeof bulk>[0], ids);
  };
}
export const selectedIds = () => selection.ids(new Set(store.pilots.map(p => p.id)));
export function filterBy(kind: 'seed' | 'lobby', value: string) { filter[kind] = value; persist(); render(); }

/** Re-filters, re-sorts and redraws the visible rows (called once a second with fresh data, and on any change). */
export function render() {
  shown = sortPilots(filterPilots(store.pilots, filter, store.rooms), sortKey, sortDir);
  const ids = selectedIds(); store.map.selected = new Set(ids);
  $('#chips').innerHTML = CHIPS.map(c => `<button class="chip ${filter.status.has(c.status) ? 'on' : ''}" data-status="${c.status}">${c.label}</button>`).join('')
    + (filter.seed ? `<button class="chip on" data-clear="seed">Sector ${esc(filter.seed.slice(0, 14))} ✕</button>` : '')
    + (filter.lobby ? `<button class="chip on" data-clear="lobby">Lobby ${esc(filter.lobby)} ✕</button>` : '');
  $('#roster-count').textContent = `${shown.length} of ${store.pilots.length}${store.pilots.some(isBot) ? ` · ${store.pilots.filter(isBot).length} bots` : ''}`;
  const head = $('#roster-head');
  head.querySelectorAll<HTMLElement>('[data-sort]').forEach(el => { el.classList.toggle('sorted', el.dataset.sort === sortKey); el.dataset.dir = el.dataset.sort === sortKey ? (sortDir === 1 ? '▲' : '▼') : ''; });
  const all = head.querySelector<HTMLInputElement>('input[type=checkbox]')!;
  all.checked = shown.length > 0 && shown.every(p => selection.has(p.id)); all.indeterminate = !all.checked && shown.some(p => selection.has(p.id));
  const bar = $('#bulkbar'); bar.hidden = ids.length === 0;
  $('#bulk-count').textContent = `${ids.length} selected`;
  $('#roster-spacer').style.height = `${shown.length * ROW}px`;
  drawRows();
}
function drawRows() {
  const scroll = $('#roster-scroll'), first = Math.max(0, Math.floor(scroll.scrollTop / ROW) - BUFFER), last = Math.min(shown.length, Math.ceil((scroll.scrollTop + scroll.clientHeight) / ROW) + BUFFER);
  const rows = $('#roster-rows'); rows.style.transform = `translateY(${first * ROW}px)`;
  rows.innerHTML = shown.length ? shown.slice(first, last).map(p => `<div class="prow ${p.id === store.map.followed ? 'followed' : ''} ${p.id === store.drawer ? 'open' : ''} ${selection.has(p.id) ? 'picked' : ''}" data-id="${esc(p.id)}">
    <input type="checkbox" ${selection.has(p.id) ? 'checked' : ''} aria-label="Select ${esc(p.name)}">
    <div class="pname"><b>${esc(p.name)}</b>${p.authority ? '<span class="tag" title="Runs this sector\'s enemies">AUTH</span>' : ''}${p.dead ? '<span class="tag red">DEAD</span>' : ''}${isBot(p) ? '<span class="tag dim">BOT</span>' : ''}<div class="sub">${esc(p.ip)} · ${ago(p.since)}</div></div>
    <div class="pwhere">${esc(where(p))}<div class="sub">${p.lobby ? `lobby ${esc(p.lobby)}` : '&nbsp;'}</div></div>
    <div class="num">${p.ping ?? '–'}<div class="sub">${p.rate}/s</div></div>
    <div class="num">${p.profile ? Math.round(p.profile.power) : '–'}</div>
    <button class="icon" data-menu title="Actions">⋯</button></div>`).join('') : '<p class="empty">No pilots match.</p>';
}
