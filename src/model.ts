import { advanceBelt,spinFor,BELT_MOTION } from './beltMotion.ts';
import { EnemyPopulation,type EnemyPopulationSnapshot } from './enemyPopulation.ts';
import { POPULATION } from './populationConfig.ts';
import { SPECIAL } from './abilityConfig.ts';
import { freshAbility,state,tick,activate,onFire,onHit,onMiningHit,onDamageTaken,onBoost,onEnergyDeficit,onOverheat,type AbilityState } from './abilities.ts';
import { dangerAt, bossSites, ChunkWorld, SeedRandom, randomWorldSeed, type WorldSnapshot } from './world.ts';
import { segmentPolygonHit, segmentCircleHit } from './asteroidGeometry.ts';
import { clearLineOfSight, avoidMovingOre, nextEnemyState, type EnemyState } from './enemyAI.ts';
import { cellOf, cellCenter, structureAt, outpostFor, connectedIds, outpostCenter, outpostRadius, structureOnSegment, maxHealth, wear, NEIGHBOURS, outpostStats, emptyStore, storedTotal, turretOf, dronesOf, shielded, outpostValue, turretDps, droneTripsBeforeService, type Outpost, type Structure, type Drone } from './outposts.ts';
import { ensureAsteroidGeometry,asteroidLocal,asteroidWorld, miningImpact, mineMaterial, type Asteroid } from './mining.ts';
export type { Asteroid } from './mining.ts';
import type { EffectEvent } from './effectEvents.ts';
import { collideAsteroid, collide, type Body } from './collisions.ts';
import { WORLD, SHIP, WEAPONS, ENEMIES, ENEMY_AI, ENEMY_SPAWN, HORDE, OUTPOST, STRUCTURES, STRUCTURE_SPECIAL, DRONES, type StructureKind, DANGER, BOSS, HEARING, type EnemyDefinition, type EnemyWeapon, COLLISION, ORE_COMBAT, PATROL, MODULE_DURABILITY, REPAIR, MODULES, BUILD_GRID, BASES, BASE_RADIUS, EXPLORATION, RESOURCES, type EnemyKind, CORE, ROCKET, WEAPON_TYPES, SHIP_SYSTEMS, VFX, type WeaponKind, equipment, upgradeCost, type EquipmentStats, type EquipmentKind, type ModuleKind, type Resource } from './data.ts';
export type ShipModule = { x: number; y: number; kind: ModuleKind; level: number; cooldown: number; integrity: number; ability?:AbilityState; targetIds?: number[]; boostRemaining?:number; boostCooldown?:number };
export type Point = { x: number; y: number };
export type Input = { x: number; y: number; aim: Point; fire: boolean; mine: boolean; dock: boolean; boost?:boolean; overclock?:boolean; view?: { x: number; y: number; width: number; height: number } };
export type Enemy = Point & { /** Outpost raid target and party membership. */ raid?:number;raidParty?:boolean; armor?:number;accuracyScale?:number;maxHealth?:number;damageScale?:number;rewardScale?:number;meltdown?:number; meltdownDone?:boolean; faction?: import("./data.ts").FactionKind; cargo?: Partial<Record<Resource,number>>; industryClock?:number; horde?: boolean; populationExempt?: boolean; mount?: Point; phase2?: boolean; phase3?: boolean; cooldown3?: number; surge?: number; surgeTimer?: number; empTimer?: number; empCharge?: number; state?: EnemyState; lastSeen?: Point; memory?: number; clock?: number; retreat?: number; retreated?: boolean; reposition?: number; sidestep?: number; stuck?: number; px?: number; py?: number; shield?: number; shieldDelay?: number; cooldown2?: number; charge?: { t: number; angle: number; weapon: number }; sx?: number; sy?: number; parent?: number; home?: Point; populationRegion?:string;populationClass?:'normal'|'elite';populationPatrol?:Point & {id:number;angle:number};rewarded?:boolean; disabledFor?: number; vx?: number; vy?: number; impactCooldown?: number; kind?: EnemyKind; squad?: number; slot?: number; patrolAngle?: number; id: number; health: number; cooldown: number; angle: number };
export type Drop = Point & {vx?:number;vy?:number; id: number; ore: Resource; amount: number };
export type Bullet = Point & { id: number; vx: number; vy: number; life: number; enemy: boolean; damage?: number; homing?: number; rocket?: boolean; splash?: number; weapon?: WeaponKind; level?: number; attackerId?:number; penetrating?:number; hitIds?:number[]; enhanced?:boolean; guided?:boolean; fragment?:boolean; age?:number; /** Fired by an outpost turret: survives off screen like hostile fire. */ turret?:boolean };
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
export class GameModel {
  player = { x: WORLD.stationX, y: WORLD.stationY + 130, vx: 0, vy: 0, health: SHIP.health, angle: -Math.PI / 2 };
  modules: ShipModule[] = [{ x: 1, y: 0, kind: 'cannon', level: 1, cooldown: 0, integrity: 45 }, { x: 0, y: -1, kind: 'miner', level: 1, cooldown: 0, integrity: 40 }];
  squads: (Point & { id: number; angle: number })[] = [];
  bases = BASES.map((base, i) => ({ ...base, unlocked: i === 0 }));
  explored = new Set<string>();
  detachedModules: (Point & { vx: number; vy: number; kind: ModuleKind; level: number; angle: number; life: number })[] = [];
  systemsDisabled=0;
  empImmunity=0;
  energy = 100;
  heat = 0;
  powerLimited = false;
  heatLimited = false;
  private enemyBulletPool:Bullet[]=[];
  private cargoOverride:number|undefined;
  get cargoCapacity(){return this.cargoOverride??(SHIP_SYSTEMS.cargoCapacity+this.bonus('cargo'));}
  set cargoCapacity(value:number){this.cargoOverride=value;}
  private statsCache?: {source:ShipModule[];count:number;core:number;values:EquipmentStats;mass:number;power:number;heat:number;weapons:number};
  private engineRatio = 1;
  empPulses: (Point & { radius:number; maxRadius:number; damage:number; stun:number; hits:number[];cascade?:boolean;secondary?:number })[] = [];
  effects: EffectEvent[] = [];
  shield = 0;
  private shieldDelay = 0;
  coreLevel = 1;
  coreAbility=freshAbility();
  novaFields:(Point & {radius:number;life:number;damage:number})[]=[];
  enemyHazards:(Point & {radius:number;active:boolean;progress:number})[]=[];
  enemyBeams:{start:Point;end:Point;life:number}[]=[];
  blasts: (Point & { radius: number; life: number })[] = [];
  cargo: Record<Resource, number> = { iron: 0, copper: 0, crystal: 0, ice: 0, radioactive: 0 };
  stored: Record<Resource, number> = { iron: 0, copper: 0, crystal: 0, ice: 0, radioactive: 0 };
  asteroids: Asteroid[] = []; enemies: Enemy[] = []; drops: Drop[] = []; bullets: Bullet[] = [];
  miningLinks: { from: Point; to: Point; targetId: number; level: number; moduleX?:number; moduleY?:number }[] = [];
  tractorLinks: { from: Point; to: Point; level: number; targetId: number; moduleX:number; moduleY:number }[] = [];
  miningPoint: Point | undefined;
  minedTarget: Asteroid | undefined; oreHits = 0; enemyHits = 0; kills = 0; deaths = 0; message = 'Welcome, pilot. Mine nearby asteroids and unload at the station.';
  /** Bosses currently on their return cooldown (main's population ledger decides when they come back). */
  get defeatedBosses(): EnemyKind[] { return (this.sites ??= bossSites(this.world.spec)).filter(site => !this.population.bossReady(site.kind, this.world.time)).map(site => site.kind); }
  /** Player-built outposts; saved with the world. */
  outposts: Outpost[] = [];
  /** The best intact Build module on the ship, or undefined when construction is unavailable. */
  get builder() {
    const module = this.modules.filter(m => m.kind === 'builder' && m.integrity > 0).sort((a, b) => b.level - a.level)[0];
    if (!module) return undefined;
    const stats = MODULES.builder.levels[module.level - 1];
    return { level: module.level, range: stats.buildRange ?? 0, speed: stats.buildSpeed ?? 1, discount: stats.buildDiscount ?? 0 };
  }
  /** Why Build Mode is unavailable right now, if it is. */
  get buildModeError(): string | undefined {
    if (this.dead) return 'Ship destroyed.';
    if (!this.builder) return this.modules.some(m => m.kind === 'builder') ? 'The Build module is disabled. Repair it at a station.' : `Install a Build module (Core level ${OUTPOST.coreLevel}) to construct outposts.`;
    if (this.energy < OUTPOST.energyPerBlock) return 'Not enough energy to run the Build module.';
  }
  /** Carried-cargo price of a block after the Build module's discount. */
  structureCost(kind: StructureKind): Record<Resource, number> {
    const discount = 1 - (this.builder?.discount ?? 0) / 100, base = STRUCTURES[kind].cost;
    return Object.fromEntries((Object.keys(base) as Resource[]).map(ore => [ore, Math.ceil(base[ore] * discount)])) as Record<Resource, number>;
  }
  /** Why a block cannot be placed in this construction-grid cell; undefined when it can. */
  placeError(kind: StructureKind, cx: number, cy: number): string | undefined {
    const unavailable = this.buildModeError; if (unavailable) return unavailable;
    if (!Number.isSafeInteger(cx) || !Number.isSafeInteger(cy)) return 'Outside the construction grid.';
    const x = cellCenter(cx), y = cellCenter(cy), point = { x, y }, half = OUTPOST.cell / 2;
    if (x < 200 || y < 200 || x > WORLD.width - 200 || y > WORLD.height - 200) return 'Too close to the edge of the sector.';
    if (dist(point, this.player) > this.builder!.range) return 'Out of construction range. Move closer.';
    if (structureAt(this.outposts, cx, cy)) return 'That cell is already built on.';
    if (this.bases.some(base => dist(base, point) < OUTPOST.baseClearance)) return 'Too close to a station.';
    if (this.asteroids.some(a => dist(a, point) < a.radius + half)) return 'An asteroid is in the way.';
    if (dist(point, this.player) < SHIP.radius + half || this.modules.some(m => dist(this.modulePoint(m), point) < 8 + half)) return 'Your ship is in the way.';
    if (this.enemies.some(e => e.health > 0 && dist(e, point) < ENEMIES[e.kind ?? 'raider'].radius + half)) return 'A ship is in the way.';
    if (kind === 'outpostCore') {
      if (this.outposts.some(outpost => dist(outpostCenter(outpost), point) < OUTPOST.coreSpacing)) return 'Too close to another outpost core.';
    } else if (!outpostFor(this.outposts, cx, cy)) {
      return this.outposts.length ? 'Blocks must touch an existing outpost block, inside that outpost\'s construction area.' : 'Place an Outpost Core first.';
    }
    const price = this.structureCost(kind), missing = (Object.keys(price) as Resource[]).filter(ore => this.cargo[ore] < price[ore]);
    if (missing.length) return `Not enough carried ${missing.join(' and ')}.`;
  }
  /** Builds a block from carried cargo. Returns false and sets `message` when it cannot. */
  placeStructure(kind: StructureKind, cx: number, cy: number, rot = 0): boolean {
    const error = this.placeError(kind, cx, cy);
    if (error) { this.message = error; return false; }
    const price = this.structureCost(kind);
    for (const ore of Object.keys(price) as Resource[]) this.cargo[ore] -= price[ore];
    this.energy -= OUTPOST.energyPerBlock;
    const structure: Structure = { id: this.id++, kind, cx, cy, rot: ((rot % 4) + 4) % 4, level: 1, health: STRUCTURES[kind].health, progress: 0 };
    let outpost = kind === 'outpostCore' ? undefined : outpostFor(this.outposts, cx, cy);
    if (!outpost) { outpost = { id: this.id++, name: `Outpost ${this.outposts.length + 1}`, cx, cy, structures: [], revision: 0, energy: 0, stored: emptyStore() }; this.outposts.push(outpost); }
    if (STRUCTURES[kind].turret) structure.angle = structure.rot * Math.PI / 2;
    outpost.structures.push(structure); outpost.revision++;
    this.message = kind === 'outpostCore' ? `${outpost.name} founded. Build outward from the core.` : `${STRUCTURES[kind].label} under construction.`;
    this.cue('build', { x: cellCenter(cx), y: cellCenter(cy) });
    return true;
  }
  /** Applies damage to a block. Destroyed blocks are removed, along with anything they were holding to the core. */
  damageStructure(outpost: Outpost, structure: Structure, amount: number, attackerId?: number, direct = false) {
    if (amount <= 0 || structure.health <= 0) return;
    if (!direct) {
      // Level-5 plating shrugs off part of every hit; a shield generator's pool absorbs the rest first.
      if (structure.level >= OUTPOST.maxLevel && (structure.kind === 'wall' || structure.kind === 'reinforcedWall')) amount *= 1 - (structure.kind === 'wall' ? STRUCTURE_SPECIAL.wallReduction : STRUCTURE_SPECIAL.reinforcedReduction);
      const absorbed = Math.min(outpost.shield ?? 0, amount);
      if (absorbed > 0 && shielded(outpost, structure)) {
        outpost.shield = (outpost.shield ?? 0) - absorbed; outpost.shieldDelay = OUTPOST.shieldDelay; amount -= absorbed;
        this.effect({ type: 'shield', x: cellCenter(structure.cx), y: cellCenter(structure.cy), radius: 14, color: 0x79dfff });
        const attacker = outpostStats(outpost).reflect && attackerId !== undefined ? this.enemies.find(e => e.id === attackerId && e.health > 0) : undefined;
        if (attacker) this.hitEnemy(attacker, absorbed * STRUCTURE_SPECIAL.reflect);
        if (amount <= 0) return;
      }
    }
    const before = wear(structure); structure.health -= amount;
    if (structure.health > 0) { if (wear(structure) !== before) outpost.revision++; return; }
    const lost = structure.kind === 'outpostCore' ? [...outpost.structures] : [structure];
    outpost.structures = outpost.structures.filter(s => !lost.includes(s)); outpost.revision++;
    if (structure.kind !== 'outpostCore') { const held = connectedIds(outpost); lost.push(...outpost.structures.filter(s => !held.has(s.id))); outpost.structures = outpost.structures.filter(s => held.has(s.id)); }
    for (const s of lost) this.addBlast({ x: cellCenter(s.cx), y: cellCenter(s.cy), radius: 18, life: 0.2 });
    this.dropOrphanDrones(outpost); this.spillOutpostOverflow(outpost);
    if (!outpost.structures.length) { this.outposts = this.outposts.filter(o => o !== outpost); this.message = `${outpost.name} has been destroyed.`; }
    this.cue('moduleLost', { x: cellCenter(structure.cx), y: cellCenter(structure.cy) });
  }
  /** Stored minerals that no longer fit (storage lost or outpost destroyed) spill out as pickups; nothing is deleted. */
  private spillOutpostOverflow(outpost: Outpost) {
    const stored = outpost.stored ??= emptyStore(), capacity = outpost.structures.length ? outpostStats(outpost).storageCapacity : 0;
    let excess = storedTotal(outpost) - capacity; if (excess <= 0) return;
    const centre = outpostCenter(outpost);
    (Object.keys(stored) as Resource[]).sort((a, b) => stored[b] - stored[a]).forEach((ore, i) => {
      const amount = Math.min(stored[ore], excess); if (amount <= 0) return;
      stored[ore] -= amount; excess -= amount; this.drops.push({ id: this.id++, x: centre.x + (i - 2) * 20, y: centre.y + 34, ore, amount });
    });
  }
  /** The closest outpost whose core is within `range` of the ship. */
  outpostNear(range: number = OUTPOST.panelRange) {
    return this.outposts.map(outpost => ({ outpost, distance: dist(outpostCenter(outpost), this.player) })).filter(o => o.distance <= range).sort((a, b) => a.distance - b.distance)[0]?.outpost;
  }
  /** Why cargo cannot be moved to or from this outpost right now; undefined when it can. */
  transferError(outpost: Outpost): string | undefined {
    if (this.dead) return 'Ship destroyed.';
    if (!this.outposts.includes(outpost)) return 'That outpost no longer exists.';
    if (!outpost.structures.some(s => s.kind === 'outpostCore' && s.progress >= 1)) return 'The Outpost Core is still under construction.';
    if (dist(outpostCenter(outpost), this.player) > OUTPOST.transferRange && this.dockAt() !== outpost) return `Move within ${OUTPOST.transferRange} m of the Outpost Core, or to a Docking station, to transfer cargo.`;
  }
  /** Moves carried cargo into outpost storage until it is full. Returns the amount moved. */
  depositToOutpost(outpost: Outpost) {
    const error = this.transferError(outpost); if (error) { this.message = error; return 0; }
    const stored = outpost.stored ??= emptyStore(); let room = outpostStats(outpost).storageCapacity - storedTotal(outpost), moved = 0;
    for (const ore of Object.keys(this.cargo) as Resource[]) { const amount = Math.max(0, Math.min(this.cargo[ore], room)); this.cargo[ore] -= amount; stored[ore] += amount; room -= amount; moved += amount; }
    this.message = moved ? `Stored ${moved} minerals at ${outpost.name}.` : room <= 0 ? `${outpost.name} storage is full.` : 'No cargo to store.';
    return moved;
  }
  /** Moves stored minerals into the ship until its hold is full. Returns the amount moved. */
  withdrawFromOutpost(outpost: Outpost) {
    const error = this.transferError(outpost); if (error) { this.message = error; return 0; }
    const stored = outpost.stored ??= emptyStore(); let room = this.cargoCapacity - this.cargoUsed, moved = 0;
    for (const ore of Object.keys(stored) as Resource[]) { const amount = Math.max(0, Math.min(stored[ore], room)); stored[ore] -= amount; this.cargo[ore] += amount; room -= amount; moved += amount; }
    this.message = moved ? `Loaded ${moved} minerals from ${outpost.name}.` : room <= 0 ? 'Cargo hold is full.' : `${outpost.name} storage is empty.`;
    return moved;
  }
  /** Minerals available for outpost work: carried cargo plus that outpost's storage. */
  private outpostFunds(outpost: Outpost, price: Record<Resource, number>) { const stored = outpost.stored ??= emptyStore(); return (Object.keys(price) as Resource[]).filter(ore => this.cargo[ore] + stored[ore] < price[ore]); }
  private payOutpost(outpost: Outpost, price: Record<Resource, number>) { const stored = outpost.stored ??= emptyStore(); for (const ore of Object.keys(price) as Resource[]) { const carried = Math.min(this.cargo[ore], price[ore]); this.cargo[ore] -= carried; stored[ore] -= price[ore] - carried; } }
  /** Price of taking a block from `level` to the next: its build cost times the current level, less any discounts. */
  structureUpgradeCost(outpost: Outpost, s: Structure): Record<Resource, number> {
    const base = STRUCTURES[s.kind].cost, discount = (1 - (this.builder?.discount ?? 0) / 100) * (outpostStats(outpost).fabrication ? 1 - STRUCTURE_SPECIAL.fabrication : 1);
    return Object.fromEntries((Object.keys(base) as Resource[]).map(ore => [ore, Math.ceil(base[ore] * s.level * discount)])) as Record<Resource, number>;
  }
  private outpostWorkError(s: Structure): string | undefined {
    const unavailable = this.buildModeError; if (unavailable) return unavailable;
    if (dist({ x: cellCenter(s.cx), y: cellCenter(s.cy) }, this.player) > this.builder!.range) return 'Out of construction range. Move closer.';
  }
  upgradeStructureError(outpost: Outpost, s: Structure): string | undefined {
    if (s.progress < 1) return 'Still under construction.';
    if (s.level >= OUTPOST.maxLevel) return 'Maximum level.';
    const work = this.outpostWorkError(s); if (work) return work;
    if (s.level >= OUTPOST.stationLevel && !outpostStats(outpost).upgrades) return `Build an Upgrade station to go beyond level ${OUTPOST.stationLevel}.`;
    const missing = this.outpostFunds(outpost, this.structureUpgradeCost(outpost, s));
    if (missing.length) return `Not enough ${missing.join(' and ')} (carried plus outpost storage).`;
  }
  /** Raises a block one level, paying from carried cargo first and outpost storage second. */
  upgradeStructure(outpost: Outpost, s: Structure): boolean {
    const error = this.upgradeStructureError(outpost, s); if (error) { this.message = error; return false; }
    this.payOutpost(outpost, this.structureUpgradeCost(outpost, s));
    const before = maxHealth(s); s.level++; s.health += maxHealth(s) - before; outpost.revision++;
    this.message = `${STRUCTURES[s.kind].label} upgraded to level ${s.level}.`; this.cue('build', { x: cellCenter(s.cx), y: cellCenter(s.cy) });
    this.spillOutpostOverflow(outpost);
    return true;
  }
  structureRepairCost(s: Structure): Record<Resource, number> { return { iron: Math.ceil(Math.max(0, maxHealth(s) - s.health) * OUTPOST.repairIronPerHp), copper: 0, crystal: 0, ice: 0, radioactive: 0 }; }
  repairStructureError(outpost: Outpost, s: Structure): string | undefined {
    if (s.progress < 1) return 'Still under construction.';
    if (s.health >= maxHealth(s)) return 'No damage to repair.';
    const work = this.outpostWorkError(s); if (work) return work;
    if (this.outpostFunds(outpost, this.structureRepairCost(s)).length) return 'Not enough iron (carried plus outpost storage).';
  }
  /** Fully repairs one block for iron; never free. */
  repairStructure(outpost: Outpost, s: Structure): boolean {
    const error = this.repairStructureError(outpost, s); if (error) { this.message = error; return false; }
    this.payOutpost(outpost, this.structureRepairCost(s)); s.health = maxHealth(s); outpost.revision++;
    this.message = `${STRUCTURES[s.kind].label} repaired.`; this.cue('build', { x: cellCenter(s.cx), y: cellCenter(s.cy) });
    return true;
  }
  /** The outpost whose finished Docking station the ship is close enough to use, if any. */
  dockAt(): Outpost | undefined {
    for (const outpost of this.outposts) for (const s of outpost.structures) {
      const range = STRUCTURES[s.kind].dock;
      if (range && s.progress >= 1 && dist({ x: cellCenter(s.cx), y: cellCenter(s.cy) }, this.player) <= range) return outpost;
    }
    return undefined;
  }
  /** Docking (E) at an outpost: unload cargo into its storage, then repair from carried and outpost minerals if they cover the cost. */
  dockAtOutpost(outpost: Outpost) {
    const moved = this.depositToOutpost(outpost), stored = outpost.stored ??= emptyStore(), cut = outpostStats(outpost).rapidService ? 1 - STRUCTURE_SPECIAL.rapidService : 1, full = this.repairCost;
    const price = Object.fromEntries((Object.keys(full) as Resource[]).map(ore => [ore, Math.ceil(full[ore] * cut)])) as Record<Resource, number>, ores = Object.keys(price) as Resource[];
    const needed = ores.some(ore => price[ore] > 0);
    if (!needed) { this.message = moved ? `Docked at ${outpost.name}: stored ${moved} minerals. No repairs needed.` : `Docked at ${outpost.name}. Nothing to unload or repair.`; return; }
    if (ores.some(ore => this.cargo[ore] + stored[ore] < price[ore])) { this.message = `Docked at ${outpost.name}: stored ${moved} minerals. Not enough minerals here for repairs.`; return; }
    for (const ore of ores) { const carried = Math.min(this.cargo[ore], price[ore]); this.cargo[ore] -= carried; stored[ore] -= price[ore] - carried; }
    this.player.health = this.maxHealth; this.shield = this.maxShield;
    for (const m of this.modules) m.integrity = this.moduleMaxIntegrity(m);
    this.message = `Docked at ${outpost.name}: stored ${moved} minerals and repaired the ship from outpost stores.`;
  }
  /** Drones whose hangar is gone are lost; whatever they carried is released as pickups. */
  private dropOrphanDrones(outpost: Outpost) {
    const drones = outpost.drones; if (!drones?.length) return;
    const hangars = new Set(outpost.structures.filter(s => STRUCTURES[s.kind].drones).map(s => s.id));
    for (const d of drones) if (!hangars.has(d.hangar) && d.load > 0 && d.ore) this.releaseOre(d, d.ore, d.load);
    outpost.drones = drones.filter(d => hangars.has(d.hangar));
  }
  private updateDrones(outpost: Outpost, dt: number) {
    const drones = outpost.drones ??= [], stored = outpost.stored ??= emptyStore(), stats = outpostStats(outpost), capacity = stats.storageCapacity;
    const hangars = outpost.structures.filter(s => STRUCTURES[s.kind].drones && s.progress >= 1);
    for (const h of hangars) for (let have = drones.filter(d => d.hangar === h.id).length; have < dronesOf(h); have++) drones.push({ id: this.id++, hangar: h.id, x: cellCenter(h.cx), y: cellCenter(h.cy), angle: 0, state: 'idle', load: 0, timer: have * 0.7, trips: 0 });
    for (const d of drones) {
      const hangar = hangars.find(h => h.id === d.hangar); if (!hangar) continue;
      const home = { x: cellCenter(hangar.cx), y: cellCenter(hangar.cy) }, swarm = hangar.level >= OUTPOST.maxLevel;
      d.timer = Math.max(0, d.timer - dt); d.beam = undefined;
      const fly = (to: Point, stop: number) => {
        const gap = dist(d, to); if (gap <= stop + 0.5) return true;
        const step = Math.min(gap - stop, DRONES.speed * dt); d.angle = Math.atan2(to.y - d.y, to.x - d.x); d.x += (to.x - d.x) / gap * step; d.y += (to.y - d.y) / gap * step;
        return gap - step <= stop + 0.5;
      };
      if (d.state === 'idle') {
        d.x = home.x; d.y = home.y;
        if (d.timer > 0 || storedTotal(outpost) >= capacity) continue;
        if ((outpost.energy ?? 0) < DRONES.launchEnergy) { outpost.shortage = true; continue; }
        // Nearest rock with ore that is not already crowded. The level-5 swarm spreads out and goes for the most valuable ore first.
        let target: Asteroid | undefined, best = -Infinity;
        for (const a of this.asteroids) {
          if (a.amount <= 0) continue; const gap = dist(a, home); if (gap > DRONES.range) continue;
          const working = drones.filter(o => o !== d && o.target === a.id).length; if (working >= DRONES.perAsteroid) continue;
          const score = swarm ? DANGER.ore[a.ore] * 10000 - working * 5000 - gap : -gap;
          if (score > best) { best = score; target = a; }
        }
        if (!target) { d.timer = DRONES.retry; continue; }
        outpost.energy = (outpost.energy ?? 0) - DRONES.launchEnergy; d.target = target.id; d.state = 'outbound'; this.cue('drone', home, 8);
      } else if (d.state === 'outbound' || d.state === 'mining') {
        const rock = this.asteroids.find(a => a.id === d.target && a.amount > 0);
        // Rock gone, drifted out of reach, or a different ore than the load already aboard: head home.
        if (!rock || dist(rock, home) > DRONES.range * DRONES.leash || (d.load > 0 && d.ore !== rock.ore)) { d.target = undefined; d.state = 'returning'; continue; }
        const arrived = fly(rock, rock.radius + DRONES.standoff);
        if (d.state === 'outbound') { if (arrived) d.state = 'mining'; continue; }
        if (!arrived) continue;
        // The same finite extraction the ship uses: only what leaves the rock goes into the drone.
        const impact = miningImpact(rock, d, rock), removed = mineMaterial(rock, DRONES.rate * dt, impact);
        d.beam = impact; d.angle = Math.atan2(rock.y - d.y, rock.x - d.x);
        if (removed > 0) { d.ore = rock.ore; d.load += removed; this.emitDebris(impact, { x: impact.x - rock.x, y: impact.y - rock.y }, RESOURCES[rock.ore].color, rock.id + rock.amount); }
        if (rock.amount <= 0) this.destroyAsteroid(rock.id);
        if (d.load >= DRONES.capacity || rock.amount <= 0) { d.target = undefined; d.state = 'returning'; }
      } else if (fly(home, 2)) {
        // Unload what fits; a full outpost leaves the drone waiting at its hangar with the rest.
        const amount = d.ore ? Math.max(0, Math.min(d.load, capacity - storedTotal(outpost))) : 0;
        if (d.ore && amount > 0) { stored[d.ore] += amount; d.load -= amount; }
        if (d.load > 0) continue;
        // Every few trips the drone is serviced; a repair bay makes that quick.
        d.trips = (d.trips ?? 0) + 1; const service = d.trips >= droneTripsBeforeService(stats);
        if (service) d.trips = 0;
        d.ore = undefined; d.state = 'idle'; d.timer = service ? (stats.droneService ? DRONES.bayServiceTime : DRONES.serviceTime) : DRONES.recharge;
      }
    }
  }
  /** An enemy with no fight on its hands attacks an outpost it was sent to raid, or one it has wandered within sight of. Returns true if it did. */
  private raidOutpost(e: Enemy, def: EnemyDefinition, dt: number): boolean {
    if (def.part || def.boss || !def.weapons.length) return false;
    let outpost = e.raid === undefined ? undefined : this.outposts.find(o => o.id === e.raid);
    if (!outpost && e.raidParty) { e.raid = undefined; e.raidParty = false; }
    if (!outpost) outpost = this.outposts.find(o => dist(outpostCenter(o), e) < def.detection + outpostRadius(o) && dist(outpostCenter(o), this.player) < OUTPOST.activeRange);
    if (!outpost) return false;
    e.raid = outpost.id; const centre = outpostCenter(outpost);
    // Badly hurt raiders break off and leave.
    if (e.raidParty && e.health < def.health * OUTPOST.raid.retreatAt) {
      const away = Math.atan2(e.y - centre.y, e.x - centre.x); e.angle = away; e.x = clamp(e.x + Math.cos(away) * def.speed * dt, 30, WORLD.width - 30); e.y = clamp(e.y + Math.sin(away) * def.speed * dt, 30, WORLD.height - 30);
      if (dist(e, centre) > OUTPOST.raid.giveUp) { e.rewarded = true; e.health = 0; }
      return true;
    }
    // Turrets and power first, then whatever is closest.
    let target: Structure | undefined, best = Infinity;
    for (const s of outpost.structures) { const d = dist({ x: cellCenter(s.cx), y: cellCenter(s.cy) }, e) - (STRUCTURES[s.kind].turret || STRUCTURES[s.kind].generation ? 400 : 0); if (d < best) { best = d; target = s; } }
    if (!target) return false;
    const point = { x: cellCenter(target.cx), y: cellCenter(target.cy) }, gap = dist(e, point), aim = Math.atan2(point.y - e.y, point.x - e.x), hold = Math.min(def.stop, def.range * 0.8);
    if (gap > hold) { const travel = avoidMovingOre(e, aim, this.asteroids, def.radius); e.x = clamp(e.x + Math.cos(travel) * def.speed * 0.8 * dt, 30, WORLD.width - 30); e.y = clamp(e.y + Math.sin(travel) * def.speed * 0.8 * dt, 30, WORLD.height - 30); }
    e.angle = aim; e.state = 'attack';
    if (gap < def.range) def.weapons.forEach((weapon, i) => {
      if ((i === 0 ? e.cooldown : e.cooldown2 ?? 0) > 0) return;
      if (i === 0) e.cooldown = weapon.cooldown + (weapon.charge ?? 0); else e.cooldown2 = weapon.cooldown + (weapon.charge ?? 0);
      this.enemyShot(e, { ...weapon, homing: undefined }, aim);
    });
    return true;
  }
  private updateTurrets(outpost: Outpost, dt: number) {
    const stats = outpostStats(outpost), special = STRUCTURE_SPECIAL, boost = (outpost.command ?? 0) > 0 ? 1 + special.command.bonus : 1;
    let engaged = false;
    for (const s of outpost.structures) {
      const turret = s.progress >= 1 ? turretOf(s) : undefined; if (!turret) continue;
      const x = cellCenter(s.cx), y = cellCenter(s.cy), range = turret.range * (1 + stats.radar), top = s.level >= OUTPOST.maxLevel;
      s.cooldown = Math.max(0, (s.cooldown ?? 0) - dt); s.scan = (s.scan ?? 0) - dt; s.angle ??= s.rot * Math.PI / 2;
      s.quiet = (s.quiet ?? 0) + dt; if (s.quiet > special.gatling.cool) s.ramp = 0;
      let target = s.target === undefined ? undefined : this.enemies.find(e => e.id === s.target && e.health > 0 && dist(e, { x, y }) <= range);
      if (!target && s.scan <= 0) {
        // Look for the nearest hostile in range a few times a second rather than every frame.
        s.scan = OUTPOST.turretScan; let best = range;
        for (const e of this.enemies) { if (e.health <= 0 || ENEMIES[e.kind ?? 'raider'].weakPoint) continue; const d = dist(e, { x, y }); if (d <= best) { best = d; target = e; } }
      }
      s.target = target?.id;
      if (!target) continue;
      engaged = true;
      const wanted = Math.atan2(target.y - y, target.x - x), turn = Math.atan2(Math.sin(wanted - s.angle), Math.cos(wanted - s.angle));
      s.angle += clamp(turn, -turret.turn * dt, turret.turn * dt);
      if (Math.abs(turn) > OUTPOST.turretAim || s.cooldown > 0 || outpost.overheated) continue;
      if ((outpost.energy ?? 0) < turret.energy) { outpost.shortage = true; continue; }
      outpost.energy = (outpost.energy ?? 0) - turret.energy; outpost.heat = (outpost.heat ?? 0) + (turret.heat ?? 0);
      // Level-5 autocannons spin up while they keep firing.
      if (top && s.kind === 'autocannonTurret') s.ramp = Math.min(1, (s.ramp ?? 0) + turret.cooldown / special.gatling.ramp);
      s.quiet = 0; s.shots = (s.shots ?? 0) + 1;
      s.cooldown = turret.cooldown / boost / (1 + (s.ramp ?? 0) * special.gatling.maxBonus);
      const muzzle = OUTPOST.cell * 0.7, shot = (angle: number, damage: number, splash?: number): Bullet => ({ id: this.id++, x: x + Math.cos(angle) * muzzle, y: y + Math.sin(angle) * muzzle, vx: Math.cos(angle) * turret.speed, vy: Math.sin(angle) * turret.speed, life: turret.lifetime, enemy: false, damage, weapon: turret.weapon, turret: true, splash });
      const bullet = shot(s.angle, turret.damage, turret.splash);
      if (turret.weapon === 'rocket') bullet.rocket = true;
      if (turret.guided) { bullet.guided = true; bullet.age = 0; }
      // Level-5 railguns: every Nth round punches through several hulls (the ship's Hypervelocity handling).
      if (top && s.kind === 'railgunTurret' && s.shots % special.railEvery === 0) { bullet.enhanced = true; bullet.penetrating = SPECIAL.rail.targets; bullet.hitIds = []; }
      this.bullets.push(bullet);
      // Level-5 missile turrets add a fan of guided mini-missiles.
      if (top && s.kind === 'missileTurret') for (let i = 0; i < special.swarm.count; i++) { const mini = shot(s.angle + (i - (special.swarm.count - 1) / 2) * 0.5, turret.damage * special.swarm.fraction, (turret.splash ?? 60) * 0.5); mini.rocket = true; mini.guided = true; mini.age = 0; this.bullets.push(mini); }
      this.effect({ type: 'muzzle', x: bullet.x, y: bullet.y, angle: s.angle, weapon: turret.weapon, silent: true }); this.cue(turret.weapon === 'cannon' ? 'fire' : turret.weapon, { x, y });
    }
    // Level-5 core: the first shots of an engagement trigger a short outpost-wide rate boost.
    if (engaged && stats.command && (outpost.command ?? 0) <= 0 && (outpost.commandCooldown ?? 0) <= 0) { outpost.command = special.command.duration; outpost.commandCooldown = special.command.cooldown; }
  }
  /** Repair stations mend the most damaged block in their radius, paying stored iron and battery energy. */
  private updateRepairStations(outpost: Outpost, dt: number) {
    const stored = outpost.stored ??= emptyStore(), special = STRUCTURE_SPECIAL.reconstruction;
    for (const station of outpost.structures) {
      const def = STRUCTURES[station.kind]; if (!def.repair || station.progress < 1) continue;
      let worst: Structure | undefined, low = 1;
      for (const s of outpost.structures) { if (s.progress < 1 || Math.max(Math.abs(s.cx - station.cx), Math.abs(s.cy - station.cy)) > (def.repairRadius ?? 0)) continue; const f = s.health / maxHealth(s); if (f < low) { low = f; worst = s; } }
      if (!worst) continue;
      const rate = def.repair * [1, 1.4, 1.8, 2.3, 3][station.level - 1] * (station.level >= OUTPOST.maxLevel && low < special.below ? special.multiplier : 1);
      const repair = Math.min(rate * dt, maxHealth(worst) - worst.health), energy = OUTPOST.repairEnergyPerSecond * dt;
      const debt = (outpost.repairDebt ?? 0) + repair * OUTPOST.repairIronPerHp, whole = Math.floor(debt);
      if (stored.iron < Math.ceil(debt) || (outpost.energy ?? 0) < energy) { if ((outpost.energy ?? 0) < energy) outpost.shortage = true; continue; }
      stored.iron -= whole; outpost.repairDebt = debt - whole; outpost.energy = (outpost.energy ?? 0) - energy;
      const before = wear(worst); worst.health += repair; if (wear(worst) !== before) outpost.revision++;
    }
  }
  /** Raids: a countdown per outpost. Near the ship a raid party arrives (with warning if there is radar); far away it is banked and settled later. */
  private updateRaids(outpost: Outpost, dt: number, active: boolean) {
    const raid = OUTPOST.raid, centre = outpostCenter(outpost), stats = outpostStats(outpost);
    outpost.raidTimer ??= raid.interval[0] + this.random() * (raid.interval[1] - raid.interval[0]);
    if ((outpost.raidWarning ?? 0) > 0) {
      const before = Math.floor(outpost.raidWarning! / HORDE.alarmEvery); outpost.raidWarning! -= dt;
      if (active && Math.floor(outpost.raidWarning! / HORDE.alarmEvery) !== before) this.cue('hordeAlarm', centre);
      if (outpost.raidWarning! > 0) return;
      outpost.raidWarning = 0;
      if (!active) { outpost.pendingRaids = (outpost.pendingRaids ?? 0) + 1; return; }
      // Arrive from the side away from the ship so the party is not spawned on top of the player.
      const level = Math.max(1, Math.min(raid.size.length, this.dangerAt(centre))), away = Math.atan2(centre.y - this.player.y, centre.x - this.player.x) + (this.random() - 0.5) * 1.6;
      for (let i = 0; i < raid.size[level - 1]; i++) {
        const pool = i === 0 && level >= 2 ? ENEMY_SPAWN.elite[level - 1] : ENEMY_SPAWN.normal[level - 1], kind = pool[Math.floor(this.random() * pool.length)], angle = away + (i - raid.size[level - 1] / 2) * 0.18;
        this.spawnEnemy(kind, clamp(centre.x + Math.cos(angle) * raid.distance, 60, WORLD.width - 60), clamp(centre.y + Math.sin(angle) * raid.distance, 60, WORLD.height - 60), angle + Math.PI, { raid: outpost.id, raidParty: true, horde: false });
      }
      this.message = `RAID: hostiles are attacking ${outpost.name}!`; this.cue('hordeAlarm', centre);
      return;
    }
    outpost.raidTimer -= dt;
    if (outpost.raidTimer > 0) return;
    outpost.raidTimer = raid.interval[0] + this.random() * (raid.interval[1] - raid.interval[0]);
    if (outpostValue(outpost) < raid.minValue) return;
    // Radar buys warning time; without it the raid simply arrives.
    outpost.raidWarning = stats.radar > 0 ? raid.radarWarning * (stats.radarLevel >= OUTPOST.maxLevel ? STRUCTURE_SPECIAL.radarWarning : 1) : 0.01;
    if (active && stats.radar > 0) { this.message = `RADAR: raid inbound on ${outpost.name} in ${Math.ceil(outpost.raidWarning)}s.`; this.cue('hordeAlarm', centre); }
  }
  /** Settles what happened while the ship was away: banked raids, repairs, then drone mining against the real asteroids now in range. */
  private resolveAway(outpost: Outpost) {
    const elapsed = Math.min(OUTPOST.awayCap, outpost.away ?? 0), stats = outpostStats(outpost), stored = outpost.stored ??= emptyStore(), centre = outpostCenter(outpost), notes: string[] = [];
    outpost.away = 0;
    // Raids: whatever the defences could not stop over a short fight lands on turrets and reactors first.
    const raids = outpost.pendingRaids ?? 0; outpost.pendingRaids = 0;
    if (raids > 0) {
      const level = Math.max(1, Math.min(OUTPOST.raid.awayDamage.length, this.dangerAt(centre))), powered = stats.generation > 0 || stats.turrets === 0;
      const defence = (powered ? turretDps(outpost) * OUTPOST.raid.defenceSeconds : 0) + stats.shieldCapacity;
      let damage = Math.max(0, OUTPOST.raid.awayDamage[level - 1] - defence) * raids, lost = 0; const blocks = outpost.structures.length;
      const order = [...outpost.structures].sort((a, b) => Number(Boolean(STRUCTURES[b.kind].turret || STRUCTURES[b.kind].generation)) - Number(Boolean(STRUCTURES[a.kind].turret || STRUCTURES[a.kind].generation)) || Number(a.kind === 'outpostCore') - Number(b.kind === 'outpostCore'));
      for (const s of order) { if (damage <= 0 || !outpost.structures.includes(s)) continue; const hit = Math.min(damage, s.health); damage -= hit; this.damageStructure(outpost, s, hit, undefined, true); }
      lost = blocks - outpost.structures.length;
      notes.push(lost ? `${raids} raid${raids > 1 ? 's' : ''} destroyed ${lost} block${lost > 1 ? 's' : ''}` : `${raids} raid${raids > 1 ? 's' : ''} repelled`);
      if (!this.outposts.includes(outpost)) { this.message = `${outpost.name} was destroyed by a raid while you were away.`; return; }
    }
    const after = outpostStats(outpost);
    outpost.energy = after.energyCapacity; outpost.heat = 0; outpost.overheated = false; outpost.shield = after.shieldCapacity;
    // Repair stations work through the damage as far as stored iron allows.
    let budget = after.repair * elapsed, mended = 0;
    for (const s of [...outpost.structures].sort((a, b) => a.health / maxHealth(a) - b.health / maxHealth(b))) {
      if (budget <= 0 || s.progress < 1) continue;
      const repair = Math.min(budget, maxHealth(s) - s.health, Math.floor(stored.iron / OUTPOST.repairIronPerHp)); if (repair <= 0) continue;
      stored.iron -= Math.ceil(repair * OUTPOST.repairIronPerHp); s.health += repair; budget -= repair; mended += repair; outpost.revision++;
    }
    if (mended > 0) notes.push(`repaired ${Math.round(mended)} hull`);
    // Drones: their banked work is taken out of the actual rocks in range, so nothing is created.
    const hangars = outpost.structures.filter(s => s.progress >= 1 && STRUCTURES[s.kind].drones);
    let work = after.generation > 0 ? Math.floor(after.drones * DRONES.awayRate * elapsed) : 0, mined = 0;
    if (work > 0 && hangars.length) {
      const rocks = this.asteroids.filter(a => a.amount > 0 && hangars.some(h => dist(a, { x: cellCenter(h.cx), y: cellCenter(h.cy) }) <= DRONES.range)).sort((a, b) => dist(a, centre) - dist(b, centre));
      for (const rock of rocks) {
        const room = after.storageCapacity - storedTotal(outpost), take = Math.min(work, room, rock.amount); if (take <= 0) break;
        const removed = mineMaterial(rock, take, miningImpact(rock, centre, rock));
        stored[rock.ore] += removed; work -= removed; mined += removed;
        if (rock.amount <= 0) this.destroyAsteroid(rock.id);
      }
    }
    if (mined > 0) notes.push(`drones stored ${mined} ore`);
    for (const d of outpost.drones ?? []) if (d.load === 0) { d.state = 'idle'; d.target = undefined; }
    outpost.report = notes.length ? `${outpost.name} while you were away (${Math.round(elapsed / 60)} min): ${notes.join(', ')}.` : undefined;
    if (outpost.report) this.message = outpost.report;
  }
  private updateOutposts(dt: number) {
    const builder = this.builder, p = this.player;
    for (const outpost of [...this.outposts]) {
      const stats = outpostStats(outpost), distance = dist(outpostCenter(outpost), p), active = !this.dead && distance < OUTPOST.activeRange;
      outpost.stored ??= emptyStore(); outpost.shortage = false;
      const low = (outpost.energy ?? 0) < stats.energyCapacity * STRUCTURE_SPECIAL.overdriveBelow;
      outpost.energy = Math.min(stats.energyCapacity, (outpost.energy ?? 0) + (stats.generation + (low ? stats.overdrive : 0)) * dt);
      // Heat: turret fire adds it, cores and coolers remove it; an overheated outpost holds fire until it is back under 60%.
      outpost.purgeCooldown = Math.max(0, (outpost.purgeCooldown ?? 0) - dt);
      outpost.heat = Math.max(0, (outpost.heat ?? 0) - stats.cooling * dt);
      if (outpost.heat >= stats.heatCapacity && stats.heatCapacity > 0) {
        if (stats.purge && outpost.purgeCooldown <= 0) { outpost.heat *= 1 - STRUCTURE_SPECIAL.purge.fraction; outpost.purgeCooldown = STRUCTURE_SPECIAL.purge.cooldown; } else outpost.overheated = true;
      } else if (outpost.overheated && outpost.heat < stats.heatCapacity * 0.6) outpost.overheated = false;
      // Shields recharge from the battery after a quiet spell.
      outpost.shieldDelay = Math.max(0, (outpost.shieldDelay ?? 0) - dt); outpost.shield = Math.min(outpost.shield ?? 0, stats.shieldCapacity);
      if (stats.shieldCapacity > 0 && outpost.shieldDelay <= 0 && outpost.shield < stats.shieldCapacity) {
        const gain = Math.min(stats.shieldRegen * dt, stats.shieldCapacity - outpost.shield), cost = gain * OUTPOST.shieldEnergyPerPoint;
        if (outpost.energy >= cost) { outpost.energy -= cost; outpost.shield += gain; } else outpost.shortage = true;
      }
      outpost.command = Math.max(0, (outpost.command ?? 0) - dt); outpost.commandCooldown = Math.max(0, (outpost.commandCooldown ?? 0) - dt);
      this.updateRaids(outpost, dt, active);
      // Turrets, drones and repairs are simulated only for outposts near the ship; time away is banked instead.
      if (!active) { outpost.away = Math.min(OUTPOST.awayCap, (outpost.away ?? 0) + dt); continue; }
      if ((outpost.away ?? 0) >= OUTPOST.awayMin) {
        // Settle only once the ship is close and the streamed asteroid field around the outpost has had time to load.
        outpost.settle = distance < OUTPOST.resolveRange ? (outpost.settle ?? 0) + dt : 0;
        if (distance < OUTPOST.resolveRange && (!this.streaming || outpost.settle >= OUTPOST.resolveDelay)) { outpost.settle = 0; this.resolveAway(outpost); if (!this.outposts.includes(outpost)) continue; }
        else continue;
      } else outpost.away = 0;
      if (stats.turrets) this.updateTurrets(outpost, dt);
      if (outpost.drones?.length || stats.drones) this.updateDrones(outpost, dt);
      if (stats.repair) this.updateRepairStations(outpost, dt);
    }
    for (const outpost of this.outposts) {
      const near = builder !== undefined && dist(outpostCenter(outpost), p) < builder.range * OUTPOST.awayRange + outpostRadius(outpost);
      for (const s of outpost.structures) {
        if (s.progress >= 1) continue;
        // Construction runs at the Build module's speed while the ship is close, and slowly on its own otherwise.
        s.progress = Math.min(1, s.progress + dt * (near ? builder!.speed : OUTPOST.awaySpeed) / STRUCTURES[s.kind].buildTime);
        if (s.progress >= 1) outpost.revision++;
      }
    }
    // Level-5 Industrial Fabricator: repairs one damaged block at a time from carried iron and ship energy.
    if (!builder || builder.level < 5 || this.dead) return;
    const fab = OUTPOST.fabricator;
    for (const outpost of this.outposts) for (const s of outpost.structures) {
      if (s.progress < 1 || s.health >= maxHealth(s) || dist({ x: cellCenter(s.cx), y: cellCenter(s.cy) }, p) > builder.range) continue;
      const repair = Math.min(fab.hpPerSecond * dt, maxHealth(s) - s.health), iron = repair * fab.ironPerHp, energy = fab.energyPerSecond * dt;
      this.fabricatorDebt += iron;
      const whole = Math.floor(this.fabricatorDebt);
      if (this.cargo.iron < Math.ceil(this.fabricatorDebt) || this.energy < energy) { this.fabricatorDebt -= iron; return; }
      this.cargo.iron -= whole; this.fabricatorDebt -= whole; this.energy -= energy;
      const before = wear(s); s.health += repair; if (wear(s) !== before) outpost.revision++;
      return;
    }
  }
  private fabricatorDebt = 0;
  /** Horde event state: seconds until the next alert, remaining alert time, approach direction and the size of the horde in play. */
  horde = { timer: HORDE.interval[0][1] + HORDE.firstDelay, warning: 0, angle: 0, total: 0 };
  get hordeCount() { return this.enemies.filter(e => e.horde && e.health > 0).length; }
  private lastDanger = 4; private id = 1000000000; private impactTimer = 0; private spawnTimer:number = POPULATION.tick;
  readonly seed: string;
  readonly world: ChunkWorld;
  readonly population:EnemyPopulation;
  private rng: SeedRandom;
  private streaming: boolean;
  private random: () => number;
  constructor(seed = randomWorldSeed(), options: { streaming?: boolean; world?: WorldSnapshot;population?:EnemyPopulationSnapshot;restoring?:boolean } = {}) {
    this.seed = seed; this.world = new ChunkWorld(seed, options.world);this.population=new EnemyPopulation(this.world.spec,options.population);
    this.rng = new SeedRandom(seed + ':simulation'); this.random = this.rng.next;
    this.streaming = options.streaming ?? true;
    this.bases = this.world.spec.bases.map((base, i) => ({ ...base, unlocked: i === 0 }));
    const home = this.bases[0], angle = this.world.spec.exitAngle;
    this.player.x = home.x + Math.cos(angle) * 130; this.player.y = home.y + Math.sin(angle) * 130;
    this.player.angle = angle;
    this.asteroids = this.world.activate(this.player, [], true);
    if(!options.restoring)this.updatePopulation(undefined,false);this.revealExploration();
  }
  get chartedAsteroids() { return [...this.world.surveyed.values()]; }
  toSave(): GameSave {
    return { version: 1, seed: this.seed, population:this.population.snapshot(), world: this.world.snapshot(this.asteroids),
      systemsDisabled:this.systemsDisabled,empImmunity:this.empImmunity,player: { ...this.player }, modules: structuredClone(this.modules), coreAbility:{...this.coreAbility},novaFields:structuredClone(this.novaFields), coreLevel: this.coreLevel, shield: this.shield, energy: this.energy, heat: this.heat, empPulses: structuredClone(this.empPulses),
      cargo: { ...this.cargo }, stored: { ...this.stored }, bases: structuredClone(this.bases), explored: [...this.explored],
      enemies: structuredClone(this.enemies), squads: structuredClone(this.squads), drops: structuredClone(this.drops), bullets: structuredClone(this.bullets), detachedModules: structuredClone(this.detachedModules),
      kills: this.kills, outposts: structuredClone(this.outposts), horde: { ...this.horde }, deaths: this.deaths, id: this.id, rng: this.rng.state, spawnTimer: this.spawnTimer, shieldDelay: this.shieldDelay, impactTimer: this.impactTimer };
  }
  static fromSave(value: unknown) {
    const data = value as GameSave;
    if (!data || data.version !== 1 || typeof data.seed !== 'string' || !data.world || data.world.spec?.version !== 1 || data.world.spec.seed !== data.seed || !data.player || !Number.isFinite(data.player.x) || !Number.isFinite(data.player.y) || !Array.isArray(data.modules) || !Array.isArray(data.bases) || data.bases.length !== BASES.length || !Array.isArray(data.explored) || !Array.isArray(data.world.changes) || !Array.isArray(data.world.surveyed)) throw new Error('Unsupported or invalid save file.');
    const m = new GameModel(data.seed, { world: data.world,population:data.population,restoring:true });
    if (!Number.isInteger(data.coreLevel) || data.coreLevel<1 || data.coreLevel>CORE.levels.length || data.modules.some(block => !MODULES[block.kind] || !Number.isInteger(block.level) || block.level < 1 || block.level > MODULES[block.kind].levels.length || !Number.isFinite(block.integrity))) throw new Error('Invalid ship data in save.');
    m.coreAbility={...freshAbility(),...data.coreAbility};m.novaFields=structuredClone(data.novaFields??[]).slice(-SPECIAL.plasma.maxFields);
    m.systemsDisabled=data.systemsDisabled??0;m.empImmunity=data.empImmunity??0;
    m.player = { ...data.player }; m.modules = structuredClone(data.modules); m.coreLevel = data.coreLevel; m.shield = data.shield; m.energy = Math.max(0,Math.min(data.energy ?? m.maxEnergy,m.maxEnergy)); m.heat = data.heat ?? 0; m.empPulses = structuredClone(data.empPulses ?? []);
    const empty = () => Object.fromEntries((Object.keys(RESOURCES) as Resource[]).map(ore => [ore, 0])) as Record<Resource, number>;
    m.cargo = { ...empty(), ...data.cargo }; m.stored = { ...empty(), ...data.stored };
    if ([...Object.values(m.cargo), ...Object.values(m.stored)].some(n => !Number.isFinite(n) || n < 0)) throw new Error('Invalid resource quantities in save.');
    m.bases = structuredClone(data.bases); m.explored = new Set(data.explored);
    m.enemies = structuredClone(data.enemies ?? []); m.squads = structuredClone(data.squads ?? []); m.drops = structuredClone(data.drops ?? []); m.bullets = structuredClone(data.bullets ?? []); m.detachedModules = structuredClone(data.detachedModules ?? []);
    m.kills = data.kills; if (data.horde) m.horde = { ...m.horde, ...data.horde }; m.outposts = structuredClone(data.outposts ?? []); m.deaths = data.deaths; m.id = data.id; m.rng.state = data.rng; m.spawnTimer = data.population?data.spawnTimer:POPULATION.tick; m.shieldDelay = data.shieldDelay; m.impactTimer = data.impactTimer;
    m.asteroids = m.world.activate(m.player, [], true); const overflow=m.cargoUsed>m.cargoCapacity;m.spillCargo();m.message = overflow?'World restored. Excess cargo was preserved as nearby pickups.':`World restored. Seed: ${m.seed}`; return m;
  }
  private get aggregate(){
    const cached=this.statsCache;
    if(cached&&cached.source===this.modules&&cached.count===this.modules.length&&cached.core===this.coreLevel)return cached;
    const values:EquipmentStats={};let mass=CORE.mass,power=0,heat=0,weapons=0;
    for(const m of this.modules){
      const definition=MODULES[m.kind],stats=definition.levels[m.level-1];mass+=definition.mass;
      if(definition.weapon)weapons++;power+=(stats.power??0)/(definition.weapon?stats.cooldown!:1);heat+=(stats.heat??0)/(definition.weapon?stats.cooldown!:1);
      for(const [key,value]of Object.entries(definition.levels[m.level-1])){const stat=key as keyof EquipmentStats;values[stat]=(values[stat]??0)+value;}
    }
    return this.statsCache={source:this.modules,count:this.modules.length,core:this.coreLevel,values,mass,power,heat,weapons};
  }
  private bonus(stat:keyof EquipmentStats){return this.aggregate.values[stat]??0;}
  get shipMass(){return this.aggregate.mass;}
  get powerDemand(){return this.aggregate.power;}
  get heatGeneration(){return this.aggregate.heat;}
  get installedWeapons(){return this.aggregate.weapons;}
  get tractorCapacity(){return this.bonus('targets');}
  get boostActive(){return this.modules.some(m=>(m.boostRemaining??0)>0);}
  get boostReady(){return this.modules.filter(m=>m.kind==='engine'&&m.level>=2&&(m.boostCooldown??0)<=0).length;}
  private burst(stat:'burstSpeed'|'burstThrust'){return this.modules.reduce((sum,m)=>sum+((m.boostRemaining??0)>0?(MODULES[m.kind].levels[m.level-1][stat]??0):0),0)*this.engineRatio;}
  get maxEnergy() { return CORE.levels[this.coreLevel - 1].energyCapacity! + this.bonus('energyCapacity'); }
  get basePowerGeneration(){return CORE.levels[this.coreLevel-1].generation!+this.bonus('generation');}
  get powerGeneration() { return this.basePowerGeneration+this.modules.reduce((sum,m)=>sum+(m.kind==='reactor'&&m.level>=5&&(m.ability?.active??0)>0?MODULES.reactor.levels[m.level-1].generation!*SPECIAL.reactor.bonus:0),0); }
  get coolingRate() { return CORE.levels[this.coreLevel - 1].cooling! + this.bonus('cooling'); }
  get heatCapacity() { return CORE.levels[this.coreLevel - 1].heatCapacity! + this.bonus('heatCapacity'); }
  private operate(energy: number, heat: number): boolean {
    if(this.systemsDisabled>0)return false;
    if(this.coreLevel>=5&&this.coreAbility.active>0){energy*=SPECIAL.core.costMultiplier;heat*=SPECIAL.core.costMultiplier;}
    if (this.energy + 1e-8 < energy) { this.powerLimited = true; return false; }
    if (this.heat + heat > this.heatCapacity + 1e-8) { this.heatLimited = true; return false; }
    this.energy = Math.max(0, this.energy - energy); this.heat = Math.min(this.heatCapacity, this.heat + heat); return true;
  }
  private effectView?: Input['view'];
  /** Sound-only event: heard off screen too, quieter with distance, deeper for larger ships. */
  private cue(cue: NonNullable<EffectEvent['cue']>, at: Point = this.player, size = SHIP.radius) {
    const volume = 1 - dist(at, this.player) / HEARING.range;
    if (volume > 0 && this.effects.length < VFX.maxEvents) this.effects.push({ type: 'cue', cue, x: at.x, y: at.y, volume: Math.min(1, volume * 1.4), pitch: Math.max(0.55, Math.min(1.35, Math.sqrt(17 / size))) });
  }
  private effect(event: EffectEvent) {
    const v=this.effectView,margin=VFX.visibleMargin;
    if(v&&(event.x<v.x-margin||event.y<v.y-margin||event.x>v.x+v.width+margin||event.y>v.y+v.height+margin))return;
    if(this.effects.length<VFX.maxEvents)this.effects.push(event);
  }
  private addBlast(blast: Point & {radius:number;life:number}, weapon?: WeaponKind) {
    this.blasts.push(blast); this.effect({ type: blast.radius > 20 ? 'explosion' : 'impact', ...blast, weapon });
  }
  private emitDebris(point: Point, outward: Point, color: number, seed: number) {
    this.effect({ type:'debris',...point,angle:Math.atan2(outward.y,outward.x),color,count:2+Math.abs(seed%3) });
  }
  private spillCargo(){
    let excess=Math.max(0,this.cargoUsed-this.cargoCapacity);
    for(const ore of Object.keys(this.cargo) as Resource[]){if(excess<=0)break;const amount=Math.min(excess,this.cargo[ore]);this.cargo[ore]-=amount;excess-=amount;this.releaseOre(this.player,ore,amount);}
  }
  private collectDrop(drop: Drop, point: Point) {
    const take = Math.max(0, Math.min(drop.amount, this.cargoCapacity - this.cargoUsed));
    if (take > 0) { this.cargo[drop.ore] += take; drop.amount -= take; this.effect({ type:'collection', ...point, color: RESOURCES[drop.ore].color, radius:12 }); }
  }
  get maxShield() { return this.bonus('shield'); }
  get shieldRecharge() { return this.bonus('recharge'); }
  get maxHealth() { return CORE.levels[this.coreLevel - 1].hull! + this.bonus('hull'); }
  get maxSpeed() { return (SHIP.speed + this.bonus('speed') * this.engineRatio + this.burst('burstSpeed')) / Math.sqrt(this.shipMass / SHIP_SYSTEMS.referenceMass); }
  get acceleration() { return (SHIP.acceleration + this.bonus('acceleration') * this.engineRatio + this.burst('burstThrust')) / (this.shipMass / SHIP_SYSTEMS.referenceMass); }
  get pickupRange() { return SHIP.pickupRange + this.bonus('pickup'); }
  get miningRate() { return this.bonus('mining') || REPAIR.emergencyMining; }
  modulePoint(m: Pick<ShipModule,'x'|'y'>, heading = this.player.angle): Point {
    return { x:this.player.x+(m.x*Math.cos(heading)-m.y*Math.sin(heading))*BUILD_GRID.cellSize, y:this.player.y+(m.x*Math.sin(heading)+m.y*Math.cos(heading))*BUILD_GRID.cellSize };
  }
  modulePositions(kind: ModuleKind, heading = this.player.angle) {
    const p = this.player;
    return this.modules.filter(m => m.kind === kind).map(m => ({ ...m, gridX: m.x, gridY: m.y,
      x: p.x + (m.x * Math.cos(heading) - m.y * Math.sin(heading)) * BUILD_GRID.cellSize,
      y: p.y + (m.x * Math.sin(heading) + m.y * Math.cos(heading)) * BUILD_GRID.cellSize,
    }));
  }
  upgradeError(x: number, y: number): string | undefined {
    if (this.dead || !this.atStation) return 'Return to the station to upgrade.';
    const m = this.modules.find(m => m.x === x && m.y === y);
    const core = x === 0 && y === 0;
    if (!m && !core) return 'Select an installed module.';
    const kind: EquipmentKind = core ? 'core' : m!.kind, level = core ? this.coreLevel : m!.level;
    if (level >= equipment(kind).levels.length) return 'Maximum level reached.';
    if (!core && level + 1 > this.coreLevel) return `Upgrade your core / hull to level ${level + 1} first.`;
    if (level >= equipment(kind).levels.length) return 'Maximum level reached.';
    const cost = upgradeCost(kind, level);
    if ((Object.keys(cost) as Resource[]).some(ore => this.stored[ore] < cost[ore])) return 'Not enough stored ore. Unload with E first.';
  }
  upgradeModule(x: number, y: number): boolean {
    const error = this.upgradeError(x, y);
    if (error) { this.message = error; return false; }
    const m = this.modules.find(m => m.x === x && m.y === y);
    const core = x === 0 && y === 0, kind: EquipmentKind = core ? 'core' : m!.kind;
    const oldHull = this.maxHealth, oldShield = this.maxShield;
    const cost = upgradeCost(kind, core ? this.coreLevel : m!.level);
    for (const ore of Object.keys(cost) as Resource[]) this.stored[ore] -= cost[ore];
    if (core) this.coreLevel++; else {
      const oldMax = this.moduleMaxIntegrity(m!); m!.level++;
      m!.integrity += this.moduleMaxIntegrity(m!) - oldMax;
      this.statsCache=undefined;
    }
    this.player.health += this.maxHealth - oldHull;
    this.shield += this.maxShield - oldShield;
    this.message = `${equipment(kind).label} upgraded to level ${core ? this.coreLevel : m!.level}.`;
    return true;
  }
  buildError(kind: ModuleKind, x: number, y: number): string | undefined {
    if (this.dead || !this.atStation) return 'Return to the station to install modules.';
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || Math.abs(x) * BUILD_GRID.cellSize > WORLD.width / 2 || Math.abs(y) * BUILD_GRID.cellSize > WORLD.height / 2) return 'Outside the build grid.';
    if (kind === 'builder' && this.coreLevel < OUTPOST.coreLevel) return `The Build module requires Core level ${OUTPOST.coreLevel}.`;
    if ((x === 0 && y === 0) || this.modules.some(m => m.x === x && m.y === y)) return 'That cell is occupied.';
    if (Math.abs(x) + Math.abs(y) !== 1 && !this.modules.some(m => Math.abs(m.x - x) + Math.abs(m.y - y) === 1)) return 'Attach to the core or an installed module.';
    const def = MODULES[kind];
    if ((Object.keys(def.cost) as Resource[]).some(ore => this.stored[ore] < def.cost[ore])) return 'Not enough stored ore. Unload with E first.';
  }
  installModule(kind: ModuleKind, x: number, y: number): boolean {
    const error = this.buildError(kind, x, y);
    if (error) { this.message = error; return false; }
    for (const ore of Object.keys(MODULES[kind].cost) as Resource[]) this.stored[ore] -= MODULES[kind].cost[ore];
    const oldHull = this.maxHealth, oldShield = this.maxShield;
    this.modules.push({ x, y, kind, level: 1, cooldown: 0, integrity: MODULE_DURABILITY[kind][0] });
    this.player.health += this.maxHealth - oldHull;
    this.shield += this.maxShield - oldShield;
    this.message = `${MODULES[kind].label} installed.`;
    return true;
  }
  moduleMaxIntegrity(m: ShipModule) { return MODULE_DURABILITY[m.kind][m.level - 1]; }
  private connectedKeys(modules = this.modules) {
    const connected = new Set(['0,0']); let changed = true;
    while (changed) {
      changed = false;
      for (const block of modules) {
        const key = `${block.x},${block.y}`;
        if (!connected.has(key) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => connected.has(`${block.x + dx},${block.y + dy}`))) { connected.add(key); changed = true; }
      }
    }
    return connected;
  }
  moveError(x: number, y: number, toX: number, toY: number): string | undefined {
    const m = this.modules.find(m => m.x === x && m.y === y), other = this.modules.find(m => m.x === toX && m.y === toY);
    if (!m || this.dead || !this.atStation || !Number.isSafeInteger(toX) || !Number.isSafeInteger(toY) || Math.abs(toX) * BUILD_GRID.cellSize > WORLD.width / 2 || Math.abs(toY) * BUILD_GRID.cellSize > WORLD.height / 2 || (toX === 0 && toY === 0)) return 'Choose a build cell at an active base. The core stays fixed.';
    const proposed = this.modules.map(block => block === m ? { ...block, x: toX, y: toY } : block === other ? { ...block, x, y } : block);
    if (this.connectedKeys(proposed).size !== this.modules.length + 1) return 'Every block must stay connected to the core.';
  }
  moveModule(x: number, y: number, toX: number, toY: number): boolean {
    const error = this.moveError(x,y,toX,toY);
    if (error) { this.message=error; return false; }
    const m=this.modules.find(m=>m.x===x&&m.y===y)!,other=this.modules.find(m=>m.x===toX&&m.y===toY);
    if (other) { other.x = x; other.y = y; }
    m.x = toX; m.y = toY; this.message = other ? 'Modules swapped.' : 'Module moved. Ship layout updated.'; return true;
  }
  moduleRefund(m: ShipModule) {
    const paid = { ...MODULES[m.kind].cost };
    for (let level = 1; level < m.level; level++) {
      const cost = upgradeCost(m.kind, level);
      for (const ore of Object.keys(paid) as Resource[]) paid[ore] += cost[ore];
    }
    const condition = Math.max(0, Math.min(1, m.integrity / this.moduleMaxIntegrity(m)));
    for (const ore of Object.keys(paid) as Resource[]) paid[ore] = Math.floor(paid[ore] * condition);
    return paid;
  }
  removeModule(x: number, y: number): boolean {
    const m = this.modules.find(m => m.x === x && m.y === y);
    if (!m || this.dead || !this.atStation) { this.message = 'Select a module at an active base; the core cannot be removed.'; return false; }
    const remaining = this.modules.filter(block => block !== m);
    if (this.connectedKeys(remaining).size !== remaining.length + 1) { this.message = 'Move the attached blocks first so removal does not disconnect the ship.'; return false; }
    const lostCapacity=MODULES[m.kind].levels[m.level-1].cargo??0;
    if(this.cargoUsed>this.cargoCapacity-lostCapacity){this.message='Unload cargo before removing this hold.';return false;}
    const refund = this.moduleRefund(m), oldMax = this.maxHealth;
    const hullLoss = MODULES[m.kind].levels[m.level - 1].hull ?? 0;
    if (this.player.health <= hullLoss) { this.message = 'Repair your hull before removing this armor.'; return false; }
    this.modules = remaining;
    this.player.health = Math.min(this.maxHealth, this.player.health - (oldMax - this.maxHealth));
    this.shield = Math.min(this.shield, this.maxShield);this.energy=Math.min(this.energy,this.maxEnergy);
    for (const ore of Object.keys(refund) as Resource[]) this.stored[ore] += refund[ore];
    this.message = `${MODULES[m.kind].label} removed; refund added to base storage.`; return true;
  }
  get repairCost(): Record<Resource, number> {
    const integrity = this.modules.reduce((sum, m) => sum + Math.max(0, this.moduleMaxIntegrity(m) - m.integrity), 0);
    return { iron: Math.ceil((Math.max(0, this.maxHealth - this.player.health) + integrity) * REPAIR.ironPerHull), copper: Math.ceil(integrity * REPAIR.copperPerModule), crystal: 0, ice: 0, radioactive: 0 };
  }
  repairError(): string | undefined {
    if (this.dead || !this.atStation) return 'Repair at an active base.';
    const cost = this.repairCost;
    if ((Object.keys(cost) as Resource[]).some(ore => this.cargo[ore] + this.stored[ore] < cost[ore])) return 'Not enough minerals to repair.';
  }
  repairShip(): boolean {
    const error = this.repairError(); if (error) { this.message = error; return false; }
    for (const ore of Object.keys(this.repairCost) as Resource[]) {
      const amount = this.repairCost[ore], carried = Math.min(this.cargo[ore], amount);
      this.cargo[ore] -= carried; this.stored[ore] -= amount - carried;
    }
    this.player.health = this.maxHealth; this.shield = this.maxShield;
    for (const m of this.modules) m.integrity = this.moduleMaxIntegrity(m);
    this.message = 'Ship repaired; mineral cost paid.'; return true;
  }
  private breakModule(m: ShipModule) {
    const p = this.player; this.cue('moduleLost');
    const point = { x: p.x + (m.x * Math.cos(p.angle) - m.y * Math.sin(p.angle)) * BUILD_GRID.cellSize, y: p.y + (m.x * Math.sin(p.angle) + m.y * Math.cos(p.angle)) * BUILD_GRID.cellSize };
    this.detachedModules.push({ x: point.x, y: point.y, vx: this.player.vx * 0.4 + (m.x || 1) * 22, vy: this.player.vy * 0.4 + m.y * 22, kind: m.kind, level: m.level, angle: this.player.angle, life: 25 });
    if (this.detachedModules.length > 40) this.detachedModules.shift();
    for (const ore of Object.keys(MODULES[m.kind].cost) as Resource[]) this.releaseOre(point, ore, Math.floor(MODULES[m.kind].cost[ore] * REPAIR.salvageFraction));
    this.modules = this.modules.filter(block => block !== m);
  }
  isExplored(point: Point) { return this.explored.has(`${Math.floor(point.x / EXPLORATION.cell)},${Math.floor(point.y / EXPLORATION.cell)}`); }
  private revealExploration() {
    const cell = EXPLORATION.cell, p = this.player;
    for (let x = Math.max(0, Math.floor((p.x - EXPLORATION.radius) / cell)); x <= Math.min(Math.ceil(WORLD.width / cell) - 1, Math.floor((p.x + EXPLORATION.radius) / cell)); x++) {
      for (let y = Math.max(0, Math.floor((p.y - EXPLORATION.radius) / cell)); y <= Math.min(Math.ceil(WORLD.height / cell) - 1, Math.floor((p.y + EXPLORATION.radius) / cell)); y++) {
        if (dist(p, { x: (x + 0.5) * cell, y: (y + 0.5) * cell }) <= EXPLORATION.radius) this.explored.add(`${x},${y}`);
      }
    }
  }
  private damagePlayer(amount: number, hit?: Point, attackerId?:number) {
    if(this.modules.some(m=>m.kind==='engine'&&m.level>=5&&(m.ability?.phase??0)>0))return;
    if(this.modules.some(m=>m.kind==='armor'&&m.level>=5&&(m.ability?.active??0)>0))amount*=1-SPECIAL.armor.reduction;
    for(const m of this.modules)if(m.kind==='armor'&&onDamageTaken(m,amount))this.effect({type:'shield',...this.player,color:MODULES.armor.color,radius:28});
    const absorbed = Math.min(this.shield, amount), damage = amount - absorbed;
    if (absorbed > 0) this.effect({type:'shield',...(hit??this.player),radius:22,color:0x71e1ff});
    if(absorbed>0&&attackerId!==undefined&&this.modules.some(m=>m.kind==='shield'&&m.level>=5)){
      const attacker=this.enemies.find(e=>e.id===attackerId&&e.health>0);
      if(attacker){this.hitEnemy(attacker,absorbed*SPECIAL.shield.fraction);this.arc(hit??this.player,attacker,0xa4edff);}
    }
    this.shield -= absorbed; this.player.health = Math.max(0, this.player.health - damage);
    this.shieldDelay = 3;
    if (damage <= 0 || !hit) return;
    const positions = (Object.keys(MODULES) as ModuleKind[]).flatMap(kind => this.modulePositions(kind));
    const nearest = positions.sort((a, b) => dist(a, hit) - dist(b, hit))[0];
    if (!nearest || dist(nearest, hit) > 18 || dist(this.player, hit) < dist(nearest, hit)) return;
    const m = this.modules.find(block => block.x === nearest.gridX && block.y === nearest.gridY);
    if (!m) return;
    m.integrity = Math.max(0, m.integrity - damage);
    if (m.integrity <= 0) {
      this.breakModule(m);
      const connected = this.connectedKeys();
      for (const loose of [...this.modules]) if (!connected.has(`${loose.x},${loose.y}`)) this.breakModule(loose);
      this.player.health = Math.min(this.player.health, this.maxHealth); this.shield = Math.min(this.shield, this.maxShield);
      this.spillCargo();
      this.message = 'Module destroyed! Recover loose cargo and salvage.';
    }
  }
  private projectileHitsPlayer(point: Point) {
    return dist(this.player, point) < SHIP.radius + 4 || (Object.keys(MODULES) as ModuleKind[]).some(kind => this.modulePositions(kind).some(block => dist(block, point) < 12));
  }
  get cargoUsed() { return Object.values(this.cargo).reduce((a, b) => a + b, 0); }
  get dead() { return this.player.health <= 0; }
  get nearestBase() { return this.bases.reduce((best, base) => dist(this.player, base) < dist(this.player, best) ? base : best); }
  get atStation() { return this.bases.some(base => base.unlocked && dist(this.player, base) < BASE_RADIUS); }
  get nearestUnlockedBase() { return this.bases.filter(base => base.unlocked).reduce((best, base) => dist(this.player, base) < dist(this.player, best) ? base : best); }
  unlockError(): string | undefined {
    const base = this.nearestBase;
    if (this.dead || dist(this.player, base) >= BASE_RADIUS) return 'Approach a locked outpost and press G to activate it.';
    if (base.unlocked) return 'This base is already active.';
    if ((Object.keys(base.cost) as Resource[]).some(ore => this.cargo[ore] + this.stored[ore] < base.cost[ore])) return 'Not enough minerals to activate this outpost.';
  }
  unlockBase(): boolean {
    const error = this.unlockError();
    if (error) { this.message = error; return false; }
    const base = this.nearestBase;
    for (const ore of Object.keys(base.cost) as Resource[]) {
      const carried = Math.min(this.cargo[ore], base.cost[ore]);
      this.cargo[ore] -= carried; this.stored[ore] -= base.cost[ore] - carried;
    }
    base.unlocked = true;
    this.message = `${base.name} activated! E repairs/unloads; B opens the outfitter.`;
    return true;
  }
  private hordeSeen = 0;
  private updateHorde(dt: number, danger: number, safe: boolean) {
    const h = this.horde, p = this.player, alive = this.enemies.filter(e => e.horde && e.health > 0);
    // Outrun hordes give up without paying out.
    for (const e of alive) if (dist(e, p) > HORDE.despawn) { e.rewarded = true; e.health = 0; }
    const remaining = alive.filter(e => e.health > 0).length;
    if (this.hordeSeen > 0 && remaining === 0) {
      const beaten = alive.length === 0 && !this.dead;
      if (beaten) {
        const level = Math.max(1, Math.min(HORDE.size.length, danger)), reward = Object.entries(HORDE.reward) as [Resource, number][];
        reward.forEach(([ore, amount], i) => this.drops.push({ id: this.id++, x: p.x + (i - (reward.length - 1) / 2) * 22, y: p.y - 60, ore, amount: amount * level }));
        this.message = 'Horde destroyed. Salvage bonus released nearby.'; this.cue('build');
      }
      h.total = 0;
    }
    this.hordeSeen = remaining;
    if (remaining > 0 || this.dead) return;
    const level = Math.max(1, Math.min(HORDE.size.length, danger)), range = HORDE.interval[level - 1];
    if (h.warning > 0) {
      if (safe) { h.warning = 0; h.timer = HORDE.retry; this.message = 'Horde lost your trail at the station.'; return; }
      const before = Math.floor(h.warning / HORDE.alarmEvery); h.warning -= dt;
      if (Math.floor(h.warning / HORDE.alarmEvery) !== before) this.cue('hordeAlarm');
      if (h.warning <= 0) { h.warning = 0; this.spawnHorde(level); h.timer = range[0] + this.random() * (range[1] - range[0]); }
      return;
    }
    // The clock only runs out in open space, away from the starting base.
    if (safe || dist(p, this.bases[0]) < DANGER.safeRadius) return;
    h.timer = Math.min(h.timer, range[1] + HORDE.firstDelay) - dt;
    if (h.timer <= 0) { h.warning = HORDE.warning; h.angle = this.random() * Math.PI * 2; this.message = 'ALERT: a horde has found you. Fight or dock!'; this.cue('hordeAlarm'); }
  }
  private spawnHorde(level: number) {
    const p = this.player, count = HORDE.size[level - 1]; this.horde.total = count;
    for (let i = 0; i < count; i++) {
      const pool = this.random() < HORDE.eliteShare[level - 1] ? ENEMY_SPAWN.elite[level - 1] : ENEMY_SPAWN.normal[level - 1], kind = pool[Math.floor(this.random() * pool.length)], radius = ENEMIES[kind].radius;
      let spot: Point | undefined;
      for (let attempt = 0; attempt < 12 && !spot; attempt++) {
        const angle = this.horde.angle + (this.random() - 0.5) * HORDE.arc, distance = HORDE.distance[0] + this.random() * (HORDE.distance[1] - HORDE.distance[0]) + attempt * 25;
        const point = { x: clamp(p.x + Math.cos(angle) * distance, 60, WORLD.width - 60), y: clamp(p.y + Math.sin(angle) * distance, 60, WORLD.height - 60) };
        const blocked = this.asteroids.some(a => dist(a, point) < a.radius + radius + 12) || this.enemies.some(e => dist(e, point) < ENEMIES[e.kind ?? 'raider'].radius + radius + 14) || this.bases.some(base => dist(base, point) < BASE_RADIUS + radius + 40);
        if (!blocked || attempt === 11) spot = point;
      }
      this.spawnEnemy(kind, spot!.x, spot!.y, Math.atan2(p.y - spot!.y, p.x - spot!.x), { horde: true, lastSeen: { x: p.x, y: p.y }, memory: HORDE.memory });
    }
    this.message = `HORDE: ${count} hostiles inbound!`;
  }
  /** Seeded danger level (1-4) of a location; decides which enemy classes spawn there. */
  dangerAt(point: Point) {
    const level = dangerAt(this.world.spec, point.x, point.y), site = this.bossSites.find(site => dist(site, point) < site.radius);
    // A living boss makes its territory extreme; defeating it makes the field safer to mine.
    return !site ? level : site.defeated ? Math.min(level, 2) : DANGER.labels.length;
  }
  /** Seeded boss territories with their current defeat state. */
  get bossSites() { const resting = this.defeatedBosses; return (this.sites ??= bossSites(this.world.spec)).map(site => ({ ...site, defeated: resting.includes(site.kind) })); }
  private sites?: ReturnType<typeof bossSites>;
  private spawnBoss(site: Point & { kind: EnemyKind }) {
    const def = ENEMIES[site.kind], boss = this.spawnEnemy(site.kind, site.x, site.y, 0, { home: { x: site.x, y: site.y } });
    for (const part of def.boss!.parts) this.spawnEnemy(part.kind, site.x + part.x, site.y + part.y, 0, { parent: boss.id, mount: { x: part.x, y: part.y } });
    def.boss!.escorts.forEach((kind, i) => { const angle = Math.PI / 2 + i * Math.PI; this.spawnEnemy(kind, site.x + Math.cos(angle) * 260, site.y + Math.sin(angle) * 260, angle,{faction:def.faction}); });
    this.message = `WARNING: ${def.label} is guarding this field.`; this.cue('bossWarning');
    return boss;
  }
  private enemyFire(e: Enemy, def: EnemyDefinition, state: EnemyState, visible: boolean, distance: number, toPlayer: number, toGoal: number, dt: number) {
    const p = this.player, weapons = def.boss && e.phase3 && def.boss.finalWeapons ? def.boss.finalWeapons : def.boss && e.phase2 ? def.boss.phaseWeapons : def.weapons;
    const face = (angle: number) => { const turn = Math.atan2(Math.sin(angle - e.angle), Math.cos(angle - e.angle)); e.angle = def.turnRate ? e.angle + clamp(turn, -def.turnRate * dt, def.turnRate * dt) : angle; };
    const mayFire = visible && (!def.industry||def.industry.combat||(e.memory??0)>0) && state !== 'retreat' && state !== 'investigate' && !((e.surge ?? 0) > 0);
    const sheltered = this.bases.some(base => base.unlocked && dist(e, base) < BASE_RADIUS);
    if (e.charge) {
      // Telegraphed shot: the aim line tracks, locks shortly before firing, then the shot goes where it locked.
      const weapon = weapons[e.charge.weapon];if(weapon.requiresPart&&!this.enemies.some(part=>part.parent===e.id&&part.health>0&&part.kind===weapon.requiresPart)){e.charge=undefined;return;} e.charge.t -= dt;
      if (e.charge.t > ENEMY_AI.chargeLock) e.charge.angle = toPlayer;
      face(e.charge.angle);
      if (e.charge.t <= 0) { if (!sheltered) this.enemyShot(e, weapon, e.charge.angle); e.charge = undefined; }
    } else {
      face(state === 'retreat' ? toPlayer + Math.PI : state === 'investigate' ? toGoal : toPlayer);
      weapons.forEach((weapon, i) => {
        if (weapon.requiresPart && !this.enemies.some(part=>part.parent===e.id&&part.kind===weapon.requiresPart&&part.health>0)) return;
        if ((i === 0 ? e.cooldown : e.cooldown2!) > 0 || !mayFire || distance >= def.range || sheltered || e.charge) return;
        if (i === 0) e.cooldown = weapon.cooldown; else e.cooldown2 = weapon.cooldown;
        if (weapon.charge) { e.charge = { t: weapon.charge, angle: toPlayer, weapon: i }; this.cue(weapon.type === 'rocket' ? 'lock' : 'railCharge', e, def.radius); return; }
        const time = weapon.lead ? distance / weapon.speed : 0;
        this.enemyShot(e, weapon, Math.atan2(p.y + p.vy * time - e.y, p.x + p.vx * time - e.x));
      });
      if (def.drones && (!def.drones.requiresPart||this.enemies.some(part=>part.parent===e.id&&part.health>0&&part.kind===def.drones!.requiresPart)) && this.enemies.length<90 && mayFire && (e.cooldown3 ?? 0) <= 0 && !sheltered) {
        e.cooldown3 = def.drones.interval;
        if (this.enemies.filter(other => other.parent === e.id && other.kind === (def.drones!.kind??'drone')).length < def.drones.max) { this.spawnEnemy(def.drones.kind??'drone', e.x + Math.cos(e.angle) * def.radius, e.y + Math.sin(e.angle) * def.radius, e.angle, { parent: e.id,faction:e.faction??def.faction }); this.cue('drone', e); }
      }
    }
  }
  get danger() { return this.dangerAt(this.player); }
  private spawnEnemy(kind: EnemyKind, x: number, y: number, angle: number, extra: Partial<Enemy> = {}) {
    const def = ENEMIES[kind], enemy: Enemy = { id: this.id++, kind, x, y, health: def.health, shield: def.shield, cooldown: 1, angle, populationExempt: true, armor:def.armor??0, faction:def.faction, ...extra };
    if (def.behavior === 'guard' && !enemy.horde) enemy.home = { x, y };
    this.enemies.push(enemy); return enemy;
  }
  private damageEnemy(e: Enemy, amount: number, alert = true) {
    const def = ENEMIES[e.kind ?? 'raider'];
    if (def.weakPoint) {
      // Reactor vents never break; once exposed they pass damage straight to the boss hull, past its shield.
      const boss = this.enemies.find(other => other.id === e.parent && other.health > 0);
      if (boss?.phase2 && amount > 0) {
        boss.health -= amount * def.weakPoint; this.effect({ type: 'impact', x: e.x, y: e.y, radius: 18, color: def.color });
        if (boss.health <= 0) this.enemyDestroyed(boss);
      }
      return;
    }
    if(e.meltdown!==undefined&&!e.meltdownDone)return;
    const absorbed = Math.min(e.shield ?? 0, amount);
    // Being hit points the enemy at the attacker even without a line of sight.
    if (alert && amount > 0 && !this.atStation) { e.lastSeen = { x: this.player.x, y: this.player.y }; e.memory = ENEMY_AI.memory; }
    if (absorbed > 0) { e.shield = (e.shield ?? 0) - absorbed; this.effect({ type: 'shield', x: e.x, y: e.y, radius: def.radius + 6, color: def.color }); }
    if (amount > 0) e.shieldDelay = def.shieldDelay;
    const aura=this.enemies.find(other=>other!==e&&other.health>0&&ENEMIES[other.kind??'raider'].aura&& (other.faction??ENEMIES[other.kind??'raider'].faction)===(e.faction??def.faction)&&dist(other,e)<ENEMIES[other.kind??'raider'].aura!.range);
    const facing=Math.cos(Math.atan2(this.player.y-e.y,this.player.x-e.x)-e.angle)>.4;
    const housing=def.boss?.frontArmor && (!def.boss.parts.some(part=>ENEMIES[part.kind].role==='housing')||this.enemies.some(part=>part.parent===e.id&&part.health>0&&ENEMIES[part.kind??'raider'].role==='housing'));
    if(facing&&housing)amount=absorbed+(amount-absorbed)*(1-def.boss!.frontArmor!);
    e.health -= (amount - absorbed)*(1-Math.min(.65,e.armor??0))*(1-(aura?ENEMIES[aura.kind??'raider'].aura!.reduction:0));
  }
  private enemyExplosion(b:Bullet,point:Point){const radius=b.splash??0;this.effect({type:'explosion',...point,radius,weapon:b.weapon,color:0xf2a36a});if(!this.atStation&&dist(point,this.player)<radius+SHIP.radius)this.damagePlayer((b.damage??0)*Math.max(.25,1-dist(point,this.player)/(radius+SHIP.radius)),point,b.attackerId);}
  private enemyShot(e: Enemy, w: EnemyWeapon, angle: number) {
    const def = ENEMIES[e.kind ?? 'raider'], count = w.count ?? 1, reach = def.radius + 6;
    if(def.repositionAfterShot)e.reposition=def.repositionAfterShot;
    if(w.beam){if(w.beam.arc){const coil=this.enemies.find(part=>part.parent===e.id&&part.health>0&&ENEMIES[part.kind??'raider'].role==='coil');if(coil)this.arc(e,coil,0xc794ff);}
      const end={x:e.x+Math.cos(angle)*w.beam.range,y:e.y+Math.sin(angle)*w.beam.range};let nearest=1,rockHit:Asteroid|undefined;
      for(const rock of this.asteroids){if(segmentCircleHit(e,end,rock,rock.radius)===undefined)continue;const hit=segmentPolygonHit(ensureAsteroidGeometry(rock),asteroidLocal(rock,e),asteroidLocal(rock,end));if(hit&&hit.t<nearest){nearest=hit.t;rockHit=rock;}}
      const point={x:e.x+(end.x-e.x)*nearest,y:e.y+(end.y-e.y)*nearest};
      if(!this.atStation&&(segmentCircleHit(e,point,this.player,SHIP.radius+5)!==undefined))this.damagePlayer(w.damage,this.player,e.id);
      if(rockHit&&w.beam.material>0){const removed=mineMaterial(rockHit,w.beam.material,point);e.cargo??={};e.cargo[rockHit.ore]=(e.cargo[rockHit.ore]??0)+removed;if(rockHit.amount<=0)this.destroyAsteroid(rockHit.id);}
      if(this.enemyBeams.length>=12)this.enemyBeams.shift();
      this.enemyBeams.push({start:{x:e.x,y:e.y},end:point,life:.22});this.cue('rail',e,def.radius);return;
    }
    this.effect({ type: 'muzzle', x: e.x, y: e.y, angle, color: 0xff7770, weapon: w.type, silent: true });
    this.cue(w.type === 'cannon' ? 'fire' : w.type, e, def.radius);
    const available=Math.max(0,256-this.bullets.filter(b=>b.enemy&&b.life>0).length);
    for (let i = 0; i < Math.min(count,available); i++) {
      const t = count > 1 ? i / (count - 1) - 0.5 : 0, heading = angle + t * (w.spread ?? 0)/(e.accuracyScale??1), side = t * 2 * (w.offset ?? 0);
      const bullet: Bullet = Object.assign(this.enemyBulletPool.pop()??({} as Bullet),{homing:undefined,rocket:false,age:0, id: this.id++, x: e.x + Math.cos(angle) * reach - Math.sin(angle) * side, y: e.y + Math.sin(angle) * reach + Math.cos(angle) * side, vx: Math.cos(heading) * w.speed, vy: Math.sin(heading) * w.speed, life: w.lifetime, enemy: true, damage: w.damage*(e.damageScale??1), splash:w.splash, weapon: w.type, attackerId:e.id });
      if (w.type === 'rocket') bullet.rocket = true;
      if (w.homing) bullet.homing = w.homing;
      this.bullets.push(bullet);
    }
  }
  private updatePopulation(view:Input['view'],regenerate=true){
    const blockers=[{...this.player,radius:SHIP.radius},...this.modules.map(m=>({...this.modulePoint(m),radius:12})),...this.enemies.map(e=>({...e,radius:ENEMIES[e.kind??'raider'].radius})),...this.outposts.map(o=>({...outpostCenter(o),radius:outpostRadius(o)+40}))];
    if(regenerate)this.world.replenish(this.player,this.asteroids,view,blockers);
    const next=this.population.update(this.world.time,this.player,view,this.asteroids,this.bases,this.enemies,this.squads,()=>this.id++,[...blockers.slice(0,this.modules.length+1),...blockers.slice(blockers.length-this.outposts.length)],this.coreLevel);
    this.enemies=next.enemies;this.squads=next.squads;
  }
  respawn() {
    if (!this.dead) return;
    const base = this.nearestUnlockedBase;
    this.player = { x: base.x, y: base.y + 130, vx: 0, vy: 0, health: this.maxHealth, angle: -Math.PI / 2 };
    this.energy = this.maxEnergy; this.heat = 0; this.empPulses = [];this.novaFields=[];this.coreAbility.active=0;for(const m of this.modules)if(m.ability){m.ability.active=0;m.ability.phase=0;m.ability.sustained=0;}
    this.impactTimer = 0; this.shield = this.maxShield; this.shieldDelay = 0;
    this.revealExploration();
    this.bullets = []; this.message = 'Respawned. Your dropped cargo remains at the wreck location.';
  }
  private shoot(source: Point, angle: number, enemy: boolean, override?: typeof WEAPONS.enemy) {
    const w = override ?? (enemy ? WEAPONS.enemy : WEAPONS.player);
    if(enemy)this.effect({type:'muzzle',...source,angle,color:0xff7770,weapon:'cannon'});
    this.bullets.push({ id: this.id++, x: source.x + Math.cos(angle) * (enemy ? 23 : 10), y: source.y + Math.sin(angle) * (enemy ? 23 : 10), vx: Math.cos(angle) * w.speed, vy: Math.sin(angle) * w.speed, life: w.lifetime, enemy, damage: w.damage,attackerId:enemy?(source as Enemy).id:undefined });
  }
  private impact(speed: number, label: string, hit?: Point): number {
    if (speed <= COLLISION.safeSpeed || this.impactTimer > 0) return 0;
    const damage = Math.min(COLLISION.maxDamage, Math.ceil((speed - COLLISION.safeSpeed) * COLLISION.damagePerSpeed));
    this.damagePlayer(damage, hit);
    this.impactTimer = COLLISION.damageCooldown;
    this.addBlast({ x: this.player.x, y: this.player.y, radius: 24, life: 0.14 });
    this.message = `${label} impact! Damage ${damage}. Slow down to push safely.`;
    return damage;
  }
  private resolveContacts(dt: number) {
    const p = this.player;
    const playerBody: Body = { ...p, radius: SHIP.radius, mass: this.shipMass / SHIP_SYSTEMS.referenceMass };
    const moving = this.asteroids.filter(a => a.motion || Math.abs(a.vx) + Math.abs(a.vy) > 0.1);
    const movingCells=new Set(moving.map(a=>`${Math.floor(a.x/128)},${Math.floor(a.y/128)}`));
    const nearMoving=(a:Asteroid)=>{const x=Math.floor(a.x/128),y=Math.floor(a.y/128);for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)if(movingCells.has(`${x+dx},${y+dy}`))return true;return false;};
    // Spatial buckets keep ambient drift from introducing an all-pairs contact scan.
    const active = this.asteroids.filter(a => (Math.abs(a.x - p.x) < 500 && Math.abs(a.y - p.y) < 500) || this.enemies.some(e => Math.abs(a.x - e.x) < 140 && Math.abs(a.y - e.y) < 140) || nearMoving(a));
    const rocks = active.map(a => {
      ensureAsteroidGeometry(a);
      if(advanceBelt(a,this.world.spec,this.world.time,dt))return {...a,mass:Math.max(1,(a.radius/20)**2)};
      const decay = Math.exp(-COLLISION.asteroidDrag * dt);
      let dx=a.driftX??0,dy=a.driftY??0;
      if(Math.hypot(dx,dy)>0){
        if(Math.abs(a.x-(a.originX??a.x))>POPULATION.ambientRange&&Math.sign(dx)===Math.sign(a.x-(a.originX??a.x))||a.x<a.radius+5&&dx<0||a.x>WORLD.width-a.radius-5&&dx>0)dx=-dx;
        if(Math.abs(a.y-(a.originY??a.y))>POPULATION.ambientRange&&Math.sign(dy)===Math.sign(a.y-(a.originY??a.y))||a.y<a.radius+5&&dy<0||a.y>WORLD.height-a.radius-5&&dy>0)dy=-dy;
        for(const base of this.bases){const distance=Math.hypot(a.x-base.x,a.y-base.y);if(distance<POPULATION.baseClearance+a.radius+30){const speed=Math.hypot(dx,dy);dx=(a.x-base.x)/(distance||1)*speed;dy=(a.y-base.y)/(distance||1)*speed;}}
        a.driftX=dx;a.driftY=dy;a.rotation=spinFor(a)*(this.world.time-(this.world.spec.motionEpoch??0))||0;
      }
      a.x += dx*dt+(a.vx-dx)*(1-decay)/COLLISION.asteroidDrag;
      a.y += dy*dt+(a.vy-dy)*(1-decay)/COLLISION.asteroidDrag;
      a.vx=dx+(a.vx-dx)*decay;a.vy=dy+(a.vy-dy)*decay;
      return { ...a, mass: Math.max(1, (a.radius / 20) ** 2) };
    });
    for (const rock of rocks) {
      const speed = collideAsteroid(playerBody, rock, rock.geometry!, COLLISION.restitution);
      if (speed !== undefined) this.impact(speed, 'Asteroid', miningImpact(rock, playerBody, rock));
    }
    // Moving ore can push other deposits rather than passing through them.
    const buckets = new Map<string, number[]>();
    for (let i = 0; i < rocks.length; i++) {
      const rock = rocks[i], bx = Math.floor(rock.x / 128), by = Math.floor(rock.y / 128);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        for (const j of buckets.get(`${bx + dx},${by + dy}`) ?? []) collide(rocks[j], rock, COLLISION.restitution);
      }
      const key = `${bx},${by}`;
      const bucket = buckets.get(key) ?? []; bucket.push(i); buckets.set(key, bucket);
    }
    for (const e of this.enemies) {
      const body: Body = { ...e, vx: e.vx ?? 0, vy: e.vy ?? 0, radius: ENEMIES[e.kind ?? 'raider'].radius, mass: ENEMIES[e.kind ?? 'raider'].mass };
      e.impactCooldown = Math.max(0, (e.impactCooldown ?? 0) - dt);
      for (const rock of rocks) {
        const speed = collideAsteroid(body, rock, rock.geometry!, COLLISION.restitution);
        if (speed !== undefined && speed > COLLISION.safeSpeed && e.impactCooldown <= 0) {
          this.damageEnemy(e, Math.min(COLLISION.maxDamage, Math.ceil((speed - COLLISION.safeSpeed) * COLLISION.damagePerSpeed)), false);
          this.enemyHits++;
          e.impactCooldown = COLLISION.damageCooldown;
          this.addBlast({ x: e.x, y: e.y, radius: 16, life: 0.12 });
        }
      }
      if (e.health > 0) {
        const speed = collide(playerBody, body, COLLISION.restitution);
        if (speed !== undefined) this.damageEnemy(e, this.impact(speed, 'Ship', e));
      }
      e.x = clamp(body.x, 20, WORLD.width - 20); e.y = clamp(body.y, 20, WORLD.height - 20);
      e.vx = body.vx; e.vy = body.vy;
      if (e.health <= 0) this.enemyDestroyed(e);
    }
    for (let i = 0; i < rocks.length; i++) {
      const rock = rocks[i], a = active[i];
      a.x = clamp(rock.x, a.radius, WORLD.width - a.radius);
      a.y = clamp(rock.y, a.radius, WORLD.height - a.radius);
      a.vx = a.x === rock.x ? rock.vx : -rock.vx * COLLISION.restitution;
      a.vy = a.y === rock.y ? rock.vy : -rock.vy * COLLISION.restitution;
    }
    p.x = clamp(playerBody.x, 20, WORLD.width - 20); p.y = clamp(playerBody.y, 20, WORLD.height - 20);
    p.vx = p.x === playerBody.x ? playerBody.vx : 0; p.vy = p.y === playerBody.y ? playerBody.vy : 0;
  }
  private enemyDestroyed(e: Enemy) {
    const def = ENEMIES[e.kind ?? 'raider'];
    if(e.rewarded)return;
    if(def.boss?.meltdown&&!e.meltdownDone){if(e.meltdown===undefined){e.meltdown=def.boss.meltdown.duration;e.empCharge=e.meltdown;e.charge=undefined;this.cue('empCharge',e,def.radius);this.message='Reactor meltdown! Clear the blast radius!';}e.health=1;return;}e.rewarded=true;
    this.addBlast({ x: e.x, y: e.y, radius: Math.max(35, def.radius * 1.6), life: def.boss ? 0.5 : 0.22 });
    // Components that go down with their boss are debris, not separate kills or loot.
    if (e.mount && !this.enemies.some(other => other.id === e.parent && other.health > 0)) return;
    if(!e.populationExempt)this.population.recordDefeat(e,this.world.time);
    this.kills++;
    let share = 1;
    if (def.boss && e.kind) {
      // The ledger starts the boss's return cooldown; only the first kill pays the full reward.
      const result = this.population.recordBossDefeat(e.kind, this.world.time); share = result.uniqueReward ? 1 : HORDE.repeatBossLoot;
      this.cue('bossDown', e);
      this.message = `${def.label} destroyed. This field is safer to mine until it returns.`;
    }
    for(const [ore,amount] of Object.entries(e.cargo??{}))this.releaseOre(e,ore as Resource,Math.floor((amount??0)*(def.industry?.lootShare??1)));
    const loot = Object.entries(def.loot) as [Resource, number][];
    loot.forEach(([ore, amount], i) => this.drops.push({ id: this.id++, x: e.x + i * 16 - (loot.length - 1) * 8, y: e.y, ore, amount: Math.max(1, Math.round(amount * share*(e.rewardScale??1))) }));
  }
  private releaseOre(point: Point, ore: Resource, amount: number,velocity?:Point) {
    if (amount <= 0) return;
    const existing = this.drops.find(d => d.ore === ore && dist(d, point) < 45);
    if (existing) {const total=existing.amount+amount;if(velocity){existing.vx=((existing.vx??0)*existing.amount+velocity.x*amount)/total;existing.vy=((existing.vy??0)*existing.amount+velocity.y*amount)/total;}existing.amount=total;}
    else this.drops.push({ id: this.id++, ...point, ore, amount,...(velocity?{vx:velocity.x,vy:velocity.y}:{}) });
  }
  destroyAsteroid(id: number): boolean {
    const asteroid = this.asteroids.find(a => a.id === id);
    if (!asteroid) return false;
    // Release only what remains; already mined ore is never paid twice.
    this.releaseOre(asteroid, asteroid.ore, asteroid.amount,{x:asteroid.vx*BELT_MOTION.dropInheritance,y:asteroid.vy*BELT_MOTION.dropInheritance});
    asteroid.amount = 0; asteroid.health = 0;
    this.emitDebris(asteroid, { x: 1, y: -1 }, RESOURCES[asteroid.ore].color, asteroid.id);
    this.asteroids = this.asteroids.filter(a => a !== asteroid);
    this.world.destroy(id,asteroid);
    return true;
  }
  private pushOre(asteroid:Asteroid,damage:number,direction:Point){
    const length=Math.hypot(direction.x,direction.y);
    if(length<1e-8||damage<=0)return;
    const previousSpeed=Math.hypot(asteroid.vx,asteroid.vy),limit=Math.max(previousSpeed,ORE_COMBAT.maxShotSpeed);
    const mass=Math.max(1,(asteroid.radius/20)**2),impulse=damage*ORE_COMBAT.impulsePerDamage/mass;
    asteroid.vx+=direction.x/length*impulse;asteroid.vy+=direction.y/length*impulse;
    const speed=Math.hypot(asteroid.vx,asteroid.vy);
    if(speed>limit){asteroid.vx*=limit/speed;asteroid.vy*=limit/speed;}
  }
  private shootOre(asteroid: Asteroid, damage: number, point: Point, weapon?: WeaponKind, direction?: Point) {
    this.pushOre(asteroid,damage,direction??{x:asteroid.x-point.x,y:asteroid.y-point.y});
    const removed = mineMaterial(asteroid, damage * ORE_COMBAT.materialPerDamage, point);
    if (removed > 0) {
      const recovered = Math.floor((asteroid.shotYieldRemainder ?? 0) + removed * ORE_COMBAT.recovery + 1e-9);
      asteroid.shotYieldRemainder = (asteroid.shotYieldRemainder ?? 0) + removed * ORE_COMBAT.recovery - recovered;
      asteroid.wastedAmount = (asteroid.wastedAmount ?? 0) + removed - recovered;
      this.releaseOre(point, asteroid.ore, recovered,{x:asteroid.vx*BELT_MOTION.dropInheritance,y:asteroid.vy*BELT_MOTION.dropInheritance});
      this.emitDebris(point, { x: point.x - asteroid.x, y: point.y - asteroid.y }, RESOURCES[asteroid.ore].color, asteroid.id + asteroid.amount);
    }
    this.oreHits++; this.addBlast({ ...point, radius: 10, life: 0.1 },weapon);
    if (asteroid.amount <= 0) this.destroyAsteroid(asteroid.id);
  }
  private hitEnemy(enemy:Enemy,damage:number){
    if(enemy.health<=0||damage<=0)return;
    this.enemyHits++;this.damageEnemy(enemy,damage);if(enemy.health<=0)this.enemyDestroyed(enemy);
  }
  private arc(from:Point,to:Point,color:number){this.effect({type:'arc',...from,toX:to.x,toY:to.y,color});}
  private fragment(b:Bullet,point:Point){
    if(b.weapon!=='flak'||b.level!==5||b.fragment)return;
    const available=SPECIAL.flak.maxActive-this.bullets.filter(b=>b.fragment&&b.life>0).length;
    for(let i=0;i<Math.min(SPECIAL.flak.count,available);i++){
      const angle=Math.atan2(b.vy,b.vx)+(i===0?-.5:.5);
      this.bullets.push({id:this.id++,...point,vx:Math.cos(angle)*600,vy:Math.sin(angle)*600,life:1,age:0,enemy:false,damage:(b.damage??0)*SPECIAL.flak.fraction,weapon:'flak',level:5,fragment:true});
    }
  }
  private explodeRocket(bullet: Bullet, point: Point) {
    this.addBlast({ ...point, radius: bullet.splash ?? 65, life: 0.18 },bullet.weapon);
    for (const e of this.enemies) if (e.health > 0 && dist(e, point) <= (bullet.splash ?? 65) + ENEMIES[e.kind ?? 'raider'].radius) {
      this.hitEnemy(e,bullet.damage??65);
    }
    if(bullet.weapon==='plasma'&&bullet.level===5){
      if(this.novaFields.length>=SPECIAL.plasma.maxFields)this.novaFields.shift();
      this.novaFields.push({...point,radius:bullet.splash??95,life:SPECIAL.plasma.duration,damage:(bullet.damage??0)*SPECIAL.plasma.fraction});
    }
    for (const asteroid of [...this.asteroids]) if (dist(asteroid, point) < (bullet.splash ?? 65) + asteroid.radius) this.shootOre(asteroid, bullet.damage ?? 65, miningImpact(asteroid, point, asteroid),bullet.weapon,{x:asteroid.x-point.x,y:asteroid.y-point.y});
  }
  update(dt: number, input: Input) {
    this.blasts = this.blasts.filter(b => (b.life -= dt) > 0);
    for (const block of this.detachedModules) { block.x += block.vx * Math.min(dt, 0.05); block.y += block.vy * Math.min(dt, 0.05); block.life -= dt; }
    this.detachedModules = this.detachedModules.filter(block => block.life > 0);
    this.effects.length = 0;this.effectView=input.view;
    this.tractorLinks = []; this.miningLinks = [];
    this.minedTarget = undefined; this.miningPoint = undefined;
    if (this.dead) return;
    dt = Math.min(dt, 0.05);
    this.systemsDisabled=Math.max(0,this.systemsDisabled-dt);this.empImmunity=Math.max(0,this.empImmunity-dt);
    this.world.advance(dt);
    tick(this.coreAbility,dt);
    for(const m of this.modules)if(m.level>=5){const a=state(m);tick(a,dt);if(m.kind==='cannon')a.sustained=input.fire&&!this.atStation?a.sustained+dt:0;}
    if(input.overclock&&this.coreLevel>=5&&this.coreAbility.cooldown<=0&&this.operate(SPECIAL.core.power,SPECIAL.core.heat)){
      activate(this.coreAbility,SPECIAL.core.duration,SPECIAL.core.cooldown);this.effect({type:'shield',...this.player,color:CORE.color,radius:40});
    }
    for(const m of this.modules)if(m.kind==='cooler'&&onOverheat(m,this.heat,this.heatCapacity)){
      this.heat=Math.max(0,this.heat-this.heatCapacity*SPECIAL.cooler.fraction);this.effect({type:'shield',...this.modulePoint(m),color:MODULES.cooler.color,radius:45});
    }
    for(const m of this.modules)if(m.kind==='reactor'&&m.level>=5){
      if(onEnergyDeficit(m,this.energy,this.maxEnergy,this.powerDemand,this.basePowerGeneration))this.effect({type:'shield',...this.modulePoint(m),color:MODULES.reactor.color,radius:25});
      if(state(m).active>0){this.heat=Math.min(this.heatCapacity,this.heat+SPECIAL.reactor.heat*dt);}
    }
    this.shieldDelay = Math.max(0, this.shieldDelay - dt);
    this.energy = Math.min(this.maxEnergy, this.energy + this.powerGeneration * dt);
    this.heat = Math.max(0, this.heat - this.coolingRate * dt);
    this.powerLimited = false; this.heatLimited = false;
    if (this.shieldDelay <= 0 && this.shield < this.maxShield) for (const m of this.modules) if (m.kind === 'shield') {
      const stats = MODULES.shield.levels[m.level - 1], amount = Math.min(this.maxShield - this.shield, stats.recharge! * dt);
      const fraction = amount / stats.recharge!;
      if (this.operate((stats.power ?? 0) * fraction, (stats.heat ?? 0) * fraction)) this.shield += amount;
    }
    let engines=0,powered=0;
    for(const m of this.modules)if(m.kind==='engine'){
      engines++;const stats=MODULES.engine.levels[m.level-1];
      m.boostRemaining=Math.max(0,(m.boostRemaining??0)-dt);m.boostCooldown=Math.max(0,(m.boostCooldown??0)-dt);
      const activate=Boolean(input.boost&&m.level>=2&&m.boostCooldown<=0);
      const running=Boolean(input.x||input.y||m.boostRemaining>0||activate);
      if(!running||this.operate((running?(stats.power??0)*dt:0)+(activate?(stats.boostPower??0):0),(running?(stats.heat??0)*dt:0)+(activate?(stats.boostHeat??0):0))){
        powered++;
        if(activate){onBoost(m);m.boostRemaining=stats.boostDuration!;m.boostCooldown=stats.boostCooldown!;this.effect({type:'muzzle',...this.modulePoint(m),angle:this.player.angle+Math.PI,color:MODULES.engine.color});}
      }
    }
    this.engineRatio=engines?powered/engines:1;
    this.impactTimer=Math.max(0,this.impactTimer-dt);
    const p=this.player;
    let thrustX=input.x,thrustY=input.y;
    if(this.boostActive&&!thrustX&&!thrustY){const direction=Math.hypot(p.vx,p.vy)>1?Math.atan2(p.vy,p.vx):p.angle;thrustX=Math.cos(direction);thrustY=Math.sin(direction);}
    const length=Math.hypot(thrustX,thrustY)||1;
    if(thrustX||thrustY){
      p.vx+=thrustX/length*this.acceleration*dt;p.vy+=thrustY/length*this.acceleration*dt;
      const speed=Math.hypot(p.vx,p.vy);if(speed>this.maxSpeed){p.vx*=this.maxSpeed/speed;p.vy*=this.maxSpeed/speed;}
      p.x+=p.vx*dt;p.y+=p.vy*dt;
    }else{
      const decay=Math.exp(-SHIP.drag*dt);p.x+=p.vx*(1-decay)/SHIP.drag;p.y+=p.vy*(1-decay)/SHIP.drag;p.vx*=decay;p.vy*=decay;
    }
    const boundedX = clamp(p.x, 20, WORLD.width - 20);
    const boundedY = clamp(p.y, 20, WORLD.height - 20);
    if (boundedX !== p.x) p.vx = 0;
    if (boundedY !== p.y) p.vy = 0;
    p.x = boundedX; p.y = boundedY;
    p.angle = Math.atan2(input.aim.y - p.y, input.aim.x - p.x);
    if (input.fire && this.atStation) this.message = 'Weapons disabled inside active safe zones.';
    for (const m of this.modules) {
      m.cooldown = Math.max(0, m.cooldown - dt);
      const weapon=MODULES[m.kind].weapon;
      if (!input.fire || this.atStation || m.cooldown > 0 || !weapon) continue;
      const stats=MODULES[m.kind].levels[m.level-1],type=WEAPON_TYPES[weapon];
      if(!this.operate(stats.power??0,stats.heat??0)){if(m.ability)m.ability.sustained=0;continue;}
      const special=onFire(m);
      const source=this.modulePoint(m),angle=Math.atan2(input.aim.y-source.y,input.aim.x-source.x);
      this.effect({type:'muzzle',x:source.x+Math.cos(angle)*10,y:source.y+Math.sin(angle)*10,angle,weapon,level:m.level,color:type.color});
      if(weapon==='emp')this.empPulses.push({...source,radius:0,maxRadius:stats.empRange!,damage:stats.damage!,stun:stats.stun!,hits:[],cascade:m.level===5,secondary:0});
      else for(let pellet=0;pellet<type.pellets;pellet++){
        const direction=angle+(type.pellets>1?(pellet/(type.pellets-1)-.5)*type.spread:0);
        this.shoot(source,direction,false);
        const bullet=this.bullets[this.bullets.length-1];
        bullet.damage=stats.damage;bullet.weapon=weapon;bullet.level=m.level;bullet.splash=stats.splash;bullet.rocket=weapon==='rocket';
        if(special.penetrating){bullet.penetrating=SPECIAL.rail.targets;bullet.enhanced=true;bullet.hitIds=[];}
        bullet.vx=Math.cos(direction)*type.speed;bullet.vy=Math.sin(direction)*type.speed;
      }
      if(special.swarm){
        const available=SPECIAL.rocket.maxActive-this.bullets.filter(b=>b.guided&&b.life>0).length;
        for(let i=0;i<Math.min(available,SPECIAL.rocket.count);i++){
          const direction=angle+(i-1)*.24;this.shoot(source,direction,false);const b=this.bullets[this.bullets.length-1];
          Object.assign(b,{weapon:'rocket',level:5,rocket:true,guided:true,age:0,damage:stats.damage!*SPECIAL.rocket.fraction,splash:stats.splash!*.45,vx:Math.cos(direction)*WEAPON_TYPES.rocket.speed,vy:Math.sin(direction)*WEAPON_TYPES.rocket.speed});
        }
      }
      m.cooldown=stats.cooldown!/special.rate;
    }
    if(input.mine&&this.cargoUsed>=this.cargoCapacity)this.message='Cargo full. Unload at a base (E) or install another cargo hold (Q).';
    if (input.mine&&this.cargoUsed<this.cargoCapacity) {
      const candidates = this.asteroids.filter(a => dist(p, a) <= SHIP.miningRange).sort((a, b) => dist(p, a) - dist(p, b));
      const focused = candidates.find(a => dist(input.aim, a) <= a.radius + 35) ?? candidates[0];
      const assigned = new Set<number>();
      const beams = this.modulePositions('miner');
      const sources = beams.length ? beams.map(beam => ({ ...beam, moduleX:beam.gridX,moduleY:beam.gridY,rate: MODULES.miner.levels[beam.level - 1].mining! })) : [{ x: p.x, y: p.y, level: 1,moduleX:undefined,moduleY:undefined, rate: REPAIR.emergencyMining }];
      for (const source of sources) {
        const targets = [focused, ...candidates.filter(a => a !== focused)].filter((a): a is Asteroid => Boolean(a && a.amount > 0));
        const split = beams.length > 1 && this.coreLevel >= 2 && source.level >= 2;
        const target = (split ? targets.find(a => !assigned.has(a.id)) : targets[0]) ?? targets[0];
        if (!target) continue;
        assigned.add(target.id);
        const impact = miningImpact(target, source, target);
        const stats = MODULES.miner.levels[source.level - 1];
        const module=this.modules.find(m=>m.x===source.moduleX&&m.y===source.moduleY&&m.kind==='miner'),efficiency=source.level>=5?SPECIAL.miner.efficiency:1;
        if (beams.length && !this.operate((stats.power??0)*dt*efficiency,(stats.heat??0)*dt*efficiency)) continue;
        this.miningLinks.push({ from: { x: source.x, y: source.y }, to: impact, targetId: target.id, level:source.level,moduleX:source.moduleX,moduleY:source.moduleY });
        this.minedTarget ??= target; this.miningPoint ??= impact;
        const removed = mineMaterial(target, source.rate * dt+onMiningHit(module,dt), impact);
        if (removed > 0) {
          this.releaseOre(impact, target.ore, removed,{x:target.vx*BELT_MOTION.dropInheritance,y:target.vy*BELT_MOTION.dropInheritance});
          this.emitDebris(impact, { x: impact.x - target.x, y: impact.y - target.y }, RESOURCES[target.ore].color, target.id + target.amount);
        }
        if (target.amount <= 0) { this.destroyAsteroid(target.id); if (this.minedTarget === target) { this.minedTarget = undefined; this.miningPoint = undefined; } }
      }
    }
    for(const drop of this.drops){drop.x=clamp(drop.x+(drop.vx??0)*dt,0,WORLD.width);drop.y=clamp(drop.y+(drop.vy??0)*dt,0,WORLD.height);}
    const claimed = new Set<number>(), dropsById = new Map(this.drops.map(drop => [drop.id, drop]));
    for (const module of this.modules) if (module.kind === 'tractor') {
      const stats = MODULES.tractor.levels[module.level-1];
      const source = this.modulePoint(module), slots = stats.targets!;
      const sweep=module.level>=5&&((state(module).active>0)||(state(module).cooldown<=0));
      const range=stats.tractor!*(sweep?SPECIAL.tractor.rangeMultiplier:1);
      const ids = (module.targetIds ??= []);
      let count = 0;
      if (this.cargoUsed < this.cargoCapacity) for (const id of ids) {
        const drop = dropsById.get(id);
        if (drop && drop.amount > 0 && !claimed.has(id) && dist(source,drop) <= range && count < slots) { ids[count++] = id; claimed.add(id); }
      }
      ids.length = count;
      while (ids.length < slots && this.cargoUsed < this.cargoCapacity) {
        let nearest: Drop | undefined, distance = range;
        for (const drop of this.drops) if (drop.amount > 0 && !claimed.has(drop.id)) {
          const d = dist(source,drop); if (d <= distance) { nearest=drop;distance=d; }
        }
        if (!nearest) break; ids.push(nearest.id); claimed.add(nearest.id);
      }
      if (!ids.length) continue;
      if (!this.operate((stats.power??0)*dt,(stats.heat??0)*dt)) { for(const id of ids)claimed.delete(id); ids.length=0;continue; }
      if(module.level>=5&&activate(state(module),SPECIAL.tractor.duration,SPECIAL.tractor.cooldown))this.effect({type:'shield',...source,color:MODULES.tractor.color,radius:32});
      for (const id of ids) {
        const drop=dropsById.get(id)!; const distance=dist(source,drop),step=Math.min(distance,stats.pull!*dt);
        if(distance>0){drop.x+=(source.x-drop.x)/distance*step;drop.y+=(source.y-drop.y)/distance*step;}
        this.tractorLinks.push({from:source,to:{x:drop.x,y:drop.y},level:module.level,targetId:id,moduleX:module.x,moduleY:module.y});
        if(dist(source,drop)<=SHIP_SYSTEMS.collectionRadius) this.collectDrop(drop,source);
      }
    }
    for (const drop of this.drops) if (drop.amount > 0 && !claimed.has(drop.id) && dist(p,drop)<this.pickupRange) this.collectDrop(drop,p);
    this.drops = this.drops.filter(d => d.amount > 0);
    if (input.dock && this.atStation) {
      for (const ore of Object.keys(this.cargo) as Resource[]) { this.stored[ore] += this.cargo[ore]; this.cargo[ore] = 0; }
      if (this.repairShip()) this.message = 'Cargo stored. Ship repaired; minerals paid.';
      else this.message = 'Cargo stored. Insufficient minerals for repairs; check the shop (Q).';
    } else if (input.dock) { const outpost = this.dockAt(); if (outpost) this.dockAtOutpost(outpost); else this.message = 'Move within 220m of the green station, or to an outpost Docking station, to dock.'; }
    this.enemyHazards=[];
    this.enemyBeams=this.enemyBeams.filter(beam=>(beam.life-=dt)>0).slice(-12);
    const safe = this.atStation;
    // Announce when the player crosses into more dangerous space.
    const danger = this.danger;
    if (danger > this.lastDanger && !safe && !this.dead) this.message = `Entering ${DANGER.labels[danger - 1].toLowerCase()} threat space. Richer ore, stronger patrols.`;
    this.lastDanger = danger;
    this.updateHorde(dt, danger, safe);
    this.updateOutposts(dt);
    for(const site of this.bossSites)if(dist(p,site)>BOSS.wake+300)this.population.leaveTerritory(site.kind);
    for (const site of this.bossSites) if (this.population.canSpawnBoss(site.kind,this.world.time) && !site.defeated && dist(p, site) < BOSS.wake && !this.enemies.some(e => e.kind === site.kind)) this.spawnBoss(site);
    const visibleEnemies = new Set(this.enemies.filter(e => !safe && dist(e, p) <= ENEMIES[e.kind ?? 'raider'].detection && clearLineOfSight(e, p, this.asteroids)).map(e => e.id));
    const alertedSquads = new Set(this.enemies.filter(e => e.squad !== undefined && visibleEnemies.has(e.id)).map(e => e.squad));
    this.squads = this.squads.filter(squad => this.enemies.some(e => e.squad === squad.id));
    for (const squad of this.squads) {
      if (alertedSquads.has(squad.id)) continue;
      squad.angle += PATROL.turnRate * dt;const avoidance=avoidMovingOre(squad,squad.angle,this.asteroids,65)-squad.angle;squad.angle+=avoidance*dt;
      squad.x += Math.cos(squad.angle) * PATROL.speed * dt; squad.y += Math.sin(squad.angle) * PATROL.speed * dt;
      if (squad.x < 250 || squad.y < 250 || squad.x > WORLD.width - 250 || squad.y > WORLD.height - 250) { squad.angle += Math.PI / 2; squad.x = clamp(squad.x, 250, WORLD.width - 250); squad.y = clamp(squad.y, 250, WORLD.height - 250); }
      if (this.bases.some(base => base.unlocked && dist(squad, base) < BASE_RADIUS + 180)) squad.angle += dt * 2;
    }
    for (const e of this.enemies) {
      if(e.health<=0)continue;
      if ((e.disabledFor ?? 0) > 0) { e.disabledFor=Math.max(0,e.disabledFor!-dt);e.vx=0;e.vy=0;continue; }
      if(e.meltdown!==undefined&&!e.meltdownDone){e.meltdown-=dt;const blast=ENEMIES[e.kind??'raider'].boss!.meltdown!;e.empCharge=e.meltdown;if(e.meltdown<=0){e.meltdownDone=true;e.health=0;if(!safe&&dist(e,p)<blast.radius)this.damagePlayer(blast.damage);this.enemyDestroyed(e);}continue;}
      const previous = { x: e.x, y: e.y };
      const def = ENEMIES[e.kind ?? 'raider'], distance = dist(e, p); e.cooldown -= dt; e.cooldown2 = (e.cooldown2 ?? 0) - dt; e.cooldown3 = (e.cooldown3 ?? 0) - dt;
      if(def.industry && (!def.boss||!def.boss.parts.some(part=>ENEMIES[part.kind].role==='miner')||this.enemies.some(part=>part.parent===e.id&&part.health>0&&ENEMIES[part.kind??'raider'].role==='miner')) && !safe && (!visibleEnemies.has(e.id)||def.industry.combat||(e.memory??0)<=0)) {
        const industry=def.industry; e.cargo??={};e.industryClock=(e.industryClock??0)+dt;
        if(e.industryClock>=.5){const elapsed=Math.min(1,e.industryClock);e.industryClock=0;
          const carried=Object.values(e.cargo).reduce((sum,n)=>sum+(n??0),0);
          const rock=this.asteroids.filter(a=>a.amount>0&&dist(a,e)<industry.range+a.radius).sort((a,b)=>dist(a,e)-dist(b,e))[0];
          if(rock&&carried<industry.cargo){const impact=miningImpact(rock,e,rock),removed=mineMaterial(rock,Math.min(industry.rate*elapsed,industry.cargo-carried),impact);if(removed>0){if(this.enemyBeams.length>=12)this.enemyBeams.shift();this.enemyBeams.push({start:{x:e.x,y:e.y},end:impact,life:.22});}e.cargo[rock.ore]=(e.cargo[rock.ore]??0)+removed;if(rock.amount<=0)this.destroyAsteroid(rock.id);}
          for(const drop of this.drops)if(dist(drop,e)<def.radius+40&&drop.amount>0){const room=industry.cargo-Object.values(e.cargo).reduce((sum,n)=>sum+(n??0),0),amount=Math.min(drop.amount,Math.max(0,room));e.cargo[drop.ore]=(e.cargo[drop.ore]??0)+amount;drop.amount-=amount;}
          if(carried>=(industry.escapeAt??Infinity)){e.retreat=5;e.retreated=true;}
        }
      }
      if (e.shield === undefined) e.shield = def.shield;
      // Regional reinforcements arrive without a post; guards adopt the place they first appear.
      if (def.behavior === 'guard' && !e.home && !e.horde) e.home = { x: e.x, y: e.y };
      // A horde always knows where its prey is and never breaks off.
      if (e.horde && !safe) { e.lastSeen = { x: p.x, y: p.y }; e.memory = HORDE.memory; }
      e.shieldDelay = Math.max(0, (e.shieldDelay ?? 0) - dt);
      const powered = !def.boss || this.enemies.some(other => other.parent === e.id && other.health > 0 && ENEMIES[other.kind ?? 'raider'].shieldSource);
      if (powered && e.shieldDelay <= 0 && e.shield < def.shield) e.shield = Math.min(def.shield, e.shield + def.shieldRegen * dt);
      // Outpost raiders must finish their escape even beyond the normal AI activation distance.
      if(!e.raidParty&&dist(e,p)>BOSS.wake+800){e.vx=0;e.vy=0;continue;}
      if (def.boss && !e.phase2 && e.health < def.health * def.boss.phaseAt) {
        // Phase two: a heavier weapon set and a single call for reinforcements.
        e.phase2 = true; e.cooldown = 1.5; e.cooldown2 = 2.5; e.charge = undefined; this.cue('bossPhase', e, def.radius);
        this.addBlast({ x: e.x, y: e.y, radius: def.radius + 30, life: 0.3 });
        def.boss.reinforcements.forEach((kind, i) => { const angle = e.angle + Math.PI + (i - 1) * 0.6; this.spawnEnemy(kind, e.x + Math.cos(angle) * (def.radius + 160), e.y + Math.sin(angle) * (def.radius + 160), angle, { lastSeen: { x: p.x, y: p.y }, memory: ENEMY_AI.memory,faction:e.faction??def.faction }); });
        this.message = def.boss.reinforcements.length ? `${def.label} is damaged and calling reinforcements!` : `${def.label} is wounded and turning aggressive!`;
      }
      if (def.boss?.finalAt && e.phase2 && !e.phase3 && e.health < def.health * def.boss.finalAt) {
        e.phase3 = true; e.cooldown = 1.2; e.cooldown2 = 2; e.charge = undefined; this.cue('bossPhase', e, def.radius);
        this.addBlast({ x: e.x, y: e.y, radius: def.radius + 40, life: 0.35 });
        this.message = `${def.label} is critical: final attack pattern!`;
      }
      const visible = visibleEnemies.has(e.id), squad = this.squads.find(squad => squad.id === e.squad);
      if (def.boss?.surge && powered) {
        // Shield surge: a pause in the attack while the nodes pour power into the shield.
        if ((e.surge ?? 0) > 0) { e.surge = e.surge! - dt; e.shield = Math.min(def.shield, e.shield + def.boss.surge.rate * dt); }
        else if (visible) { e.surgeTimer = (e.surgeTimer ?? def.boss.surge.interval) - dt; if (e.surgeTimer <= 0) { e.surgeTimer = def.boss.surge.interval; e.surge = def.boss.surge.duration; e.charge = undefined; this.cue('surge', e); } }
      } else e.surge = 0;
      if (def.boss?.emp || def.emp) {
        // Area pulse with a warning ring: leave the ring before it fires.
        const emp = (def.boss?.emp ?? def.emp)!;
        if ((e.empCharge ?? 0) > 0) {
          e.empCharge = e.empCharge! - dt;
          if (e.empCharge <= 0) {
            this.effect({ type: 'explosion', x: e.x, y: e.y, radius: emp.radius, weapon: 'emp', color: WEAPON_TYPES.emp.color }); this.cue('emp', e, def.radius);
            if (!safe && !this.dead && distance < emp.radius) { this.damagePlayer(emp.damage); this.energy = Math.max(0, this.energy - emp.drain); if(emp.suppress&&this.empImmunity<=0){this.systemsDisabled=Math.min(1.2,emp.suppress);this.empImmunity=5;}this.message = 'EMP hit: systems recovering!'; }
          }
        } else if (visible) { e.empTimer = (e.empTimer ?? emp.interval) - dt; if (e.empTimer <= 0) { e.empTimer = emp.interval; e.empCharge = emp.charge; this.cue('empCharge', e); } }
      }
      if(def.boss?.hazards&&visible&&this.enemies.some(part=>part.parent===e.id&&part.health>0&&ENEMIES[part.kind??'raider'].role==='coil')){
        const h=def.boss.hazards,phase=(e.clock??0)%h.cycle,active=phase>=h.charge&&phase<h.charge+h.active;
        if(phase<h.charge+h.active)for(let i=0;i<h.count;i++){const angle=(e.clock??0)*h.speed+i*Math.PI*2/h.count,point={x:e.x+Math.cos(angle)*h.radius,y:e.y+Math.sin(angle)*h.radius};this.enemyHazards.push({...point,radius:h.size,active,progress:Math.min(1,phase/h.charge)});if(active&&!safe&&dist(point,p)<h.size+SHIP.radius)this.damagePlayer(h.damage*dt,point,e.id);}
      }
      if (def.part) {
        // Mounted component: rides its boss, aims and fires on its own, and dies with the boss.
        const parent = this.enemies.find(other => other.id === e.parent);
        if (!parent || parent.health <= 0) { e.health = 0; continue; }
        if (def.weakPoint) e.health = def.health;
        const cos = Math.cos(parent.angle), sin = Math.sin(parent.angle), mount = e.mount ?? { x: 0, y: 0 };
        e.x = parent.x + cos * mount.x - sin * mount.y; e.y = parent.y + sin * mount.x + cos * mount.y; e.vx = parent.vx; e.vy = parent.vy;
        e.state = visible ? 'attack' : 'patrol';
        const aim = Math.atan2(p.y - e.y, p.x - e.x);
        if (visible && def.weapons.length) this.enemyFire(e, def, 'attack', true, dist(e, p), aim, aim, dt); else e.angle = parent.angle;
        continue;
      }
      if(def.industry&&!def.industry.combat&&(e.memory??0)<=0&&(e.retreat??0)<=0){
        const drop=this.drops.filter(d=>d.amount>0&&dist(d,e)<900).sort((a,b)=>dist(a,e)-dist(b,e))[0];
        const rock=this.asteroids.filter(a=>a.amount>0&&dist(a,e)<1100).sort((a,b)=>dist(a,e)-dist(b,e))[0];const goal=drop??rock;
        if(goal){e.state=drop?'collect':'mine';const stop=drop?def.radius+25:Math.max((rock?.radius??0)+def.radius+20,def.industry.range*.6);const heading=avoidMovingOre(e,Math.atan2(goal.y-e.y,goal.x-e.x),this.asteroids,def.radius,true);e.angle=heading;if(dist(e,goal)>stop){const step=Math.min(def.speed*.6*dt,dist(e,goal)-stop);e.x+=Math.cos(heading)*step;e.y+=Math.sin(heading)*step;}e.vx=(e.x-previous.x)/dt;e.vy=(e.y-previous.y)/dt;continue;}
      }
      // Memory: the last place the player was seen, shared across an alerted squad, fades after ENEMY_AI.memory seconds.
      const shared = !safe && e.squad !== undefined && alertedSquads.has(e.squad) && distance < def.detection * PATROL.sharedDetectionMultiplier;
      if (visible || shared) { e.lastSeen = { x: p.x, y: p.y }; e.memory = ENEMY_AI.memory; }
      else if (e.lastSeen) { e.memory = (e.memory ?? 0) - dt; if (safe || e.memory <= 0 || dist(e, e.lastSeen) < ENEMY_AI.arrive) e.lastSeen = undefined; }
      e.clock = (e.clock ?? 0) + dt; e.retreat = Math.max(0, (e.retreat ?? 0) - dt); e.reposition = Math.max(0, (e.reposition ?? 0) - dt);
      // Guards give up the chase once the player leaves their territory.
      const leashed = def.leash !== undefined && e.home !== undefined && dist(e.home, p) > def.leash;
      // Fragile classes break off once when badly damaged, then come back to finish the fight.
      if (visible && !leashed && !e.horde && !e.retreated && def.retreatAt > 0 && e.health < (e.maxHealth??def.health) * def.retreatAt) { e.retreated = true; e.retreat = ENEMY_AI.retreatTime; }
      if (e.retreat > 0 && distance > def.detection * 1.2) e.retreat = 0;
      const slotForward = e.slot === 0 ? 0 : -PATROL.spacing, slotSide = e.slot === 0 ? 0 : (e.slot === 1 ? -1 : 1) * PATROL.spacing;
      const ally=def.support?this.enemies.filter(other=>other!==e&&other.health>0&&(other.faction??ENEMIES[other.kind??'raider'].faction)===(e.faction??def.faction)&&!ENEMIES[other.kind??'raider'].part&&(ENEMIES[other.kind??'raider'].boss||ENEMIES[other.kind??'raider'].radius>def.radius)&&dist(other,e)<1000).sort((a,b)=>dist(a,e)-dist(b,e))[0]:undefined;
      const post = ally?{x:ally.x-Math.cos(ally.angle)*150,y:ally.y-Math.sin(ally.angle)*150}:squad ? { x: squad.x + Math.cos(squad.angle) * slotForward - Math.sin(squad.angle) * slotSide, y: squad.y + Math.sin(squad.angle) * slotForward + Math.cos(squad.angle) * slotSide } : e.home;
      const reloading = def.behavior === 'reload' && e.cooldown > 1;
      const previousState = e.state, state = e.state = nextEnemyState({ visible, remembers: e.lastSeen !== undefined, inRange: distance < def.range, leashed, awayFromPost: post !== undefined && dist(e, post) > ENEMY_AI.postRadius,
        guard: def.behavior === 'guard', strafes: ENEMY_AI.strafe[def.behavior] >= 0.45, reloading, retreating: e.retreat > 0, repositioning: e.reposition > 0 });
      if (visible && !def.part && (previousState === undefined || previousState === 'patrol' || previousState === 'return' || previousState === 'investigate') && state !== 'patrol' && state !== 'return' && state !== 'investigate') this.cue('alert', e, def.radius);
      const engaged = state !== 'patrol' && state !== 'return';
      if (!engaged && !safe && this.outposts.length && this.raidOutpost(e, def, dt)) { e.vx = dt > 0 ? (e.x - previous.x) / dt : 0; e.vy = dt > 0 ? (e.y - previous.y) / dt : 0; continue; }
      if (!engaged) { e.sx = 0; e.sy = 0; e.charge = undefined; e.stuck = 0; }
      if (engaged) {
        const goal = state === 'investigate' && e.lastSeen ? e.lastSeen : p, toGoal = Math.atan2(goal.y - e.y, goal.x - e.x), toPlayer = Math.atan2(p.y - e.y, p.x - e.x);
        const holds = def.behavior === 'hold' || def.behavior === 'guard', flip = Math.floor((e.clock + e.id % 5) / ENEMY_AI.strafeFlip) % 2 ? 1 : -1;
        const side = (e.id % 2 ? 1 : -1) * (state === 'strafe' ? flip : 1) * (e.sidestep ?? 1);
        let radial = 0, strafe = 0, pace = def.speed;
        if(def.boss?.parts.some(part=>ENEMIES[part.kind].role==='engine')&&!this.enemies.some(part=>part.parent===e.id&&part.health>0&&ENEMIES[part.kind??'raider'].role==='engine'))pace*=.55;
        if (state === 'chase') { radial = 1; strafe = 0.15; }
        else if (state === 'investigate') { radial = 1; pace *= ENEMY_AI.investigatePace; }
        else if (state === 'retreat') { radial = -1; strafe = 0.25; }
        else if (state === 'reposition' && e.reposition > 0) { radial = 0.2; strafe = 1; }
        else if (state === 'reposition') { radial = -1; strafe = 0.5; }
        else { radial = distance > def.stop + 40 ? 1 : distance < def.stop - 60 && !holds ? -1 : 0; strafe = ENEMY_AI.strafe[def.behavior]; }
        if (e.phase2 && def.boss?.phaseSpeed) pace *= def.boss.phaseSpeed;
        if (e.charge) { strafe = 0; pace *= 0.25; }
        let mx = Math.cos(toGoal) * radial - Math.sin(toGoal) * strafe * side, my = Math.sin(toGoal) * radial + Math.cos(toGoal) * strafe * side;
        if (state === 'defend' && e.home && def.leash !== undefined) {
          // Defenders fight from inside their territory instead of being drawn away from it.
          const away = dist(e, e.home);
          if (away > def.leash * 0.6) { mx += (e.home.x - e.x) / away * 1.2; my += (e.home.y - e.y) / away * 1.2; }
        }
        for (const other of this.enemies) {
          const gap = other === e || def.boss || other.parent === e.id || ENEMIES[other.kind ?? 'raider'].part ? 0 : dist(e, other);
          if (gap > 0 && gap < ENEMY_AI.spacing) { const push = (1 - gap / ENEMY_AI.spacing) * 1.5; mx += (e.x - other.x) / gap * push; my += (e.y - other.y) / gap * push; }
        }
        for (const rock of this.asteroids) {
          const clear = rock.radius + def.radius + ENEMY_AI.avoid, gap = Math.abs(rock.x - e.x) < clear && Math.abs(rock.y - e.y) < clear ? dist(e, rock) : 0;
          if (gap > 0 && gap < clear) {
            // Push away from the rock and slide around it on whichever side is already closer to the goal.
            const push = (1 - gap / clear) * 2.5, awayX = (e.x - rock.x) / gap, awayY = (e.y - rock.y) / gap, cross = Math.cos(toGoal) * awayY - Math.sin(toGoal) * awayX;
            const turn = Math.abs(cross) > 0.05 ? Math.sign(cross) : side;
            mx += (awayX + awayY * turn * 0.9) * push; my += (awayY - awayX * turn * 0.9) * push;
          }
        }
        const length = Math.hypot(mx, my);
        if (length > 1) { mx /= length; my /= length; }
        // Blocked while trying to move: sidestep the other way for a moment instead of grinding against the obstacle.
        const wanted = Math.hypot(e.sx ?? 0, e.sy ?? 0), actual = dt > 0 && e.px !== undefined && e.py !== undefined ? Math.hypot(e.x - e.px, e.y - e.py) / dt : wanted;
        e.stuck = wanted > 40 && actual < wanted * 0.3 ? (e.stuck ?? 0) + dt : Math.max(0, (e.stuck ?? 0) - dt);
        if (e.stuck > ENEMY_AI.stuckTime) { e.stuck = 0; e.reposition = ENEMY_AI.repositionTime; e.sidestep = -(e.sidestep ?? 1); }
        e.px = e.x; e.py = e.y;
        const ax = mx * pace - (e.sx ?? 0), ay = my * pace - (e.sy ?? 0), change = Math.hypot(ax, ay), limit = def.accel * dt, k = change > limit ? limit / change : 1;
        e.sx = (e.sx ?? 0) + ax * k; e.sy = (e.sy ?? 0) + ay * k;
        e.x = clamp(e.x + e.sx * dt, 30, WORLD.width - 30); e.y = clamp(e.y + e.sy * dt, 30, WORLD.height - 30);
        this.enemyFire(e, def, state, visible, distance, toPlayer, toGoal, dt);
      } else if (squad) {
        const forward = e.slot === 0 ? 0 : -PATROL.spacing, side = e.slot === 0 ? 0 : (e.slot === 1 ? -1 : 1) * PATROL.spacing;
        const target = { x: squad.x + Math.cos(squad.angle) * forward - Math.sin(squad.angle) * side, y: squad.y + Math.sin(squad.angle) * forward + Math.cos(squad.angle) * side };
        const distance = dist(e, target), step = Math.min(distance, def.speed * 0.8 * dt);
        if (distance > 0) { const travel=avoidMovingOre(e,Math.atan2(target.y-e.y,target.x-e.x),this.asteroids,def.radius);e.x+=Math.cos(travel)*step;e.y+=Math.sin(travel)*step; }
        e.angle = squad.angle;
      } else {
        e.patrolAngle = e.home && dist(e, e.home) > 220 ? Math.atan2(e.home.y - e.y, e.home.x - e.x) : (e.patrolAngle ?? e.angle) + dt * 0.2; e.angle = e.patrolAngle;
        e.x += Math.cos(e.angle) * def.speed * 0.4 * dt; e.y += Math.sin(e.angle) * def.speed * 0.4 * dt;
        if (e.x < 30 || e.y < 30 || e.x > WORLD.width - 30 || e.y > WORLD.height - 30) e.patrolAngle += Math.PI / 2;
        e.x = clamp(e.x, 30, WORLD.width - 30); e.y = clamp(e.y, 30, WORLD.height - 30);
      }
      for (const base of this.bases) if (base.unlocked) {
        const distance = dist(e, base), boundary = BASE_RADIUS + def.radius + 15;
        if (distance < boundary) {
          const nx = distance > 0 ? (e.x - base.x) / distance : 1, ny = distance > 0 ? (e.y - base.y) / distance : 0;
          e.x = base.x + nx * boundary; e.y = base.y + ny * boundary;
        }
      }
      e.vx = dt > 0 ? (e.x - previous.x) / dt : 0; e.vy = dt > 0 ? (e.y - previous.y) / dt : 0;
    }
    this.resolveContacts(dt);
    this.revealExploration();
    if (this.streaming) this.asteroids = this.world.activate(p, this.asteroids);
    for (const asteroid of this.asteroids) if (this.isExplored(asteroid)) this.world.surveyed.set(asteroid.id, { id: asteroid.id, x: asteroid.x, y: asteroid.y, ore: asteroid.ore });
    for(const pulse of this.empPulses){
      pulse.radius=Math.min(pulse.maxRadius,pulse.radius+WEAPON_TYPES.emp.speed*dt);
      for(const enemy of this.enemies)if(enemy.health>0&&!pulse.hits.includes(enemy.id)&&dist(enemy,pulse)<=pulse.radius+ENEMIES[enemy.kind??'raider'].radius){
        pulse.hits.push(enemy.id);if(!ENEMIES[enemy.kind??'raider'].boss)enemy.disabledFor=Math.max(enemy.disabledFor??0,pulse.stun);this.hitEnemy(enemy,pulse.damage);
        this.effect({type:'impact',x:enemy.x,y:enemy.y,weapon:'emp',radius:20,color:WEAPON_TYPES.emp.color});
        if(pulse.cascade&&(pulse.secondary??0)<SPECIAL.emp.maxSecondary){
          const nearby=this.enemies.filter(e=>e!==enemy&&e.health>0&&!pulse.hits.includes(e.id)&&dist(e,enemy)<=SPECIAL.emp.range).sort((a,b)=>dist(a,enemy)-dist(b,enemy));
          for(const secondary of nearby.slice(0,SPECIAL.emp.maxSecondary-(pulse.secondary??0))){
            pulse.secondary=(pulse.secondary??0)+1;pulse.hits.push(secondary.id);secondary.disabledFor=Math.max(secondary.disabledFor??0,pulse.stun*SPECIAL.emp.stunFraction);
            this.hitEnemy(secondary,pulse.damage*SPECIAL.emp.fraction);this.arc(enemy,secondary,MODULES.emp.color);
          }
        }
      }
    }
    this.empPulses=this.empPulses.filter(pulse=>pulse.radius<pulse.maxRadius);
    for(const e of this.enemies)if(e.health>0){
      let damage=0;for(const field of this.novaFields)if(dist(e,field)<=field.radius+ENEMIES[e.kind??'raider'].radius)damage=Math.max(damage,field.damage*Math.min(dt,field.life));
      this.hitEnemy(e,damage);
    }
    this.novaFields=this.novaFields.filter(field=>(field.life-=dt)>0);
    for (const b of [...this.bullets]) {
      if (b.life <= 0) continue;
      if(b.guided||b.fragment){b.age=(b.age??0)+dt;if(b.age>(b.guided?SPECIAL.rocket.lifetime:SPECIAL.flak.lifetime)){b.life=0;continue;}}
      if(b.guided){
        const target=this.enemies.filter(e=>e.health>0&&dist(e,b)<=SPECIAL.rocket.range).sort((a,c)=>dist(a,b)-dist(c,b))[0];
        if(target){const angle=Math.atan2(b.vy,b.vx),desired=Math.atan2(target.y-b.y,target.x-b.x),difference=Math.atan2(Math.sin(desired-angle),Math.cos(desired-angle)),next=angle+clamp(difference,-SPECIAL.rocket.turnRate*dt,SPECIAL.rocket.turnRate*dt),speed=Math.hypot(b.vx,b.vy);b.vx=Math.cos(next)*speed;b.vy=Math.sin(next)*speed;}
      }
      if (b.homing && b.enemy && !this.dead) {
        // Guided missiles turn toward the player at a limited rate, so they can be out-turned or blocked.
        const speed = Math.hypot(b.vx, b.vy), current = Math.atan2(b.vy, b.vx), wanted = Math.atan2(p.y - b.y, p.x - b.x) - current;
        const heading = current + clamp(Math.atan2(Math.sin(wanted), Math.cos(wanted)), -b.homing * dt, b.homing * dt);
        b.vx = Math.cos(heading) * speed; b.vy = Math.sin(heading) * speed;
      }
      const start = { x: b.x, y: b.y }; b.x += b.vx * dt; b.y += b.vy * dt;
      const view = input.view ?? { x: 0, y: 0, width: WORLD.width, height: WORLD.height }, margin = b.enemy || b.turret ? ENEMY_AI.shotMargin : 12;
      if (b.x < view.x - margin || b.y < view.y - margin || b.x > view.x + view.width + margin || b.y > view.y + view.height + margin) { b.life = 0; continue; }
      if (b.enemy && this.outposts.length) {
        // Hostile fire is stopped by, and damages, finished outpost blocks. The player's own shots pass over them.
        const struck = structureOnSegment(this.outposts, start, b);
        if (struck) { b.life = 0; this.effect({ type: 'impact', ...struck.point, radius: 12, color: 0xffb070, weapon: b.weapon }); this.damageStructure(struck.outpost, struck.structure, b.damage ?? WEAPONS.enemy.damage, b.attackerId); continue; }
      }
      for(let hit=0;hit<(b.enhanced?SPECIAL.rail.targets:1);hit++){
      let oreHit: { asteroid: Asteroid; point: Point; t: number } | undefined;
      for (const asteroid of this.asteroids) {
        if (segmentCircleHit(start, b, asteroid, asteroid.radius + 4) === undefined) continue;
        const shape = ensureAsteroidGeometry(asteroid);
        const local = segmentPolygonHit(shape, asteroidLocal(asteroid,start),asteroidLocal(asteroid,b));
        if (local && (!oreHit || local.t < oreHit.t)) oreHit = { asteroid, point: asteroidWorld(asteroid,local), t: local.t };
      }
      let target: Enemy | undefined, targetT = Infinity;
      if (b.enemy) {
        if (!this.atStation) {
          targetT = segmentCircleHit(start, b, p, SHIP.radius + 4) ?? Infinity;
          for (const kind of Object.keys(MODULES) as ModuleKind[]) for (const block of this.modulePositions(kind)) targetT = Math.min(targetT, segmentCircleHit(start, b, block, 12) ?? Infinity);
        }
      } else for (const e of this.enemies) if (e.health > 0&&!b.hitIds?.includes(e.id)) {
        const t = segmentCircleHit(start, b, e, ENEMIES[e.kind ?? 'raider'].radius + (b.rocket ? 7 : 4));
        if (t !== undefined && t < targetT) { target = e; targetT = t; }
      }
      if (oreHit && oreHit.t <= targetT) {
        b.life = 0;this.fragment(b,oreHit.point);
        if(b.enemy&&(b.splash??0)>0)this.enemyExplosion(b,oreHit.point);else if ((b.splash ?? 0)>0) this.explodeRocket(b, oreHit.point); else this.shootOre(oreHit.asteroid, b.damage ?? (b.enemy ? WEAPONS.enemy.damage : WEAPONS.player.damage), oreHit.point,b.weapon,{x:b.vx,y:b.vy});
      } else if (Number.isFinite(targetT)) {
        b.life = 0; const point = { x: start.x + (b.x - start.x) * targetT, y: start.y + (b.y - start.y) * targetT };
        this.fragment(b,point);
        if (b.enemy) {if((b.splash??0)>0)this.enemyExplosion(b,point);else this.damagePlayer(b.damage ?? WEAPONS.enemy.damage, point,b.attackerId);}
        else if ((b.splash ?? 0)>0) this.explodeRocket(b, point);
        else if (target) {
          this.hitEnemy(target,b.damage??WEAPONS.player.damage);
          const chain=onHit(b,target,this.enemies);if(chain){this.hitEnemy(chain.target,chain.damage);this.arc(target,chain.target,MODULES.pulse.color);}
          if(b.enhanced){(b.hitIds??=[]).push(target.id);b.penetrating=(b.penetrating??1)-1;b.damage=(b.damage??0)*SPECIAL.rail.falloff;if(b.penetrating>0)b.life=1;}
          this.addBlast({ ...point, radius: b.weapon==='rail'?35:12, life: 0.1 },b.weapon);
        }
      } else break;
      if(b.life<=0)break;
      }
    }
    for(const b of this.bullets)if(b.enemy&&b.life<=0&&this.enemyBulletPool.length<256)this.enemyBulletPool.push(b);
    this.bullets = this.bullets.filter(b => b.life > 0); this.enemies = this.enemies.filter(e => e.health > 0);
    const moduleMap=new Map(this.modules.map(m=>[`${m.x},${m.y}`,m])),remainingDrops=new Map(this.drops.map(d=>[d.id,d])),remainingOre=new Map(this.asteroids.map(a=>[a.id,a]));
    this.tractorLinks=this.tractorLinks.filter(link=>{
      const module=moduleMap.get(`${link.moduleX},${link.moduleY}`),drop=remainingDrops.get(link.targetId);
      if(module?.kind!=='tractor'||!drop)return false;
      link.from=this.modulePoint(module);link.to={x:drop.x,y:drop.y};return true;
    });
    this.miningLinks=this.miningLinks.filter(link=>{
      const module=link.moduleX===undefined?undefined:moduleMap.get(`${link.moduleX},${link.moduleY}`),ore=remainingOre.get(link.targetId);
      if(!ore||(link.moduleX!==undefined&&module?.kind!=='miner'))return false;
      link.from=module?this.modulePoint(module):{x:p.x,y:p.y};link.to=miningImpact(ore,link.from,ore);return true;
    });
    this.minedTarget=this.miningLinks.length?remainingOre.get(this.miningLinks[0].targetId):undefined;this.miningPoint=this.miningLinks[0]?.to;
    this.spawnTimer-=dt;if(this.spawnTimer<=0){this.updatePopulation(input.view);this.spawnTimer=POPULATION.tick;}

    if (this.dead) {
      this.deaths++;
      for (const ore of Object.keys(this.cargo) as Resource[]) { if (this.cargo[ore]) this.drops.push({ id: this.id++, x: p.x, y: p.y, ore, amount: this.cargo[ore] }); this.cargo[ore] = 0; }
      this.message = 'Ship destroyed. Press R to respawn at the station. Stored resources are safe.';
    }
  }
}



export type GameSave = {
  systemsDisabled?:number;empImmunity?:number;version: 1; seed: string; population?:EnemyPopulationSnapshot;world: WorldSnapshot; player: GameModel['player']; modules: ShipModule[];
  coreAbility?:AbilityState;novaFields?:GameModel['novaFields'];coreLevel: number; shield: number; energy?:number; heat?:number; empPulses?:GameModel['empPulses']; cargo: Record<Resource, number>; stored: Record<Resource, number>;
  bases: GameModel['bases']; explored: string[]; enemies: Enemy[]; squads: GameModel['squads']; drops: Drop[];
  bullets: Bullet[]; detachedModules: GameModel['detachedModules']; kills: number; outposts?: Outpost[]; horde?: GameModel['horde']; deaths: number; id: number; rng: number;
  spawnTimer: number; shieldDelay: number; impactTimer: number;
};
