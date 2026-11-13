# Tasks

## HUD, navigation and fleet — built, needs play
- [x] HUD restyle, alarms, collapsible menu/help and wide-screen scaling
- [x] Radar minimap with three ranges; compass strip with markers
- [x] Player map markers (add/remove on the sector map, saved)
- [x] Multiple ships: buy, rename, hangar, switch at a station; cargo unloaded on switch
- [x] 179 tests/build and browser checks at 1024x768 and 2000x1125
- [ ] Human play: HUD size on real monitors, ship price, whether hangar ships should be tied to the station they were left at
- [ ] Next: per-ship hull sprite or colour so fleet ships look different

## Moving belts — completed
- [x] Reusable seeded drifting, elliptical orbital, flowing and static motion definitions
- [x] Gentle minority ambient drift, cohesive individual variation and independent rotation
- [x] Rotation-aware mining, deformation, projectiles, visibility and contacts
- [x] Moving mineral drops, tractor collection and finite-resource conservation
- [x] Inverse-motion chunk queries, deduplication, sparse overrides and cached rendering
- [x] Current-motion regeneration and saved epoch/offset compatibility
- [x] Local enemy/patrol avoidance and rich-belt threat response
- [x] 114 tests/build and ~60 FPS browser stress/reload verification
- [ ] Human playtest of long-distance belt streaming, encounter pacing and mining feel

## Latest balance and editor fixes
- [x] Further reduce gunfire asteroid displacement and cap stacked weapon pushes
- [x] Weaken all L1 weapons while retaining later-tier stats
- [x] Add denser saved asteroid belts/clusters without resetting original deposits
- [x] Raise regional enemy targets and local entity budgets
- [x] Preserve outfitter scroll positions through drag/drop and refresh
- [x] 103 tests/build; exact browser scroll check and 36-enemy ~60 FPS stress check

## Renewable populations — completed
- [x] Central cooldown/threat/density/safety/local-budget configuration
- [x] Seeded asteroid replacement slots, fresh finite reserves, safe offscreen arrivals and bounded records
- [x] Regional enemy recovery and existing-archetype patrols; dormant actor persistence
- [x] Persisted game-time deadlines/counters; unloaded catch-up and migration without reload duplication
- [x] Boss cooldown/unique-reward ledger (actual boss encounters still pending)
- [x] 101 tests, build, browser replacement/mining/save checks and ~60 FPS heavy combat
- [ ] Human playtest of regional regeneration pacing and threat balance

- [x] Reduce asteroid gunfire knockback and verify sustained-fire collision damage

## Five-level module system — completed
- [x] Universal five-tier data, costs, durability, save validation, texture generation and unique core
- [x] All sixteen functional level-5 abilities with shared hooks and independent saved timers
- [x] Exact five-tier tractor/cargo progression; finite ore, exclusive claims and non-recursive damage
- [x] Bounded guided missiles, fragments and nova fields; recognizable lightweight feedback
- [x] UI comparisons, ability names/descriptions/cooldowns, unlock and maximum indicators
- [x] 90 regression tests; build; actual browser upgrade and ~60 FPS L5 large-ship combat check
- [x] Successful Pages deployment and live five-tier upgrade/combat verification
- [ ] Human balance pass on advanced economy and special-ability power/heat interactions

## Current completed stage — module freedom, effects and outfitter
- [x] Remove per-type and total module-count caps; expandable connected-layout editor
- [x] Reactors, cooling, power/heat operation limits and mass-based handling
- [x] Tractor levels: 1/2/3 targets at 150/225/300 px/s; exclusive stable module-local targets
- [x] Full-cargo guards, 120 base capacity and cargo holds adding 60/120/200
- [x] Preserve overflow on cargo-module destruction and old save loading
- [x] Level-2/3 Shift bursts, energy/heat costs and cooldowns
- [x] Seven functional weapon identities, independent weapons and EMP disable pulses
- [x] Shared pooled effects: muzzle flashes, trails, mining/debris, shield hits, collection and rings
- [x] Distinct purple tractors, animated mining/tractor tethers and V toggle
- [x] Three-panel responsive outfitter: category/search, north grid, current → next table and explicit actions
- [x] Immediate ship overview, clear affordability/errors, HUD readability improvements
- [x] Louder normalized procedural sounds, distinct weapons, mine/tractor loops and master/effects controls
- [x] Existing seeded worlds, ore deformation, collision, bases and v1 saves preserved
- [x] Unit regression suite and browser checks at 1440/1366/1024/900 widths
- [x] Heavy combat fixture tuned to ~60 FPS with cached Canvas rendering

- [x] Pointer drag/drop previews, validated targets and direct install/move/swap controls

- [x] Tenfold world area, scaled new geography, legacy persistence and local chunk streaming

- [x] Clearer procedural module hardware, beveled hull plates and tier markers

- [x] Deep Space Patrol background music and persistent audio/VFX settings menu

- [x] Weapon impulse on resistant asteroids and rock-versus-enemy damage/loot verification

- [x] Pixel-art pass: baked low-res sprites, parallax backdrop, enemy silhouettes, hard-edged panels
- [ ] Re-measure the heavy-combat fixture and check the outfitter at all four widths with the new sprites

## Publishing
- [x] Prepare public repository connection and test/build/Pages workflow
- [x] Push tested source to N4STYN8/VOIDFORGE
- [x] Enable Pages, await deployment and verify the live game

## Next feature stage — enemy/boss brief
- [ ] Six enemy classes with distinct loadouts, silhouettes, shields, loot and sounds
- [ ] Tactical state machine: flanking, lead shots, obstacle avoidance, range control and retreat
- [ ] Seeded danger regions linked to rich resource geography and map warnings
- [ ] Boss framework and persistent seeded guarding territories
- [ ] Iron Warden, Crystal Leviathan and Reactor Titan, each with telegraphs/phases/rewards
- [ ] Remaining encounter-specific audio and combat balancing
## Next coherent stage from the latest staged brief
- [x] Enemy classes with distinct loadouts, silhouettes, shields and loot (raider, interceptor, gunship, sniper, frigate, carrier + drones, defender)
- [x] Enemy and boss sound cues (rail charge, missile lock, drone launch, alert, boss warning/phase/defeat, surge, EMP charge, module lost, hull, death)
- [x] Tactical state machine: patrol, investigate, chase, attack, strafe, retreat, reposition, defend, return
- [x] Seeded danger regions linked to rich resource geography, HUD threat chip and map tint
- [x] Boss framework: mounted destructible parts, phases, boss bar, seeded guarded territories, persistent defeat
- [x] Iron Warden
- [x] Crystal Leviathan and Reactor Titan, each with telegraphs/phases/rewards
- [x] Bosses return on the population ledger cooldown
- [x] Horde events with red-alert HUD, banner, siren and salvage bonus
- [ ] Combat balancing (enemy classes, bosses, horde size/frequency) and sound mix from real play; remaining combat-effect polish

## Later systems
- [ ] Refining, crafting, research, player-placed structures and automation
- [ ] Human playtest of economy, power/cooling, cargo and progression balance

## Outpost construction (brief: Modular Outpost Construction System)
- [x] Phase 1: Build module with Core level 4 unlock and five levels
- [x] Phase 2: world-aligned nested construction grid, Build Mode, placement preview and rules
- [x] Phase 3: Outpost Core, wall, reinforced wall, visual connections, construction time, damage, connectivity, save/load
- [x] Phase 4: autocannon/missile/railgun turrets, reactors and battery, storage blocks and cargo transfer
- [x] Shield generator, cooling unit, radar tower
- [x] Phase 5: mining drones (hangar) and docking station unload/repair
- [x] Drone repair bay
- [ ] Enemies attacking drones
- [x] Phase 6: upgrade and repair stations, five-level building upgrades with level-5 specials
- [x] Phase 7: enemy raids on outposts, away-from-player settlement on return
- [x] Phase 8: machinery animation, raid/drone cues, baked sprites and cached stats
- [ ] Outpost balancing from real play (costs, turret strength, raid size and frequency, drone rates)
- [ ] Decide whether ships and asteroids should collide with outpost blocks
