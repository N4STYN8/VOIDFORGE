import type { EquipmentKind } from './data.ts';
export const ABILITIES:Record<EquipmentKind,{name:string;description:string;cooldown?:number}>={
 core:{name:'Command Overclock',description:'Press C: module energy and heat costs fall 25% for 6 seconds. Costs 30 energy and 10 heat; construction rules remain unchanged.',cooldown:30},
 cannon:{name:'Gatling Fury',description:'Sustained firing ramps fire rate up to +60% over 3 seconds. Releasing fire resets the bonus.'},
 pulse:{name:'Chain Lightning',description:'Hits arc 40% damage to one other enemy within 160 units. Arcs cannot chain again.'},
 rail:{name:'Hypervelocity Round',description:'Every fourth shot penetrates up to 3 enemies, with 30% damage falloff after each hit.'},
 plasma:{name:'Plasma Nova',description:'Explosions leave a 3-second energy field dealing 20% shot damage per second. Overlapping fields apply only the strongest damage; maximum 8 fields.'},
 rocket:{name:'Swarm Strike',description:'Adds 3 guided mini-missiles, each dealing 30% shot damage. Maximum 24 guided missiles at once.',cooldown:6},
 flak:{name:'Shrapnel Storm',description:'Pellets split into 2 short-lived fragments on impact, each dealing 25% pellet damage. Fragments cannot split again; maximum 96 special projectiles.'},
 emp:{name:'System Cascade',description:'Each pulse spreads 35% damage and half-duration disable to up to 3 nearby secondary enemies within 120 units. Secondary hits cannot spread again.'},
 miner:{name:'Deep Core Extraction',description:'Consumes 15% less operating energy and heat. Every 2 seconds of mining extracts 4 extra minerals from remaining finite reserves.',cooldown:2},
 tractor:{name:'Magnetic Sweep',description:'Attraction range increases 50% for 3 seconds every 10 seconds while collecting. Keeps the 5-target limit.',cooldown:10},
 cargo:{name:'Quantum Compression',description:'Compresses the normal 400-unit hold to 500 effective capacity (+100 included in the level-5 statistic). No extra physical block.'},
 armor:{name:'Reactive Armor',description:'A hit of 20+ damage activates 35% reduction against subsequent hits for 3 seconds. Plates do not multiply reduction.',cooldown:10},
 shield:{name:'Reflective Barrier',description:'Reflects 25% of projectile damage absorbed by shields back to the firing enemy. Multiple generators do not multiply reflection; reflected hits cannot reflect again.'},
 engine:{name:'Phase Dash',description:'Shift burst grants damage immunity for its first 0.3 seconds. Normal burst energy, heat and cooldown still apply.'},
 reactor:{name:'Emergency Overdrive',description:'When energy falls below 25% and peak draw exceeds output, adds 50% of this reactor’s output for 4 seconds, generating 12 heat/s.',cooldown:14},
 builder:{name:'Industrial Fabricator',description:'Automatically repairs damaged outpost blocks within construction range at 25 hull per second, spending carried iron and 8 energy per second.'},
 cooler:{name:'Cryogenic Purge',description:'At 85% heat, instantly purges 30% of ship thermal capacity. Each cooler has its own cooldown.',cooldown:12},
};
export const SPECIAL={
 core:{duration:6,cooldown:30,costMultiplier:.75,power:30,heat:10},
 cannon:{ramp:3,maxBonus:.6},pulse:{range:160,fraction:.4},rail:{every:4,targets:3,falloff:.7},
 plasma:{duration:3,fraction:.2,maxFields:8},rocket:{cooldown:6,count:3,fraction:.3,maxActive:24,turnRate:4,range:700,lifetime:4},
 flak:{count:2,fraction:.25,maxActive:96,lifetime:.6},emp:{range:120,fraction:.35,stunFraction:.5,maxSecondary:3},
 miner:{interval:2,extra:4,efficiency:.85},tractor:{duration:3,cooldown:10,rangeMultiplier:1.5},
 armor:{threshold:20,duration:3,cooldown:10,reduction:.35},shield:{fraction:.25},engine:{invulnerable:.3},
 reactor:{threshold:.25,duration:4,cooldown:14,bonus:.5,heat:12},cooler:{threshold:.85,cooldown:12,fraction:.3},
};
