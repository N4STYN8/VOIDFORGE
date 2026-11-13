import type { EquipmentKind } from './data.ts';
/** Paid ultimate modifiers. Per-projectile/field limits bound effects, not installed modules. */
export const SPECIAL={
 core:{duration:7,cooldown:30,costMultiplier:.65,output:1.25,power:40,heat:15},
 cannon:{ramp:2,maxBonus:2.2},pulse:{range:160,fraction:.4,every:4,targets:4,falloff:.8,damage:2.25,power:2,heat:1.5},rail:{every:3,targets:5,falloff:.8,damage:2,power:1.75,heat:1.5},
 plasma:{every:4,blast:1.4,damage:1.75,power:2.2,heat:1.8,duration:3,fraction:.35,maxFields:8},rocket:{cooldown:8,count:6,fraction:.55,power:2.4,heat:1.8,maxActive:24,turnRate:4,range:900,lifetime:4},
 flak:{pellets:11,count:3,fraction:.3,maxActive:96,lifetime:.6},emp:{range:180,fraction:.5,stunFraction:.5,maxSecondary:5,radius:1.3,recovery:4,maxPulses:12},
 miner:{interval:1,extra:12,efficiency:.65},tractor:{duration:3,cooldown:12,rangeMultiplier:1.75,speed:1.5,slots:3,cost:1.8},
 armor:{threshold:20,duration:3,cooldown:12,reduction:.5,passive:.25,power:20,heat:6},shield:{fraction:.25,duration:2.5,cooldown:18,reduction:.35,power:30,heat:8,regen:2.5,cost:1.75},engine:{invulnerable:.45,phaseCooldown:5},
 reactor:{threshold:.32,duration:4,cooldown:16,bonus:1,heat:16},cooler:{threshold:.8,duration:3,cooldown:14,fraction:.45,bonus:1.5,power:20},
};
export const ABILITIES:Record<EquipmentKind,{name:string;description:string;cooldown?:number}>={
 core:{name:'Command Overclock',description:'Press C: connected weapons, mining, collection, shield regeneration, construction, generation and cooling gain 25% output; operation energy/heat costs fall 35% for 7 seconds. Costs 40 energy and 15 heat.',cooldown:30},
 cannon:{name:'Bullet Storm',description:'Sustained firing ramps up to +220% fire rate over 2 seconds. Every round still costs energy and heat; release resets the ramp.'},
 pulse:{name:'Overcharged Beam',description:'Every fourth bolt deals 225% damage and pierces up to 4 enemies with 20% falloff. Overcharged bolts cost double energy and 50% more heat.'},
 rail:{name:'Hypervelocity Shot',description:'Every third shot deals double damage, bypasses armor (not shields), and penetrates up to 5 enemies with 20% falloff. Costs 75% more energy and 50% more heat.'},
 plasma:{name:'Supernova Blast',description:'Every fourth shot deals 175% damage with 40% larger blast radius, costing 120% more energy and 80% more heat. L5 impacts leave 3-second fields; overlapping fields use only the strongest damage (8-field limit).'},
 rocket:{name:'Swarm Barrage',description:'Adds 6 guided missiles at 55% shot damage each. Barrage costs 140% more energy and 80% more heat; 24 guided missiles maximum.',cooldown:8},
 flak:{name:'Shrapnel Storm',description:'Fires 11 pellets per paid volley. Each impact can split into 3 fragments at 30% pellet damage. Fragments never split again; 96-fragment limit.'},
 emp:{name:'System Blackout',description:'30% larger pulse disables multiple enemies and cascades to 5 secondary targets. Enemies gain a recovery window after a disable; bosses take damage without being stun-locked.'},
 miner:{name:'Industrial Excavator',description:'Consumes 35% less operating energy/heat and extracts 12 extra minerals each second from the actual remaining asteroid reserve. Nothing is created.',cooldown:1},
 tractor:{name:'Gravity Vortex',description:'For 3 seconds, gains 75% range, 50% pull speed and 3 extra target slots. Vortex operation costs 80% more energy/heat; minerals cannot be claimed twice.',cooldown:12},
 cargo:{name:'Compression Storage',description:'600 effective cargo capacity per L5 hold, including compression above the normal 400-unit chamber. Multiple holds add capacity without duplicating cargo.'},
 armor:{name:'Fortress Armor',description:'25% passive damage reduction. A hit of 20+ damage can spend 20 energy/6 heat for 50% additional reduction against later hits for 3 seconds. Bonuses do not multiply across plates.',cooldown:12},
 shield:{name:'Aegis Field',description:'A projectile hit can spend 30 energy/8 heat for 35% damage reduction and 150% faster powered shield regeneration for 2.5 seconds. Regeneration costs 75% more energy/heat during the field; reflects 25% absorbed projectile damage once.',cooldown:18},
 engine:{name:'Warp Burst',description:'Shift delivers extreme short acceleration. The first 0.45 seconds protect against damage; shared protection recovery prevents permanent immunity. Normal burst energy/heat costs remain.'},
 reactor:{name:'Overdrive Reactor',description:'Below 32% energy while draw exceeds output, doubles this reactor output for 4 seconds while generating 16 extra heat/s. Output does not compound.',cooldown:16},
 cooler:{name:'Cryogenic Surge',description:'At 80% heat, spends 20 energy to purge 45% thermal capacity and boost this cooler output 150% for 3 seconds. Shared recovery prevents repeated stacking.',cooldown:14},
 builder:{name:'Industrial Fabricator',description:'L5 constructs at 5× base speed and repairs nearby outpost blocks at 50 hull/s using carried iron, 16 energy/s and 4 heat/s. Construction and repair still spend real minerals.'},
};
