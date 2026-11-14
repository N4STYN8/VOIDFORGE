import { LOBBY_SHARE, RESOURCES, type Resource } from './data.ts';
import type { GameModel } from './model.ts';
import type { NetClient } from './net.ts';

/**
 * Lobby resource sharing (opt-in per player). No DOM or Phaser.
 *
 * A pilot who turned sharing on announces their station deposits to the lobby (`pool`). When another
 * member's action falls short and the announced pools cover it, the model raises `borrowRequest`; this
 * splits it across the members who share, asks each (`take`), and each owner either takes exactly that
 * out of their own deposits and sends it (`give`) or declines with nothing. The minerals become the
 * borrower's deposits and the model retries the action. Minerals only move: an owner's `give` that the
 * relay cannot deliver goes back into the owner's deposits, and a late `give` is still kept.
 */
type Minerals = Partial<Record<Resource, number>>;
const isResource = (v: string): v is Resource => v in RESOURCES;
/** Whole, positive, sane amounts only. */
export function readMinerals(d: unknown): Minerals {
  const out: Minerals = {};
  if (!d || typeof d !== 'object') return out;
  for (const [ore, n] of Object.entries(d)) if (isResource(ore) && Number.isInteger(n) && (n as number) > 0 && (n as number) <= 10_000_000) out[ore] = n as number;
  return out;
}
const label = (m: Minerals) => (Object.entries(m) as [Resource, number][]).map(([ore, n]) => `${n} ${ore}`).join(', ');

export class LobbyShare {
  /** This pilot's switch: share my station deposits with my lobby. */
  enabled = false;
  private net: NetClient;
  private current: () => GameModel;
  private now = 0;
  private pools = new Map<string, { at: number; pool: Minerals }>();
  private advertised = { key: '', at: -Infinity };
  private request?: { id: string; waiting: Set<string>; covered: boolean };
  /** Gives sent and not yet known to be delivered, so an undeliverable one goes back to the deposits. */
  private gives = new Map<string, { at: number; minerals: Minerals }>();
  private serial = 0;
  constructor(net: NetClient, current: () => GameModel) {
    this.net = net; this.current = current;
    net.onParty = (from, kind, data) => this.receive(from, kind, data);
    net.onPartyUndelivered = (to, kind) => {
      if (kind === 'give') for (const [key, give] of this.gives) if (key.endsWith(`|${to}`)) { this.refund(give.minerals); this.gives.delete(key); }
      if (kind === 'take' && this.request?.waiting.delete(to)) { this.request.covered = false; this.settle(); }
    };
  }
  private name(id: string) { return this.net.lobby?.members.find(m => m.id === id)?.name ?? 'a lobby member'; }
  private member(id: string) { return Boolean(this.net.lobby?.members.some(m => m.id === id && m.id !== this.net.id)); }
  private refund(minerals: Minerals) { const model = this.current(); for (const [ore, n] of Object.entries(minerals) as [Resource, number][]) model.stored[ore] += n; }
  /** What lobby members other than this pilot share right now. */
  get pool(): Minerals {
    const total: Minerals = {};
    for (const [id, entry] of this.pools) if (this.member(id) && this.now - entry.at <= LOBBY_SHARE.poolTtl) for (const [ore, n] of Object.entries(entry.pool) as [Resource, number][]) total[ore] = (total[ore] ?? 0) + n;
    return total;
  }
  /** Lobby members currently sharing, for the Multiplayer panel. */
  get sharers() { return [...this.pools].filter(([id, e]) => this.member(id) && this.now - e.at <= LOBBY_SHARE.poolTtl && Object.keys(e.pool).length).map(([id]) => this.name(id)); }
  private receive(from: string, kind: string, data: unknown) {
    if (!this.member(from)) return;
    const model = this.current(), d = (data ?? {}) as { id?: unknown; pool?: unknown; minerals?: unknown };
    if (kind === 'pool') { this.pools.set(from, { at: this.now, pool: readMinerals(d.pool) }); return; }
    if (kind === 'take') {
      const id = typeof d.id === 'string' ? d.id.slice(0, 40) : '', want = readMinerals(d.minerals), ores = Object.entries(want) as [Resource, number][];
      const ok = this.enabled && id && ores.length && ores.every(([ore, n]) => model.stored[ore] >= n);
      if (ok) {
        for (const [ore, n] of ores) model.stored[ore] -= n;
        this.gives.set(`${id}|${from}`, { at: this.now, minerals: want });
        model.message = `Sent ${label(want)} from your deposits to ${this.name(from)}.`;
        this.advertised.at = -Infinity;
      }
      this.net.party(from, 'give', { id, minerals: ok ? want : {} });
      return;
    }
    if (kind === 'give') {
      const got = readMinerals(d.minerals), request = this.request;
      // Whatever arrives is kept, even after the request timed out: minerals are never dropped.
      if (Object.keys(got).length) model.receiveLobbyMinerals(got, this.name(from));
      if (request && d.id === request.id && request.waiting.delete(from)) { if (!Object.keys(got).length) request.covered = false; this.settle(); }
    }
  }
  private settle() {
    const request = this.request; if (!request || request.waiting.size) return;
    this.request = undefined; this.current().finishBorrow(request.covered);
  }
  /** Once per frame, after the model update. */
  frame(model: GameModel, now: number) {
    this.now = now;
    for (const [key, give] of this.gives) if (now - give.at > 15) this.gives.delete(key);
    if (!this.net.connected || !this.net.lobby) {
      this.pools.clear(); model.lobbyPool = {}; this.advertised.key = '';
      if (model.borrowRequest) { model.borrowRequest = undefined; model.finishBorrow(false); }
      if (this.request) { this.request = undefined; model.finishBorrow(false); }
      return;
    }
    // Announce what this pilot shares (nothing when sharing is off), on change and every poolInterval.
    const pool: Minerals = this.enabled ? readMinerals(model.stored) : {}, key = JSON.stringify(pool);
    if (key !== this.advertised.key || now - this.advertised.at >= LOBBY_SHARE.poolInterval) { this.advertised = { key, at: now }; this.net.party(undefined, 'pool', { pool }); }
    model.lobbyPool = this.pool;
    const want = model.borrowRequest; if (!want) return;
    model.borrowRequest = undefined;
    // Split the shortfall across sharing members, largest pools first.
    const asks = new Map<string, Minerals>();
    for (const [ore, need] of Object.entries(want) as [Resource, number][]) {
      let left = need;
      const owners = [...this.pools].filter(([id, e]) => this.member(id) && now - e.at <= LOBBY_SHARE.poolTtl && (e.pool[ore] ?? 0) > 0).sort((a, b) => (b[1].pool[ore] ?? 0) - (a[1].pool[ore] ?? 0));
      for (const [id, entry] of owners) { if (left <= 0) break; const n = Math.min(left, entry.pool[ore]!); left -= n; entry.pool[ore]! -= n; (asks.get(id) ?? asks.set(id, {}).get(id)!)[ore] = n; }
      if (left > 0) { model.finishBorrow(false); return; }
    }
    const id = `${this.net.id ?? 'p'}:${++this.serial}`;
    this.request = { id, waiting: new Set(asks.keys()), covered: true };
    for (const [owner, minerals] of asks) this.net.party(owner, 'take', { id, minerals });
  }
}
