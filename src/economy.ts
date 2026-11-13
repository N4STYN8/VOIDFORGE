import type { Resource } from './data.ts';
export type Minerals=Record<Resource,number>;
export const minerals=(iron=0,copper=0,crystal=0,ice=0,radioactive=0):Minerals=>({iron,copper,crystal,ice,radioactive});
/** All prices round upward when paid; salvage rounds downward. No timed progression gates. */
export const ECONOMY={
 upgradeMultipliers:[2,5,12,30],
 categories:{basic:['armor','cargo','cannon','miner'],moderate:['pulse','tractor','engine','cooler','flak'],advanced:['rail','plasma','rocket','shield','reactor'],specialized:['emp','builder']},
 purchases:{cannon:minerals(60,30),miner:minerals(45,30),armor:minerals(65,15),cargo:minerals(55,10),pulse:minerals(90,60),tractor:minerals(85,55),engine:minerals(80,55),cooler:minerals(70,45),flak:minerals(95,65),rail:minerals(160,100),plasma:minerals(145,95),rocket:minerals(135,90),shield:minerals(130,90),reactor:minerals(150,100),emp:minerals(190,130),builder:minerals(350,220),core:minerals(150,75)},
 // Additional deposits required by the destination tier; no rare gate before core 4.
 tierMaterials:[minerals(),minerals(0,0,40,20),minerals(0,0,180,90,25),minerals(0,0,650,300,150)],
 coreUpgrades:[minerals(3000,1500),minerals(10000,5000,1000,400),minerals(36000,18000,5000,2500,800),minerals(200000,100000,35000,18000,9000)],
 structureMultiplier:3,structureUpgradeMultipliers:[2,5,12,30],
 drones:{rate:2,awayRate:.6,launchEnergy:8},
 // Existing field abundance, enemy rewards and renewal intervals are intentionally retained.
 mining:{minimum:25,spread:46,radioactiveBonus:15,fieldWeights:['iron','iron','iron','copper','copper','crystal','ice','radioactive'] as Resource[]},
 targetsMinutes:[[15,25],[45,75],[120,240],[360,600]],
} as const;
export function missingMinerals(price:Minerals,available:Minerals){return Object.entries(price).filter(([ore,n])=>n>available[ore as Resource]).map(([ore,n])=>`${Math.ceil(n-available[ore as Resource])} ${ore}`).join(', ');}
/** Pre-rebalance valuation for untracked legacy modules: never mint a higher refund by loading an old ship. */
export const LEGACY_PURCHASES:Record<string,Minerals>={cannon:minerals(20,10),pulse:minerals(25,15,5),rail:minerals(45,25,12),plasma:minerals(35,20,8),rocket:minerals(30,15),flak:minerals(30,20,5),emp:minerals(35,20,10),miner:minerals(15,10),tractor:minerals(25,15,5),cargo:minerals(20),armor:minerals(25,5),shield:minerals(25,15,5),engine:minerals(20,15),reactor:minerals(30,15,5),cooler:minerals(20,10,0,10),builder:minerals(60,40,15)};
export function legacyInvestment(kind:string,level:number):Minerals{const base=LEGACY_PURCHASES[kind],paid={...base};for(let l=1;l<level;l++){paid.iron+=Math.max(15,base.iron)*l;paid.copper+=Math.max(5,base.copper)*l;paid.crystal+=l>=2?5*l:0;paid.ice+=l>=3?10*(l-2):0;paid.radioactive+=l>=4?10:0;}return paid;}
