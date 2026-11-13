import { EXTRA_ENEMIES,type ExtraEnemyKind } from './enemyDefinitions.ts';
export const WORLD = { width: 19200 * Math.sqrt(10), height: 19200 * Math.sqrt(10), stationX: 3200, stationY: 3200 };
export const RESOURCES = { iron: { label: 'Iron', color: 0xb9bdc7 }, copper: { label: 'Copper', color: 0xd59460 }, crystal: { label: 'Crystal', color: 0x8ad6ed }, ice: { label: 'Ice', color: 0xc5ecff }, radioactive: { label: 'Radioactive', color: 0x9fe63f } };
export type Resource = keyof typeof RESOURCES;
export const SHIP = { speed: 280, acceleration: 650, drag: 1.6, radius: 18, health: 100, miningRange: 240, miningRate: 9, pickupRange: 65 };
export const WEAPONS = { player: { damage: 12, speed: 700, cooldown: 0.18, lifetime: 1.1 }, enemy: { damage: 9, speed: 340, cooldown: 1.4, lifetime: 2.2 } };
export type EnemyKind = ExtraEnemyKind | 'raider' | 'scout' | 'tank' | 'sniper' | 'frigate' | 'carrier' | 'defender' | 'drone' | 'warden' | 'wardenTurret' | 'wardenShield' | 'leviathan' | 'leviathanNode' | 'leviathanPod' | 'titan' | 'titanCannon' | 'titanPod' | 'titanReactor';
export type FactionKind='rust'|'iron'|'void';
export type EnemyBehavior = 'hold' | 'flank' | 'kite' | 'reload' | 'carrier' | 'guard';
/** count/spread/offset fire several shots at once; homing is a turn rate (rad/s); charge is a telegraphed wind-up (s); lead aims ahead of a moving target. */
export type EnemyWeapon = { type: WeaponKind; damage: number; speed: number; cooldown: number; lifetime: number; count?: number; spread?: number; offset?: number; homing?: number; charge?: number; lead?: boolean; splash?:number;requiresPart?:EnemyKind;beam?:{range:number;material:number;arc?:boolean} };
export type EnemyDefinition = {
  faction?:FactionKind;armor?:number;support?:boolean;role?:'weapon'|'bay'|'engine'|'coil'|'generator'|'miner'|'housing';aura?:{range:number;reduction:number};industry?:{range:number;rate:number;cargo:number;escapeAt?:number;lootShare:number;combat?:boolean};emp?:{interval:number;charge:number;radius:number;damage:number;drain:number;suppress?:number};repositionAfterShot?:number;
  label: string; threat: number; health: number; shield: number; shieldRegen: number; shieldDelay: number;
  speed: number; accel: number; radius: number; mass: number; detection: number; range: number; stop: number;
  behavior: EnemyBehavior; color: number; weapons: EnemyWeapon[]; loot: Partial<Record<Resource, number>>;
  drones?: { max: number; interval: number;kind?:EnemyKind;requiresPart?:EnemyKind }; leash?: number;
  /** Hull fraction below which the ship breaks off once (0 = fights to the end). */
  retreatAt: number;
  /** Hull turns toward its target at this rate (rad/s) instead of snapping; used by large ships. */
  turnRate?: number;
  /** A destructible component mounted on a boss: it has no movement of its own. */
  part?: boolean;
  /** While any part with this flag survives, its boss keeps regenerating shields. */
  shieldSource?: boolean;
  /** Armoured reactor vent: takes no damage itself, but once its boss reaches phase two each hit passes this multiple straight to the boss hull, past its shield. */
  weakPoint?: number;
  boss?: BossDefinition;
};
/** Boss extras: a second weapon set below `phaseAt` hull, one reinforcement call, escorts and mounted parts (offsets in ship space, nose along +x). */
export type BossDefinition = {
  frontArmor?:number;hazards?:{count:number;radius:number;speed:number;damage:number;size:number;charge:number;active:number;cycle:number};meltdown?:{duration:number;radius:number;damage:number};
  phaseAt: number; phaseWeapons: EnemyWeapon[]; reinforcements: EnemyKind[]; escorts: EnemyKind[]; parts: { kind: EnemyKind; x: number; y: number }[];
  /** Optional third phase below this hull fraction. */
  finalAt?: number; finalWeapons?: EnemyWeapon[];
  /** Movement speed multiplier from phase two onward. */
  phaseSpeed?: number;
  /** Shield surge: every `interval` s the boss holds fire for `duration` s and recharges shields at `rate`/s (needs a living shield source). */
  surge?: { interval: number; duration: number; rate: number };
  /** Area pulse: after a `charge` s warning ring, everything within `radius` takes `damage` and loses `drain` energy. */
  emp?: { interval: number; charge: number; radius: number; damage: number; drain: number;suppress?:number };
};
// Internal keys raider/scout/tank/sniper are kept so existing saves keep their enemies.
export const ENEMIES: Record<EnemyKind, EnemyDefinition> = {
  ...EXTRA_ENEMIES,
  raider: { label: 'Rust Raider', threat: 1, retreatAt: 0.25, health: 60, shield: 0, shieldRegen: 0, shieldDelay: 0, speed: 115, accel: 260, radius: 17, mass: 1, detection: 780, range: 420, stop: 260, behavior: 'hold', color: 0xe15e68,
    weapons: [{ type: 'cannon', damage: 9, speed: 340, cooldown: 1.4, lifetime: 2.2 }], loot: { iron: 6 } },
  scout: { label: 'Pirate Scout', threat: 1, retreatAt: 0.4, health: 35, shield: 0, shieldRegen: 0, shieldDelay: 0, speed: 190, accel: 520, radius: 13, mass: 0.7, detection: 850, range: 340, stop: 210, behavior: 'flank', color: 0xffbd6e,
    weapons: [{ type: 'pulse', damage: 3, speed: 460, cooldown: 0.8, lifetime: 1.4, count: 2, offset: 5 }], loot: { copper: 4 } },
  tank: { label: 'Iron Gunship', threat: 2, retreatAt: 0, health: 200, shield: 0, shieldRegen: 0, shieldDelay: 0, speed: 65, accel: 110, radius: 25, mass: 3, detection: 850, range: 460, stop: 300, behavior: 'hold', color: 0xbf88de,
    weapons: [{ type: 'cannon', damage: 6, speed: 380, cooldown: 0.34, lifetime: 1.8, lead: true }, { type: 'rocket', damage: 22, speed: 250, cooldown: 3.4, lifetime: 3.2 }], loot: { iron: 14, copper: 6 } },
  sniper: { label: 'Railgun Sniper', threat: 3, retreatAt: 0.45, health: 70, shield: 0, shieldRegen: 0, shieldDelay: 0, speed: 95, accel: 200, radius: 18, mass: 1, detection: 1100, range: 780, stop: 620, behavior: 'kite', color: 0x74bedc,
    weapons: [{ type: 'rail', damage: 30, speed: 900, cooldown: 3.2, lifetime: 1.4, charge: 1.1 }], loot: { crystal: 6, copper: 4 } },
  frigate: { label: 'Missile Frigate', threat: 2, retreatAt: 0.35, health: 120, shield: 20, shieldRegen: 4, shieldDelay: 4, speed: 105, accel: 180, radius: 21, mass: 2, detection: 900, range: 560, stop: 430, behavior: 'reload', color: 0xd9c05a,
    weapons: [{ type: 'rocket', damage: 11, speed: 230, cooldown: 5.5, lifetime: 4.2, count: 4, spread: 0.7, homing: 1.5 }], loot: { copper: 10, ice: 5 } },
  carrier: { label: 'Drone Carrier', threat: 3, retreatAt: 0.3, health: 240, shield: 40, shieldRegen: 5, shieldDelay: 5, speed: 60, accel: 90, radius: 30, mass: 4, detection: 1000, range: 700, stop: 600, behavior: 'carrier', color: 0x8fd08a,
    weapons: [], drones: { max: 3, interval: 4 }, loot: { iron: 16, crystal: 10, radioactive: 3 } },
  defender: { label: 'Shielded Defender', threat: 3, retreatAt: 0, health: 110, shield: 140, shieldRegen: 14, shieldDelay: 3.5, speed: 90, accel: 200, radius: 22, mass: 2.5, detection: 800, range: 440, stop: 300, behavior: 'guard', leash: 1300, color: 0x7f8cff,
    weapons: [{ type: 'plasma', damage: 16, speed: 300, cooldown: 1.5, lifetime: 2.2, lead: true }], loot: { crystal: 8, radioactive: 5 } },
  drone: { label: 'Attack Drone', threat: 0, retreatAt: 0, health: 14, shield: 0, shieldRegen: 0, shieldDelay: 0, speed: 230, accel: 700, radius: 8, mass: 0.3, detection: 900, range: 260, stop: 150, behavior: 'flank', color: 0x9be0a0,
    weapons: [{ type: 'pulse', damage: 2, speed: 420, cooldown: 0.7, lifetime: 1 }], loot: {} },
  // Boss 1. Guards a rich industrial field; its shield only recharges while a shield generator survives.
  warden: { label: 'Iron Warden', threat: 5, retreatAt: 0, health: 1600, shield: 400, shieldRegen: 45, shieldDelay: 2.5, speed: 42, accel: 40, radius: 64, mass: 40, detection: 1300, range: 900, stop: 420, behavior: 'guard', leash: 1700, turnRate: 0.55, color: 0xd9a441,
    weapons: [{ type: 'cannon', damage: 14, speed: 420, cooldown: 1.6, lifetime: 2.4, count: 3, spread: 0.16, lead: true }, { type: 'rocket', damage: 16, speed: 240, cooldown: 6, lifetime: 4, count: 5, spread: 0.9, charge: 1.3 }],
    boss: { phaseAt: 0.5, reinforcements: ['tank', 'scout', 'scout'], escorts: ['defender', 'defender'],
      phaseWeapons: [{ type: 'cannon', damage: 14, speed: 440, cooldown: 1, lifetime: 2.4, count: 5, spread: 0.32, lead: true }, { type: 'rocket', damage: 14, speed: 250, cooldown: 4.5, lifetime: 4.2, count: 8, spread: 1.4, homing: 1.1, charge: 1.1 }],
      parts: [{ kind: 'wardenTurret', x: 38, y: -52 }, { kind: 'wardenTurret', x: 38, y: 52 }, { kind: 'wardenTurret', x: -38, y: -56 }, { kind: 'wardenTurret', x: -38, y: 56 }, { kind: 'wardenShield', x: -2, y: -68 }, { kind: 'wardenShield', x: -2, y: 68 }] },
    loot: { iron: 160, copper: 110, crystal: 25 } },
  wardenTurret: { label: 'Warden Turret', threat: 0, retreatAt: 0, part: true, health: 90, shield: 0, shieldRegen: 0, shieldDelay: 0, speed: 0, accel: 0, radius: 11, mass: 1, detection: 1100, range: 620, stop: 0, behavior: 'hold', color: 0xd9a441,
    weapons: [{ type: 'pulse', damage: 4, speed: 480, cooldown: 0.55, lifetime: 1.5 }], loot: {} },
  wardenShield: { label: 'Shield Generator', threat: 0, retreatAt: 0, part: true, shieldSource: true, health: 140, shield: 0, shieldRegen: 0, shieldDelay: 0, speed: 0, accel: 0, radius: 12, mass: 1, detection: 1100, range: 1, stop: 0, behavior: 'hold', color: 0x7fd0ff,
    weapons: [], loot: { crystal: 6 } },
  // Boss 2. Guards a crystal field: charged beam, plasma fans, drones and periodic shield surges fed by its crystal nodes.
  leviathan: { label: 'Crystal Leviathan', threat: 5, retreatAt: 0, health: 1900, shield: 600, shieldRegen: 30, shieldDelay: 3, speed: 70, accel: 60, radius: 60, mass: 35, detection: 1400, range: 950, stop: 520, behavior: 'guard', leash: 1800, turnRate: 0.7, color: 0x8ad6ed,
    weapons: [{ type: 'rail', damage: 34, speed: 1000, cooldown: 5, lifetime: 1.4, charge: 1.4 }, { type: 'plasma', damage: 12, speed: 300, cooldown: 2.2, lifetime: 2.6, count: 3, spread: 0.5, lead: true }],
    drones: { max: 3, interval: 6 },
    boss: { phaseAt: 0.4, phaseSpeed: 1.5, reinforcements: [], escorts: ['sniper', 'defender'], surge: { interval: 16, duration: 4, rate: 90 },
      phaseWeapons: [{ type: 'rail', damage: 34, speed: 1000, cooldown: 3.2, lifetime: 1.4, charge: 1.1 }, { type: 'plasma', damage: 12, speed: 320, cooldown: 1.5, lifetime: 2.6, count: 5, spread: 0.9, lead: true }],
      parts: [{ kind: 'leviathanNode', x: -10, y: -62 }, { kind: 'leviathanNode', x: -10, y: 62 }, { kind: 'leviathanPod', x: 34, y: -50 }, { kind: 'leviathanPod', x: 34, y: 50 }] },
    loot: { crystal: 140, ice: 60, radioactive: 10 } },
  leviathanNode: { label: 'Crystal Node', threat: 0, retreatAt: 0, part: true, shieldSource: true, health: 160, shield: 0, shieldRegen: 0, shieldDelay: 0, speed: 0, accel: 0, radius: 12, mass: 1, detection: 1100, range: 1, stop: 0, behavior: 'hold', color: 0x8ad6ed,
    weapons: [], loot: { crystal: 8 } },
  leviathanPod: { label: 'Plasma Pod', threat: 0, retreatAt: 0, part: true, health: 100, shield: 0, shieldRegen: 0, shieldDelay: 0, speed: 0, accel: 0, radius: 11, mass: 1, detection: 1100, range: 560, stop: 0, behavior: 'hold', color: 0x8ad6ed,
    weapons: [{ type: 'plasma', damage: 8, speed: 320, cooldown: 1.8, lifetime: 2 }], loot: {} },
  // Boss 3. Guards a radioactive field: plasma cannons, missile barrages, an EMP pulse, three phases and reactor vents that open in phase two.
  titan: { label: 'Reactor Titan', threat: 5, retreatAt: 0, health: 2400, shield: 300, shieldRegen: 0, shieldDelay: 4, speed: 34, accel: 30, radius: 72, mass: 60, detection: 1400, range: 950, stop: 440, behavior: 'guard', leash: 1800, turnRate: 0.45, color: 0x9fe63f,
    weapons: [{ type: 'plasma', damage: 20, speed: 320, cooldown: 2, lifetime: 2.8, count: 2, offset: 14, lead: true }, { type: 'rocket', damage: 13, speed: 240, cooldown: 7, lifetime: 4.2, count: 6, spread: 1.1, homing: 1, charge: 1.4 }],
    boss: { phaseAt: 0.6, finalAt: 0.25, reinforcements: ['tank', 'frigate'], escorts: ['defender', 'tank'], emp: { interval: 11, charge: 1.8, radius: 430, damage: 12, drain: 80 },
      phaseWeapons: [{ type: 'plasma', damage: 20, speed: 330, cooldown: 1.5, lifetime: 2.8, count: 2, offset: 14, lead: true }, { type: 'rocket', damage: 13, speed: 245, cooldown: 5.5, lifetime: 4.2, count: 8, spread: 1.3, homing: 1.1, charge: 1.2 }],
      finalWeapons: [{ type: 'plasma', damage: 22, speed: 340, cooldown: 0.9, lifetime: 2.8, count: 3, spread: 0.35, lead: true }, { type: 'rocket', damage: 13, speed: 250, cooldown: 4, lifetime: 4.4, count: 10, spread: 1.6, homing: 1.2, charge: 1 }],
      parts: [{ kind: 'titanCannon', x: 40, y: -60 }, { kind: 'titanCannon', x: 40, y: 60 }, { kind: 'titanPod', x: -28, y: -70 }, { kind: 'titanPod', x: -28, y: 70 }, { kind: 'titanReactor', x: -70, y: -28 }, { kind: 'titanReactor', x: -70, y: 28 }] },
    loot: { radioactive: 120, crystal: 60, iron: 120 } },
  titanCannon: { label: 'Plasma Cannon', threat: 0, retreatAt: 0, part: true, health: 130, shield: 0, shieldRegen: 0, shieldDelay: 0, speed: 0, accel: 0, radius: 12, mass: 1, detection: 1100, range: 650, stop: 0, behavior: 'hold', color: 0x9fe63f,
    weapons: [{ type: 'plasma', damage: 9, speed: 340, cooldown: 1.4, lifetime: 2.2 }], loot: {} },
  titanPod: { label: 'Missile Pod', threat: 0, retreatAt: 0, part: true, health: 110, shield: 0, shieldRegen: 0, shieldDelay: 0, speed: 0, accel: 0, radius: 12, mass: 1, detection: 1100, range: 700, stop: 0, behavior: 'hold', color: 0x9fe63f,
    weapons: [{ type: 'rocket', damage: 8, speed: 240, cooldown: 4.5, lifetime: 3.6, count: 2, spread: 0.4, homing: 0.9 }], loot: {} },
  titanReactor: { label: 'Reactor Vent', threat: 0, retreatAt: 0, part: true, weakPoint: 1.5, health: 1, shield: 0, shieldRegen: 0, shieldDelay: 0, speed: 0, accel: 0, radius: 13, mass: 1, detection: 1100, range: 1, stop: 0, behavior: 'hold', color: 0xffe07a,
    weapons: [], loot: {} },
};
// Preserve legacy keys and encounters; requested archetypes share their established implementations.
Object.assign(ENEMIES.raider,{faction:'rust',armor:.03});Object.assign(ENEMIES.scout,{faction:'rust',armor:.02});Object.assign(ENEMIES.tank,{faction:'iron',armor:.3});Object.assign(ENEMIES.sniper,{faction:'iron',armor:.08,repositionAfterShot:1.2});Object.assign(ENEMIES.frigate,{faction:'rust',armor:.12});
Object.assign(ENEMIES.carrier,{faction:'void'});Object.assign(ENEMIES.defender,{faction:'iron'});Object.assign(ENEMIES.drone,{faction:'void'});
Object.assign(ENEMIES.warden,{faction:'iron'});Object.assign(ENEMIES.leviathan,{faction:'void'});Object.assign(ENEMIES.titan,{faction:'void'});
Object.assign(ENEMIES.warden.boss!,{frontArmor:.3,finalAt:.22,surge:{interval:14,duration:2,rate:70},finalWeapons:[{type:'rail',damage:24,speed:1050,cooldown:3,lifetime:3,charge:1.3},{type:'flak',damage:5,speed:390,cooldown:1.2,lifetime:3,count:7,spread:.9}]});
ENEMIES.warden.boss!.parts.push({kind:'bossReactor',x:-70,y:0});
export const ENEMY_ARCHETYPES:EnemyKind[]=['scrapDrone','scout','raider','tank','sniper','bomber','frigate','flak','disruptor','shieldCarrier','marauder','escort'];
export const MAJOR_BOSSES:EnemyKind[]=['warden','rustLeviathan','tyrant','harvester','storm','dreadforge'];
/**
 * Boss placement. Each site is chosen from the seeded ore clusters (preferring `ores`, then richness),
 * at least `minHomeDistance` from the start. The boss wakes when the player comes within `wake`;
 * `territory` is its extreme-danger zone, which drops to medium once it is defeated.
 */
export const BOSS: { wake: number; territory: number; minHomeDistance: number; sites: { kind: EnemyKind; ores: Resource[] }[] } = {
  wake: 2600, territory: 1000, minHomeDistance: 7000, sites: [{ kind: 'warden', ores: ['iron', 'copper'] }, { kind: 'leviathan', ores: ['crystal'] }, { kind: 'titan', ores: ['radioactive'] },{kind:'rustLeviathan',ores:['copper','iron']},{kind:'tyrant',ores:['copper','crystal']},{kind:'harvester',ores:['iron','crystal']},{kind:'storm',ores:['crystal','ice']},{kind:'dreadforge',ores:['radioactive']}],
};
/**
 * Danger levels 1-4 come from the seeded resource geography, not from distance: richer ore fields
 * are more dangerous. `ore` is the base level per resource, `safeRadius` keeps the start at level 1
 * and `calmRadius` caps the surrounding area at level 2 so every seed has a survivable opening.
 */
export const DANGER = {
  ore: { iron: 1, copper: 1, ice: 2, crystal: 3, radioactive: 4 } as Record<Resource, number>,
  labels: ['Low', 'Medium', 'High', 'Extreme'], colors: ['#7fd6a8', '#e8c45a', '#f08a4b', '#f0527a'], mapTint: ['', '#2b2a17', '#3d2214', '#42142e'],
  safeRadius: 2200, calmRadius: 3800, richDensity: 0.8, core: 0.85, fringe: 1.25,
};
/**
 * Enemy classes by danger level - 1, split the way EnemyPopulation counts them: `normal` ships
 * arrive as patrol groups, `elite` ships arrive singly on the slower elite timers.
 */
export const ENEMY_SPAWN: { normal: EnemyKind[][]; elite: EnemyKind[][] } = {
  normal: [['raider', 'scout'], ['raider', 'scout', 'frigate'], ['scout', 'frigate', 'raider'], ['frigate', 'scout', 'frigate']],
  elite: [['tank'], ['tank', 'sniper'], ['tank', 'sniper', 'carrier', 'defender'], ['sniper', 'carrier', 'defender', 'defender']],
};
/**
 * Horde events. Away from the start, a timer (seconds, by danger level) counts down; when it ends
 * the HUD goes to red alert for `warning` seconds and then `size` enemies arrive together from one
 * direction and hunt the player. Docking during the warning calls it off. Clearing a horde pays
 * `reward` times the danger level. Hordes that are outrun by `despawn` units give up.
 */
export const HORDE = {
  interval: [[420, 600], [330, 480], [270, 400], [210, 330]], firstDelay: 180, warning: 10, retry: 90, alarmEvery: 1.4,
  size: [6, 9, 12, 15], eliteShare: [0, 0.2, 0.3, 0.4], distance: [1000, 1250], arc: 0.9, memory: 30, despawn: 3600,
  reward: { iron: 25, copper: 15, crystal: 6 } as Partial<Record<Resource, number>>, repeatBossLoot: 0.5,
};
export const ENEMY_AI = { strafe: { hold: 0.3, flank: 1, kite: 0.3, reload: 0.5, carrier: 0.2, guard: 0.45 } as Record<EnemyBehavior, number>, spacing: 70, avoid: 45, chargeLock: 0.3, shotMargin: 700,
  // State machine timing: seconds unless noted.
  memory: 6, arrive: 70, retreatTime: 5, strafeFlip: 3, investigatePace: 0.75, stuckTime: 0.7, repositionTime: 1.1, postRadius: 220 };
export const BASES = [
  { id: 'forge', name: 'Forge / 01', x: 3200, y: 3200, cost: { iron: 0, copper: 0, crystal: 0, ice: 0, radioactive: 0 } },
  { id: 'relay', name: 'Relay / 02', x: 7000, y: 3200, cost: { iron: 80, copper: 40, crystal: 0, ice: 0, radioactive: 0 } },
  { id: 'haven', name: 'Haven / 03', x: 3200, y: 8200, cost: { iron: 100, copper: 50, crystal: 10, ice: 0, radioactive: 0 } },
  { id: 'crossing', name: 'Crossing / 04', x: 10000, y: 10000, cost: { iron: 140, copper: 70, crystal: 20, ice: 0, radioactive: 0 } },
  { id: 'watch', name: 'Watch / 05', x: 15500, y: 6000, cost: { iron: 180, copper: 90, crystal: 30, ice: 0, radioactive: 0 } },
  { id: 'drift', name: 'Drift / 06', x: 7000, y: 16000, cost: { iron: 180, copper: 90, crystal: 30, ice: 0, radioactive: 0 } },
  { id: 'edge', name: 'Edge / 07', x: 16500, y: 16500, cost: { iron: 240, copper: 120, crystal: 50, ice: 0, radioactive: 0 } },
];
export const BASE_RADIUS = 220;

export type WeaponKind = 'cannon' | 'pulse' | 'rail' | 'plasma' | 'rocket' | 'flak' | 'emp';
export type ModuleKind = WeaponKind | 'miner' | 'cargo' | 'armor' | 'engine' | 'shield' | 'tractor' | 'reactor' | 'cooler';
export type EquipmentKind = ModuleKind | 'core';
export type EquipmentStats = { damage?: number; cooldown?: number; mining?: number; pickup?: number; hull?: number; speed?: number; acceleration?: number; splash?: number; shield?: number; recharge?: number; tractor?: number; pull?: number; targets?: number; power?: number; heat?: number; generation?: number; energyCapacity?: number; cooling?: number; heatCapacity?: number; empRange?: number; cargo?:number; stun?: number; burstSpeed?:number; burstThrust?:number; boostDuration?:number; boostCooldown?:number; boostPower?:number; boostHeat?:number };
export type EquipmentDefinition = { label: string; color: number; mass: number; cost: Record<Resource, number>; weapon?: WeaponKind; description: string; levels: EquipmentStats[] };
const cost = (iron: number, copper = 0, crystal = 0, ice = 0, radioactive = 0): Record<Resource, number> => ({ iron, copper, crystal, ice, radioactive });
export const MODULES: Record<ModuleKind, EquipmentDefinition> = {
  cannon: { label: 'Autocannon', color: 0xffce70, mass: 4, cost: cost(20,10), weapon: 'cannon', description: 'Rapid kinetic rounds. Energy/heat costs are per volley.', levels: [{damage:12,cooldown:.18,power:2.8,heat:1.2},{damage:30,cooldown:.16,power:4,heat:1.8},{damage:45,cooldown:.14,power:5.5,heat:2.5}] },
  pulse: { label: 'Pulse laser', color: 0x6de4ff, mass: 4, cost: cost(25,15,5), weapon: 'pulse', description: 'Fast cyan bolts with short energy trails.', levels: [{damage:11,cooldown:.22,power:4,heat:2},{damage:28,cooldown:.2,power:5.5,heat:3},{damage:42,cooldown:.18,power:7,heat:4}] },
  rail: { label: 'Railgun', color: 0xd8f2ff, mass: 9, cost: cost(45,25,12), weapon: 'rail', description: 'High-velocity slugs and strong impact shockwaves.', levels: [{damage:45,cooldown:1.1,power:18,heat:14},{damage:110,cooldown:1,power:24,heat:19},{damage:160,cooldown:.9,power:32,heat:25}] },
  plasma: { label: 'Plasma cannon', color: 0xaeff90, mass: 7, cost: cost(35,20,8), weapon: 'plasma', description: 'Slow plasma orbs burst on impact with area damage.', levels: [{damage:27,cooldown:.7,splash:40,power:12,heat:10},{damage:70,cooldown:.65,splash:50,power:17,heat:14},{damage:105,cooldown:.6,splash:65,power:23,heat:19}] },
  rocket: { label: 'Missile launcher', color: 0xff9766, mass: 7, cost: cost(30,15), weapon: 'rocket', description: 'Visible missiles with exhaust and area explosions; no ammo cost.', levels: [{damage:39,cooldown:1.5,splash:65,power:10,heat:9},{damage:95,cooldown:1.3,splash:85,power:14,heat:13},{damage:140,cooldown:1.1,splash:105,power:19,heat:18}] },
  flak: { label: 'Flak cannon', color: 0xffa678, mass: 6, cost: cost(30,20,5), weapon: 'flak', description: 'Five pellets per volley in a spread. Costs apply to the whole volley.', levels: [{damage:4,cooldown:.65,power:9,heat:7},{damage:11,cooldown:.6,power:13,heat:10},{damage:16,cooldown:.55,power:18,heat:14}] },
  emp: { label: 'EMP emitter', color: 0x729cff, mass: 6, cost: cost(35,20,10), weapon: 'emp', description: 'Expanding electric pulse damages and temporarily disables enemies.', levels: [{damage:9,cooldown:2,empRange:140,stun:2.2,power:20,heat:8},{damage:25,cooldown:1.8,empRange:190,stun:3,power:28,heat:12},{damage:40,cooldown:1.6,empRange:240,stun:4,power:38,heat:16}] },
  miner: { label: 'Mining beam', color: 0x75ebc3, mass: 4, cost: cost(15,10), description: 'Hold right click / Space to auto-mine. Power/heat are per second; upgraded beams split targets.', levels: [{mining:9,power:8,heat:3},{mining:15,power:12,heat:5},{mining:24,power:18,heat:7}] },
  tractor: { label: 'Tractor beam', color: 0xe1a0ff, mass: 3, cost: cost(25,15,5), description: 'Independent target slots pull ore to this module. Power/heat are per active second.', levels: [{tractor:180,pull:150,targets:1,power:4,heat:1},{tractor:300,pull:225,targets:2,power:6,heat:1.5},{tractor:450,pull:300,targets:3,power:9,heat:2}] },
  cargo: { label: 'Cargo hold', color: 0xc599e8, mass: 3, cost: cost(20), description: 'Adds cargo capacity and passive loose-ore pickup reach. Multiple holds combine.', levels: [{pickup:30,cargo:60},{pickup:55,cargo:120},{pickup:85,cargo:200}] },
  armor: { label: 'Armor plating', color: 0xa8b8c9, mass: 8, cost: cost(25,5), description: 'Adds hull and sturdy structure, at the cost of mass.', levels: [{hull:30},{hull:55},{hull:90}] },
  shield: { label: 'Shield generator', color: 0x71e1ff, mass: 5, cost: cost(25,15,5), description: 'Adds shield; recharging uses energy after three seconds without hits.', levels: [{shield:40,recharge:5,power:3,heat:.5},{shield:75,recharge:8,power:5,heat:.8},{shield:120,recharge:12,power:8,heat:1.2}] },
  engine: { label: 'Speed booster', color: 0x6db9ff, mass: 2, cost: cost(20,15), description: 'Powered cruise bonuses. Level 2+ adds a Shift-triggered burst with energy/heat cost and cooldown.', levels: [{speed:25,acceleration:80,power:6,heat:3},{speed:45,acceleration:140,power:9,heat:5,burstSpeed:150,burstThrust:400,boostDuration:1.8,boostCooldown:6,boostPower:18,boostHeat:12},{speed:70,acceleration:220,power:13,heat:8,burstSpeed:240,burstThrust:650,boostDuration:2.2,boostCooldown:5,boostPower:24,boostHeat:18}] },
  reactor: { label: 'Reactor', color: 0xffda86, mass: 8, cost: cost(30,15,5), description: 'Adds energy production and storage. Reactors combine their output.', levels: [{generation:35,energyCapacity:70},{generation:60,energyCapacity:110},{generation:100,energyCapacity:170}] },
  cooler: { label: 'Cooling system', color: 0x9edfff, mass: 4, cost: cost(20,10,0,10), description: 'Adds heat dissipation and thermal capacity. Cooling systems combine.', levels: [{cooling:18,heatCapacity:25},{cooling:30,heatCapacity:40},{cooling:48,heatCapacity:65}] },
};
export const CORE: EquipmentDefinition = { label: 'Core', color: 0x73c9ee, mass: 12, cost: cost(30,15), description: 'Core tiers unlock item tiers and improve hull, power and cooling. No module-count cap.', levels: [{hull:100,generation:40,energyCapacity:100,cooling:12,heatCapacity:100},{hull:150,generation:60,energyCapacity:160,cooling:16,heatCapacity:140},{hull:225,generation:90,energyCapacity:240,cooling:22,heatCapacity:200}] };
export const MAX_MODULE_LEVEL=5;
const ADVANCED_LEVELS:Record<EquipmentKind,[EquipmentStats,EquipmentStats]>={
 core:[{hull:320,generation:125,energyCapacity:340,cooling:30,heatCapacity:280},{hull:450,generation:170,energyCapacity:480,cooling:40,heatCapacity:380}],
 cannon:[{damage:62,cooldown:.125,power:7,heat:3.2},{damage:82,cooldown:.11,power:9,heat:4}],
 pulse:[{damage:58,cooldown:.16,power:9,heat:5},{damage:78,cooldown:.14,power:12,heat:6.5}],
 rail:[{damage:220,cooldown:.8,power:42,heat:32},{damage:295,cooldown:.7,power:54,heat:40}],
 plasma:[{damage:145,cooldown:.55,splash:80,power:30,heat:25},{damage:195,cooldown:.5,splash:95,power:39,heat:32}],
 rocket:[{damage:190,cooldown:1,splash:120,power:25,heat:24},{damage:250,cooldown:.9,splash:135,power:33,heat:31}],
 flak:[{damage:22,cooldown:.5,power:24,heat:19},{damage:29,cooldown:.45,power:31,heat:25}],
 emp:[{damage:56,cooldown:1.4,empRange:280,stun:4.5,power:48,heat:21},{damage:75,cooldown:1.2,empRange:320,stun:5,power:60,heat:27}],
 miner:[{mining:35,power:25,heat:10},{mining:48,power:34,heat:14}],
 tractor:[{tractor:550,pull:375,targets:4,power:12,heat:2.5},{tractor:650,pull:450,targets:5,power:16,heat:3}],
 cargo:[{pickup:110,cargo:300},{pickup:140,cargo:500}],
 armor:[{hull:135},{hull:195}],
 shield:[{shield:180,recharge:17,power:11,heat:1.7},{shield:260,recharge:24,power:15,heat:2.3}],
 engine:[{speed:100,acceleration:310,power:18,heat:11,burstSpeed:320,burstThrust:850,boostDuration:2.5,boostCooldown:4.5,boostPower:32,boostHeat:24},{speed:135,acceleration:420,power:24,heat:15,burstSpeed:420,burstThrust:1100,boostDuration:2.8,boostCooldown:4,boostPower:42,boostHeat:32}],
 reactor:[{generation:150,energyCapacity:250},{generation:220,energyCapacity:360}],
 cooler:[{cooling:70,heatCapacity:95},{cooling:100,heatCapacity:140}],
};
for(const [kind,levels]of Object.entries(ADVANCED_LEVELS)) (kind==='core'?CORE:MODULES[kind as ModuleKind]).levels.push(...levels);
export const ROCKET = { speed: 330, lifetime: 3.2 };
export const WEAPON_TYPES: Record<WeaponKind, {speed:number;pellets:number;spread:number;color:number;trail:number}> = {
  cannon:{speed:700,pellets:1,spread:0,color:0xffce70,trail:8}, pulse:{speed:1050,pellets:1,spread:0,color:0x6de4ff,trail:24},
  rail:{speed:2200,pellets:1,spread:0,color:0xe4f6ff,trail:145}, plasma:{speed:380,pellets:1,spread:0,color:0xaeff90,trail:16},
  rocket:{speed:330,pellets:1,spread:0,color:0xff9766,trail:28}, flak:{speed:680,pellets:5,spread:.34,color:0xffac74,trail:5},
  emp:{speed:340,pellets:1,spread:0,color:0x729cff,trail:0},
};
export const SHIP_SYSTEMS = { referenceMass:20, collectionRadius:10, cargoCapacity:120 };
/** Sound cues from the simulation are heard within `range` of the player and fade with distance. */
export const HEARING = { range: 1700 };
export const VFX = { particleBudget:320, visibleMargin:100, maxEvents:256, beamColors:{tractor:[0xf095ff,0xd783ff,0xb98aff,0xd2b0ff,0xf0c0ff],mining:[0x75ebc3,0x83edff,0xf0f8b1,0xb3ffe2,0xf7fff1]} };
export function equipment(kind: EquipmentKind) { return kind === 'core' ? CORE : MODULES[kind]; }
export function upgradeCost(kind: EquipmentKind, currentLevel: number): Record<Resource, number> {
  const base = equipment(kind).cost;
  return { iron: Math.max(15, base.iron) * currentLevel, copper: Math.max(5, base.copper) * currentLevel, crystal: currentLevel >= 2 ? 5 * currentLevel : 0, ice: currentLevel>=3?10*(currentLevel-2):0, radioactive:currentLevel>=4?10:0 };
}
export function statsLabel(stats: EquipmentStats) {
  return Object.entries(stats).map(([key, value]) => `${({ damage: 'Damage', cooldown: 'Shot interval (s)', mining: 'Ore/s', cargo:'Cargo capacity +',pickup: 'Pickup +m', hull: 'Hull', speed: 'Speed +', acceleration: 'Thrust +', splash: 'Blast radius', shield: 'Shield', recharge: 'Recharge/s', tractor: 'Beam range', pull: 'Pull speed', targets: 'Targets', power:'Energy',heat:'Heat',generation:'Power/s',energyCapacity:'Energy capacity',cooling:'Cooling/s',heatCapacity:'Heat capacity',empRange:'EMP radius',stun:'Disable (s)',burstSpeed:'Burst speed +',burstThrust:'Burst thrust +',boostDuration:'Burst duration (s)',boostCooldown:'Burst cooldown (s)',boostPower:'Burst energy',boostHeat:'Burst heat' } as Record<string, string>)[key]} ${value}`).join(' · ');
}
export const BUILD_GRID = { radius: 3, cellSize: 16, pickupBonus: 30 };

export const COLLISION = { restitution: 0.3, asteroidDrag: 0.4, safeSpeed: 40, damagePerSpeed: 0.09, maxDamage: 25, damageCooldown: 0.6 };

export const EXPLORATION = { cell: 480, radius: 850 };
export const MODULE_DURABILITY: Record<ModuleKind, number[]> = { reactor:[60,90,130],cooler:[40,60,85],pulse:[40,60,85],rail:[55,80,110],plasma:[45,70,100],flak:[45,70,100],emp:[40,60,90],tractor:[40,60,85],cannon:[45,65,90],miner:[40,60,85],rocket:[50,75,105],cargo:[35,55,80],armor:[100,150,220],engine:[40,60,85],shield:[35,55,80] };
for(const durability of Object.values(MODULE_DURABILITY))durability.push(Math.round(durability[2]*1.4),Math.round(durability[2]*1.9));
export const REPAIR = { ironPerHull: 0.2, copperPerModule: 0.05, salvageFraction: 0.5, emergencyMining: 3 };
export const PATROL = { groupSize: 3, spacing: 65, speed: 55, turnRate: 0.08, sharedDetectionMultiplier: 1.4 };
export const ORE_COMBAT = { materialPerDamage: 0.1, recovery: 0.35, impulsePerDamage: 0.3, maxShotSpeed: 12 };

export const MODULE_CATEGORIES = {
  Weapons:['cannon','pulse','rail','plasma','rocket','flak','emp'], Mining:['miner'], Collection:['tractor','cargo'], Defense:['shield','armor'], Propulsion:['engine'], Power:['reactor'], Utility:['cooler'],
} satisfies Record<string,ModuleKind[]>;
export const MODULE_SHORT:Record<EquipmentKind,string>={core:'Core',cannon:'Auto',pulse:'Pulse',rail:'Rail',plasma:'Plasma',rocket:'Missile',flak:'Flak',emp:'EMP',miner:'Mining',tractor:'Tractor',cargo:'Cargo',armor:'Armor',shield:'Shield',engine:'Booster',reactor:'Reactor',cooler:'Cooler'};
export const STAT_LABELS:Partial<Record<keyof EquipmentStats,string>>={damage:'Damage',cooldown:'Fire rate (shots/s)',mining:'Mining (ore/s)',cargo:'Cargo capacity +',pickup:'Pickup reach +',hull:'Hull',speed:'Cruise speed +',acceleration:'Thrust +',splash:'Blast radius',shield:'Shield',recharge:'Recharge /s',tractor:'Tractor range',pull:'Pull speed',targets:'Target slots',power:'Operating energy',heat:'Operating heat',generation:'Power output /s',energyCapacity:'Energy capacity',cooling:'Cooling /s',heatCapacity:'Heat capacity',empRange:'EMP radius',stun:'Disable (s)',burstSpeed:'Burst speed +',burstThrust:'Burst thrust +',boostDuration:'Burst duration (s)',boostCooldown:'Burst cooldown (s)',boostPower:'Burst energy',boostHeat:'Burst heat'};
