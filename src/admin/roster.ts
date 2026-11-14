import type { AdminPilot, AdminRoom } from '../adminProtocol.ts';

/**
 * Pilot roster logic for the admin page (pure, tested in Node): text search, status chips, sector and lobby
 * filters, column sorting and a selection that forgets pilots who went offline.
 */
export type Status = 'alive' | 'dead' | 'solo' | 'lobby' | 'sharing' | 'authority' | 'bots' | 'humans';
export type RosterFilter = { text: string; status: Set<Status>; seed?: string; lobby?: string };
export type SortKey = 'name' | 'where' | 'ping' | 'rate' | 'power' | 'since';
export const emptyFilter = (): RosterFilter => ({ text: '', status: new Set() });
/** Simulated pilots (scripts/swarm.ts) are named "Sim 001" and so on. */
export const isBot = (p: AdminPilot) => p.name.startsWith('Sim ');

export function filterPilots(pilots: AdminPilot[], f: RosterFilter, rooms: AdminRoom[]) {
  const members = new Map(rooms.map(r => [r.seed, r.members])), text = f.text.trim().toLowerCase();
  const here = (p: AdminPilot) => p.room ? members.get(p.room) ?? 1 : 0;
  const test: Record<Status, (p: AdminPilot) => boolean> = {
    alive: p => !p.dead, dead: p => Boolean(p.dead), lobby: p => Boolean(p.lobby), sharing: p => here(p) > 1,
    solo: p => !p.lobby && here(p) === 1, authority: p => p.authority, bots: isBot, humans: p => !isBot(p),
  };
  return pilots.filter(p =>
    (!text || [p.name, p.ip, p.id, p.lobby ?? ''].some(v => v.toLowerCase().includes(text))) &&
    [...f.status].every(s => test[s](p)) &&
    (!f.seed || p.room === f.seed) && (!f.lobby || p.lobby === f.lobby));
}

const value = (p: AdminPilot, key: SortKey): string | number | undefined =>
  key === 'name' ? p.name.toLowerCase() : key === 'where' ? `${p.world?.home ?? '~'}|${p.world?.x ?? 0},${p.world?.y ?? 0}` : key === 'ping' ? p.ping
    : key === 'rate' ? p.rate : key === 'power' ? p.profile?.power : p.since;
/** Sorts a copy; pilots with no value for the key (unknown ping, no profile) always go last. */
export function sortPilots(pilots: AdminPilot[], key: SortKey, dir: 1 | -1) {
  return [...pilots].sort((a, b) => {
    const x = value(a, key), y = value(b, key);
    if (x === undefined || y === undefined) return x === y ? 0 : x === undefined ? 1 : -1;
    return (x < y ? -1 : x > y ? 1 : 0) * dir || a.id.localeCompare(b.id);
  });
}

export class Selection {
  private set = new Set<string>();
  toggle(id: string) { if (!this.set.delete(id)) this.set.add(id); }
  has(id: string) { return this.set.has(id); }
  /** Selects every id between `from` and `to` (inclusive) in the order shown. */
  range(order: string[], from: string, to: string) {
    const i = order.indexOf(from), j = order.indexOf(to); if (i < 0 || j < 0) return;
    for (const id of order.slice(Math.min(i, j), Math.max(i, j) + 1)) this.set.add(id);
  }
  setAll(ids: string[]) { this.set = new Set(ids); }
  clear() { this.set.clear(); }
  /** Selected ids still online; the rest are dropped. */
  ids(online: Set<string>) { for (const id of this.set) if (!online.has(id)) this.set.delete(id); return [...this.set]; }
  get size() { return this.set.size; }
}
