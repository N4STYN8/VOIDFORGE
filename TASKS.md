# Tasks

## Multiplayer latency — built, needs internet play
- [x] Latency benchmark over a real relay with simulated delay (scripts/latencyBench.ts)
- [x] Adaptive remote-ship interpolation with extrapolation and eased corrections
- [x] Enemy velocities, dead reckoning, enemies in fx with partial/full lists and removals
- [x] Enemy shots fast-forwarded by age + one-way delay; pilot shots launched from the drawn shooter
- [x] Early fx/hit flushes inside a client-side send budget under the relay limit
- [x] Ping readout (panel, command bar, other pilots) without a relay change
- [ ] Play over a real internet link (20–80 ms) and tune INTERP / GHOST constants
- [ ] With relay redeploy approval: `ping`/`pong` message, sender timestamps on ship state

## Space-station outposts — built, needs play
- [x] Distinct module art for all sixteen block types, continuous hull walls, corridor tubes
- [x] Same-kind squares up to 3x3 drawn as one large module
- [x] Outpost radius 14 -> 24 cells
- [ ] Play-test a large station; check frame time with several big stations on screen
- [ ] Optional: larger, multi-cell-only block types (e.g. a habitat ring) if the user wants stations bigger than the grid of single blocks

## Save storage — fixed, needs a real large world
- [x] Save to IndexedDB with localStorage as the synchronous fallback; newest valid copy loads
- [x] Trim float digits in save text (about 35% smaller)
- [x] Backup moved to IndexedDB
- [ ] Confirm on the live site with the world that failed
- [ ] If saves keep growing: store asteroid outlines more compactly or drop records for untouched drifting rocks

## HUD, navigation and fleet — built, needs play
- [x] HUD restyle, alarms, collapsible menu/help and wide-screen scaling
- [x] Radar minimap with three ranges; compass strip with markers
- [x] Player map markers (add/remove on the sector map, saved)
- [x] Multiple ships: buy, rename, hangar, switch at a station; cargo unloaded on switch
- [x] 180 tests/build and browser checks at 1024x768 and 2000x1125
- [ ] Human play: HUD size on real monitors, ship price, whether hangar ships should be tied to the station they were left at
- [x] Per-ship hull paint (eight colours, saved per ship)
- [ ] Next: show the paint on outfitter grid icons and the radar ship arrow; hull shapes per ship if wanted

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

## Expanded fleets / factions / bosses (2026-11-13)
- [x] Reusable archetype definitions and specialized AI operations
- [x] Twelve requested archetypes, including finite-resource mining marauder
- [x] Three seeded regional factions and configurable coordinated fleets
- [x] Component dependencies, frontal armor, engine damage and phases
- [x] Six requested bosses; preserve Crystal Leviathan and Reactor Titan
- [x] World distribution, bounded scaling, rewards and exit-gated boss returns
- [x] Procedural cached modules, telegraphs and existing synthesized sound cues
- [x] Regression/combat/save tests, production build and browser stress check
- [ ] Human balance pass: starter progression to Warden; tune fleet frequency, damage and salvage
- [ ] Measure sustained performance on the target player's hardware

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
- [x] Integrate Zach's outpost construction merge; preserve outpost behaviors and pass all 182 combined tests

## Cockpit HUD
- [x] Audit existing palette, technical fonts, pixel scale and border conventions
- [x] Reuse ship status and map rendering; add frame/navigation/tactical/command layout
- [x] Connect real state, keyboard-equivalent commands and compact preference
- [x] Verify responsive center visibility, command behavior, regression tests/build and frame rate
- [ ] Human cockpit readability pass during combat/mining at the target player's resolution
- [x] Refine cockpit toward supplied reference: angular armor, stacked icon gauges, circular radar, friendly station thumbnail and icon console; verify 185 tests and responsive controls
- [x] Add detailed layered cockpit armor, fasteners, vents, segmented instruments; integrate latest fleet/navigation/save systems and verify 203 tests plus browser controls
- [x] Fix large-screen panel zoom/clipping; preserve forge footer with L5 abilities/warnings, improve reference typography/icons/gauges and verify 125% display scaling

## Outfitter cockpit style
- [x] Match cockpit palette/panels, improve catalog/grid/inspector readability and level indicators
- [x] Preserve editor, fleet and upgrade interactions; check responsive layout and full build/tests
- [ ] User visual review at their usual resolution
- [x] Fix bottom HUD lost clicks using permanent command nodes; verify held clicks, SVG targets, keyboard focus, cooldown updates and original restrictions

## Ultimate five-tier modules
- [x] Rebalance all 17 five-tier definitions; preserve costs/core gating/unlimited placement
- [x] Implement named paid L5 abilities, shared defense/EMP recovery, finite extraction and persistent repair debt
- [x] Add cached L5 module detail, bounded combat effects and heavier ultimate firing pitch
- [x] Verify tier curves, paid-shot failure, penetration, EMP recovery, conservation, saves and HUD controls
- [ ] Human playtest L3 versus L5 loadouts against normal fleets and bosses; tune economy/difficulty from observed play

## Complete economy rebalance
- [x] Audit prices, income, rarity, cargo, enemy/boss rewards, drones, regeneration and discounts
- [x] Centralize escalating ship/core prices and infrastructure/drone tuning
- [x] Version new-world rarity/yields; preserve existing reserves/modules/minerals
- [x] Prevent legacy refund inflation with paid investment records
- [x] Show required/stored/missing mineral costs in the outfitter
- [x] Add repeatable economy benchmark/report and regression coverage
- [ ] Human timed starter/midgame/endgame runs: validate delivery duty, rare-material search time and core milestones

## Live map HUD
- [x] Translucent cockpit chart, ship-follow/local default, world/zoom controls and fixed-size symbols
- [x] Continue flight/simulation/audio while open; isolate map pointer input; preserve explicit pause
- [x] Verify map interactions, movement, responsive bounds, tests/build
- [ ] User review of map visibility during combat

## Shared space (MMO) — staged plan, decided 2026-11-13
Choices: own Node + WebSocket relay; sector grid; owners keep changes to their sector; open PvP outside station safe zones; killer takes the victim's carried cargo and the victim pays at their home station to rebuild. Host: the Raspberry Pi at `wss://voidforge.2dq.us` (Let's Encrypt already on the Pi). Target: 1,000 concurrent players on one shared map. Nate also has access to the Pi: deploying or restarting the relay there is a deployment, so it needs an explicit go-ahead and the two developers coordinate it.
- [x] Stage 1 — sector grid offline: thrust into a world edge for 1.5 s to enter the neighbouring sector; unvisited sectors are generated from the home seed and grid position; visited sectors are saved whole and restored; ship, cargo, stored minerals and hangar travel with the pilot; old saves load at the home sector
- [ ] Stage 1 follow-ups: show neighbouring sector names at the map edges; generated sectors farther from home get higher danger
- [x] Stage 2 — relay and lobbies: dependency-free `server/` relay (hand-written WebSocket framing), sector rooms, lobbies of 8 with 6-letter codes and `?join=` invite links, guests fly their own ship into the host's world and follow the host between sectors, remote ships drawn with their layout/paint/name/hull and shown on radar/compass, rate limits and origin allowlist, `npm run relay` and `npm run relay-bot`
- [x] Relay deployed on the Pi 2026-11-13 (user go-ahead): `wss://voidforge.2dq.us`, nginx + Let's Encrypt in front of a systemd service on 127.0.0.1:8787
- [x] Play-test fixes 2026-11-13: other pilots' shots shown; knocked rocks move for everyone; ships collide; guests get the host's copy of the sector (rocks, depletion, stations, outposts for show, clock); guests cross edges in the host's grid; traffic batched under the relay rate limit; a destroyed pilot never runs a sector
- [x] Always online: connects on entering play with backoff reconnects, Play offline switch; Multiplayer panel (P / command bar) with open lobby list, open or private lobbies, join by code, renames, pilots here
- [ ] Relay redeploy on the Pi for the new `fx`, `world`, `lobbies` and `open` messages (needs explicit go-ahead; do it before the site update reaches main, or shots and enemy fire are not shared)
- [x] Second play-test round: other pilots' shields and mining/tractor beams drawn; no pausing in multiplayer (ships stay visible and simulating behind menus or in a hidden tab); menus no longer fire the guns
- [x] Lobby resource sharing (opt-in): members share station deposits; short actions borrow exactly the shortfall and retry
- [ ] Relay redeploy for lobby-wide `party` messages (resource sharing needs it live; approval needed)
- [ ] Stage 2 follow-ups: remote engine flames; outposts built after a guest arrives appear only on their next visit
- [x] Stage 3 — shared sector state: the relay elects one authority per sector (owner, else lobby host, else first arrival) that runs enemies and hunts the nearest visible pilot; followers mirror its enemies, send their hits and receive kill salvage as their own pickups; enemy shots and beams are shared and hit whoever they reach; rock changes need a 2.5 s relay claim lease, so two pilots never mine the same ore, and dents/depletion are copied to everyone in the sector
- [ ] Stage 3 follow-ups: boss EMP pulses and hazards only hurt the authority's ship; drops and pickups are personal by design; rock-on-rock pushes are local, so drift can still differ slightly between pilots
- [x] Stage 4 — PvP and alliances: open PvP outside station safe rings, lobby members are allies; shots hit other pilots' ships and the victim applies the damage (capped at `PVP.damageCap` per attacker per second); a pilot hit by another pilot within `PVP.creditWindow` seconds of dying loses all carried cargo to that pilot (moved, never duplicated; returned to the wreck if the killer has left) and must rebuild at the home station for `rebuildCost(core)` minerals; hostile pilots are red on screen and radar, and a warning shows when one is in the sector
- [ ] Stage 4 follow-ups: decide whether PvE deaths should also cost a rebuild (currently free respawn as before); relay-side damage plausibility checks; PvP sounds and hit flashes on remote ships
- [x] Stage 5 — matchmaking: each online pilot publishes a progression score (core level x10 + module levels); crossing into a never-visited cell asks the relay (`SECTOR.matchChance`, 50%) for the online pilot nearest in progression within `MATCH.maxRatio` (1.75x), and that cell of your grid becomes their home sector, where you meet them (they own it and run its enemies); the link is saved so the cell never changes, edges from it continue on your own grid, and offline or unmatched cells generate as before
- [ ] Stage 5 follow-ups: show linked pilots' cells on the sector map; let a pilot opt out of being matched; matching by danger region as well as progression
- [x] Stage 6 — scale toward 1,000: interest management (ship state only to pilots within `NET.interest` 7,000 units; authorities send only enemies near another pilot), frames encoded once per broadcast, replaceable state skipped for backed-up sockets, packed array ship state and rounded enemy rows, `/stats` endpoint, `scripts/loadTest.ts`. Measured on this PC with 1,000 pilots in 4-pilot sectors (relay as its own process, load generator on the same machine): 30% of one core, 111 MB, 0 skipped, latency p50 22 ms / p99 38 ms, 40.7 Mbit/s outbound
- [ ] Stage 6 follow-ups: the Pi measured 64% of one core at 200 pilots (p99 124 ms, 8.5 Mbit/s out), so it holds roughly 300 pilots, not 1,000 — for 1,000, move the relay to a VPS or split rooms across processes by room-key hash behind a small router; binary encoding if bandwidth is still the limit

## Animated main menu
- [x] Integrate startup menu and single-scene lifecycle without menu autosaving
- [x] Continue/new seed/confirmation/backups and same-session return flow
- [x] Animate existing station/ships/asteroids with hidden-tab/reduced-motion handling
- [x] Tutorial, lore, truthful multiplayer status and shared settings
- [x] Responsive keyboard/touch layout, desktop/mobile screenshots and save-failure verification
- [ ] User visual review of menu composition and motion before publication
- [x] Revise menu composition toward reference: scenic dockside foreground/portrait, violet planet/nebula, enlarged Forge and cyan industrial frames
- [x] Replace rejected primitive art with detailed reference-derived menu illustration; preserve working HTML controls and independent animation
- [x] Integrate latest multiplayer update safely; expose real lobby entry and verify menu disconnect/no-save behavior with a local relay
- [x] Remove menu flyby ships; add bounded settings-aware button sounds and an explicit New Game warning with default Cancel focus

## Compact HUD
- [x] Replace full-height compact frame with floating instruments and centered short console
- [x] Verify toggle/full restoration, persisted preference, command identity/actions and five responsive sizes
- [ ] User review of compact combat readability

## Industrial audio audit
- [x] Audit actual sound definitions/triggers and missing/lost deposit/outfitter events
- [x] Layer successful unload by actual amount; cover empty, partial outpost and fleet transfers
- [x] Aggregate pickups, add persistent cutting noise and safe loop cleanup
- [x] Improve seven weapon identities/level scaling, paid ultimate/system warnings and outpost/UI feedback
- [x] Bound mixing priorities, reserve critical voices and preserve music/settings/mute
- [x] Verify model accounting, real browser audio rendering/cleanup and integrated multiplayer regression suite
- [ ] Human listening on headphones/small speakers; tune bass and confirmation balance
- [ ] Optional future remote-pilot shot-audio protocol (no relay changes in this release)

## Ship zoom rendering
- [x] Sample the player's assembled hull as one core-anchored cached texture instead of independently transformed tiles
- [x] Preserve paint/layout/levels, north preview and safe fallback for large ships
- [x] Verify real wheel zoom in Canvas/WebGL and layout/texture-budget regressions
- [ ] User visual check of their ship while zooming

## Audio strength and visibility
- [x] Replace global hit/kill audio with positioned cues and reject off-screen world events
- [x] Strengthen effects, add metallic impact texture and music ducking with bounded output/source costs
- [x] Verify viewport boundaries, real browser playback and offline mix/source cleanup
- [ ] Human listening pass on headphones/speakers

## Enemy retaliation
- [x] Pursue a damaging shooter beyond detection, including remote shooters
- [x] Preserve visibility-gated firing, safe zones, retreat and guard leash
- [x] Regression-test pursuit, timeout, collisions and multiplayer targeting
- [ ] Playtest pursuit duration and disengagement balance

## Missile interception
- [x] Tough hostile missiles with cumulative damage and explosion/sound on destruction
- [x] Swept collision, cover priority, pooled health reset and legacy defaults
- [x] Test multiple hits, interception, cover and visual-only shot exclusion
- [ ] Playtest missile durability and hit radius

## Active-flight zoom correction
- [x] Eliminate stale camera-matrix aim jumps on the wheel-input frame
- [x] Disable pixel-rounded follow at fractional zoom
- [x] Check active Canvas/WebGL flight plus projection regressions
- [ ] User verify zoom behavior on their ship

## Zoom heading reversal
- [x] Reproduce a 180-degree flip during moving, near-center-cursor zoom
- [x] Hold heading across wheel zoom; resume normal aim on mouse movement
- [x] Verify moving Canvas/WebGL zoom, aim release and projection regression
- [ ] User check on their ship; changes remain local

## Earlier Build module unlock
- [x] Unlock purchase/use at hull/core level 2 with matching description
- [x] Verify L1 blocked, L2 installation and outpost placement
- [ ] Playtest early outpost progression

## Dynamic 12-track soundtrack
- [x] Preserve latest main/performance changes and prior Core-2 Build module unlock
- [x] Discover, preserve and map all 12 actual MP3s
- [x] Central state priority, activity hysteresis and confirmed combat signals
- [x] Bounded streaming/equal-power crossfades, fair rotation, resume and failure handling
- [x] Preserve controls/unlock/SFX; test states, interruptions, playback and production build
- [ ] Human listening pass for soundtrack/SFX balance
- [ ] Optional future follower boss targeting metadata (requires separate relay scope)

## Combat music trigger refinement
- [x] Six visible living NPC ships to start; latch until zero
- [x] Ignore individual NPC hits and offscreen/dead/component counts
- [x] Single confirmed hostile player triggers PvP; 3s inactivity ends it
- [x] Resume peaceful song/position after long fights with 2s return fades
- [x] Test threshold sequence, viewport filtering, real playback, rapid returns, priority and PvP events
- [ ] Human playtest combat/peaceful transition balance
