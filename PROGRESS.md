# Progress

## Latest — moving asteroid belts and gentle ambient drift
- Seeded static, drifting, elliptical orbital and looping figure-eight flowing belts. Shared motion is analytical in saved game time; individual bounded variation and slow independent rotation keep formations cohesive.
- About 20% of eligible non-belt rocks have sustained 1.5–3.5 units/s drift; starter deposits/base approaches stay protected. Moving belt speeds are configurable (large 2–8, small 5–12 parameter ranges).
- Mining/deformation, swept projectiles, visibility and ship contacts use rotation-aware local coordinates. Drops inherit half rock velocity and remain tractor-collectible. Enemy movement/patrols locally steer around moving rocks; rich moving groups raise regional threat.
- Streaming inversely queries belt motion, filters current-space actors, deduplicates IDs, prioritizes nearby rocks under budget and retains sparse mining/contact overrides. Cached source chunks and a two-second activation cadence avoid distant physics simulation.
- Regeneration preserves parent belt identity and joins its current motion at safe offscreen locations. Optional v1 metadata stores belt definitions/epoch, per-rock offsets/rotation and drop velocity; old worlds start motion at their saved epoch without position jumps.
- 114 tests pass; production build passes. Browser stress: 296 moving rocks, 36 enemies and 33-module mining/combat ship measured ~60 FPS (maximum observed frame ~26 ms), with no runtime errors. Reload preserved elapsed motion. A second two-hour world with 16 belts, 683 active rocks (497 belt members), 36 enemies and the same ship also measured ~60 FPS (max observed frame ~32 ms).
- Next: human playtest of belt pacing/streaming and resource-rich patrol pressure. Boss encounter content remains queued; no new boss system was introduced.

## Branch merge note (2026-11-13)
- The pixel-art, enemy-class, AI, danger-region, boss and sound work below was rebuilt on top of main's five-level modules, level-5 abilities, renewable asteroid fields and regional enemy population. 128 tests pass (main's 103 plus the branch's, with one new integration test); build passes; browser checked an old save loading, a fresh world, a boss fight in an extreme region and the outfitter, with no runtime errors.
- Bosses now return on main's ledger cooldown (20-30 minutes); their territory is safer in between and repeat kills pay half the reward.
- Horde events added: after several minutes in open space (sooner in dangerous regions) the HUD flashes red with an ALERT banner, a siren and chevrons showing the approach direction; ten seconds later 6-15 enemies (by danger level) arrive together and hunt the player. Docking during the alert calls it off, a horde that is outrun gives up, and destroying one pays a salvage bonus. 130 tests pass; browser confirmed the alert, banner, flashing panels and a 15-ship horde with no errors.
- Unplayed: balance of the new enemy classes and hordes against the 40% weaker level-1 weapons; horde frequency and size are first guesses.

## Latest — gentler gunfire, weaker starters, denser space and stable outfitter scrolling
- Weapon asteroid impulse reduced another 90% (3→0.3), resting-rock shot speed cap 120→12. Repeated volleys cannot accumulate high speed; existing ship/collision momentum is preserved.
- L1 damage reduced ~40% across all seven weapons: cannon 12, pulse 11, rail 45, plasma 27, missile 39, flak 4/pellet, EMP 9. Tiers 2–5 and firing intervals unchanged.
- Added a saved seeded belt/cluster layer with up to 32 extra asteroid candidates per chunk. Original asteroid IDs, shapes, positions, depletion and upgrades remain intact. Additional deposits enter through safe scheduled offscreen arrivals, including existing worlds; no reset required.
- Enemy targets increased to 5/10/16 for low/medium/high threat; active enemy budget 24→36, asteroid local budget 1,800→2,400. Cooldowns and gradual spawn rates retained.
- Outfitter refreshes restore catalog, grid, detail and outer scroll positions after placement/upgrades/dragging. Browser drag/drop test preserved catalog scroll exactly (647→647).
- 103 tests pass; production build passes. Browser stress test with 33 modules and 36 enemies runs ~60 FPS with no runtime errors. Next: human balance feedback on starter combat and field/patrol density.

## Latest — renewable regional populations
- Depleted asteroid slots replenish at different seeded positions using the existing field generator: common 2–5 minutes (ice 3–5), crystal/radioactive 8–15. New shape/size/yield, same resource class, gentle drift, no visible/overlapping/ship/base spawns; blocked arrivals defer.
- Field targets follow original per-chunk seeded density. Gradual scheduled arrivals, 1,800 local asteroid budget, sparse slot reuse across repeated generations; original tombstones and modified geometry remain saved.
- Replaced the ten-second global enemy spawner with regional threat profiles, normal 1–3 minute and heavy/sniper 5–10 minute recovery, safe randomized patrol entry and 24 active-enemy budget. Distant actors sleep with health/patrol state, count against regional targets, and wake without duplicate rewards.
- Persisted elapsed game time, cooldowns, counters, retries, replacement state and dormant enemies in optional v1 fields. Unloaded regions become eligible through absolute game-time deadlines; no wall-clock/offline grants or distant physics simulation.
- Boss cooldown/one-time reward ledger supports 20–30 minute recovery and is tested. There are no implemented boss encounters to integrate; actual boss spawning remains in the queued boss stage.
- 101 tests pass, including 60 renewal cycles, old-save migration, rare delays, placement safety, cooldowns, unloaded catch-up, reload conservation, dormancy and boss reward guards. Production build passes.
- Browser: actual replacement arrival, save/reload without duplicate/clock reset, mining a carved replacement, and 33-module L5 combat all render without runtime errors at ~60 FPS.
- Next: human balance pass on replenishment/threat rates, then the existing enemy-class overhaul. No new blocking failures found.

## Asteroid knockback balance
- Reduced weapon impulse by 75% (12→3 per damage) and shot-induced speed cap from 300 to 120. Single shots nudge rocks; sustained fire can still propel rocks into enemies. Mining and weapon damage unchanged.
- 90 tests/build pass, including lower single-shot motion, repeated-hit speed cap and enemy damage from sustained fire. Next: continue human balance feedback before the queued enemy-class stage.

## Latest — five-level module system complete
- All 16 existing types support levels 1–5, retaining tiers 1–3, per-item upgrades, unique centered core and unlimited module quantities. Added tier stats/costs/durability/icons and backward-compatible v1 saves.
- All 16 L5 abilities are functional: overclock, fury, chain, piercing, nova, swarm, shrapnel, cascade, extraction, sweep, compression, reactive armor, reflection, phase dash, overdrive and purge. C activates the core; Shift activates boosters.
- Tractor slots/speeds: 1–5 and 150/225/300/375/450. Cargo bonuses: 60/120/200/300/500. Editor separates normal comparisons from named L5 unlocks, descriptions, cooldowns and max-level status.
- Shared ability hooks/configuration, exclusive collection, finite reserves, one-generation fragments, no recursive damage and bounded fields/projectiles. State/timers persist through saves.
- 90 tests pass; production build passes. Browser verified actual L4→L5 upgrade and icons, HUD/controls and a 33-module L5 combat/mining fixture at ~60 FPS with no runtime errors.
- 2026-11-13: GitHub Pages deployment succeeded; repeated upgrade/icon/control and large-ship combat checks against the live site (~60 FPS), with no runtime errors.
- No blocking bugs found. Remaining work: human balancing of advanced costs/power/heat and abilities; next feature stage is the queued enemy-class overhaul.


## 2026-11-12 — Module freedom, effects and readable outfitter
- Removed arbitrary module-type and total slot caps. The north-facing editor pans/zooms and supports repeated equipment, attachment validation, catalog drag/drop, moves/swaps, upgrades and removal.
- Added real mass, energy and heat operation rules, stacking reactors and cooling. All ship stats are data-driven and cached; individual items keep cooldowns and target/boost state.
- Tractors now have exact 1/2/3 target slots and 150/225/300 pull speeds, persistent exclusive targets, module-local collection, level colors and pulsing energy tethers.
- Added pulse, rail, plasma, flak and EMP alongside autocannons/missiles. Visuals use a reusable bounded pool (320), distinct projectiles/trails, mine sparks/debris, flashes, rings and shield/collection feedback. V disables effects without changing the simulation.
- Shift triggers level-2/3 booster bursts with duration, energy/heat cost and cooldown.
- Latest cargo steering replaces unlimited inventory with 120 base capacity; holds add 60/120/200. Full cargo pauses mining/collection. Hold removal is blocked if unsafe; broken holds and old-save overflow preserve excess as pickups.
- Redesigned outfitter into catalog/grid/details panels with category/search, actual current → next comparisons, exact costs, affordability/errors and immediate full ship overview. Flight HUD now clearly separates carried/stored resources and groups vitals.
- Added moderately louder normalized audio, unique weapon profiles, continuous mining/tractor hums, collection/shield/burst/failure cues and master/effects sliders. Tractor beams stay purple at every tier.
- Preserved seeded chunk worlds, carved ore, resource conservation, current enemy patrols, outposts and v1 saves.

## Drag-and-drop editor update
- Replaced native HTML dragging with pointer-based dragging for catalog installs and installed module moves/swaps.
- Added floating module previews, green/red target validation, release instructions, Escape/outside cancellation and post-drag click suppression. Core stays fixed; connectivity, affordability and upgrade state remain enforced.
- Browser checked actual mouse dragging: catalog installation, invalid core drop without mutation and occupied-cell swap; no runtime errors. All 65 tests and build pass.

## Tenfold world expansion
- World area increased exactly 10× to approximately 60,716 × 60,716; each axis grows by √10. New worlds scale belt/cluster geography to fill the larger map.
- Old saves preserve their original region, bases, asteroid IDs and depletion. Deterministic outer geography fades in beyond the former boundary and is saved once. Outer IDs use a separate fixed-stride namespace.
- Chunk size and 5×5 active window remain unchanged; partial boundary chunks reject out-of-world candidates. Map wheel zoom now reaches 24×.
- 67 tests pass, including legacy ID/depletion migration, deterministic outer chunks, edge clipping and save restoration. Browser checked an old save at 59,000/59,000, movement, map zoom and save/reload without runtime errors. Production build passes.

## Module graphics refresh
- Added chamfered, beveled metal housings, inset equipment, corner fasteners and tier indicators. Every module has distinct hardware: gun barrels/rails, mining lenses, purple tractor forks, shield plates, cargo straps, radiators and engine nozzles.
- Uses the existing shared procedural drawModule and cached textures in flight, outfitter and detached salvage; no gameplay or collision changes, shaders or downloaded assets.
- 67 tests and production build pass. Browser verified all catalog textures load, outfitter/flight render without errors and inspected the outfitter screenshot.

## Background music and settings
- Integrated the supplied Deep Space Patrol.mp3 as looping background music through a separate music gain channel. Playback begins after interaction, pauses when hidden/muted and resumes when appropriate.
- Added a Settings modal that pauses gameplay, with master/music/effects sliders, mute, VFX toggle and full/reduced particle density. Preferences persist independently of game saves; N/V shortcuts remain supported.
- Browser verified actual track playback/looping, independent volumes, mute/resume, VFX/density, Escape close and reload persistence, with no runtime errors. 67 tests/build pass.

## Weapon-propelled asteroids
- Projectile hits now transfer directional impulse to rocks; explosions push outward. Smaller rocks move more, repeated hits build momentum, and shot-induced speed is capped at 300 units/s.
- Weapon material damage reduced from 15% to 10%; mining unchanged. Existing reduced resource recovery and conservation remain intact.
- Moving rocks use existing polygon contacts to damage/kill enemies, play hit feedback and award loot once. No new physics objects or save format changes.
- 70 tests pass, including weapon/enemy-shot impulse, mass response, movement, speed caps, rocket blast direction and an end-to-end shot → rock → enemy kill/loot check. Production build passes.

## Earlier-stage verification
## Pixel-art pass (branch, not yet merged)
- Top-down view kept; all world art is now low-resolution pixel art baked in new `src/sprites.ts`: cobbled-rock asteroids with glowing ore cavities in each ore's colour, a large ring station (core, landing deck, spokes, habitat ring, solar wings, dish, tanks), four detailed gunmetal enemy warships with muted faction accents, stepped-diamond ore pickups, 16x16 modules, and dark outlines throughout. One upper-left light; ship casts a shadow.
- Background is three parallax layers (seeded posterized gas clouds, far stars, near stars) instead of a flat grid tile. Particles blend additively. HUD/outfitter panels use square corners, hard borders and hard offset shadows with no layout changes.
- Canvas renderer, no new dependencies, no downloaded art, no shaders. Simulation untouched; 70 tests and the production build pass. Browser checked flight view, station, rocks, enemy sprites and HUD with no console errors.
- Not yet checked: heavy-combat frame rate, the outfitter screen, and layouts at 1024/900 widths.

## Enemy classes (branch, not yet merged)
- Brief stages 1-3 (outfitter, upgrade comparisons, no module caps) were already complete; the outfitter was re-checked in the browser with the new art.
- Stage 4 done: seven hostile classes plus carrier drones, all data-driven. Pirate Raider (cannon), Pirate Interceptor (dual pulse, flanks), Heavy Gunship (lead-aimed autocannon + rockets), Railgun Sniper (charged shot with aim-line warning, keeps distance), Missile Frigate (four guided missiles, retreats while reloading), Drone Carrier (up to three drones, stays far), Shielded Defender (regenerating shield, plasma, guards a home point with a leash).
- Enemy shields, per-class loot tables, acceleration-limited steering with separation and asteroid repulsion, hostile shot colours, shield bars/rings and distinct hull sprites. Starting area spawns threat-1 pirates only; tougher classes appear further out.
- 77 tests pass (7 new for classes, shields, missiles, drones, leash, loot, starting threat); build passes. Browser checked all eight sprites, shields, drones and the sniper warning in a staged scene.
- Stage 5 done: nine-state AI (patrol, investigate, chase, attack, strafe, retreat, reposition, defend, return). Enemies remember and search the player's last position, react to being hit from out of sight, break off once when badly damaged (class-dependent), sidestep when blocked, slide around asteroids and reverse strafe direction. Awareness pips show searching/fighting/retreating. 82 tests pass (5 new); staged browser scene confirmed strafe, retreat, reposition and defend states.
- Stage 6 done: seeded danger regions. Each ore field has a danger level 1-4 from its ore, richness and a seeded variation, so danger follows the geography rather than distance and differs per seed (about 75% of space is low). The start is always low and its surroundings are capped at medium. Spawn pools are per level (level 4 is elite: defenders, carriers, snipers). HUD shows the current threat, a message announces entering higher threat, and the sector map tints explored space by level. 83 tests pass.
- Fixed a load/new-world error where the backdrop repaint pointed a tile layer at its own internal canvas.
- Stages 7-8 started: boss framework and the first boss. The Iron Warden guards a seeded rich iron/copper field far from the start, with two escort defenders. It has a 1600 hull and 400 shield, a triple heavy cannon and a telegraphed rocket salvo, four destructible pulse turrets and two shield generators (shields stop recharging once both are destroyed). Below half hull it switches to a five-shot cannon spread and eight guided rockets and calls a gunship and two interceptors once. Boss bar, map marker, extreme-danger territory that drops to medium when cleared, large loot drop, and defeat saved permanently. 88 tests pass (5 new); staged browser fight confirmed parts, phase two, reinforcements and the boss bar.
- Stages 7-8 complete: all three bosses. Crystal Leviathan (crystal field): charged beam with aim warning, plasma fans, up to three drones, and a shield surge every 16 s during which it holds fire, until both crystal nodes are destroyed; faster and harder-hitting below 40% hull. Reactor Titan (radioactive field): twin plasma and guided barrages, an EMP pulse with a warning ring that damages and drains energy, destructible plasma cannons and missile pods, reactor vents that open in phase two and take 1.5x damage past the shield, and a final pattern below 25% hull. Each has its own seeded territory, escorts, boss bar status line, map marker and saved defeat. 92 tests pass (4 new); staged browser fights confirmed the surge, EMP ring, phases and sprites.
- Stage 9 done: sound. Enemy fire is now audible off screen, quieter with distance and deeper for larger ships. New synthesized cues: rail charge whine, missile-lock beeps, drone launch, enemy alert chirp, boss warning alarm, boss phase change, boss destruction, shield surge, EMP charge, module destroyed, hull damage (separate from shield hits) and ship destruction. Rockets, rail, flak and explosions gained a filtered noise layer. Existing master/effects/music volumes, mute, rate limiting and voice cap apply to all of it. 94 tests pass (2 new); all 28 cues were scheduled in a running browser audio context without errors.
- Not done from the brief: combat-effect polish (part 9) and balancing (part 10). Nobody has listened to the new sounds or played a boss fight, so mix levels and difficulty are unverified.

## Verification
- 65 tests passing, including prior world/geometry/combat tests and new unlimited module combinations, exact tractor behavior, full cargo, no duplication, energy/heat/mass, weapon origins, EMP, Shift, pool cleanup and effect-disabled equivalence.
- Production build passes; expected Phaser bundle warning only (~368 KB gzip).
- Browser checks: 33-module ship with eight reactors, search using actual keyboard input, three panels, upgrade comparisons, HUD expansion, Shift burst, effects toggle and volume control; layouts inspected at 1440×1000, 1366×768, 1024×768 and 900×650. No runtime errors.
- Heavy simultaneous combat/mining/tractor fixture (~245 active ore, eight enemies, seven weapons) measured ~60 FPS in headless Canvas. Software WebGL measured ~35 FPS, motivating the default Canvas renderer and viewport-sized background.

## Publishing complete
- Public source: https://github.com/N4STYN8/VOIDFORGE
- Live game: https://n4styn8.github.io/VOIDFORGE/
- Main pushes run tests/build and publish GitHub Pages; PRs validate without publishing. Pull synchronizes the local copy.
- Initial deployment succeeded. Live browser check returned HTTP 200, rendered the game/HUD and reported no runtime errors.
- Credentials and local QA fixtures/screenshots are excluded from source.

## Scope and next task
- The later enemy-class, tactical AI, danger-region and three-boss overhaul is explicitly staged. It is queued next; current four enemy classes/patrol systems remain working.
- Next development task: a real play session to tune sound levels and combat balance (enemy damage/health, boss durations, spawn rates per danger level), then remaining combat-effect polish.
- Known limits: balancing/human playtesting remain pending; physical ship contacts still use a core-circle approximation. No new blocking failures found in this stage.

## Run
`npm install`, `npm run dev` (current local URL: http://127.0.0.1:5174/). Use JSON Export/Import to transfer saves between localhost and the hosted page.

## Enemy fleets and bosses — 2026-11-13
- Added seven archetypes alongside the five matching legacy classes, for twelve requested roles. Existing carrier/defender/drone and Crystal Leviathan/Reactor Titan encounters remain available.
- Three seeded regional factions use configurable three-ship fleets, shared squad awareness, formations, support shields, armored escorts and bounded regional/core scaling. Home-region scaling remains unchanged.
- Added Rust Leviathan, Copper Tyrant, Void Harvester, Storm Engine and Dreadforge; extended Iron Warden with rear reactor, shield surge, frontal protection and final phase. All eight major encounters use seeded territories.
- Components gate body weapons, mining, drone deployment, shields, electrical hazards and engine speed. Cutting beams stop at asteroid polygons; marauders/harvesters remove finite ore and carry real pickups. Cargo and encounter state survive saves.
- EMP suppression lasts at most 1.2 seconds with five-second immunity and leaves basic movement available. Electrical hazards, charged shots and final meltdown have visible warnings. Boss return requires leaving the territory as well as waiting for the ledger cooldown.
- Cached modular silhouettes/faction accents, existing synthesized cues, pooled/capped hostile bullets (256), capped beam traces (12), drone actor ceiling (90), and distant AI suspension.
- Validation: 154 tests passed; production build passed (existing Phaser bundle warning). Browser: all textures present, no runtime errors; headless Canvas ~60 FPS with 400 asteroids and 50 actors including Dreadforge. Checked 100 seeds: all eight boss sites present.
- Compatibility: optional actor armor/scaling/cargo and EMP save fields preserve v1 saves; existing actors without armor retain their old damage behavior. Previously generated original three boss sites keep their selection order.
- Remaining: human difficulty/economy/audio playtest; stress measurements are synthetic and do not establish performance on every device. Physical contacts retain the existing circle approximation.
- Next specific task: play one progression run from starter ship through the first Warden encounter, then tune fleet frequency, projectile damage and boss rewards from observed time-to-kill.
- Git: local branch codex/enemy-fleets-factions-bosses, upstream origin/main. Fetched before implementation; main was synchronized at a1eb8d5. Pre-existing AGENTS.md collaboration rules preserved. No commit, push, merge or deployment.
- Files changed this task: src/data.ts, src/enemyDefinitions.ts, src/fleetConfig.ts, src/enemyAI.ts, src/enemyPopulation.ts, src/model.ts, src/world.ts, src/sprites.ts, src/main.ts, tests/enemies.test.ts, tests/fleets.test.ts, GAME_DESIGN.md, ARCHITECTURE.md, TASKS.md, PROGRESS.md. AGENTS.md was already modified and remains preserved.
