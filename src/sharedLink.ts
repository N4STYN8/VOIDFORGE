import { pilotRadius, type GameModel, type SectorWorld } from './model.ts';
import { BUDGET, type NetClient } from './net.ts';
import { NET } from './netProtocol.ts';
import { sharedSector, encodeRock, encodeEnemies, encodeBump, encodePilotShot, encodeLook, decodeRocks, decodeEnemies, decodeIds, decodeShots, decodeHits, decodeLoot, decodePvpHit, decodeCargo, decodeBumps, decodePilotShots, decodeLook, type PilotLook, type PilotShot, type SharedHit, type SharedShot } from './shared.ts';
import { sectorWorld } from './sectors.ts';
import { packWorld, unpackWorld, WORLD_CHUNK } from './worldTransfer.ts';

/**
 * Send rates for shared-sector traffic, per second. Everything a pilot produces in a frame (own shots,
 * knocked and mined rocks, and for the authority its enemies, enemy fire and the sector clock) goes out together
 * as one `fx` message at `fx` per second, so a pilot stays under the relay's per-client message limit
 * (NET.maxRate). Fresh shots (and, on followers, fresh hits) may go sooner, up to `fxFast` / `hitsFast` per
 * second, while the client's send budget has room (BUDGET.reserve). The authority's enemies ride in fx: those
 * within NEAR_ENEMIES of another pilot in every fx (at most `fx` per second), the whole list `enemies` times a
 * second, and removals at once.
 */
export const SHARE_RATES = { enemies: 2, fx: 10, fxFast: 30, hits: 6, hitsFast: 20, worldChunks: 8 };
/** Enemies this close to another pilot (world units, about a zoomed-out screen) are updated in every fx. */
export const NEAR_ENEMIES = 2400;
/** Longest one-way network delay assumed when carrying received things forward (seconds). */
const MAX_ONE_WAY = 0.25;
/** Seconds before a world request with no answer is asked again. */
const WORLD_RETRY = 6;
/** Rough size budget for one fx message, well under NET.maxMessage. */
const FX_BUDGET = NET.maxMessage - 3500;

/**
 * One fx message. p own shots, b bumped rocks, r changed rocks, l look; authority only: e enemy fire (each with its
 * age `a`), c clock, n enemy rows (f = 1 when the list is complete), x removed enemy ids. q is the sender's round
 * trip to the relay in milliseconds (about once a second), so receivers can estimate the delay from sender to them.
 */
type Fx = { p?: unknown[]; b?: unknown[]; r?: unknown[]; e?: unknown[]; c?: number; l?: unknown; n?: unknown[]; f?: 1; x?: number[]; q?: number };
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
  private last = { enemies: -Infinity, near: -Infinity, fx: -Infinity, hits: -Infinity, chunk: -Infinity, rtt: -Infinity };
  /** Enemy ids followers have been told about and not yet told are gone. */
  private sentEnemies = new Set<number>();
  /** Other pilots' round trips to the relay (seconds), from their fx. */
  private peerRtt = new Map<string, number>();
  /** Authority: enemy fire picked up each frame, with when, so its age can be sent. */
  private pendingEnemyShots: { shot: SharedShot; at: number }[] = [];
  private pendingHits = new Map<number, SharedHit>();
  private pendingPvp = new Map<string, number>();
  private lastPvp = -Infinity;
  private now = 0;
  /** Own shots already sent, per model (bullet ids restart with each model). */
  private sentShots = { model: undefined as GameModel | undefined, id: -1 };
  private pendingShots: PilotShot[] = [];
  private lastClock = -Infinity;
  /** Which authority's copy this pilot holds, and the request in flight. */
  private synced = '';
  private asked = { key: '', at: -Infinity };
  private incoming = new Map<string, { n: number; parts: string[]; got: number }>();
  private outgoing: { to: string; id: string; i: number; n: number; data: string }[] = [];
  private looks = new Map<string, { at: number; look: PilotLook }>();
  /** Another pilot's current shield and beams, if they sent them recently. */
  look(id: string): PilotLook | undefined { const entry = this.looks.get(id); return entry && this.now - entry.at <= LOOK_TTL ? entry.look : undefined; }
  /** Another pilot's round trip to the relay in whole milliseconds, if they have sent it. */
  pingOf(id: string) { const rtt = this.peerRtt.get(id); return rtt === undefined ? undefined : Math.round(rtt * 1000); }
  /**
   * Estimated seconds from `from` sending something to it arriving here: half of each side's round trip to the
   * relay (this client's measured, the sender's from its fx; this client's if the sender's is unknown).
   */
  oneWay(from: string) {
    const mine = this.net.rtt ?? 0, theirs = this.peerRtt.get(from) ?? mine;
    return Math.min(MAX_ONE_WAY, (mine + theirs) / 2);
  }
  /** Set by the scene: replaces the model with one built on the authority's copy of the sector. */
  onWorld: (world: SectorWorld) => void = () => {};
  constructor(net: NetClient, current: () => GameModel) {
    this.net = net; this.current = current;
    net.onCast = (_from, kind, data) => {
      const model = this.current(), shared = model.shared;
      if (kind === 'fx' && data && typeof data === 'object') {
        const fx = data as Fx;
        const look = decodeLook(fx.l); if (look) this.looks.set(_from, { at: this.now, look });
        if (typeof fx.q === 'number' && Number.isFinite(fx.q) && fx.q >= 0) this.peerRtt.set(_from, Math.min(2, fx.q / 1000));
        const shots = decodePilotShots(fx.p);
        // Launched from where this pilot draws the shooter's ship, so they leave its visible guns.
        if (shots.length) model.applyPilotShots(shots, this.net.pose(_from, this.net.clock()));
        model.applyBumps(decodeBumps(fx.b));
        for (const rock of decodeRocks(fx.r)) model.applyRock(rock);
        if (shared?.role === 'follower' && _from === this.net.room?.authority) {
          const oneWay = this.oneWay(_from);
          model.removeEnemies(decodeIds(fx.x));
          if (fx.n) model.applyEnemies(decodeEnemies(fx.n), oneWay, fx.f === 1);
          model.applyShots(decodeShots(fx.e), oneWay);
          if (typeof fx.c === 'number') model.applyClock(fx.c);
        }
      }
      // Older clients still send these separately.
      if (kind === 'rocks') for (const rock of decodeRocks(data)) model.applyRock(rock);
      if (kind === 'enemies' && shared?.role === 'follower') model.applyEnemies(decodeEnemies(data), this.oneWay(_from), true);
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
      model.visitorOutposts = []; this.looks.clear(); this.peerRtt.clear(); this.sentEnemies.clear(); this.pendingEnemyShots.length = 0;
      this.outgoing.length = 0; this.incoming.clear(); this.synced = '';
      return;
    }
    const role = net.authority ? 'authority' : 'follower';
    if (model.shared?.role !== role) { const loot = model.shared?.pvpLoot; model.shared = sharedSector(role, id => net.claims.has(id, this.now)); model.shared.pvpLoot = loot; this.pendingHits.clear(); this.sentEnemies.clear(); this.pendingEnemyShots.length = 0; this.last.enemies = -Infinity; }
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
    if (this.pendingPvp.size && this.due(now, this.lastPvp, SHARE_RATES.hits, SHARE_RATES.hitsFast, this.pendingPvp.size)) { this.lastPvp = now; for (const [to, damage] of this.pendingPvp) net.direct(to, 'pvp-hit', { damage }); this.pendingPvp.clear(); }
    if (shared.pvpLoot && !shared.pvpLoot.sent) { net.direct(shared.pvpLoot.to, 'pvp-loot', shared.pvpLoot.cargo); shared.pvpLoot.sent = true; }
    net.flushClaims();
    this.collectShots(model);
    if (role === 'authority') { for (const shot of shared.shots.splice(0)) if (this.pendingEnemyShots.length < 96) this.pendingEnemyShots.push({ shot, at: now }); }
    // Fresh fire goes out at once when the budget allows, instead of waiting for the next regular fx.
    if (this.due(now, this.last.fx, SHARE_RATES.fx, SHARE_RATES.fxFast, this.pendingShots.length + this.pendingEnemyShots.length)) { this.last.fx = now; this.sendFx(model, role === 'authority'); }
    if (role === 'authority') {
      for (const loot of shared.loot.splice(0)) net.direct(loot.to, 'loot', loot.drops);
      shared.hits.length = 0;
    } else {
      for (const hit of shared.hits.splice(0)) { const sum = this.pendingHits.get(hit.enemyId); if (sum) sum.damage += hit.damage; else this.pendingHits.set(hit.enemyId, { ...hit }); }
      if (this.pendingHits.size && this.due(now, this.last.hits, SHARE_RATES.hits, SHARE_RATES.hitsFast, this.pendingHits.size)) {
        this.last.hits = now;
        net.direct(net.room.authority, 'hit', [...this.pendingHits.values()].slice(0, 64)); this.pendingHits.clear();
      }
      shared.shots.length = 0; shared.loot.length = 0;
    }
  }
  /**
   * True when a batched message is due: its regular interval has passed, or there is something urgent and at least
   * the fast interval has passed while the client's send budget has room to spare.
   */
  private due(now: number, last: number, rate: number, fast: number, urgent: number) {
    if (now - last >= 1 / rate) return true;
    return urgent > 0 && now - last >= 1 / fast && this.net.spare() >= BUDGET.reserve;
  }
  /** Picks up this pilot's newly fired shots every frame (they can be gone again before the next send). */
  private collectShots(model: GameModel) {
    if (this.sentShots.model !== model) { this.sentShots = { model, id: Math.max(-1, ...model.bullets.map(b => b.id)) }; this.pendingShots = []; return; }
    let top = this.sentShots.id;
    for (const b of model.bullets) if (b.id > this.sentShots.id) {
      top = Math.max(top, b.id);
      if (!b.enemy && !b.turret && !b.remote && b.life > 0 && model.shared!.targets.length && this.pendingShots.length < 48) this.pendingShots.push(encodePilotShot(b, model.player));
    }
    this.sentShots.id = top;
  }
  /** One batched message: own new shots, knocked rocks, changed rocks, and (authority) enemies, enemy fire and the clock. */
  private sendFx(model: GameModel, authority: boolean) {
    const shared = model.shared!, fx: Fx = {}, now = this.now;
    if (this.pendingShots.length) fx.p = this.pendingShots.splice(0);
    if (this.net.rtt !== undefined && now - this.last.rtt >= 1) { fx.q = Math.round(this.net.rtt * 1000); this.last.rtt = now; }
    const look = model.dead ? undefined : encodeLook(model.player, model.shield, model.maxShield, model.miningLinks, model.tractorLinks);
    if (look) fx.l = look;
    if (shared.bumpedRocks.size) {
      const byId = new Map(model.asteroids.map(a => [a.id, a]));
      fx.b = [...shared.bumpedRocks].slice(0, 48).flatMap(id => { const a = byId.get(id); return a && !shared.changedRocks.has(id) ? [encodeBump(a)] : []; });
      shared.bumpedRocks.clear();
    }
    if (authority) {
      if (this.pendingEnemyShots.length) fx.e = this.pendingEnemyShots.splice(0, 64).map(({ shot, at }) => ({ ...shot, a: Math.round((now - at) * 1000) / 1000 }));
      this.pendingEnemyShots.length = 0;
      this.addEnemies(model, fx);
      // The clock rides along with other traffic, and goes alone at most once a second.
      if (fx.e || fx.p || fx.b?.length || fx.n || shared.changedRocks.size || this.now - this.lastClock >= 1) { fx.c = Math.round(model.world.time * 100) / 100; this.lastClock = this.now; }
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
    if (fx.p || fx.b?.length || fx.r?.length || fx.e?.length || fx.c !== undefined || fx.l || fx.n || fx.x) this.net.cast('fx', fx);
  }
  /**
   * Authority: the enemies other pilots here could see or chart, with velocities. Nearby ones in every fx (at most
   * SHARE_RATES.fx a second), the whole list SHARE_RATES.enemies times a second (so followers also drop enemies
   * that left everyone's range), and the ids of enemies gone since the last message.
   */
  private addEnemies(model: GameModel, fx: Fx) {
    const now = this.now, targets = model.shared!.targets, alive = new Set<number>();
    for (const e of model.enemies) if (e.health > 0) alive.add(e.id);
    const removed = [...this.sentEnemies].filter(id => !alive.has(id));
    for (const id of removed) this.sentEnemies.delete(id);
    if (removed.length) fx.x = removed.slice(0, 128);
    const within = (range: number) => model.enemies.filter(e => e.health > 0 && targets.some(t => Math.abs(t.x - e.x) < range && Math.abs(t.y - e.y) < range));
    if (now - this.last.enemies >= 1 / SHARE_RATES.enemies) {
      const list = within(NET.interest);
      this.last.enemies = now; this.last.near = now;
      fx.n = encodeEnemies(list); fx.f = 1;
      this.sentEnemies = new Set(list.slice(0, 96).map(e => e.id));
    } else if (now - this.last.near >= 1 / SHARE_RATES.fx - 0.005) {
      const list = within(NEAR_ENEMIES);
      if (!list.length) return;
      this.last.near = now;
      fx.n = encodeEnemies(list);
      for (const e of list.slice(0, 96)) this.sentEnemies.add(e.id);
    }
  }
}
