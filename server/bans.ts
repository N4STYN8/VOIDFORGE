import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { BanEntry } from '../src/adminProtocol.ts';

/**
 * IP bans set from the admin console. Kept in a small JSON file when `file` is given (on the Pi
 * /var/lib/voidforge/bans.json) so they survive relay restarts; in memory otherwise. Expired entries are
 * pruned. A missing or corrupt file starts an empty list (with a warning) rather than stopping the relay.
 */
export class Bans {
  private entries: BanEntry[] = [];
  private file?: string;
  private now: () => number;
  constructor(file?: string, now: () => number = Date.now) {
    this.file = file; this.now = now;
    if (!file) return;
    try {
      const data = JSON.parse(readFileSync(file, 'utf8'));
      if (!Array.isArray(data)) throw new Error('not a list');
      this.entries = data.filter((b): b is BanEntry => b && typeof b.ip === 'string' && Number.isFinite(b.until)).map(b => ({ ip: b.ip, until: b.until, reason: String(b.reason ?? ''), name: String(b.name ?? ''), at: Number(b.at) || 0 }));
    } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') console.warn(`[admin] Ignoring unreadable bans file ${file}: ${(error as Error).message}`);
    }
  }
  private prune() { const now = this.now(), before = this.entries.length; this.entries = this.entries.filter(b => b.until > now); return before !== this.entries.length; }
  /** How many times the file was written (tests check that bulk actions write once). */
  saves = 0;
  private save() {
    this.saves++;
    if (!this.file) return;
    try { const tmp = `${this.file}.tmp`; writeFileSync(tmp, JSON.stringify(this.entries, null, 1)); renameSync(tmp, this.file); }
    catch (error) { console.warn(`[admin] Could not save bans to ${this.file}: ${(error as Error).message}`); }
  }
  add(ip: string, minutes: number, reason: string, name: string) { return this.addMany([{ ip, minutes, reason, name }])[0]; }
  /** Adds several bans with a single file write (a bulk kick or ban must not write once per address). */
  addMany(list: { ip: string; minutes: number; reason: string; name: string }[]): BanEntry[] {
    if (!list.length) return [];
    this.prune();
    const ips = new Set(list.map(b => b.ip)), at = this.now();
    this.entries = this.entries.filter(b => !ips.has(b.ip));
    const added = list.map(b => ({ ip: b.ip, until: at + b.minutes * 60000, reason: b.reason, name: b.name, at }));
    this.entries.push(...added); this.save();
    return added;
  }
  remove(ip: string) { const before = this.entries.length; this.entries = this.entries.filter(b => b.ip !== ip); if (this.entries.length !== before) { this.save(); return true; } return false; }
  isBanned(ip: string) { if (this.prune()) this.save(); return this.entries.some(b => b.ip === ip); }
  list() { if (this.prune()) this.save(); return this.entries.map(b => ({ ...b })); }
}
