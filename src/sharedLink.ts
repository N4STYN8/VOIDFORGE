import type { GameModel } from './model.ts';
import type { NetClient } from './net.ts';
import { NET } from './netProtocol.ts';
import { sharedSector, encodeRock, encodeEnemies, decodeRocks, decodeEnemies, decodeShots, decodeHits, decodeLoot, decodePvpHit, decodeCargo, type SharedHit } from './shared.ts';

/** Send rates for shared-sector traffic, per second. */
export const SHARE_RATES = { enemies: 4, rocks: 8, hits: 15 };

/**
 * Connects a GameModel to the relay while a sector is shared (stage 3). Call `frame` once per frame after
 * the model update: it sets the model's role (authority or follower) and remote targets for the next
 * update, then sends what the update produced. Incoming traffic is applied to whatever model `current`
 * returns, so it survives the scene swapping models. No DOM or Phaser.
 */
export class SharedLink {
  private net: NetClient;
  private current: () => GameModel;
  private last = { enemies: -Infinity, rocks: -Infinity, hits: -Infinity };
  private pendingHits = new Map<number, SharedHit>();
  private pendingPvp = new Map<string, number>();
  private lastPvp = -Infinity;
  private now = 0;
  constructor(net: NetClient, current: () => GameModel) {
    this.net = net; this.current = current;
    net.onCast = (_from, kind, data) => {
      const model = this.current(), shared = model.shared;
      if (kind === 'rocks') for (const rock of decodeRocks(data)) model.applyRock(rock);
      if (kind === 'enemies' && shared?.role === 'follower') model.applyEnemies(decodeEnemies(data));
      if (kind === 'shots' && shared?.role === 'follower') model.applyShots(decodeShots(data));
    };
    net.onDirect = (from, kind, data) => {
      const model = this.current();
      if (kind === 'hit' && model.shared?.role === 'authority') for (const hit of decodeHits(data)) model.applyRemoteHit(hit.enemyId, hit.damage, from, hit.pierce);
      if (kind === 'loot') model.receiveLoot(decodeLoot(data));
      const name = this.net.peers.get(from)?.name ?? 'another pilot';
      if (kind === 'pvp-hit') model.applyPvpHit(from, name, decodePvpHit(data), Boolean(this.net.lobby?.members.some(m => m.id === from)));
      if (kind === 'pvp-loot') model.receivePvpLoot(decodeCargo(data), name);
    };
    // The killer left before their salvage arrived: it goes back to the wreck instead of vanishing.
    net.onUndelivered = (_to, kind) => { if (kind === 'pvp-loot') this.current().returnPvpLoot(); };
  }
  frame(model: GameModel, now: number) {
    this.now = now;
    const net = this.net;
    if (!net.sharing || !net.room) {
      if (model.shared) { if (model.shared.pvpLoot && !model.shared.pvpLoot.sent) model.returnPvpLoot(); model.shared = undefined; this.pendingHits.clear(); this.pendingPvp.clear(); }
      return;
    }
    const role = net.authority ? 'authority' : 'follower';
    if (model.shared?.role !== role) { const loot = model.shared?.pvpLoot; model.shared = sharedSector(role, id => net.claims.has(id, this.now)); model.shared.pvpLoot = loot; this.pendingHits.clear(); }
    const shared = model.shared!;
    shared.targets = net.poses(now).filter(pose => !pose.dead).map(pose => ({ id: pose.id, x: pose.x, y: pose.y, vx: pose.vx, vy: pose.vy, radius: 18 + 16 * Math.max(0, ...pose.blocks.map(b => Math.max(Math.abs(b[1]), Math.abs(b[2])))) }));
    shared.allies = new Set(net.lobby?.members.map(m => m.id) ?? []);
    // PvP: hits on other pilots, summed per victim; the killing blow's cargo to the killer.
    for (const hit of shared.pvpHits.splice(0)) this.pendingPvp.set(hit.to, (this.pendingPvp.get(hit.to) ?? 0) + hit.damage);
    if (this.pendingPvp.size && now - this.lastPvp >= 1 / SHARE_RATES.hits) { this.lastPvp = now; for (const [to, damage] of this.pendingPvp) net.direct(to, 'pvp-hit', { damage }); this.pendingPvp.clear(); }
    if (shared.pvpLoot && !shared.pvpLoot.sent) { net.direct(shared.pvpLoot.to, 'pvp-loot', shared.pvpLoot.cargo); shared.pvpLoot.sent = true; }
    net.flushClaims();
    // Rocks this pilot changed (while holding their claim), batched.
    if (shared.changedRocks.size && now - this.last.rocks >= 1 / SHARE_RATES.rocks) {
      this.last.rocks = now;
      const ids = [...shared.changedRocks].slice(0, 64); for (const id of ids) shared.changedRocks.delete(id);
      net.cast('rocks', ids.map(id => encodeRock(model.asteroids.find(a => a.id === id), id)));
    }
    if (role === 'authority') {
      // Only enemies some other pilot here could see or chart: the rest cost bandwidth for nobody.
      if (now - this.last.enemies >= 1 / SHARE_RATES.enemies) { this.last.enemies = now; net.cast('enemies', encodeEnemies(model.enemies.filter(e => shared.targets.some(t => Math.abs(t.x - e.x) < NET.interest && Math.abs(t.y - e.y) < NET.interest)))); }
      if (shared.shots.length) net.cast('shots', shared.shots.splice(0, 64));
      shared.shots.length = 0;
      for (const loot of shared.loot.splice(0)) net.direct(loot.to, 'loot', loot.drops);
      shared.hits.length = 0;
    } else {
      for (const hit of shared.hits.splice(0)) { const sum = this.pendingHits.get(hit.enemyId); if (sum) sum.damage += hit.damage; else this.pendingHits.set(hit.enemyId, { ...hit }); }
      if (this.pendingHits.size && now - this.last.hits >= 1 / SHARE_RATES.hits) {
        this.last.hits = now;
        net.direct(net.room.authority, 'hit', [...this.pendingHits.values()].slice(0, 64)); this.pendingHits.clear();
      }
      shared.shots.length = 0; shared.loot.length = 0;
    }
  }
}
