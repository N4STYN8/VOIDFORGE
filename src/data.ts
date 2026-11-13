import { ECONOMY } from './economy.ts';
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
export type ModuleKind = WeaponKind | 'miner' | 'cargo' | 'armor' | 'engine' | 'shield' | 'tractor' | 'reactor' | 'cooler' | 'builder';
export type EquipmentKind = ModuleKind | 'core';
export type EquipmentStats = { damage?: number; cooldown?: number; mining?: number; pickup?: number; hull?: number; speed?: number; acceleration?: number; splash?: number; shield?: number; recharge?: number; tractor?: number; pull?: number; targets?: number; power?: number; heat?: number; generation?: number; energyCapacity?: number; cooling?: number; heatCapacity?: number; empRange?: number; cargo?:number; stun?: number; burstSpeed?:number; burstThrust?:number; boostDuration?:number; boostCooldown?:number; boostPower?:number; boostHeat?:number; buildRange?:number; buildSpeed?:number; buildDiscount?:number };
export type EquipmentDefinition = { label: string; color: number; mass: number; cost: Record<Resource, number>; weapon?: WeaponKind; description: string; levels: EquipmentStats[] };
const cost = (iron: number, copper = 0, crystal = 0, ice = 0, radioactive = 0): Record<Resource, number> => ({ iron, copper, crystal, ice, radioactive });
export const MODULES: Record<ModuleKind, EquipmentDefinition> = {
  cannon: { label: 'Autocannon', color: 0xffce70, mass: 4, cost: {...ECONOMY.purchases.cannon}, weapon: 'cannon', description: 'Rapid kinetic rounds. Energy/heat costs are per volley.', levels: [{"damage":12,"cooldown":0.18,"power":2.8,"heat":1.2},{"damage":18,"cooldown":0.175,"power":3.5,"heat":1.4},{"damage":26,"cooldown":0.17,"power":4.2,"heat":1.6}] },
  pulse: { label: 'Pulse laser', color: 0x6de4ff, mass: 4, cost: {...ECONOMY.purchases.pulse}, weapon: 'pulse', description: 'Fast cyan bolts with short energy trails.', levels: [{"damage":11,"cooldown":0.22,"power":4,"heat":2},{"damage":17,"cooldown":0.21,"power":4.8,"heat":2.3},{"damage":25,"cooldown":0.2,"power":5.8,"heat":2.7}] },
  rail: { label: 'Railgun', color: 0xd8f2ff, mass: 9, cost: {...ECONOMY.purchases.rail}, weapon: 'rail', description: 'High-velocity slugs and strong impact shockwaves.', levels: [{"damage":45,"cooldown":1.1,"power":18,"heat":14},{"damage":70,"cooldown":1.05,"power":22,"heat":16},{"damage":105,"cooldown":1,"power":27,"heat":19}] },
  plasma: { label: 'Plasma cannon', color: 0xaeff90, mass: 7, cost: {...ECONOMY.purchases.plasma}, weapon: 'plasma', description: 'Slow plasma orbs burst on impact with area damage.', levels: [{"damage":27,"cooldown":0.7,"power":12,"heat":10,"splash":40},{"damage":42,"cooldown":0.68,"power":15,"heat":12,"splash":50},{"damage":60,"cooldown":0.64,"power":18,"heat":14,"splash":65}] },
  rocket: { label: 'Missile launcher', color: 0xff9766, mass: 7, cost: {...ECONOMY.purchases.rocket}, weapon: 'rocket', description: 'Visible missiles with exhaust and area explosions; no ammo cost.', levels: [{"damage":39,"cooldown":1.5,"power":10,"heat":9,"splash":65},{"damage":60,"cooldown":1.45,"power":13,"heat":11,"splash":75},{"damage":85,"cooldown":1.4,"power":16,"heat":14,"splash":85}] },
  flak: { label: 'Flak cannon', color: 0xffa678, mass: 6, cost: {...ECONOMY.purchases.flak}, weapon: 'flak', description: 'Five pellets per volley in a spread. Costs apply to the whole volley.', levels: [{"damage":4,"cooldown":0.65,"power":9,"heat":7},{"damage":6,"cooldown":0.62,"power":12,"heat":9},{"damage":8,"cooldown":0.58,"power":15,"heat":11}] },
  emp: { label: 'EMP emitter', color: 0x729cff, mass: 6, cost: {...ECONOMY.purchases.emp}, weapon: 'emp', description: 'Expanding electric pulse damages and temporarily disables enemies.', levels: [{"damage":9,"cooldown":5,"power":20,"heat":8,"empRange":140,"stun":1},{"damage":16,"cooldown":4.8,"power":27,"heat":11,"empRange":180,"stun":1.5},{"damage":25,"cooldown":4.6,"power":35,"heat":14,"empRange":220,"stun":2}] },
  miner: { label: 'Mining beam', color: 0x75ebc3, mass: 4, cost: {...ECONOMY.purchases.miner}, description: 'Hold right click / Space to auto-mine. Power/heat are per second; upgraded beams split targets.', levels: [{"mining":9,"power":8,"heat":3},{"mining":15,"power":12,"heat":5},{"mining":24,"power":18,"heat":7}] },
  tractor: { label: 'Tractor beam', color: 0xe1a0ff, mass: 3, cost: {...ECONOMY.purchases.tractor}, description: 'Independent target slots pull ore to this module. Power/heat are per active second.', levels: [{"tractor":180,"pull":150,"targets":1,"power":4,"heat":1},{"tractor":300,"pull":225,"targets":2,"power":6,"heat":1.5},{"tractor":450,"pull":300,"targets":3,"power":9,"heat":2}] },
  cargo: { label: 'Cargo hold', color: 0xc599e8, mass: 3, cost: {...ECONOMY.purchases.cargo}, description: 'Adds cargo capacity and passive loose-ore pickup reach. Multiple holds combine.', levels: [{"pickup":30,"cargo":60},{"pickup":55,"cargo":120},{"pickup":85,"cargo":200}] },
  armor: { label: 'Armor plating', color: 0xa8b8c9, mass: 8, cost: {...ECONOMY.purchases.armor}, description: 'Adds hull and sturdy structure, at the cost of mass.', levels: [{"hull":30},{"hull":55},{"hull":90}] },
  shield: { label: 'Shield generator', color: 0x71e1ff, mass: 5, cost: {...ECONOMY.purchases.shield}, description: 'Adds shield; recharging uses energy after three seconds without hits.', levels: [{"shield":40,"recharge":5,"power":3,"heat":0.5},{"shield":70,"recharge":8,"power":4.5,"heat":0.7},{"shield":110,"recharge":12,"power":6.5,"heat":1}] },
  engine: { label: 'Speed booster', color: 0x6db9ff, mass: 2, cost: {...ECONOMY.purchases.engine}, description: 'Powered cruise bonuses. Level 2+ adds a Shift-triggered burst with energy/heat cost and cooldown.', levels: [{"speed":25,"acceleration":80,"power":6,"heat":3},{"speed":45,"acceleration":140,"power":9,"heat":5,"burstSpeed":150,"burstThrust":400,"boostDuration":1.8,"boostCooldown":6,"boostPower":18,"boostHeat":12},{"speed":70,"acceleration":220,"power":13,"heat":8,"burstSpeed":240,"burstThrust":650,"boostDuration":2.2,"boostCooldown":5,"boostPower":24,"boostHeat":18}] },
  reactor: { label: 'Reactor', color: 0xffda86, mass: 8, cost: {...ECONOMY.purchases.reactor}, description: 'Adds energy production and storage. Reactors combine their output.', levels: [{"generation":35,"energyCapacity":70},{"generation":60,"energyCapacity":110},{"generation":100,"energyCapacity":170}] },
  cooler: { label: 'Cooling system', color: 0x9edfff, mass: 4, cost: {...ECONOMY.purchases.cooler}, description: 'Adds heat dissipation and thermal capacity. Cooling systems combine.', levels: [{"cooling":18,"heatCapacity":25},{"cooling":30,"heatCapacity":40},{"cooling":48,"heatCapacity":65}] },
  builder: { label: 'Build module', color: 0xd9a441, mass: 6, cost: {...ECONOMY.purchases.builder}, description: 'Requires Core level 4. Enters Build Mode (F) to construct outposts on the world grid from carried cargo. Must be intact and the ship must not be short of energy.', levels: [{"buildRange":240,"buildSpeed":1,"buildDiscount":0},{"buildRange":300,"buildSpeed":1.6,"buildDiscount":0},{"buildRange":360,"buildSpeed":2.2,"buildDiscount":8}] },
};
export const CORE: EquipmentDefinition = { label: 'Core', color: 0x73c9ee, mass: 12, cost: {...ECONOMY.purchases.core}, description: 'Core tiers unlock item tiers and improve hull, power and cooling. No module-count cap.', levels: [{"hull":100,"generation":40,"energyCapacity":100,"cooling":12,"heatCapacity":100},{"hull":150,"generation":60,"energyCapacity":160,"cooling":18,"heatCapacity":150},{"hull":225,"generation":90,"energyCapacity":240,"cooling":28,"heatCapacity":230}] };
export const MAX_MODULE_LEVEL=5;
const ADVANCED_LEVELS:Record<EquipmentKind,[EquipmentStats,EquipmentStats]>={
 core:[{"hull":320,"generation":130,"energyCapacity":350,"cooling":40,"heatCapacity":350},{"hull":450,"generation":180,"energyCapacity":500,"cooling":60,"heatCapacity":500}],
 cannon:[{"damage":36,"cooldown":0.16,"power":5.1,"heat":1.9},{"damage":50,"cooldown":0.15,"power":5.8,"heat":2.1}],
 pulse:[{"damage":34,"cooldown":0.19,"power":7,"heat":3.2},{"damage":44,"cooldown":0.18,"power":8,"heat":3.7}],
 rail:[{"damage":140,"cooldown":0.95,"power":33,"heat":23},{"damage":180,"cooldown":0.9,"power":40,"heat":27}],
 plasma:[{"damage":80,"cooldown":0.6,"power":22,"heat":17,"splash":80},{"damage":100,"cooldown":0.55,"power":27,"heat":20,"splash":95}],
 rocket:[{"damage":110,"cooldown":1.3,"power":20,"heat":18,"splash":100},{"damage":140,"cooldown":1.2,"power":25,"heat":22,"splash":115}],
 flak:[{"damage":11,"cooldown":0.53,"power":20,"heat":15},{"damage":14,"cooldown":0.48,"power":29,"heat":22}],
 emp:[{"damage":35,"cooldown":4.4,"power":46,"heat":18,"empRange":260,"stun":2.5},{"damage":48,"cooldown":7,"power":75,"heat":30,"empRange":340,"stun":4}],
 miner:[{"mining":33,"power":23,"heat":9},{"mining":45,"power":27,"heat":11}],
 tractor:[{"tractor":560,"pull":400,"targets":4,"power":12,"heat":2.5},{"tractor":700,"pull":600,"targets":5,"power":16,"heat":3}],
 cargo:[{"pickup":110,"cargo":300},{"pickup":160,"cargo":600}],
 armor:[{"hull":120},{"hull":150}],
 shield:[{"shield":150,"recharge":18,"power":9,"heat":1.5},{"shield":200,"recharge":25,"power":12,"heat":2}],
 engine:[{"speed":95,"acceleration":300,"power":18,"heat":10,"burstSpeed":350,"burstThrust":1000,"boostDuration":2.5,"boostCooldown":5.5,"boostPower":35,"boostHeat":25},{"speed":125,"acceleration":400,"power":22,"heat":13,"burstSpeed":600,"burstThrust":1600,"boostDuration":2,"boostCooldown":6,"boostPower":60,"boostHeat":40}],
 reactor:[{"generation":140,"energyCapacity":250},{"generation":175,"energyCapacity":350}],
 cooler:[{"cooling":70,"heatCapacity":95},{"cooling":90,"heatCapacity":125}],
 builder:[{"buildRange":440,"buildSpeed":3.2,"buildDiscount":12},{"buildRange":600,"buildSpeed":5,"buildDiscount":18}],
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
  const index=currentLevel-1;
  if(!Number.isInteger(currentLevel)||index<0||index>=4)throw new RangeError('Upgrade level must be 1–4');
  if(kind==='core')return {...ECONOMY.coreUpgrades[index]};
  const base=equipment(kind).cost,extra=ECONOMY.tierMaterials[index],scale=ECONOMY.upgradeMultipliers[index];
  return Object.fromEntries((Object.keys(base) as Resource[]).map(ore=>[ore,Math.ceil(base[ore]*scale+extra[ore])])) as Record<Resource,number>;
}
export function statsLabel(stats: EquipmentStats) {
  return Object.entries(stats).map(([key, value]) => `${({ damage: 'Damage', cooldown: 'Shot interval (s)', mining: 'Ore/s', cargo:'Cargo capacity +',pickup: 'Pickup +m', hull: 'Hull', speed: 'Speed +', acceleration: 'Thrust +', splash: 'Blast radius', shield: 'Shield', recharge: 'Recharge/s', tractor: 'Beam range', pull: 'Pull speed', targets: 'Targets', power:'Energy',heat:'Heat',generation:'Power/s',energyCapacity:'Energy capacity',cooling:'Cooling/s',heatCapacity:'Heat capacity',empRange:'EMP radius',stun:'Disable (s)',burstSpeed:'Burst speed +',burstThrust:'Burst thrust +',boostDuration:'Burst duration (s)',boostCooldown:'Burst cooldown (s)',boostPower:'Burst energy',boostHeat:'Burst heat' } as Record<string, string>)[key]} ${value}`).join(' · ');
}
export const BUILD_GRID = { radius: 3, cellSize: 16, pickupBonus: 30 };
/**
 * Fleet: extra ships are bought at a station from stored minerals. Each further ship costs `growth` more
 * than the last. Only one ship flies at a time; the others wait in the hangar with their own core level,
 * modules and hull damage. `nameLength` caps ship names.
 */
export const FLEET = {
  cost: cost(250, 120, 40), growth: 0.6, nameLength: 22,
  /** Hull paints. Index 0 is bare metal (no recolour). `strength` is how far hull greys move toward the paint colour. */
  paints: [{ name: 'Steel', color: 0x8194a2 }, { name: 'Crimson', color: 0xd9534f }, { name: 'Cobalt', color: 0x3f7fe0 }, { name: 'Emerald', color: 0x3fbf7f }, { name: 'Amber', color: 0xe8a33a }, { name: 'Violet', color: 0x9a6ae0 }, { name: 'Bone', color: 0xe6dcc8 }, { name: 'Onyx', color: 0x4a4f5c }],
  paintStrength: 0.62,
};
/** Player map markers placed on the sector map. */
export const WAYPOINTS = { max: 12, pickRadius: 14, colors: [0xffd166, 0x7fd6f2, 0xff8fa3, 0x9be0a0, 0xc7a6ff, 0xffb070] };
/**
 * Player-built outposts. Blocks sit on a world-aligned construction grid whose cell equals a ship
 * module tile. `radius` is how many cells from its core an outpost may extend; `coreSpacing` and
 * `baseClearance` keep cores apart and away from stations. Building spends carried cargo and
 * `energyPerBlock` ship energy. `gridZoom` is the camera zoom range over which the fine grid fades in.
 * `radius` times two cells must stay below `coreSpacing` so neighbouring outposts never overlap.
 * `merge` lists the blocks that are drawn as one large module when they fill a square of up to
 * `maxMerge` cells a side (appearance only: each cell is still its own block).
 */
export const OUTPOST = {
  merge: ['reactor', 'storage', 'coolingUnit', 'shieldGenerator', 'droneHangar', 'droneRepairBay', 'upgradeStation', 'repairStation', 'radarTower', 'dockingStation'] as StructureKind[], maxMerge: 3,
  coreLevel: 4, cell: BUILD_GRID.cellSize, radius: 24, coreSpacing: 900, baseClearance: 340, energyPerBlock: 6, awaySpeed: 0.5, awayRange: 2,
  largeGrid: 160, gridZoom: [1.15, 1.75], key: 'F', rotateKey: 'R',
  fabricator: { hpPerSecond: 50, ironPerHp: 0.08, energyPerSecond: 16 },
  /** Turrets only run for outposts within `activeRange` of the ship; cargo moves to and from an outpost within `transferRange` of its core. */
  activeRange: 2600, transferRange: 240, panelRange: 620, turretScan: 0.3, turretAim: 0.14,
  /** Blocks above `stationLevel` need an Upgrade station in the outpost. Manual repair costs `repairIronPerHp` iron per hull point. */
  maxLevel: 5, stationLevel: 2, repairIronPerHp: 0.08, repairEnergyPerSecond: 6, shieldEnergyPerPoint: 0.4, shieldDelay: 4,
  /** Time away is banked up to `awayCap` seconds and settled when the ship comes back within `resolveRange`. */
  awayCap: 1800, awayMin: 20, resolveRange: 1500, /** Seconds to wait near the outpost so streamed asteroids are loaded before settling. */ resolveDelay: 3,
  /** Raids: seconds between raids on an outpost, party size and away-raid damage by danger level, and the stored value below which raiders do not bother. */
  raid: { interval: [420, 720], size: [2, 3, 4, 6], awayDamage: [250, 500, 900, 1500], minValue: 120, distance: 950, radarWarning: 12, retreatAt: 0.35, giveUp: 2600, defenceSeconds: 20 },
};
/** Per-level multipliers for outpost blocks (index = level - 1). `output` scales power, battery, storage, shields, cooling and repair. */
export const STRUCTURE_LEVELS = { health: [1, 1.3, 1.65, 2.05, 2.5], output: [1, 1.4, 1.8, 2.3, 3], damage: [1, 1.25, 1.55, 1.9, 2.3], drones: [2, 4, 6, 8, 10] };
export type StructureKind = 'outpostCore' | 'wall' | 'reinforcedWall' | 'autocannonTurret' | 'missileTurret' | 'railgunTurret' | 'shieldGenerator' | 'reactor' | 'coolingUnit' | 'storage' | 'droneHangar' | 'droneRepairBay' | 'upgradeStation' | 'repairStation' | 'radarTower' | 'dockingStation';
/**
 * Mining drones. Each flies to an asteroid within `range` of its hangar, mines it through the normal
 * finite-ore extraction at `rate` ore/s, carries up to `capacity` of one ore home and unloads into
 * outpost storage. Launching costs `launchEnergy` from the outpost battery; `perAsteroid` limits crowding.
 */
export const DRONES = { speed: 95, rate: ECONOMY.drones.rate, capacity: 20, range: 750, leash: 1.35, launchEnergy: ECONOMY.drones.launchEnergy, recharge: 2, standoff: 14, perAsteroid: 2, retry: 1.5,
  /** Every `serviceEvery` trips a drone is serviced for `serviceTime` s (`bayServiceTime` with a Drone repair bay). `awayRate` is ore/s per drone while the ship is away. */
  serviceEvery: 6, serviceTime: 12, bayServiceTime: 3, awayRate: ECONOMY.drones.awayRate };
/** Automatic weapon mount: `energy` is drawn from the outpost battery per shot, `turn` is rad/s. */
export type TurretDefinition = { weapon: WeaponKind; damage: number; cooldown: number; range: number; speed: number; lifetime: number; energy: number; turn: number; splash?: number; guided?: boolean; /** Heat added to the outpost per shot. */ heat?: number };
export type StructureDefinition = { label: string; description: string; cost: Record<Resource, number>; health: number; /** Seconds at construction speed 1. */ buildTime: number; color: number;
  /** Energy per second added to the outpost battery. */ generation?: number; /** Battery capacity added. */ energyCapacity?: number; /** Mineral storage added (all ores combined). */ storage?: number; turret?: TurretDefinition;
  /** Mining drones this block houses. */ drones?: number; /** Radius within which the ship can dock (E) to unload and repair from outpost stores. */ dock?: number;
  /** Shield pool added, its recharge per second and the radius (cells) of blocks it protects. */ shield?: number; shieldRegen?: number; shieldRadius?: number;
  /** Heat removed per second and heat capacity added. */ cooling?: number; heatCapacity?: number;
  /** Hull points per second repaired on nearby blocks, paid in stored iron and battery energy. */ repair?: number; repairRadius?: number;
  /** Fraction added to turret range across the outpost; also gives warning of raids. */ radar?: number;
  /** Lets blocks in this outpost be upgraded past OUTPOST.stationLevel. */ upgrades?: boolean; /** Speeds up drone servicing. */ droneService?: boolean };
export const STRUCTURES: Record<StructureKind, StructureDefinition> = {
  outpostCore: { label: 'Outpost Core', description: 'Founds a new outpost and anchors every block joined to it. Provides a little power, battery and storage. Place this first; other blocks must connect back to it.', cost: cost(80, 40, 10), health: 600, buildTime: 8, color: 0xd9a441, generation: 10, energyCapacity: 100, storage: 200, cooling: 4, heatCapacity: 60 },
  wall: { label: 'Wall block', description: 'Basic riveted plating. Stops hostile fire. Adjacent walls join into one structure.', cost: cost(8), health: 160, buildTime: 2, color: 0x6f7c8c },
  reinforcedWall: { label: 'Reinforced wall', description: 'Cross-braced plating with more than twice the strength of a wall block.', cost: cost(14, 6), health: 380, buildTime: 3.5, color: 0x9aa9bb },
  autocannonTurret: { label: 'Autocannon turret', description: 'Rapid-fire automatic defence at short range. Cheap on energy.', cost: cost(40, 25), health: 220, buildTime: 5, color: 0xffce70,
    turret: { weapon: 'cannon', damage: 10, cooldown: 0.22, range: 520, speed: 700, lifetime: 0.9, energy: 2, turn: 4, heat: 1.2 } },
  missileTurret: { label: 'Missile turret', description: 'Long-range guided missiles with a blast radius. Slow to reload.', cost: cost(55, 35, 10), health: 200, buildTime: 7, color: 0xff9766,
    turret: { weapon: 'rocket', damage: 45, cooldown: 2.6, range: 900, speed: 330, lifetime: 3.4, energy: 14, turn: 2.5, splash: 70, guided: true, heat: 9 } },
  railgunTurret: { label: 'Railgun turret', description: 'Heavy precision shots. Slow to turn and hungry for energy.', cost: cost(70, 40, 20), health: 240, buildTime: 8, color: 0xd8f2ff,
    turret: { weapon: 'rail', damage: 120, cooldown: 2.2, range: 780, speed: 2200, lifetime: 0.5, energy: 22, turn: 1.6, heat: 14 } },
  reactor: { label: 'Reactor', description: 'Generates energy for turrets and adds battery capacity. Reactors combine.', cost: cost(50, 30, 12), health: 200, buildTime: 7, color: 0xffda86, generation: 30, energyCapacity: 120 },
  shieldGenerator: { label: 'Shield generator', description: 'Projects a shield over blocks within six cells. It absorbs damage before hulls do and recharges from the battery after a pause.', cost: cost(60, 40, 25), health: 220, buildTime: 8, color: 0x79dfff, shield: 220, shieldRegen: 9, shieldRadius: 6 },
  coolingUnit: { label: 'Cooling unit', description: 'Removes heat made by turret fire and raises heat capacity. Overheated turrets stop until the outpost cools.', cost: cost(35, 20, 0, 12), health: 180, buildTime: 5, color: 0x9edfff, cooling: 14, heatCapacity: 80 },
  droneRepairBay: { label: 'Drone repair bay', description: 'Services mining drones in a quarter of the usual time, so they spend more of it mining.', cost: cost(45, 30, 10), health: 200, buildTime: 6, color: 0x8fd08a, droneService: true },
  upgradeStation: { label: 'Upgrade station', description: 'Lets every block in this outpost be upgraded beyond level 2, up to level 5.', cost: cost(70, 50, 30, 0, 5), health: 240, buildTime: 9, color: 0xc7a6ff, upgrades: true },
  repairStation: { label: 'Repair station', description: 'Automatically repairs damaged blocks within eight cells, spending stored iron and battery energy.', cost: cost(50, 30, 12), health: 220, buildTime: 7, color: 0x78dec0, repair: 18, repairRadius: 8 },
  radarTower: { label: 'Radar tower', description: 'Extends turret range across the outpost and gives advance warning of incoming raids.', cost: cost(40, 30, 18), health: 170, buildTime: 6, color: 0xa9cfe5, radar: 0.15 },
  droneHangar: { label: 'Drone hangar', description: 'Houses mining drones (2 at level 1, up to 10 at level 5) that mine nearby asteroids and bring the ore back to outpost storage. Needs battery energy to launch and free storage to unload.', cost: cost(60, 40, 15), health: 260, buildTime: 8, color: 0x8fd08a, drones: 2 },
  dockingStation: { label: 'Docking station', description: 'Fly close and press E to unload cargo into outpost storage and repair the ship from outpost minerals.', cost: cost(50, 30, 10), health: 240, buildTime: 6, color: 0x7fd6f2, dock: 150 },
  storage: { label: 'Storage block', description: 'Adds mineral storage to the outpost. If it is destroyed, anything that no longer fits spills out as pickups.', cost: cost(30, 10), health: 180, buildTime: 4, color: 0xc599e8, storage: 400 },
};
for(const definition of Object.values(STRUCTURES))for(const ore of Object.keys(definition.cost) as Resource[])definition.cost[ore]=Math.ceil(definition.cost[ore]*ECONOMY.structureMultiplier);
/** Level-5 specials for outpost blocks. Names and text are shown in Build Mode; the numbers they use are in STRUCTURE_SPECIAL. */
export const STRUCTURE_ABILITIES: Record<StructureKind, { name: string; description: string }> = {
  outpostCore: { name: 'Command Network', description: 'When turrets engage, all turrets in the outpost fire 30% faster for 8 seconds. 30-second cooldown.' },
  wall: { name: 'Layered Plating', description: 'Takes 25% less damage.' },
  reinforcedWall: { name: 'Reactive Plating', description: 'Takes 35% less damage.' },
  autocannonTurret: { name: 'Gatling Fury', description: 'Sustained fire ramps the fire rate up to +60% over 3 seconds.' },
  missileTurret: { name: 'Swarm Strike', description: 'Each launch adds 2 guided mini-missiles at 30% damage.' },
  railgunTurret: { name: 'Hypervelocity Round', description: 'Every third shot penetrates up to 3 enemies.' },
  shieldGenerator: { name: 'Reflective Barrier', description: 'Reflects 25% of the damage its shield absorbs back at the attacker.' },
  reactor: { name: 'Emergency Overdrive', description: 'Doubles this reactor\'s output while the battery is below 25%.' },
  coolingUnit: { name: 'Cryogenic Purge', description: 'When the outpost overheats, instantly removes half its heat. 20-second cooldown.' },
  storage: { name: 'Compression', description: 'Adds a further 25% storage.' },
  droneHangar: { name: 'Advanced Mining Swarm', description: 'Drones spread out one per asteroid where they can and go for the most valuable ore in range first.' },
  droneRepairBay: { name: 'Field Refit', description: 'Drones need servicing half as often.' },
  upgradeStation: { name: 'Master Fabrication', description: 'Block upgrades in this outpost cost 15% less.' },
  repairStation: { name: 'Emergency Reconstruction', description: 'Repairs three times as fast on blocks below 30% hull.' },
  radarTower: { name: 'Early Warning Network', description: 'Raid warnings come twice as early and turret range bonus rises to 25%.' },
  dockingStation: { name: 'Rapid Service', description: 'Ship repairs at this outpost cost 30% less.' },
};
export const STRUCTURE_SPECIAL = {
  command: { bonus: 0.3, duration: 8, cooldown: 30 }, wallReduction: 0.25, reinforcedReduction: 0.35, gatling: { maxBonus: 0.6, ramp: 3, cool: 1 },
  swarm: { count: 2, fraction: 0.3 }, railEvery: 3, reflect: 0.25, overdriveBelow: 0.25, purge: { fraction: 0.5, cooldown: 20 }, compression: 0.25,
  refit: 2, fabrication: 0.15, reconstruction: { below: 0.3, multiplier: 3 }, radar: 0.25, radarWarning: 2, rapidService: 0.3,
};

export const COLLISION = { restitution: 0.3, asteroidDrag: 0.4, safeSpeed: 40, damagePerSpeed: 0.09, maxDamage: 25, damageCooldown: 0.6 };

export const EXPLORATION = { cell: 480, radius: 850 };
export const MODULE_DURABILITY: Record<ModuleKind, number[]> = { reactor:[60,90,130],cooler:[40,60,85],pulse:[40,60,85],rail:[55,80,110],plasma:[45,70,100],flak:[45,70,100],emp:[40,60,90],tractor:[40,60,85],cannon:[45,65,90],miner:[40,60,85],rocket:[50,75,105],cargo:[35,55,80],armor:[100,150,220],engine:[40,60,85],shield:[35,55,80],builder:[45,65,90] };
for(const durability of Object.values(MODULE_DURABILITY))durability.push(Math.round(durability[2]*1.4),Math.round(durability[2]*1.9));
/**
 * Player-versus-player (stage 4). Open outside station safe rings; lobby members are allies. A pilot destroyed
 * by another pilot loses their carried cargo to the killer and rebuilds at their home station for
 * `rebuildPerCore` minerals per core level (crystal from core 3), paid from stored minerals as far as they go.
 * `damageCap` limits damage per second accepted from one attacker; `creditWindow` is how long a hit still
 * counts as the kill.
 */
export const PVP = { damageCap: 600, creditWindow: 12, rebuildPerCore: { iron: 30, copper: 18 }, rebuildRare: { crystal: 4 } };
/** Sector grid: `matchChance` is how often a never-visited cell asks the relay for a matched pilot's sector while online. Flying into a world edge for `hold` seconds moves the ship to the next sector, `entryInset` units inside its opposite edge. `bound` matches the ship clamp. */
export const SECTOR = { bound: 20, edge: 40, hold: 1.5, entryInset: 320, clearance: 45, slide: 90, matchChance: 0.5 };
export const REPAIR = { ironPerHull: 0.2, copperPerModule: 0.05, salvageFraction: 0.5, emergencyMining: 3 };
export const PATROL = { groupSize: 3, spacing: 65, speed: 55, turnRate: 0.08, sharedDetectionMultiplier: 1.4 };
export const ORE_COMBAT = { materialPerDamage: 0.1, recovery: 0.35, impulsePerDamage: 0.3, maxShotSpeed: 12 };

export const MODULE_CATEGORIES = {
  Weapons:['cannon','pulse','rail','plasma','rocket','flak','emp'], Mining:['miner'], Collection:['tractor','cargo'], Defense:['shield','armor'], Propulsion:['engine'], Power:['reactor'], Utility:['cooler','builder'],
} satisfies Record<string,ModuleKind[]>;
export const MODULE_SHORT:Record<EquipmentKind,string>={core:'Core',cannon:'Auto',pulse:'Pulse',rail:'Rail',plasma:'Plasma',rocket:'Missile',flak:'Flak',emp:'EMP',miner:'Mining',tractor:'Tractor',cargo:'Cargo',armor:'Armor',shield:'Shield',engine:'Booster',reactor:'Reactor',cooler:'Cooler',builder:'Build'};
export const STAT_LABELS:Partial<Record<keyof EquipmentStats,string>>={damage:'Damage',cooldown:'Fire rate (shots/s)',mining:'Mining (ore/s)',cargo:'Cargo capacity +',pickup:'Pickup reach +',hull:'Hull',speed:'Cruise speed +',acceleration:'Thrust +',splash:'Blast radius',shield:'Shield',recharge:'Recharge /s',tractor:'Tractor range',pull:'Pull speed',targets:'Target slots',power:'Operating energy',heat:'Operating heat',generation:'Power output /s',energyCapacity:'Energy capacity',cooling:'Cooling /s',heatCapacity:'Heat capacity',empRange:'EMP radius',stun:'Disable (s)',burstSpeed:'Burst speed +',burstThrust:'Burst thrust +',boostDuration:'Burst duration (s)',boostCooldown:'Burst cooldown (s)',boostPower:'Burst energy',boostHeat:'Burst heat',buildRange:'Construction range',buildSpeed:'Construction speed x',buildDiscount:'Construction cost -%'};
