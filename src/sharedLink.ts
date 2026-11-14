import { pilotRadius, type GameModel, type SectorWorld } from './model.ts';
import type { NetClient } from './net.ts';
import { NET } from './netProtocol.ts';
import { sharedSector, encodeRock, encodeEnemies, encodeBump, encodePilotShot, encodeLook, decodeRocks, decodeEnemies, decodeShots, decodeHits, decodeLoot, decodePvpHit, decodeCargo, decodeBumps, decodePilotShots, decodeLook, type PilotLook, type SharedHit } from './shared.ts';
import { sectorWorld } from './sectors.ts';
import { packWorld, unpackWorld, WORLD_CHUNK } from './worldTransfer.ts';

/**
 * Send rates for shared-sector traffic, per second. Everything a pilot produces in a frame (own shots,
 * knocked and mined rocks, and for the authority enemy fire and the sector clock) goes out together as one
 * `fx` message, so a pilot stays under the relay's per-client message limit (NET.maxRate) with room to spare.
 */
export const SHARE_RATES = { enemies: 4, fx: 10, hits: 6, worldChunks: 8 };
/** Seconds before a world request with no answer is asked again. */
const WORLD_RETRY = 6;
/** Rough size budget for one fx message, well under NET.maxMessage. */
const FX_BUDGET = NET.maxMessage - 3500;

type Fx = { p?: unknown[]; b?: unknown[]; r?: unknown[]; e?: unknown[]; c?: number; l?: unknown };
/** A pilot's look (shield, beams) is dropped this many seconds after their last fx message. */
const LOOK_TTL = 0.4;

/**
 * Connects a GameModel to the relay while a sector is shared. Call `frame` once per frame after the model
 * update: it sets the model's role (authority or follower) and remote targets for the next update, then
 * sends what the update produced. Incoming traffic is applied to whatever model `current` returns, so it
 * survives the scene swapping models. No DOM or Phaser.
 *
 * A pilot who is not the sector's authority asks the authority for its copy of the sector once per visit
 * (on arrival, or when another pilot arrives and takes over as authority), so everyone in a sector sees the same
 * rocks, ore depletion, unlocked stations, outposts and clock. `onWorld` hands that copy to the scene.
 */
export class SharedLink {
  private net: NetClient;
  private current: () => GameModel;
  private last = { enemies: -Infinity, fx: -Infinity, hits: -Infinity, chunk: -Infinity };
  private pendingHits = new Map<number, SharedHit>();
  private pendingPvp = new Map<string, number>();
  private lastPvp = -Infinity;
  private now = 0;
  /** Own shots already sent, per model (bullet ids restart with each model). */
  private sentShots = { model: undefined as GameModel | undefined, id: -1 };
  private pendingShots: ReturnType<typeof encodePilotShot>[] = [];
  private lastClock = -Infinity;
  /** Which authority's copy this pilot holds, and the request in flight. */
  private synced = '';
  private asked = { key: '', at: -Infinity };
  private incoming = new Map<string, { n: number; parts: string[]; got: number }>();
  private outgoing: { to: string; id: string; i: number; n: number; data: string }[] = [];
  private looks = new Map<string, { at: number; look: PilotLook }>();
  /** Another pilot's current shield and beams, if they sent them recently. */
  look(id: string): PilotLook | undefined { const entry = this.looks.get(id); return entry && this.now - entry.at <= LOOK_TTL ? entry.look : undefined; }
  /** Set by the scene: replaces the model with one built on the authority's copy of the sector. */
  onWorld: (world: SectorWorld) => void = () => {};
  constructor(net: NetClient, current: () => GameModel) {
    this.net = net; this.current = current;
    net.onCast = (_from, kind, data) => {
      const model = this.current(), shared = model.shared;
      if (kind === 'fx' && data && typeof data === 'object') {
        const fx = data as Fx;
        const look = decodeLook(fx.l); if (look) this.looks.set(_from, { at: this.now, look });
        model.applyPilotShots(decodePilotShots(fx.p));
        model.applyBumps(decodeBumps(fx.b));
        for (const rock of decodeRocks(fx.r)) model.applyRock(rock);
        if (shared?.role === 'follower' && _from === this.net.room?.authority) {
          model.applyShots(decodeShots(fx.e));
          if (typeof fx.c === 'number') model.applyClock(fx.c);
        }
      }
      // Older clients still send these separately.
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
      if (kind === 'world-req' && model.shared?.role === 'authority') void this.sendWorld(from, model);
      if (kind === 'world') this.receiveChunk(from, data);
    };
    // The killer left before their salvage arrived: it goes back to the wreck instead of vanishing.
    net.onUndelivered = (to, kind) => { if (kind === 'pvp-loot') this.current().returnPvpLoot(); if (kind === 'world-req') this.asked.at = -Infinity; if (kind === 'world') this.outgoing = this.outgoing.filter(c => c.to !== to); };
  }
  /** Authority: packs this sector and queues it for one pilot. */
  private async sendWorld(to: string, model: GameModel) {
    if (this.outgoing.some(c => c.to === to)) return;
    const text = await packWorld(sectorWorld(model.toSave()));
    const id = `${model.seed.length}:${Math.floor(this.now * 1000)}`, n = Math.ceil(text.length / WORLD_CHUNK);
    for (let i = 0; i < n; i++) this.outgoing.push({ to, id, i, n, data: text.slice(i * WORLD_CHUNK, (i + 1) * WORLD_CHUNK) });
  }
  private receiveChunk(from: string, data: unknown) {
    const c = data as { id?: unknown; i?: unknown; n?: unknown; data?: unknown };
    if (from !== this.net.room?.authority || typeof c?.id !== 'string' || !Number.isInteger(c.i) || !Number.isInteger(c.n) || typeof c.data !== 'string') return;
    const i = c.i as number, n = c.n as number;
    if (n < 1 || n > 400 || i < 0 || i >= n) return;
    const key = `${from}|${c.id}`, entry = this.incoming.get(key) ?? { n, parts: [], got: 0 };
    if (entry.n !== n) return;
    if (entry.parts[i] === undefined) { entry.parts[i] = c.data; entry.got++; }
    this.incoming.set(key, entry);
    if (entry.got < n) return;
    this.incoming.clear();
    const room = this.net.sectorSeed;
    void unpackWorld(entry.parts.join('')).then(world => {
      const model = this.current();
      if (!world || world.seed !== model.seed || room !== this.net.sectorSeed) return;
      this.synced = this.syncKey(); this.onWorld(world);
    }).catch(() => { this.asked.at = -Infinity; });
  }
  /** One copy per visit to a sector: a later change of authority (say, a pilot destroyed and rebuilt) does not reload the world. */
  private syncKey() { return `${this.net.sectorSeed}`; }
  frame(model: GameModel, now: number) {
    this.now = now;
    const net = this.net;
    if (!net.sharing || !net.room) {
      if (model.shared) { if (model.shared.pvpLoot && !model.shared.pvpLoot.sent) model.returnPvpLoot(); model.shared = undefined; this.pendingHits.clear(); this.pendingPvp.clear(); }
      model.visitorOutposts = []; this.looks.clear();
      this.outgoing.length = 0; this.incoming.clear(); this.synced = '';
      return;
    }
    const role = net.authority ? 'authority' : 'follower';
    if (model.shared?.role !== role) { const loot = model.shared?.pvpLoot; model.shared = sharedSector(role, id => net.claims.has(id, this.now)); model.shared.pvpLoot = loot; this.pendingHits.clear(); }
    const shared = model.shared!;
    shared.targets = net.poses(now).filter(pose => !pose.dead).map(pose => ({ id: pose.id, x: pose.x, y: pose.y, vx: pose.vx, vy: pose.vy, radius: pilotRadius(pose.blocks.map(b => [b[1], b[2]])) }));
    shared.allies = new Set(net.lobby?.members.map(m => m.id) ?? []);
    // The authority's copy of this sector: asked for once per authority.
    if (role === 'authority') { this.synced = ''; if (!net.peers.size) model.visitorOutposts = []; }
    else {
      const key = this.syncKey();
      if (this.synced !== key && (this.asked.key !== key || now - this.asked.at >= WORLD_RETRY)) { this.asked = { key, at: now }; net.direct(net.room.authority, 'world-req', {}); }
    }
    if (this.outgoing.length && now - this.last.chunk >= 1 / SHARE_RATES.worldChunks) {
      this.last.chunk = now; const chunk = this.outgoing.shift()!;
      // Sent whether or not that pilot's ship is in view here (ship state only reaches nearby pilots); if they
      // have left the sector the relay answers `undelivered` and the rest of their copy is dropped.
      net.direct(chunk.to, 'world', { id: chunk.id, i: chunk.i, n: chunk.n, data: chunk.data });
    }
    // PvP: hits on other pilots, summed per victim; the killing blow's cargo to the killer.
    for (const hit of shared.pvpHits.splice(0)) this.pendingPvp.set(hit.to, (this.pendingPvp.get(hit.to) ?? 0) + hit.damage);
    if (this.pendingPvp.size && now - this.lastPvp >= 1 / SHARE_RATES.hits) { this.lastPvp = now; for (const [to, damage] of this.pendingPvp) net.direct(to, 'pvp-hit', { damage }); this.pendingPvp.clear(); }
    if (shared.pvpLoot && !shared.pvpLoot.sent) { net.direct(shared.pvpLoot.to, 'pvp-loot', shared.pvpLoot.cargo); shared.pvpLoot.sent = true; }
    net.flushClaims();
    if (role === 'authority' && now - this.last.enemies >= 1 / SHARE_RATES.enemies) {
      // Only enemies some other pilot here could see or chart: the rest cost bandwidth for nobody.
      this.last.enemies = now; net.cast('enemies', encodeEnemies(model.enemies.filter(e => shared.targets.some(t => Math.abs(t.x - e.x) < NET.interest && Math.abs(t.y - e.y) < NET.interest))));
    }
    this.collectShots(model);
    if (now - this.last.fx >= 1 / SHARE_RATES.fx) { this.last.fx = now; this.sendFx(model, role === 'authority'); }
    if (role === 'authority') {
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
  /** One batched message: own new shots, knocked rocks, changed rocks, and (authority) enemy fire and the clock. */
  /** Picks up this pilot's newly fired shots every frame (they can be gone again before the next send). */
  private collectShots(model: GameModel) {
    if (this.sentShots.model !== model) { this.sentShots = { model, id: Math.max(-1, ...model.bullets.map(b => b.id)) }; this.pendingShots = []; return; }
    let top = this.sentShots.id;
    for (const b of model.bullets) if (b.id > this.sentShots.id) {
      top = Math.max(top, b.id);
      if (!b.enemy && !b.turret && !b.remote && b.life > 0 && model.shared!.targets.length && this.pendingShots.length < 48) this.pendingShots.push(encodePilotShot(b));
    }
    this.sentShots.id = top;
  }
  private sendFx(model: GameModel, authority: boolean) {
    const shared = model.shared!, fx: Fx = {};
    if (this.pendingShots.length) fx.p = this.pendingShots.splice(0);
    const look = model.dead ? undefined : encodeLook(model.player, model.shield, model.maxShield, model.miningLinks, model.tractorLinks);
    if (look) fx.l = look;
    if (shared.bumpedRocks.size) {
      const byId = new Map(model.asteroids.map(a => [a.id, a]));
      fx.b = [...shared.bumpedRocks].slice(0, 48).flatMap(id => { const a = byId.get(id); return a && !shared.changedRocks.has(id) ? [encodeBump(a)] : []; });
      shared.bumpedRocks.clear();
    }
    if (authority) {
      if (shared.shots.length) fx.e = shared.shots.splice(0, 64);
      shared.shots.length = 0;
      // The clock rides along with other traffic, and goes alone at most once a second.
      if (fx.e || fx.p || fx.b?.length || shared.changedRocks.size || this.now - this.lastClock >= 1) { fx.c = Math.round(model.world.time * 100) / 100; this.lastClock = this.now; }
    }
    let size = JSON.stringify(fx).length;
    if (shared.changedRocks.size) {
      // Rocks carry their dented outline, so add them only while the message stays small; the rest go next time.
      const byId = new Map(model.asteroids.map(a => [a.id, a])), rocks: unknown[] = [];
      for (const id of [...shared.changedRocks]) {
        const row = encodeRock(byId.get(id), id), length = JSON.stringify(row).length + 1;
        if (rocks.length && size + length > FX_BUDGET) break;
        rocks.push(row); size += length; shared.changedRocks.delete(id);
        if (rocks.length >= 64) break;
      }
      fx.r = rocks;
    }
    if (fx.p || fx.b?.length || fx.r?.length || fx.e?.length || fx.c !== undefined || fx.l) this.net.cast('fx', fx);
  }
}
