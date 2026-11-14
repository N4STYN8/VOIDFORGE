# Game design

## World and exploration
- World: approximately 60,716 × 60,716 (10 times the previous 19,200-square world area). A fresh UUID seed or manually entered seed determines starting base, outposts, curved belts, clusters, density and resource regions.
- Validated starts have clear structures/ship space, reachable iron/copper, and a wide escape corridor. Richer regions and rare resources vary by seed and require exploration.
- Iron, Copper, Crystal, Ice and Radioactive ore each have finite asteroid quantities. Base inventory capacity is 120; cargo holds increase it.
- Discovery reveals 480-unit tiles around the ship. Minimap and expanded map hide unexplored terrain/outposts; enemy markers represent nearby detection. M or minimap click opens the map; wheel zooms and dragging pans the expanded map.

## Mining and ore
- Hold right click or Space to auto-mine within 240 units. An aimed reachable deposit has priority; otherwise choose the nearest.
- Level-1 miners focus a shared target. With multiple miners and a level-2 hull, level-2+ beams can select separate asteroids. Rates per miner: 9 / 15 / 24 ore per second.
- The laser hits the near polygon edge. Material removal dents that side, shrinks polygon area, exposes seams/cracks, updates collision geometry and emits 2–4 tiny fragments. Particles are capped at 80 and fade quickly.
- Mined ore becomes loose pickups, collected within 65 units plus collector bonuses. Tractor beams actively pull ore toward the ship with visible beams.
- Shooting removes material at 0.15 units per damage and recovers only 35% of it; the rest is lost. Mining recovers all removed material. Final destruction releases only the remaining quantity once.
- A weak emergency core beam provides 3 ore/s if all miners are lost.

## Movement, combat and damage
- WASD applies thrust with momentum and coast drag; mouse aims. Wheel changes playfield zoom. Esc pauses. Losing focus pauses.
- Left click fires cannons and rockets outside active safe zones. Projectiles continue until impact or leaving the visible playfield. Rockets cause area damage.
- Raiders, scouts, heavies and snipers have different health/speed/range/weapons. Some patrol in three-ship formations, share alerts and regroup when not engaged. Asteroids block visibility and fire. Only detected/visible players trigger attacks; safe zones exclude enemies and disable player weapons.
- Ships collide with ore and each other. Asteroids can be pushed and transfer momentum to other deposits. Gentle nudges are safe; hard impacts cause speed-based damage, capped at 25 per 0.6 seconds.
- Shields absorb damage before hull, recharging three seconds after the last hit. Blocks have individual integrity; broken blocks and disconnected branches detach and leave mineral salvage. Lost modules must be replaced.
- Death drops carried resources. R respawns at the nearest active base with current surviving modules; stored minerals remain safe.

## Shipyard and bases
- Q (or B) opens the outfitter at an active base. Core stays at grid center; north is forward. Grid art and ship layout match. Drag or use Move to relocate/swap blocks; all blocks must stay connected. Removal refunds paid minerals in proportion to integrity.
- Core levels provide 100/150/225/320/450 base hull and better energy/cooling. Equipment cannot exceed core level. There are no per-type or total module-count caps. Each of the 16 equipment types supports five levels; only the core is unique.
- Equipment: autocannon, pulse laser, railgun, plasma cannon, missile launcher, flak cannon, EMP emitter, mining beam, cargo hold, armor, tractor, shield, booster, reactor and cooler. Exact stats/costs/limits live in src/data.ts and are shown in the outfitter.
- E unloads resources and attempts a paid repair. Repair charges iron for missing hull/module integrity and copper for damaged module integrity; failed payment never heals. Shop quotes the cost. Shield recharge is free.
- G near a locked outpost activates it with its displayed mineral cost, using carried ore plus shared base storage. Seven bases exist per world, including the starting base. Active bases offer repair, storage, outfitting and nearby respawn.

## Persistence and scope
- Autosave every 10 seconds and on hide/exit. Save/Load buttons manage browser storage; Export/Import uses JSON save files. New world creates a new seed unless a seed is entered. Previous local save is backed up before replacement.
- Saves include seed/geography, starting coordinates, player/ship, resources, asteroid modifications/tombstones, discovered map, outpost unlocks and simulation actors.
- Research, refining, crafting chains, player-placed structures, power/heat, additional equipment tiers and full progression balancing remain future work. Existing outposts and ship construction are persisted; no separate player-built structure system exists yet.

## Module freedom, tractors and ship systems
- Build grid pans/zooms beyond its viewport. Valid attached blocks can be installed repeatedly without type/count caps. Mass affects speed/thrust; reactors combine energy generation/storage and cooling systems combine dissipation/thermal capacity. Operating equipment consumes real energy and adds heat, pausing if unavailable or overheated.
- Tractor levels: range 180/300/450/550/650; exactly 1/2/3/4/5 independent target slots; pull speed 150/225/300/375/450. Targets persist until lost, collected or out of range, are exclusively claimed, and pull toward the module's collection point. Cargo full stops collection.
- Cargo holds add 60/120/200/300/500 capacity plus pickup reach. Full cargo stops mining. Removal that would overfill cargo is rejected; destruction/load overflow becomes nearby pickups, preserving quantities.
- Level-2/3 boosters keep cruise bonuses and add Shift bursts: +150/+240 raw speed and +400/+650 thrust for 1.8/2.2 seconds, with 6/5-second cooldowns and upfront energy/heat cost. Multiple boosters combine, subject to mass and power.
- EMP emits a growing pulse that damages each enemy once and temporarily disables it. Other new weapons have independent projectiles/loadouts; no additional ammunition inventory is required.
- Q outfitter has categorized/searchable catalog, north-facing construction grid, exact current → next comparisons, action costs/refunds, live ship overview and clear failure feedback. Flight HUD groups vitals and carried/stored minerals; secondary details expand.
- Bounded pooled procedural effects support trails, muzzle/impact/shield flashes, collection bursts, debris, rings and animated beams. V toggles enhanced effects without affecting gameplay. All tractor levels use purple tones; mining uses green/cyan/pale-yellow tones.
- N mutes; Audio settings provide master/effects volume. Default volume is moderately louder, weapon profiles differ, and mining/tractor hums stop when their actions end.

## Next staged expansion
The newer six enemy classes, tactical AI expansion, seeded danger regions and three bosses are queued after the outfitter stage. Current four classes/patrol AI remain in place; this update does not claim those later stages are complete.

Shots push asteroids along projectile travel; explosive hits push outward. Impulse scales with damage and inversely with rock mass, capped at 12 units/s from gunfire for resting rocks (existing collision momentum is preserved). Weapons remove material at 10% of nominal damage and recover 35% of removed ore; mining remains efficient. Moving rocks can damage and kill enemies through normal impact contacts.

## Level-5 abilities
Normal statistics improve at every level; abilities unlock at level 5. Costs for tiers 4/5 also require ice/radioactive minerals. All definitions and tuning live in abilityConfig.ts/data.ts.
- Core: C Command Overclock, 6s at 25% lower module power/heat cost, 30s cooldown; costs 30 energy/10 heat.
- Autocannon: Gatling Fury, up to +60% firing rate after 3s sustained fire, reset on release.
- Pulse: Chain Lightning, one secondary at 40% damage within 160 units; no recursion.
- Rail: Hypervelocity Round, every fourth shot penetrates 3 enemies at 0.7 successive damage.
- Plasma: Nova fields last 3s at 20% shot damage/s; strongest overlapping field only, maximum 8.
- Missiles: Swarm Strike, three 30%-damage guided missiles every 6s; global 24 guided missile cap, 4s lifetime.
- Flak: Shrapnel Storm, two 25%-damage fragments per impact, one generation, global 96 fragments, 0.6s lifetime.
- EMP: System Cascade spreads 35% damage/half stun to up to three secondaries per pulse; no recursion or double hits.
- Mining: Deep Core Extraction uses 15% less operating energy/heat; extracts four extra ore from finite reserves every 2s of active mining.
- Tractor: Magnetic Sweep adds 50% range for 3s every 10s, with five exclusive targets per module.
- Cargo: Quantum Compression makes the L5 hold 500 capacity (normal 400 +100 compression, included in displayed value).
- Armor: Reactive Armor triggers on 20+ damage, reducing subsequent hits by 35% for 3s; 10s cooldown per plate, reduction does not multiply.
- Shields: Reflective Barrier returns 25% of absorbed projectile damage to the firing enemy; no recursion or multiplier from duplicate shields.
- Boosters: Phase Dash avoids damage for the first 0.3s of a paid Shift burst.
- Reactor: Emergency Overdrive adds 50% reactor output for 4s when low energy and peak demand exceeds base output; +12 heat/s, 14s cooldown.
- Cooler: Cryogenic Purge removes 30% thermal capacity at 85% heat, 12s cooldown per module.

## Renewable populations
Each original asteroid is a finite deposit; depletion persists. Its field slot can receive a new deposit of the same resource class, using salted seeded chunk generation at a different non-overlapping position. Common ore renews after 2–5 minutes, ice 3–5, crystal/radioactive 8–15. Camera/ship/base obstruction defers arrival rather than forcing it. Field targets follow the original seeded per-chunk population; no global world count limit.
Population updates run every 5 seconds of active game time. At most 2 rocks and 3 enemies arrive per update; local budgets are 2,400 asteroids and 36 enemies, independent of world population targets. Rocks arrive with 1–4 units/s drift. Reloading preserves timers; paused/closed games do not advance the population clock.
Enemy regions span 3,600 units and derive low/medium/high threat from seeded field richness and rare ores. Targets are 5/10/16 enemies, respectively, using existing raider/scout patrols and tank/sniper guards. Normal recovery takes 1–3 minutes; guards 5–10. Enemies enter offscreen at least 900 units away, outside ore, ships and structures. Distant enemies become dormant instead of dying or granting loot.
Boss encounter content is not implemented. The persistent encounter ledger is ready to gate repeat defeats for 20–30 minutes and grant a unique progression reward only once; it does not create new bosses.

Starter weapon damage is now 12/11/45/27/39/4/9 for autocannon/pulse/rail/plasma/missile/flak pellet/EMP. Higher levels keep their established damage. Weapon asteroid impulse is 0.3 per damage divided by rock mass. Additional seeded belts and clusters add up to 32 candidate deposits per chunk through the existing safe population scheduler, preserving original geography and depleted rocks.

## Moving fields
Worlds contain static formations, drifting belts, elliptical orbital belts and looping flowing belts. Shared motion follows saved game time, with small individual variation and slow rotation. Large-belt speed parameters range 2–8 units/s; smaller formations 5–12. About one fifth of eligible independent rocks drift at 1.5–3.5 units/s. Starter deposits and unsafe paths near bases/world edges stay protected.
Mining and collisions use each asteroid's current rotated polygon. Mineral drops inherit 50% of rock velocity; tractors pull them normally. Depletion stays finite and replacement deposits join their parent's current motion. Saves preserve epoch, path parameters, mining and physical offsets; unloaded belts catch up analytically. Existing worlds begin motion at their saved epoch, not at an arbitrary advanced phase. Paused menus/maps do not advance game time.

## Factions and expanded encounters
Rust Pirates favor fast scouts/raiders/missiles; Iron Dominion favors armored gunships, railguns and shield support; Void Reclaimers use mining marauders, plasma, EMP and Scrap Drones. Regional fleets share patrol/alert behavior and retain loose formations outside combat. Threat changes fleet composition plus bounded stats; core progression adds only a small boost outside home waters.

The six featured bosses are Iron Warden, Rust Leviathan, Copper Tyrant, Void Harvester, Storm Engine and Dreadforge. Crystal Leviathan and Reactor Titan remain as additional encounters. Destroy weapon mounts, generators, bays, coils and engines to weaken their respective systems. Avoid charge lines, electrical hazard rings and the Dreadforge's final meltdown circle. EMP briefly interrupts powered systems but never stops basic thrust. Bosses return only after their 20–30 minute ledger cooldown and after the player leaves the territory; repeat rewards remain reduced.

Enemy miners consume the same finite ore as players. They collect existing pickups, carry cargo, and drop a configured fraction when destroyed. Shield support does not stack, ends with the carrier, and protects only nearby allies.

## Cockpit interface
The flight view retains its existing navy/cyan square pixel interface. Left: hull/shield/energy/heat, cargo, inventory and ship stats. Top: exploration-grid sector, coordinates, regional threat and nearest unlocked forge. Right: explored radar, cursor-acquired visible enemy and installed weapon readiness. Bottom command modules use Shift, C, Q, F, M and E through the existing systems. Compact/full toggles optional detail; Systems holds save/load/import/new-world/audio controls. No HUD action bypasses equipment, station, power or heat requirements.
The reference-inspired frame uses angular blue-gray armor and restrained cyan indicators. Circular radar is local and explored-only; the M sector map remains the full exploration view. When no hostile is acquired, the target bay can identify a nearby discovered forge using its actual identity/distance and existing station sprite. Settings is also available from the command console.
The detailed cockpit adds layered navy armor, recessed fittings and segmented instrument faces while retaining the same pixel-scale art direction. Radar supports the shared navigation zoom controls and wheel; waypoints and compass remain available. Ship identity, fleet information, hull-paint selection and save controls are preserved.
The cockpit uses locally bundled Material Symbols for clearer status/action silhouettes. Full desktop HUD keeps cargo, inventory, statistics and forge controls visible without whole-panel scrolling; short windows use tighter spacing. Navigation/settings remain accessible while paused. Circular radar markers pin to the round boundary and all status values remain tied to actual game state.
The outfitter shares the cockpit's navy/cyan instrument housings and local icons. It retains the fleet/paint strip, stored minerals, north-facing module grid, live upgrade comparison and repair footer. Module level is shown with tier pips in the inspector and a compact badge on each installed block; all prices and actions use existing gameplay rules.
HUD commands retain their native button identity across status/cooldown refreshes, so normal-length mouse presses and keyboard activation complete reliably. Button availability still follows the existing equipment, safe-zone, station and pause rules.

## Ultimate equipment progression
All 17 equipment types have exactly five tiers with core-tier gating and no module-count caps. Base weapon throughput climbs roughly 3–5× from L1 to L5; L5 adds named tactical abilities rather than unlimited free output. C activates seven-second Command Overclock; Shift activates paid engine bursts with a brief L5 Warp protection window.
L5 weapons gain sustained Bullet Storm, every-fourth Overcharged Beam, every-third armor-piercing Hypervelocity Shot, periodic Supernova Blast, six-missile Swarm Barrage, Shrapnel Storm and System Blackout. Penetration falls off per target; shields still protect against rail shots. Extra shots/fields/fragments have global budgets. EMP has shared per-enemy recovery and cannot disable bosses.
Industrial Excavator extracts bonus material from finite reserves; Gravity Vortex claims each drop only once; Compression Storage adds 600 capacity. Fortress Armor/Aegis Field/Cryogenic Surge use paid activations and shared recovery; Overdrive Reactor adds bounded generation with heat. Industrial Fabricator spends carried iron, energy and heat on repairs. Existing minerals and overflow remain intact on load.

## Economy progression
New module purchases use common minerals and category-specific prices. Upgrades cost 2/5/12/30× purchase price plus destination-tier deposits. Core milestone prices are separate and substantially higher; core gating, Build access at core 4 and all ultimate abilities remain intact. Outpost structures cost three times their former base prices, with escalating upgrade costs and existing bounded construction discounts. Drone rates are 2 ore/s active and 0.6 ore/s away; launches cost 8 energy. Real deposits and storage still bound income.
The outfitter shows required, stored and missing minerals alongside levels/stat comparisons. Newly generated worlds weight common fields more heavily, guarantee crystal/ice/radioactive field types, and scale reserves by asteroid area. Existing saved geography/yields remain versioned. Mining/combat reward mechanics and renewal cooldowns are preserved. New prices apply to future spending; historical equipment refunds use tracked investment or the old valuation.
Pacing estimates and assumptions are in ECONOMY_REPORT.md, regenerated with npm run economy. Initial measured/assumed core estimates: 21m/59m/2.4h/7.7h; these are not forced timers or verified human completion times.

Sector chart: M/minimap opens a translucent live navigation overlay at ship-follow zoom. WASD/Shift remain active; enemies and time continue. Wheel/drag browse freely, Follow ship recenters, World shows the full extent. Click places/removes waypoints without firing through the chart; only explored geography is revealed. Esc closes the chart first; explicit pause still freezes gameplay.

## Main menu / landing page
The game starts at the animated Last Forge menu. Continue loads the newest valid saved world; without one it is disabled. Returning from Settings → Main menu offers save, return without saving, or cancel. The current session can be resumed without loading over unsaved progress. New Game offers an optional seed and explicit replacement confirmation; backup must complete before replacement. Save errors are visible and do not silently create a replacement world.
Tutorial explains actual controls and leads to the normal New Game confirmation. Lore introduces The Shattering and SPARK without blocking play. Multiplayer opens the actual shared-sector/lobby controls; connections remain opt-in. Returning to the menu disconnects and brings guests home, respecting the chosen save option. Settings reuse the existing audio/VFX controls. The menu's illustrated Forge scene and animated traffic honor reduced motion and stops while playing.
Menu: New Game warns before replacing the active voyage and requires Confirm new game; Cancel is the default focus. Menu/dialog buttons play short hover/click/warning sounds through normal audio settings. Decorative ship flybys are removed.
Compact HUD now uses floating vitals/cargo and radar cards plus a short centered action bar, leaving the flight view open. The Full HUD button restores the detailed cockpit; the browser remembers the chosen density. All commands and essential gauges remain available.

## Industrial audio upgrade
Successful Forge/outpost/fleet mineral transfers play clamps, a short rattle sequence and confirmation. 100+ loads sound heavier, with deeper pitch for 500+. Empty cargo has no deposit-success sound. Mining adds cutting crackle to its persistent hum; mineral pickups aggregate with light/heavy mechanical variations.
All seven weapon identities remain, with deeper levels and a paid-ultimate discharge layer. Added bounded power/heat warnings, shield depletion/recovery, Overclock/Warp/reactor/cooling/defensive/tractor/excavator activations, respawn/rebuild, assembly/upgrades/move/removal/repairs, outfitter open/close, outpost construction completion/hits and menu open/confirm/cancel/launch cues. Volume/mute/music settings are unchanged; action cues survive the paused outfitter. See AUDIO_AUDIT.md for coverage and remaining remote-pilot audio/listening gaps.

Ship zoom: the player's modular layout now renders from a single cached hull image so wheel zoom samples adjacent blocks together. Module art, ship dimensions and collision behavior are unchanged; moving/upgrading/repainting a block refreshes the image.

World sound follows visible event origins: off-screen weapon fire, ore/enemy hits, destruction and tool targets are silent. Menu/inventory confirmations remain audible. Mechanical effects have stronger metallic texture and temporarily duck music; existing player volume controls remain authoritative.
