import type { AdminEvent, AdminLobby, AdminPilot, AdminRequest, AdminRoom, AuditEntry, BanEntry } from '../adminProtocol.ts';
import { UniverseMap } from './map.ts';

/**
 * Shared state of the admin page and the small helpers every panel uses: the socket sender, toasts, a modal
 * form and HTML escaping. Panels (src/admin/ui/*) read `store` and call `send`; src/admin/main.ts owns the
 * socket and the frame loop.
 */
type Distribute<T> = T extends unknown ? Omit<T, 'ref'> : never;
export type Request = Distribute<AdminRequest>;
export const store = {
  pilots: [] as AdminPilot[], lobbies: [] as AdminLobby[], rooms: [] as AdminRoom[], bans: [] as BanEntry[],
  stats: {} as Record<string, number>, log: [] as AuditEntry[], events: [] as AdminEvent[],
  map: new UniverseMap(),
  /** Pilot shown in the drawer. */
  drawer: undefined as string | undefined,
  socket: undefined as WebSocket | undefined,
};
export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export const pilotById = (id?: string) => store.pilots.find(p => p.id === id);
export const nameOf = (id?: string) => pilotById(id)?.name ?? id ?? '';
export const ago = (t: number) => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h ${Math.floor(s / 60) % 60}m`; };

let refs = 0;
const labels = new Map<number, string>(), waiting = new Map<number, (m: unknown) => void>();
/** Sends a request; `label` names it in the result toast. Resolves with the relay's reply for `pilot`/`result`. */
export function send(request: Request, label?: string): Promise<unknown> | undefined {
  if (store.socket?.readyState !== WebSocket.OPEN) { toast('Not connected.', false); return; }
  const ref = ++refs; if (label) labels.set(ref, label);
  store.socket.send(JSON.stringify({ ...request, ref }));
  return new Promise(resolve => { waiting.set(ref, resolve); setTimeout(() => { if (waiting.delete(ref)) resolve(undefined); }, 15000); });
}
/** Called by main.ts for every `result`/`pilot` reply. */
export function settle(ref: number, m: { t: string; ok?: boolean; message?: string }) {
  waiting.get(ref)?.(m); waiting.delete(ref);
  if (m.t !== 'result') return;
  const label = labels.get(ref); labels.delete(ref);
  if (label || m.ok === false) toast(`${label ?? 'Action'} · ${m.message ?? (m.ok ? 'done' : 'failed')}`, m.ok !== false);
}

export function toast(text: string, ok = true) {
  const el = document.createElement('div'); el.className = `toast ${ok ? 'ok' : 'bad'}`; el.textContent = text;
  $('#toasts').append(el); setTimeout(() => el.classList.add('out'), 4200); setTimeout(() => el.remove(), 4600);
}

export type Field = { name: string; label: string; type?: 'text' | 'number' | 'select' | 'textarea'; value?: string | number; options?: { value: string; label: string }[] };
/** A small modal form. Resolves with the field values, or null when cancelled. */
export function ask(title: string, fields: Field[], confirmText = 'OK', danger = false, note = ''): Promise<Record<string, string> | null> {
  const modal = $('#modal');
  modal.innerHTML = `<form class="dialog"><h3>${esc(title)}</h3>${note ? `<p class="note">${esc(note)}</p>` : ''}${fields.map(f => `<label><span>${esc(f.label)}</span>${
    f.type === 'select' ? `<select name="${f.name}">${f.options!.map(o => `<option value="${esc(o.value)}"${o.value === String(f.value) ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`
      : f.type === 'textarea' ? `<textarea name="${f.name}" maxlength="200" rows="3">${esc(f.value ?? '')}</textarea>`
      : `<input name="${f.name}" type="${f.type ?? 'text'}" value="${esc(f.value ?? '')}" ${f.type === 'number' ? 'step="any"' : 'maxlength="200"'}>`}</label>`).join('')}
    <div class="row end"><button type="button" data-cancel>Cancel</button><button class="${danger ? 'danger' : 'primary'}">${esc(confirmText)}</button></div></form>`;
  modal.hidden = false;
  (modal.querySelector('input,select,textarea,button.primary,button.danger') as HTMLElement | null)?.focus();
  return new Promise(resolve => {
    const form = modal.querySelector('form')!;
    const done = (v: Record<string, string> | null) => { modal.hidden = true; modal.innerHTML = ''; resolve(v); };
    form.onsubmit = e => { e.preventDefault(); const out: Record<string, string> = {}; new FormData(form).forEach((v, k) => { out[k] = String(v); }); done(out); };
    (form.querySelector('[data-cancel]') as HTMLElement).onclick = () => done(null);
    form.onkeydown = e => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } };
    modal.onmousedown = e => { if (e.target === modal) done(null); };
  });
}
export const confirmDo = (title: string, note = '') => ask(title, [], 'Confirm', true, note).then(v => v !== null);

/** Remembered UI preferences (divider width, roster filter); storage may be blocked, so every access is guarded. */
export const prefs = {
  get<T>(key: string, fallback: T): T { try { const v = localStorage.getItem(`vf-admin.${key}`); return v ? JSON.parse(v) as T : fallback; } catch { return fallback; } },
  set(key: string, value: unknown) { try { localStorage.setItem(`vf-admin.${key}`, JSON.stringify(value)); } catch { /* storage blocked */ } },
};
