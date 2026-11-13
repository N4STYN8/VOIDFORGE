import { SPECIAL } from './abilityConfig.ts';
import { freshAbility,state,tick,activate,onFire,onHit,onMiningHit,onDamageTaken,onBoost,onEnergyDeficit,onOverheat,type AbilityState } from './abilities.ts';
import { ChunkWorld, SeedRandom, randomWorldSeed, type WorldSnapshot } from './world.ts';
import { segmentPolygonHit, segmentCircleHit } from './asteroidGeometry.ts';
import { clearLineOfSight } from './enemyAI.ts';
import { ensureAsteroidGeometry, miningImpact, mineMaterial, type Asteroid } from './mining.ts';
export type { Asteroid } from './mining.ts';
import type { EffectEvent } from './effectEvents.ts';
import { collideAsteroid, collide, type Body } from './collisions.ts';
import { WORLD, SHIP, WEAPONS, ENEMIES, COLLISION, ORE_COMBAT, PATROL, MODULE_DURABILITY, REPAIR, MODULES, BUILD_GRID, BASES, BASE_RADIUS, EXPLORATION, RESOURCES, type EnemyKind, CORE, ROCKET, WEAPON_TYPES, SHIP_SYSTEMS, VFX, type WeaponKind, equipment, upgradeCost, type EquipmentStats, type EquipmentKind, type ModuleKind, type Resource } from './data.ts';
export type ShipModule = { x: number; y: number; kind: ModuleKind; level: number; cooldown: number; integrity: number; ability?:AbilityState; targetIds?: number[]; boostRemaining?:number; boostCooldown?:number };
export type Point = { x: number; y: number };
export type Input = { x: number; y: number; aim: Point; fire: boolean; mine: boolean; dock: boolean; boost?:boolean; overclock?:boolean; view?: { x: number; y: number; width: number; height: number } };
export type Enemy = Point & { disabledFor?: number; vx?: number; vy?: number; impactCooldown?: number; kind?: EnemyKind; squad?: number; slot?: number; patrolAngle?: number; id: number; health: number; cooldown: number; angle: number };
export type Drop = Point & { id: number; ore: Resource; amount: number };
export type Bullet = Point & { id: number; vx: number; vy: number; life: number; enemy: boolean; damage?: number; rocket?: boolean; splash?: number; weapon?: WeaponKind; level?: number; attackerId?:number; penetrating?:number; hitIds?:number[]; enhanced?:boolean; guided?:boolean; fragment?:boolean; age?:number };
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
export class GameModel {
  player = { x: WORLD.stationX, y: WORLD.stationY + 130, vx: 0, vy: 0, health: SHIP.health, angle: -Math.PI / 2 };
  modules: ShipModule[] = [{ x: 1, y: 0, kind: 'cannon', level: 1, cooldown: 0, integrity: 45 }, { x: 0, y: -1, kind: 'miner', level: 1, cooldown: 0, integrity: 40 }];
  squads: (Point & { id: number; angle: number })[] = [];
  bases = BASES.map((base, i) => ({ ...base, unlocked: i === 0 }));
  explored = new Set<string>();
  detachedModules: (Point & { vx: number; vy: number; kind: ModuleKind; level: number; angle: number; life: number })[] = [];
  energy = 100;
  heat = 0;
  powerLimited = false;
  heatLimited = false;
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
  blasts: (Point & { radius: number; life: number })[] = [];
  cargo: Record<Resource, number> = { iron: 0, copper: 0, crystal: 0, ice: 0, radioactive: 0 };
  stored: Record<Resource, number> = { iron: 0, copper: 0, crystal: 0, ice: 0, radioactive: 0 };
  asteroids: Asteroid[] = []; enemies: Enemy[] = []; drops: Drop[] = []; bullets: Bullet[] = [];
  miningLinks: { from: Point; to: Point; targetId: number; level: number; moduleX?:number; moduleY?:number }[] = [];
  tractorLinks: { from: Point; to: Point; level: number; targetId: number; moduleX:number; moduleY:number }[] = [];
  miningPoint: Point | undefined;
  minedTarget: Asteroid | undefined; oreHits = 0; enemyHits = 0; kills = 0; deaths = 0; message = 'Welcome, pilot. Mine nearby asteroids and unload at the station.';
  private id = 1000000000; private impactTimer = 0; private spawnTimer = 12;
  readonly seed: string;
  readonly world: ChunkWorld;
  private rng: SeedRandom;
  private streaming: boolean;
  private random: () => number;
  constructor(seed = randomWorldSeed(), options: { streaming?: boolean; world?: WorldSnapshot } = {}) {
    this.seed = seed; this.world = new ChunkWorld(seed, options.world);
    this.rng = new SeedRandom(seed + ':simulation'); this.random = this.rng.next;
    this.streaming = options.streaming ?? true;
    this.bases = this.world.spec.bases.map((base, i) => ({ ...base, unlocked: i === 0 }));
    const home = this.bases[0], angle = this.world.spec.exitAngle;
    this.player.x = home.x + Math.cos(angle) * 130; this.player.y = home.y + Math.sin(angle) * 130;
    this.player.angle = angle;
    this.asteroids = this.world.activate(this.player, [], true);
    for (let i = 0; i < 5; i++) this.addEnemy();
    this.addPatrolGroup(); this.revealExploration();
  }
  get chartedAsteroids() { return [...this.world.surveyed.values()]; }
  toSave(): GameSave {
    return { version: 1, seed: this.seed, world: this.world.snapshot(this.asteroids),
      player: { ...this.player }, modules: structuredClone(this.modules), coreAbility:{...this.coreAbility},novaFields:structuredClone(this.novaFields), coreLevel: this.coreLevel, shield: this.shield, energy: this.energy, heat: this.heat, empPulses: structuredClone(this.empPulses),
      cargo: { ...this.cargo }, stored: { ...this.stored }, bases: structuredClone(this.bases), explored: [...this.explored],
      enemies: structuredClone(this.enemies), squads: structuredClone(this.squads), drops: structuredClone(this.drops), bullets: structuredClone(this.bullets), detachedModules: structuredClone(this.detachedModules),
      kills: this.kills, deaths: this.deaths, id: this.id, rng: this.rng.state, spawnTimer: this.spawnTimer, shieldDelay: this.shieldDelay, impactTimer: this.impactTimer };
  }
  static fromSave(value: unknown) {
    const data = value as GameSave;
    if (!data || data.version !== 1 || typeof data.seed !== 'string' || !data.world || data.world.spec?.version !== 1 || data.world.spec.seed !== data.seed || !data.player || !Number.isFinite(data.player.x) || !Number.isFinite(data.player.y) || !Array.isArray(data.modules) || !Array.isArray(data.bases) || data.bases.length !== BASES.length || !Array.isArray(data.explored) || !Array.isArray(data.world.changes) || !Array.isArray(data.world.surveyed)) throw new Error('Unsupported or invalid save file.');
    const m = new GameModel(data.seed, { world: data.world });
    if (!Number.isInteger(data.coreLevel) || data.coreLevel<1 || data.coreLevel>CORE.levels.length || data.modules.some(block => !MODULES[block.kind] || !Number.isInteger(block.level) || block.level < 1 || block.level > MODULES[block.kind].levels.length || !Number.isFinite(block.integrity))) throw new Error('Invalid ship data in save.');
    m.coreAbility={...freshAbility(),...data.coreAbility};m.novaFields=structuredClone(data.novaFields??[]).slice(-SPECIAL.plasma.maxFields);
    m.player = { ...data.player }; m.modules = structuredClone(data.modules); m.coreLevel = data.coreLevel; m.shield = data.shield; m.energy = Math.max(0,Math.min(data.energy ?? m.maxEnergy,m.maxEnergy)); m.heat = data.heat ?? 0; m.empPulses = structuredClone(data.empPulses ?? []);
    const empty = () => Object.fromEntries((Object.keys(RESOURCES) as Resource[]).map(ore => [ore, 0])) as Record<Resource, number>;
    m.cargo = { ...empty(), ...data.cargo }; m.stored = { ...empty(), ...data.stored };
    if ([...Object.values(m.cargo), ...Object.values(m.stored)].some(n => !Number.isFinite(n) || n < 0)) throw new Error('Invalid resource quantities in save.');
    m.bases = structuredClone(data.bases); m.explored = new Set(data.explored);
    m.enemies = structuredClone(data.enemies ?? []); m.squads = structuredClone(data.squads ?? []); m.drops = structuredClone(data.drops ?? []); m.bullets = structuredClone(data.bullets ?? []); m.detachedModules = structuredClone(data.detachedModules ?? []);
    m.kills = data.kills; m.deaths = data.deaths; m.id = data.id; m.rng.state = data.rng; m.spawnTimer = data.spawnTimer; m.shieldDelay = data.shieldDelay; m.impactTimer = data.impactTimer;
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
    if(this.coreLevel>=5&&this.coreAbility.active>0){energy*=SPECIAL.core.costMultiplier;heat*=SPECIAL.core.costMultiplier;}
    if (this.energy + 1e-8 < energy) { this.powerLimited = true; return false; }
    if (this.heat + heat > this.heatCapacity + 1e-8) { this.heatLimited = true; return false; }
    this.energy = Math.max(0, this.energy - energy); this.heat = Math.min(this.heatCapacity, this.heat + heat); return true;
  }
  private effectView?: Input['view'];
  private effect(event: EffectEvent) {
    const v=this.effectView,margin=VFX.visibleMargin;
    if(v&&(event.x<v.x-margin||event.y<v.y-margin||event.x>v.x+v.width+margin||event.y>v.y+v.height+margin))return;
    if(this.effects.length<VFX.maxEvents)this.effects.push(event);
  }
  private addBlast(blast: Point & {radius:number;life:number}, weapon?: WeaponKind) {
    this.blasts.push(blast); this.effect({ type: blast.radius > 20 ? 'explosion' : 'impact', ...blast, weapon });
  }
  private emitDebris(point: Point, outward: Point, color: number, seed: number) {
    this.effect({ type:'debris',...point,angle:Math.atan2(outward.y,outward.x),color,count:2+seed%3 });
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
    const p = this.player;
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
  private addEnemy() {
    const angle = this.random() * Math.PI * 2;
    const x = clamp(this.player.x + Math.cos(angle) * 950, 50, WORLD.width - 50), y = clamp(this.player.y + Math.sin(angle) * 950, 50, WORLD.height - 50);
    const kind = (['raider', 'scout', 'tank', 'sniper'] as EnemyKind[])[Math.floor(this.random() * 4)];
    this.enemies.push({ id: this.id++, kind, x, y, health: ENEMIES[kind].health, cooldown: 1, angle });
  }
  private addPatrolGroup() {
    const angle = this.random() * Math.PI * 2;
    const squad = { id: this.id++, x: clamp(this.player.x + Math.cos(angle) * 1100, 300, WORLD.width - 300), y: clamp(this.player.y + Math.sin(angle) * 1100, 300, WORLD.height - 300), angle: angle + Math.PI / 2 };
    this.squads.push(squad);
    for (let slot = 0; slot < PATROL.groupSize; slot++) {
      const forward = slot === 0 ? 0 : -PATROL.spacing, side = slot === 0 ? 0 : (slot === 1 ? -1 : 1) * PATROL.spacing;
      const kind: EnemyKind = slot === 0 ? 'raider' : 'scout';
      this.enemies.push({ id: this.id++, squad: squad.id, slot, kind, x: squad.x + Math.cos(squad.angle) * forward - Math.sin(squad.angle) * side, y: squad.y + Math.sin(squad.angle) * forward + Math.cos(squad.angle) * side, health: ENEMIES[kind].health, cooldown: 1, angle: squad.angle });
    }
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
    const moving = this.asteroids.filter(a => Math.abs(a.vx) + Math.abs(a.vy) > 0.1);
    // Sleeping deposits far from ships and moving ore need no contact work.
    const active = this.asteroids.filter(a => (Math.abs(a.x - p.x) < 500 && Math.abs(a.y - p.y) < 500) || this.enemies.some(e => Math.abs(a.x - e.x) < 140 && Math.abs(a.y - e.y) < 140) || moving.some(other => Math.abs(a.x - other.x) < 128 && Math.abs(a.y - other.y) < 128));
    const rocks = active.map(a => {
      ensureAsteroidGeometry(a);
      const decay = Math.exp(-COLLISION.asteroidDrag * dt);
      a.x += a.vx * (1 - decay) / COLLISION.asteroidDrag;
      a.y += a.vy * (1 - decay) / COLLISION.asteroidDrag;
      a.vx *= decay; a.vy *= decay;
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
      const body: Body = { ...e, vx: e.vx ?? 0, vy: e.vy ?? 0, radius: ENEMIES[e.kind ?? 'raider'].radius, mass: e.kind === 'tank' ? 3 : 1 };
      e.impactCooldown = Math.max(0, (e.impactCooldown ?? 0) - dt);
      for (const rock of rocks) {
        const speed = collideAsteroid(body, rock, rock.geometry!, COLLISION.restitution);
        if (speed !== undefined && speed > COLLISION.safeSpeed && e.impactCooldown <= 0) {
          e.health -= Math.min(COLLISION.maxDamage, Math.ceil((speed - COLLISION.safeSpeed) * COLLISION.damagePerSpeed));
          this.enemyHits++;
          e.impactCooldown = COLLISION.damageCooldown;
          this.addBlast({ x: e.x, y: e.y, radius: 16, life: 0.12 });
        }
      }
      if (e.health > 0) {
        const speed = collide(playerBody, body, COLLISION.restitution);
        if (speed !== undefined) e.health -= this.impact(speed, 'Ship', e);
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
    this.addBlast({ x: e.x, y: e.y, radius: 35, life: 0.22 });
    this.kills++;
    this.drops.push({ id: this.id++, x: e.x, y: e.y, ore: 'iron', amount: 6 });
  }
  private releaseOre(point: Point, ore: Resource, amount: number) {
    if (amount <= 0) return;
    const existing = this.drops.find(d => d.ore === ore && dist(d, point) < 45);
    if (existing) existing.amount += amount;
    else this.drops.push({ id: this.id++, ...point, ore, amount });
  }
  destroyAsteroid(id: number): boolean {
    const asteroid = this.asteroids.find(a => a.id === id);
    if (!asteroid) return false;
    // Release only what remains; already mined ore is never paid twice.
    this.releaseOre(asteroid, asteroid.ore, asteroid.amount);
    asteroid.amount = 0; asteroid.health = 0;
    this.emitDebris(asteroid, { x: 1, y: -1 }, RESOURCES[asteroid.ore].color, asteroid.id);
    this.asteroids = this.asteroids.filter(a => a !== asteroid);
    this.world.destroy(id);
    return true;
  }
  private pushOre(asteroid:Asteroid,damage:number,direction:Point){
    const length=Math.hypot(direction.x,direction.y);
    if(length<1e-8||damage<=0)return;
    const mass=Math.max(1,(asteroid.radius/20)**2),impulse=damage*ORE_COMBAT.impulsePerDamage/mass;
    asteroid.vx+=direction.x/length*impulse;asteroid.vy+=direction.y/length*impulse;
    const speed=Math.hypot(asteroid.vx,asteroid.vy);
    if(speed>ORE_COMBAT.maxShotSpeed){asteroid.vx*=ORE_COMBAT.maxShotSpeed/speed;asteroid.vy*=ORE_COMBAT.maxShotSpeed/speed;}
  }
  private shootOre(asteroid: Asteroid, damage: number, point: Point, weapon?: WeaponKind, direction?: Point) {
    this.pushOre(asteroid,damage,direction??{x:asteroid.x-point.x,y:asteroid.y-point.y});
    const removed = mineMaterial(asteroid, damage * ORE_COMBAT.materialPerDamage, point);
    if (removed > 0) {
      const recovered = Math.floor((asteroid.shotYieldRemainder ?? 0) + removed * ORE_COMBAT.recovery + 1e-9);
      asteroid.shotYieldRemainder = (asteroid.shotYieldRemainder ?? 0) + removed * ORE_COMBAT.recovery - recovered;
      asteroid.wastedAmount = (asteroid.wastedAmount ?? 0) + removed - recovered;
      this.releaseOre(point, asteroid.ore, recovered);
      this.emitDebris(point, { x: point.x - asteroid.x, y: point.y - asteroid.y }, RESOURCES[asteroid.ore].color, asteroid.id + asteroid.amount);
    }
    this.oreHits++; this.addBlast({ ...point, radius: 10, life: 0.1 },weapon);
    if (asteroid.amount <= 0) this.destroyAsteroid(asteroid.id);
  }
  private hitEnemy(enemy:Enemy,damage:number){
    if(enemy.health<=0||damage<=0)return;
    this.enemyHits++;enemy.health-=damage;if(enemy.health<=0)this.enemyDestroyed(enemy);
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
          this.releaseOre(impact, target.ore, removed);
          this.emitDebris(impact, { x: impact.x - target.x, y: impact.y - target.y }, RESOURCES[target.ore].color, target.id + target.amount);
        }
        if (target.amount <= 0) { this.destroyAsteroid(target.id); if (this.minedTarget === target) { this.minedTarget = undefined; this.miningPoint = undefined; } }
      }
    }
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
    } else if (input.dock) this.message = 'Move within 220m of the green station to dock.';
    const safe = this.atStation;
    const visibleEnemies = new Set(this.enemies.filter(e => !safe && dist(e, p) <= ENEMIES[e.kind ?? 'raider'].detection && clearLineOfSight(e, p, this.asteroids)).map(e => e.id));
    const alertedSquads = new Set(this.enemies.filter(e => e.squad !== undefined && visibleEnemies.has(e.id)).map(e => e.squad));
    this.squads = this.squads.filter(squad => this.enemies.some(e => e.squad === squad.id));
    for (const squad of this.squads) {
      if (alertedSquads.has(squad.id)) continue;
      squad.angle += PATROL.turnRate * dt;
      squad.x += Math.cos(squad.angle) * PATROL.speed * dt; squad.y += Math.sin(squad.angle) * PATROL.speed * dt;
      if (squad.x < 250 || squad.y < 250 || squad.x > WORLD.width - 250 || squad.y > WORLD.height - 250) { squad.angle += Math.PI / 2; squad.x = clamp(squad.x, 250, WORLD.width - 250); squad.y = clamp(squad.y, 250, WORLD.height - 250); }
      if (this.bases.some(base => base.unlocked && dist(squad, base) < BASE_RADIUS + 180)) squad.angle += dt * 2;
    }
    for (const e of this.enemies) {
      if ((e.disabledFor ?? 0) > 0) { e.disabledFor=Math.max(0,e.disabledFor!-dt);e.vx=0;e.vy=0;continue; }
      const previous = { x: e.x, y: e.y };
      const def = ENEMIES[e.kind ?? 'raider'], distance = dist(e, p); e.cooldown -= dt;
      const visible = visibleEnemies.has(e.id), squad = this.squads.find(squad => squad.id === e.squad);
      const alerted = visible || (!safe && e.squad !== undefined && alertedSquads.has(e.squad) && distance < def.detection * PATROL.sharedDetectionMultiplier);
      if (alerted) {
        e.angle = Math.atan2(p.y - e.y, p.x - e.x);
        const direction = distance > def.stop ? 1 : e.kind === 'sniper' && distance < def.stop - 100 ? -1 : 0;
        e.x = clamp(e.x + Math.cos(e.angle) * def.speed * dt * direction, 30, WORLD.width - 30);
        e.y = clamp(e.y + Math.sin(e.angle) * def.speed * dt * direction, 30, WORLD.height - 30);
        if (visible && distance < def.range && e.cooldown <= 0 && !this.bases.some(base => base.unlocked && dist(e, base) < BASE_RADIUS)) { this.shoot(e, e.angle, true, def.weapon); e.cooldown = def.weapon.cooldown; }
      } else if (squad) {
        const forward = e.slot === 0 ? 0 : -PATROL.spacing, side = e.slot === 0 ? 0 : (e.slot === 1 ? -1 : 1) * PATROL.spacing;
        const target = { x: squad.x + Math.cos(squad.angle) * forward - Math.sin(squad.angle) * side, y: squad.y + Math.sin(squad.angle) * forward + Math.cos(squad.angle) * side };
        const distance = dist(e, target), step = Math.min(distance, def.speed * 0.8 * dt);
        if (distance > 0) { e.x += (target.x - e.x) / distance * step; e.y += (target.y - e.y) / distance * step; }
        e.angle = squad.angle;
      } else {
        e.patrolAngle = (e.patrolAngle ?? e.angle) + dt * 0.2; e.angle = e.patrolAngle;
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
        pulse.hits.push(enemy.id);enemy.disabledFor=Math.max(enemy.disabledFor??0,pulse.stun);this.hitEnemy(enemy,pulse.damage);
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
      const start = { x: b.x, y: b.y }; b.x += b.vx * dt; b.y += b.vy * dt;
      const view = input.view ?? { x: 0, y: 0, width: WORLD.width, height: WORLD.height };
      if (b.x < view.x - 12 || b.y < view.y - 12 || b.x > view.x + view.width + 12 || b.y > view.y + view.height + 12) { b.life = 0; continue; }
      for(let hit=0;hit<(b.enhanced?SPECIAL.rail.targets:1);hit++){
      let oreHit: { asteroid: Asteroid; point: Point; t: number } | undefined;
      for (const asteroid of this.asteroids) {
        if (segmentCircleHit(start, b, asteroid, asteroid.radius + 4) === undefined) continue;
        const shape = ensureAsteroidGeometry(asteroid);
        const local = segmentPolygonHit(shape, { x: start.x - asteroid.x, y: start.y - asteroid.y }, { x: b.x - asteroid.x, y: b.y - asteroid.y });
        if (local && (!oreHit || local.t < oreHit.t)) oreHit = { asteroid, point: { x: local.x + asteroid.x, y: local.y + asteroid.y }, t: local.t };
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
        if ((b.splash ?? 0)>0) this.explodeRocket(b, oreHit.point); else this.shootOre(oreHit.asteroid, b.damage ?? (b.enemy ? WEAPONS.enemy.damage : WEAPONS.player.damage), oreHit.point,b.weapon,{x:b.vx,y:b.vy});
      } else if (Number.isFinite(targetT)) {
        b.life = 0; const point = { x: start.x + (b.x - start.x) * targetT, y: start.y + (b.y - start.y) * targetT };
        this.fragment(b,point);
        if (b.enemy) this.damagePlayer(b.damage ?? WEAPONS.enemy.damage, point,b.attackerId);
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
    this.spawnTimer -= dt; if (this.spawnTimer <= 0) { if (this.enemies.length <= 9 && this.random() < 0.4) this.addPatrolGroup(); else if (this.enemies.length < 12) this.addEnemy(); this.spawnTimer = 10; }

    if (this.dead) {
      this.deaths++;
      for (const ore of Object.keys(this.cargo) as Resource[]) { if (this.cargo[ore]) this.drops.push({ id: this.id++, x: p.x, y: p.y, ore, amount: this.cargo[ore] }); this.cargo[ore] = 0; }
      this.message = 'Ship destroyed. Press R to respawn at the station. Stored resources are safe.';
    }
  }
}



export type GameSave = {
  version: 1; seed: string; world: WorldSnapshot; player: GameModel['player']; modules: ShipModule[];
  coreAbility?:AbilityState;novaFields?:GameModel['novaFields'];coreLevel: number; shield: number; energy?:number; heat?:number; empPulses?:GameModel['empPulses']; cargo: Record<Resource, number>; stored: Record<Resource, number>;
  bases: GameModel['bases']; explored: string[]; enemies: Enemy[]; squads: GameModel['squads']; drops: Drop[];
  bullets: Bullet[]; detachedModules: GameModel['detachedModules']; kills: number; deaths: number; id: number; rng: number;
  spawnTimer: number; shieldDelay: number; impactTimer: number;
};
