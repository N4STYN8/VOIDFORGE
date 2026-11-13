export const WORLD = { width: 19200 * Math.sqrt(10), height: 19200 * Math.sqrt(10), asteroidCount: 1440, stationX: 3200, stationY: 3200 };
export const RESOURCES = { iron: { label: 'Iron', color: 0xb9bdc7 }, copper: { label: 'Copper', color: 0xd59460 }, crystal: { label: 'Crystal', color: 0x8ad6ed }, ice: { label: 'Ice', color: 0xc5ecff }, radioactive: { label: 'Radioactive', color: 0x9fe63f } };
export type Resource = keyof typeof RESOURCES;
export const SHIP = { speed: 280, acceleration: 650, drag: 1.6, radius: 18, health: 100, miningRange: 240, miningRate: 9, pickupRange: 65 };
export const WEAPONS = { player: { damage: 20, speed: 700, cooldown: 0.18, lifetime: 1.1 }, enemy: { damage: 9, speed: 340, cooldown: 1.4, lifetime: 2.2 } };
export const ENEMIES = {
  raider: { label: 'Raider', health: 60, speed: 115, radius: 17, detection: 780, range: 420, stop: 260, color: 0xe15e68, weapon: { damage: 9, speed: 340, cooldown: 1.4, lifetime: 2.2 } },
  scout: { label: 'Scout', health: 35, speed: 190, radius: 13, detection: 850, range: 320, stop: 190, color: 0xffbd6e, weapon: { damage: 5, speed: 420, cooldown: 0.8, lifetime: 1.6 } },
  tank: { label: 'Heavy', health: 180, speed: 65, radius: 25, detection: 850, range: 440, stop: 300, color: 0xbf88de, weapon: { damage: 18, speed: 280, cooldown: 2, lifetime: 2.4 } },
  sniper: { label: 'Sniper', health: 70, speed: 95, radius: 18, detection: 1100, range: 760, stop: 610, color: 0x74bedc, weapon: { damage: 22, speed: 570, cooldown: 2.6, lifetime: 1.8 } },
};
export type EnemyKind = keyof typeof ENEMIES;
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
  cannon: { label: 'Autocannon', color: 0xffce70, mass: 4, cost: cost(20,10), weapon: 'cannon', description: 'Rapid kinetic rounds. Energy/heat costs are per volley.', levels: [{damage:20,cooldown:.18,power:2.8,heat:1.2},{damage:30,cooldown:.16,power:4,heat:1.8},{damage:45,cooldown:.14,power:5.5,heat:2.5}] },
  pulse: { label: 'Pulse laser', color: 0x6de4ff, mass: 4, cost: cost(25,15,5), weapon: 'pulse', description: 'Fast cyan bolts with short energy trails.', levels: [{damage:18,cooldown:.22,power:4,heat:2},{damage:28,cooldown:.2,power:5.5,heat:3},{damage:42,cooldown:.18,power:7,heat:4}] },
  rail: { label: 'Railgun', color: 0xd8f2ff, mass: 9, cost: cost(45,25,12), weapon: 'rail', description: 'High-velocity slugs and strong impact shockwaves.', levels: [{damage:75,cooldown:1.1,power:18,heat:14},{damage:110,cooldown:1,power:24,heat:19},{damage:160,cooldown:.9,power:32,heat:25}] },
  plasma: { label: 'Plasma cannon', color: 0xaeff90, mass: 7, cost: cost(35,20,8), weapon: 'plasma', description: 'Slow plasma orbs burst on impact with area damage.', levels: [{damage:45,cooldown:.7,splash:40,power:12,heat:10},{damage:70,cooldown:.65,splash:50,power:17,heat:14},{damage:105,cooldown:.6,splash:65,power:23,heat:19}] },
  rocket: { label: 'Missile launcher', color: 0xff9766, mass: 7, cost: cost(30,15), weapon: 'rocket', description: 'Visible missiles with exhaust and area explosions; no ammo cost.', levels: [{damage:65,cooldown:1.5,splash:65,power:10,heat:9},{damage:95,cooldown:1.3,splash:85,power:14,heat:13},{damage:140,cooldown:1.1,splash:105,power:19,heat:18}] },
  flak: { label: 'Flak cannon', color: 0xffa678, mass: 6, cost: cost(30,20,5), weapon: 'flak', description: 'Five pellets per volley in a spread. Costs apply to the whole volley.', levels: [{damage:7,cooldown:.65,power:9,heat:7},{damage:11,cooldown:.6,power:13,heat:10},{damage:16,cooldown:.55,power:18,heat:14}] },
  emp: { label: 'EMP emitter', color: 0x729cff, mass: 6, cost: cost(35,20,10), weapon: 'emp', description: 'Expanding electric pulse damages and temporarily disables enemies.', levels: [{damage:15,cooldown:2,empRange:140,stun:2.2,power:20,heat:8},{damage:25,cooldown:1.8,empRange:190,stun:3,power:28,heat:12},{damage:40,cooldown:1.6,empRange:240,stun:4,power:38,heat:16}] },
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
export const ROCKET = { speed: 330, lifetime: 3.2 };
export const WEAPON_TYPES: Record<WeaponKind, {speed:number;pellets:number;spread:number;color:number;trail:number}> = {
  cannon:{speed:700,pellets:1,spread:0,color:0xffce70,trail:8}, pulse:{speed:1050,pellets:1,spread:0,color:0x6de4ff,trail:24},
  rail:{speed:2200,pellets:1,spread:0,color:0xe4f6ff,trail:145}, plasma:{speed:380,pellets:1,spread:0,color:0xaeff90,trail:16},
  rocket:{speed:330,pellets:1,spread:0,color:0xff9766,trail:28}, flak:{speed:680,pellets:5,spread:.34,color:0xffac74,trail:5},
  emp:{speed:340,pellets:1,spread:0,color:0x729cff,trail:0},
};
export const SHIP_SYSTEMS = { referenceMass:20, collectionRadius:10, cargoCapacity:120 };
export const VFX = { particleBudget:320, visibleMargin:100, maxEvents:256, beamColors:{tractor:[0xf095ff,0xd783ff,0xb98aff],mining:[0x75ebc3,0x83edff,0xf0f8b1]} };
export function equipment(kind: EquipmentKind) { return kind === 'core' ? CORE : MODULES[kind]; }
export function upgradeCost(kind: EquipmentKind, currentLevel: number): Record<Resource, number> {
  const base = equipment(kind).cost;
  return { iron: Math.max(15, base.iron) * currentLevel, copper: Math.max(5, base.copper) * currentLevel, crystal: currentLevel >= 2 ? 5 * currentLevel : 0, ice: 0, radioactive: 0 };
}
export function statsLabel(stats: EquipmentStats) {
  return Object.entries(stats).map(([key, value]) => `${({ damage: 'Damage', cooldown: 'Shot interval (s)', mining: 'Ore/s', cargo:'Cargo capacity +',pickup: 'Pickup +m', hull: 'Hull', speed: 'Speed +', acceleration: 'Thrust +', splash: 'Blast radius', shield: 'Shield', recharge: 'Recharge/s', tractor: 'Beam range', pull: 'Pull speed', targets: 'Targets', power:'Energy',heat:'Heat',generation:'Power/s',energyCapacity:'Energy capacity',cooling:'Cooling/s',heatCapacity:'Heat capacity',empRange:'EMP radius',stun:'Disable (s)',burstSpeed:'Burst speed +',burstThrust:'Burst thrust +',boostDuration:'Burst duration (s)',boostCooldown:'Burst cooldown (s)',boostPower:'Burst energy',boostHeat:'Burst heat' } as Record<string, string>)[key]} ${value}`).join(' · ');
}
export const BUILD_GRID = { radius: 3, cellSize: 16, pickupBonus: 30 };

export const COLLISION = { restitution: 0.3, asteroidDrag: 0.4, safeSpeed: 40, damagePerSpeed: 0.09, maxDamage: 25, damageCooldown: 0.6 };

export const EXPLORATION = { cell: 480, radius: 850 };
export const MODULE_DURABILITY: Record<ModuleKind, number[]> = { reactor:[60,90,130],cooler:[40,60,85],pulse:[40,60,85],rail:[55,80,110],plasma:[45,70,100],flak:[45,70,100],emp:[40,60,90],tractor:[40,60,85],cannon:[45,65,90],miner:[40,60,85],rocket:[50,75,105],cargo:[35,55,80],armor:[100,150,220],engine:[40,60,85],shield:[35,55,80] };
export const REPAIR = { ironPerHull: 0.2, copperPerModule: 0.05, salvageFraction: 0.5, emergencyMining: 3 };
export const PATROL = { groupSize: 3, spacing: 65, speed: 55, turnRate: 0.08, sharedDetectionMultiplier: 1.4 };
export const ORE_COMBAT = { materialPerDamage: 0.15, recovery: 0.35 };

export const MODULE_CATEGORIES = {
  Weapons:['cannon','pulse','rail','plasma','rocket','flak','emp'], Mining:['miner'], Collection:['tractor','cargo'], Defense:['shield','armor'], Propulsion:['engine'], Power:['reactor'], Utility:['cooler'],
} satisfies Record<string,ModuleKind[]>;
export const MODULE_SHORT:Record<EquipmentKind,string>={core:'Core',cannon:'Auto',pulse:'Pulse',rail:'Rail',plasma:'Plasma',rocket:'Missile',flak:'Flak',emp:'EMP',miner:'Mining',tractor:'Tractor',cargo:'Cargo',armor:'Armor',shield:'Shield',engine:'Booster',reactor:'Reactor',cooler:'Cooler'};
export const STAT_LABELS:Partial<Record<keyof EquipmentStats,string>>={damage:'Damage',cooldown:'Fire rate (shots/s)',mining:'Mining (ore/s)',cargo:'Cargo capacity +',pickup:'Pickup reach +',hull:'Hull',speed:'Cruise speed +',acceleration:'Thrust +',splash:'Blast radius',shield:'Shield',recharge:'Recharge /s',tractor:'Tractor range',pull:'Pull speed',targets:'Target slots',power:'Operating energy',heat:'Operating heat',generation:'Power output /s',energyCapacity:'Energy capacity',cooling:'Cooling /s',heatCapacity:'Heat capacity',empRange:'EMP radius',stun:'Disable (s)',burstSpeed:'Burst speed +',burstThrust:'Burst thrust +',boostDuration:'Burst duration (s)',boostCooldown:'Burst cooldown (s)',boostPower:'Burst energy',boostHeat:'Burst heat'};
