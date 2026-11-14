# Progress

## Multiplayer latency pass and ping readout (local branch claude/objective-darwin-32381a, uncommitted)
- Lower lag the game adds on top of the network, measured with the new `scripts/latencyBench.ts` (two pilots over a real local relay with simulated delay). LAN: remote ships 175 → 87 ms behind, mirrored enemies 220 → 35 ms, enemy shots 75–90 → under 10 ms, pilot shots visible 60–73 → 31 ms after firing. 80 ms round trip: ships 247 → 161 ms, enemies 298 → 22 ms, enemy shots 161–176 → 20–27 ms.
- How: adaptive interpolation delay with extrapolation and eased corrections for remote ships; enemy velocities and dead reckoning on followers; enemies ride in fx (nearby every fx, full list twice a second, removals at once); enemy shots fast-forwarded by age + one-way delay; pilot shots launched from the drawn shooter; fx and hits flushed early when the client's own send budget allows (stays under the relay limit). No relay change.
- Ping: Multiplayer panel status shows `PING n MS` (green/amber/red) and each nearby pilot's ping; the command bar status adds it. Measured by timing `lobbies` replies every 5 s.
- Fixed: a sector set between socket open and `welcome` never reached the relay.
- Validation: 303 tests (12 new in tests/latency.test.ts, including an over-the-relay mirror-accuracy and message-rate test) and build pass; `npm run load-test -- 200 4 8` fine (p99 15 ms). Browser: joined a local `relayBot --horde --fire` lobby, horde mirrored and firing, panel showed PING 10 MS and the bot's 1 ms, no console errors. Not checked: feel over a real internet link, and older clients mixed with new ones (an old follower sees no enemies from a new authority until it reloads).
- Next: play over the internet with a remote friend and tune INTERP/GHOST if ships or enemies wobble; consider the relay-side follow-ups in ARCHITECTURE.md (needs approval to redeploy the Pi).

## Shared space stage 6 — scaling (local branch claude/mmo-sectors, uncommitted)
- Interest management, encode-once broadcast, backlog skipping, packed state, `/stats`, `npm run load-test`.
- Load test, 1,000 pilots in 250 sectors for 20 s: relay 30% of one core, 111 MB, no skipped frames, latency p50 22 ms, p95 33 ms, p99 38 ms (generator on the same PC), 9,354 messages/s in, 28,062 frames/s and 40.7 Mbit/s out. Before the wire-format work it was 57 Mbit/s. Bandwidth, not CPU, is the Pi's likely limit.
- Validation: 248 tests and build; browser re-check with the packed protocol: lobby join, remote ship, 30 mirrored enemies after respawn, no console errors.
- Next: deploy the relay on the Pi (needs explicit go-ahead from both developers), then `npm run load-test -- 1000 4 20 wss://voidforge.2dq.us` from another machine.

## Shared space stage 5 — progression matchmaking (local branch claude/mmo-sectors, uncommitted)
- Relay profiles and `match`; matched cells link to another pilot's home sector and stay linked (`galaxy.links`).
- Validation: 247 tests and build. Live: from the browser's home grid, crossing east into a never-visited cell matched the bot pilot (same starter progression); the cell became "Test Pilot's sector", the browser met the bot there as a hostile stranger, and the bot (owner) was the authority.

## Shared space stage 4 — PvP and alliances (local branch claude/mmo-sectors, uncommitted)
- Open PvP outside safe rings, lobby allies immune, victim-side damage cap, killer takes carried cargo, paid rebuild at the home station (`PVP` in data.ts, `rebuildAtHome`).
- Validation: 244 tests and build; `tests/pvp-network.test.ts` runs two full pilots over a real relay: a stranger is shot down, all 37 carried minerals move to the shooter with the total unchanged, the victim owes a rebuild; lobby allies deal no damage. Browser: the stranger bot is classed hostile, the warning shows, allies stay cyan.

## Shared space stage 3 — shared rocks, enemies and salvage (local branch claude/mmo-sectors, uncommitted)
- Room authority, enemy mirroring, shared enemy fire, hit forwarding, kill salvage to the killer, rock claim leases and rock state copies (`src/shared.ts`, `src/sharedLink.ts`, relay rooms).
- Validation: 237 tests and build. Live check in Chrome against the relay and a headless authority bot with raiders: the browser became the follower, mirrored 15 enemies, raiders switched to attack and their fire reached it, a forwarded lethal hit removed the raider and delivered 6 salvage as the follower's pickups, a rock claim was granted after one round trip and mining then proceeded. Found and fixed: the bot mixed `Date.now` with `performance.now`; enemies hit by a visitor remembered the authority's position.

## Shared space stage 2 — relay, lobbies and invites (local branch claude/mmo-sectors, uncommitted)
- `server/` relay with no dependencies, sector rooms, lobbies with codes and invite links; guests fly their own ship into the host's world and follow the host; remote ships, names and hull on screen, radar and compass. Pi setup notes in server/README.md (not deployed).
- Validation: 230 tests and the build pass. Browser (Chrome tab, local relay plus `npm run relay-bot` host): invite link and typed code both join, guest moves into the host world and sees the bot ship moving with its paint and layout, Leave returns home with no stale ships, keyboard returns after typing, Create lobby shows code and members. Found and fixed: Phaser loop clock vs performance.now mismatch, late updates from the previous room.

## Shared space stage 1 — sector grid (local branch claude/mmo-sectors, uncommitted)
- User decisions: own Node relay on the Pi (`wss://voidforge.2dq.us`, Let's Encrypt), sector grid, owners keep sector changes, open PvP outside safe zones, killer takes carried cargo and the victim pays to rebuild at home, target 1,000 players. Staged plan in TASKS.md and ARCHITECTURE.md.
- Built offline: thrusting into any world edge for 1.5 s enters the neighbouring sector (`src/sectorGrid.ts`, `src/sectors.ts`, `SECTOR` in data.ts). Unvisited sectors generate from home seed + grid position; visited sectors are stored whole in the optional `galaxy` save field; ship, cargo, stored minerals and hangar travel with the pilot. The session label shows the sector.
- Ships arrive at rest and slide along the entry edge clear of rocks (a browser check caught a full-speed arrival hitting a rock). Validation: 221 tests and the build pass; browser check crossed home → E1 → home with cargo, hull and sector records preserved through Save/Load and a reload, and no console errors. The browser pane ran at about 1.5 FPS (throttled), so feel and frame time at the edge still need a human play.
- Next: see stage 6.

## Space-station look for outposts (local branch claude/station-visuals, uncommitted)
- Outposts are now drawn as space stations instead of rows of identical brass squares. Every block type has its own module art: octagonal command hub with lit windows, gun bastions, fusion-torus reactors, radiator arrays, shield emitters with corner pylons, cargo frames stacked with coloured containers, launch-bay hangars, docking collars, a radar dish on a lattice mast, a white repair module, a crystal fabricator and a green service pad.
- Walls become continuous hull plating with seams, rivets and cabin windows; reinforced walls get armour ribs and hazard corners. Corridor tubes join every pair of neighbouring blocks, so a station reads as modules joined by passages.
- Squares (2x2 or 3x3) of the same block kind are drawn as one large module, e.g. a 3x3 reactor becomes one big torus. Appearance only: every cell is still its own block with its own health and level. The merged module shows the lowest level among its blocks.
- Outposts may now reach 24 cells from their core (was 14), a 49 x 49 cell station. Neighbouring outposts still cannot overlap (2 x 24 cells < core spacing).
- Blinking red/green beacons mark the outermost blocks; reactor glow, cooling fan and radar sweep scale up on merged modules.
- 216 tests pass (4 new in tests/station.test.ts); build passes. Browser: a 93-block test station with every block type, merged 2x2/3x3 modules, scaffolding, damage and live turrets rendered with no console errors; local save backed up and restored. Not checked: how it feels in normal play, and performance with several very large stations on screen (each is still one baked texture).

## Outpost construction, phases 1-3 (local branch claude/outpost-construction, uncommitted)
- Phase 1: Build module, a new five-level ship module that cannot be installed before Core level 4. Levels raise construction range and speed, level 3 adds a cost discount, level 5 unlocks the Industrial Fabricator (auto-repairs nearby outpost blocks from carried iron and energy).
- Phase 2: a large world grid is always visible again and a fine construction grid, aligned to world coordinates at the ship tile size, fades in when zoomed in. Build Mode (F or the on-screen button) forces the grid on, opens a brass build panel with the block catalog and costs, shows a snapped preview that is green when valid and red with the reason when not, places on left click (hold to drag walls), rotates with R and exits on right click, Esc or F. Weapons and mining are suspended while building.
- Phase 3: Outpost Core, wall and reinforced wall. The core founds an outpost; other blocks must touch an existing block inside the core's construction area. Adjacent blocks join visually (brass frame on open sides, riveted seams and copper pipes between neighbours). Blocks are built from carried cargo over time, show wear when damaged, stop hostile shots, and collapse if cut off from the core. Any number of outposts; they save and load, and asteroid/enemy arrivals are kept out of them.
- 148 tests pass (7 new in tests/outposts.test.ts); build passes. Browser checked Build Mode, the grids, an 18-block outpost with scaffolding and damage, and a save/load round trip, with no runtime errors.
- Phase 4 (uncommitted): autocannon, missile and railgun turrets that find the nearest hostile, turn toward it and fire through the normal projectile system; reactors and a per-outpost battery that turrets draw from per shot, with turrets waiting when it runs dry; storage blocks and outpost mineral storage with Store cargo / Load cargo buttons near the core. Storage that is destroyed spills its overflow as pickups. A readout panel shows power, peak turret draw, battery and storage for the nearest outpost. 153 tests pass (12 for outposts); build passes; browser checked a 16-block fort with four turrets engaging enemies, cargo transfer and a save round trip with no runtime errors.
- Phase 5 (uncommitted): Drone hangars house two mining drones each. Drones fly to nearby asteroids, mine them through the same finite-ore extraction as the ship, carry up to 20 of one ore home and unload into outpost storage; they need battery energy to launch and wait when storage is full. A destroyed hangar releases what its drones carried. Docking stations let the ship press E to unload cargo and repair from outpost minerals. 157 tests pass (16 for outposts), including a tick-by-tick check that drones never create or lose ore; build passes; browser checked four drones mining and delivering, docking, and a save round trip with no runtime errors.
- Phases 6-8 (uncommitted): all sixteen block types now exist (added shield generator, cooling unit, drone repair bay, upgrade station, repair station, radar tower). Every block upgrades through five levels with a level-5 special; hangars go 2/4/6/8/10 drones. Click a built block in Build Mode to upgrade or repair it. Outposts have shields, heat (turrets overheat without cooling), automatic repair stations, radar warning, and are raided by enemies when they hold enough to be worth it. While the ship is away nothing is simulated; on return the outpost settles banked raids, repairs and drone mining against the real asteroids in range. Small machinery animation and raid/drone sound cues added. 169 tests pass (28 for outposts); build passes; browser checked all sixteen blocks, upgrades to level 5, a radar-warned raid repelled by turrets, and a ten-minute absence that moved exactly the 618 ore in range into storage, with no runtime errors.
- Fixed while testing: automatic repairs could mend a few hull points for free before any iron was owed.
- Still open: ships and asteroids pass over outpost blocks (only hostile shots are blocked); enemies do not attack drones; nothing about outposts has been balanced by play. Ships and asteroids still pass over outpost blocks; only hostile shots are blocked. Turrets only run while the ship is within 2,600 units.

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

## HUD, navigation and fleet
- HUD restyled: larger readable vitals with segmented bars, low-hull and high-heat alarms, ship name and fleet count in the header, collapsible session menu and controls help, and interface scaling on wide screens (1.25x from 1700 px, 1.6x from 2300 px).
- Radar minimap (bottom right, DOM canvas): north-up and centred on the ship with three ranges (wheel or +/-), showing explored space, asteroids, drops, enemies, outposts and markers pinned to the rim. Click opens the sector map.
- Compass strip (top centre): cardinal points slide with the ship's heading; bases, outposts, boss sites, hordes and player markers sit at their bearing and the one nearest dead ahead is named with its distance.
- Map markers: click the sector map to drop a numbered marker (up to 12), click it again to remove it. Saved with the world.
- Fleet: extra ships are bought at a station from stored minerals (each costs 60% more than the last). One ship flies; the others wait in the hangar with their own core level, modules and hull damage. Switching happens in the outfitter and unloads carried cargo to station storage first. Ships can be renamed.
- Engine modules show exhaust flames under thrust; the nebula backdrop is slightly stronger.
- Hull paint: eight paints (`FLEET.paints`), picked from swatches in the outfitter fleet strip. Each ship keeps its own; new ships get the next paint. Cosmetic and free. Painted module textures are baked once per paint on first use.
- 180 tests (11 in `tests/fleet.test.ts`) and build pass. Browser: buy, rename, switch, markers, radar, compass and layouts at 1024x768 and 2000x1125; an older save loaded unchanged. Not played by a human; ship price and marker limit are first guesses.

## Save storage fix
- Reported bug: "Save failed: browser storage is unavailable or full" on a long-played world. Cause: every disturbed asteroid adds about 900 characters to the save, and `localStorage` holds roughly 5 MB per site (shared with the new-world backup copy).
- Saves now also go to IndexedDB, which has far more room. `localStorage` is still written when the save fits, so a closing tab keeps its progress; when it does not fit, the older copy there is left alone and the IndexedDB copy is used. Loading takes the newest valid copy.
- Save text keeps non-integer numbers to four decimals: about 35% smaller (238k to 153k characters on the test world). Export uses the same text.
- The new-world/import backup moved to IndexedDB and the old `localStorage` backup is removed once that succeeds.
- 187 tests (7 in `tests/persistence.test.ts`) and build pass. Browser: start-up load, save to both stores, and a forced quota error on `localStorage` that still saved and reloaded. Not tested on the live site or with a real multi-megabyte world.

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

## Zach outpost integration — 2026-11-13
- Integrated origin/main b2fede9 (Zach's complete outpost construction merge) into codex/enemy-fleets-factions-bosses, retaining both histories.
- Resolved shared model fields, pooled hostile fire/attacker identity, outpost spawn exclusions plus core scaling, docking, outpost updates and exit-gated boss spawns. Combined both architecture/checklist sections and retained collaboration and outpost instructions.
- Fixed integration regression: retreating outpost raid parties remain active long enough to leave without awarding kills or loot, beyond ordinary distant-AI suspension.
- Verified Zach-only outpost implementation, map/styles/visuals, Build-module ability, HTML and outpost/ability tests match origin/main exactly. Full combined suite: 182 passed; production build passed (existing bundle-size warning). Browser: all enemy textures present, no runtime errors, ~60 FPS in the twelve-archetype scene.
- User authorized the local commits, integration and feature-branch push. Main and deployment workflows remain untouched; no production deployment authorized.

## Cockpit HUD — 2026-11-13
- Extended the existing navy/cyan pixel interface with slim structural rails, navigation strip, explored radar, aimed-contact readout, weapon readiness and six command modules. Retained flightHud inventory/vitals and existing session/settings/outfitter/map/build systems.
- Commands: Shift burst, C overclock, Q outfitter, F Build Mode, M explored map, E dock/paid repair. Existing shortcuts remain; buttons use the same restrictions and actual model state. Radar clicks expand the map. Compact/full HUD preference persists locally.
- Art audit and presentation boundaries recorded in ARCHITECTURE.md; no gameplay, sprites, station or asteroid artwork changed.
- Validation: 184 tests and production build passed; browser commands/settings/save-menu access, compact persistence and keyboard/WASD verified. Layouts inspected at 1440×1000, 1366×768, 1024×768, 900×650, 650×600 and 390×667; center remained clear and no horizontal overflow. Synthetic Canvas stress scene: 400 asteroids/50 actors at ~60 FPS, no browser errors.
- Files: src/cockpit.ts, src/cockpit.css, src/main.ts, index.html, tests/cockpit.test.ts, ARCHITECTURE.md, GAME_DESIGN.md, TASKS.md, PROGRESS.md.
- Git: clean start, fetched and fast-forward pull confirmed already synchronized; local branch codex/cockpit-hud. All work remains uncommitted; no push, merge or deployment. Existing Phaser bundle-size warning remains. No known blocking defects from checks.
- Next task: human combat/mining session at the player's usual resolution to assess HUD density and aimed-contact readability.

## Cockpit reference refinement — 2026-11-13
- Continued the authorized local HUD task using the supplied image: angular steel shoulders/joints and corner lights, tall recessed side bays, stacked icon gauges, circular local radar, readiness strips and icon command modules including Settings. Retained existing navy/cyan colors and all world artwork.
- Radar uses real explored cells/local ore/contacts/forges/player outposts; full-map access is preserved. Target view shows nearby friendly station identity/distance and the existing station thumbnail when no hostile contact is acquired. No fabricated health or contacts.
- Preserved both the previous local HUD edits and remote main (fetch found no new commits); no pull over local work. Branch remains codex/cockpit-hud, uncommitted. Added src/cockpitArt.ts and refined src/hud.ts alongside the previously listed UI/docs/tests files.
- Validation: 185 tests pass; build passes with existing bundle warning. Browser checks cover all command buttons (including Settings), original shortcuts, compact persistence and six viewport sizes; no errors/overflow, clear center. Stress check remains ~60 FPS with 400 asteroids and 50 actors. Fixed Systems/radar stacking and removed center-crossing frame posts on narrow layouts.
- No commits, pushes, merges or deployments. Next task: human combat/mining readability check against the reference at the user's usual resolution.

## Detailed cockpit + latest main integration — 2026-11-13
- Saved prior cockpit work as local commit b268601 and combined main fb84cc3 (HUD/navigation, map markers, fleets, hull paint and robust save storage). Resolved conflicts in architecture notes, HTML, status markup and scene integration without discarding either system.
- Added layered steel skins, recessed vents, pixel markings, slotted fasteners, cyan lamp fittings, hard instrument bevels and segmented gauges/readiness strips. Existing gameplay/world sprites are preserved; small-screen framing remains simplified.
- Reused main's zoomable radar in the cockpit, retained compass/map markers, merged hull/heat warning classes and ship-name/fleet labels, and preserved new ship painting and save behavior. Removed a duplicate nested session menu; radar pointer events and settings access verified.
- Validation: all 203 tests and production build pass (existing bundle-size warning). Browser checks: six layouts from 1440x1000 to 390x667, all command buttons and keyboard controls, radar +/− and wheel, map marker placement, fleet purchase/switching and hull paint; no errors. Stress scene with 400 asteroids/50 actors remains ~60 FPS.
- User explicitly authorized committing, pushing and updating the live site after these checks. Release preparation includes the complete merged history; deployment success will be reported after GitHub Pages verification.
- Next task: human playtest of instrument readability and contrast during combat/mining.

## HUD layout correction / second reference — 2026-11-13
- Fixed root cause of the screenshot's clipping: legacy large-screen CSS zoom scaled individual panels independently of the cockpit frame. Cockpit panels now share one sizing system, with explicit short-desktop spacing and a visible forge footer instead of a scrolling whole status panel.
- Consolidated cockpit CSS, increased label/command contrast, made status segments broader, removed double masking, simplified instrument headings and made navigation compact. Moved the controls help into Systems; kept actual ship/fleet information, cooldowns, cargo and warnings.
- Replaced hand-built HUD symbols with 13 locally bundled Google Material Symbols (Apache-2.0; THIRD_PARTY_NOTICES.md and licenses/material-symbols-APACHE-2.0.txt). No font CDN or new runtime dependency.
- Circular radar now clips and pins markers to a circle, uses quarter-range rings and a larger cyan heading arrow. Equipment rows are numbered consecutively and do not display a ready gauge when systems are locked. Map/settings/outfitter controls work while paused like their existing keyboard equivalents; powered actions remain blocked.
- Validation: 203 tests/build pass; all desktop starter/L5-with-warning layouts fit at 1903x906, 1672x941, 1536x725, 1440x900, 1366x768 and 1280x720. Separate 125% display-scale check passed. Six responsive sizes, controls, markers, radar zoom, fleet and paint browser checks passed; no errors. Stress scene remained ~60 FPS.
- Branch codex/hud-layout-fixes; clean start and fetch showed main already synchronized. User explicitly requested commit/push and live deployment after checks. No other developer changes were overwritten. Existing bundle-size warning remains.
- Next task: user review of the deployed HUD at their actual browser resolution and zoom.

## Outfitter cockpit styling — 2026-11-13
- Restyled the shipyard to match the current navy/cyan HUD: recessed panels, shared local symbol, numbered sections, clearer catalog selection, pixel-art module frames, level indicators and compact level badges on the north-facing grid.
- Added scoped src/outfitter.css. Desktop modal owns its viewport sizing (legacy zoom canceled); fleet/storage, launch, overview and repair footer remain visible while catalog/grid/inspector scroll independently. Narrow screens stack sections with a sticky close header and vertical scrolling.
- Preserved all costs, stats, event attributes and editor logic; removed the redundant maximum-level error notice while retaining its actual status. Existing ship/fleet/paint artwork and simulation are unchanged.
- Validation: 203 tests and production build pass (existing bundle warning). Browser: populated 18-module ship at seven sizes from 1903x906 to 390x667, no horizontal overflow/errors; desktop launch/repair visible. Search, drag install, upgrade, drag swap, scroll retention, remove, paint, buy/switch ship and close all passed.
- Files: src/outfitter.css, src/outfitter.ts, src/main.ts plus GAME_DESIGN.md, ARCHITECTURE.md, TASKS.md and PROGRESS.md. Clean start; fetched origin, main already synchronized; local branch codex/outfitter-cockpit-style. No conflicts, commits, pushes or deployment.
- Next task: user review of outfitter density and grid readability at the usual browser resolution.

Release authorization: user requested live publication of the outfitter update. Remote main remains synchronized; publishing the tested local changes without altering other developers' work.

## HUD button click fix — 2026-11-13
- Reproduced lost clicks: command buttons were replaced every 100ms because raw generated HTML differed from browser-serialized HTML (including SVG/boolean attributes). A 250ms mouse press missed its original target; button identity also changed while keyboard-focused.
- src/cockpit.ts now creates each command button once and patches disabled/title/status in place. The same native button survives timers and state changes. Kept command routing and all equipment/station/pause restrictions intact.
- Validation: reproduction changed from identity=false / held map click=false to both true. Browser checks passed all seven commands with 240ms clicks, SVG icon clicks held 300ms, keyboard focus/Enter across cooldown expiry, and six responsive layouts; no errors. All 203 tests and production build passed (existing bundle warning).
- Files: src/cockpit.ts, ARCHITECTURE.md, GAME_DESIGN.md, TASKS.md, PROGRESS.md. Clean start, origin fetched and main already synchronized; local branch codex/hud-button-clicks. No conflicts. Changes remain uncommitted; nothing pushed or deployed.
- Next task: verify the fix with normal-duration mouse clicks on the user's browser after publication is authorized.

## Ultimate Level 5 progression — 2026-11-13
- Preserved the authorized local HUD button fix. Rebalanced all 17 equipment types across five tiers; basic weapon throughput rises about 3–5×, with named L5 paid abilities providing larger tactical spikes. Updated costs/output descriptions, utility tiers, powered fabricator repairs and lightweight L5 visuals/audio pitch.
- Added shared defensive/phase recovery and enemy EMP recovery, prevented unpaid shots from advancing counters, and persisted recovery timers/fractional repair iron debt. Fixed penetration ending early because its loop limit decreased after each hit. Resource extraction/collection remains finite and deduplicated.
- Validation: all 207 tests pass; production build passes with the existing large-bundle warning. Added coverage for tier throughput, unpaid ultimates, EMP recovery and compatible saves. Human fleet/boss balance remains the next specific task.
- Git: codex/hud-button-clicks; origin fetched at task start, main synchronized; no upstream selected or pull performed on this feature branch. Existing uncommitted HUD/docs edits were present and explicitly authorized to preserve. No conflicts; changes remain local and uncommitted. Nothing pushed, merged or deployed.
- Browser regression: six viewport sizes (390–1440px), held HUD clicks, keyboard, map/radar, settings, docking, burst, overclock, building and preference persistence all passed with no page errors. Outfitter now labels nominal power/heat as base values because ultimate bursts can exceed them.

## Economy rebalance and combined release — 2026-11-13
- Audited old linear 1–4× upgrade costs, flat final 10-radioactive gate, multi-beam extraction, rewards, regeneration and cheap automation. Added category purchase prices, 2/5/12/30× upgrades plus tier minerals, and separate costly core milestones. Preserved all five tiers, ultimate power, cargo and combat/mining mechanics.
- Infrastructure costs ×3; structure upgrades escalate; drone income reduced to 2 active/0.6 away ore/s with 8-energy launches. Rewards and renewal cooldowns retained. New-world common-weighted fields/area-scaled yields are versioned; old worlds keep original reserves/geography. No save resource removal or equipment downgrades.
- Fixed repricing exploit: new modules track actual invested minerals; legacy refunds/salvage keep old valuation. Outfitter displays required/stored/missing minerals and precise shortfalls.
- npm run economy regenerates ECONOMY_REPORT.md: actual starter/early/mid/advanced/endgame extraction measured; explicit delivery/mineral assumptions estimate core 2–5 at 20.6/59.2/146/461.7 minutes. These are scenario estimates requiring human validation, not timing guarantees. Regional samples, combat rewards, module affordability and automation ceilings recorded.
- Validation: 212 tests pass; production build passes (existing bundle-size warning). Browser: shortages, disabled unaffordable upgrades, exact core charge, paid module ledger, upgrade and desktop overflow checks pass with no errors. Prior HUD/ultimate browser checks remain recorded above. Diff reviewed; no conflicts.
- Git: codex/hud-button-clicks had the known prior HUD/ultimate edits, explicitly included by the user's “push everything live” request. Origin fetched; HEAD matched origin/main at start; no upstream chosen/pull performed. User explicitly requested this combined release to GitHub and the existing Pages target; main push triggers that deployment. Next task: human economy pacing playtest.

## Live navigation chart — 2026-11-13
- Replaced the opaque centered map with a translucent right-side chart matching the cockpit. Starts at local zoom following the ship; Follow ship, World, +/- controls, span/coordinates, north marker and compact legend. Panning/wheel detach follow. Symbols and text retain readable screen size at any zoom.
- Map no longer pauses simulation, audio or effects; WASD/Shift and threats remain live. Explicit pause/settings/outfitter still pause. Pointer actions inside the chart cannot fire/mining-click through to gameplay. Tactical sidebar hides while chart covers it, restoring on close. Explored-only geography and existing marker/zoom/pan logic retained.
- Validation: 212 tests/build pass (existing bundle warning); isolated browser checks cover live movement, follow/world/zoom, wheel/pan/marker add, no map-click shots outside safe zones, explicit pause and desktop/mobile bounds; no page errors.
- Git: codex/hud-button-clicks, clean start, origin fetched and HEAD matched origin/main; no upstream configured/selected, no pull needed. Files: src/main.ts, src/map.ts, new src/map.css and project docs. No conflicts; local uncommitted changes only. Nothing committed, pushed or deployed.
- Next: user review of chart opacity and placement during combat at normal resolution.

Map release: user explicitly requested “push live”. Re-fetched origin: HEAD/main still synchronized; another developer's new claude/station-visuals branch is left untouched. Revalidated 212 passing tests and production build; existing bundle warning only. Publishing the reviewed map changes to the existing main-triggered GitHub Pages target.

Relay deployed on the Pi (2026-11-13, user go-ahead: "you can deploy to the pi ssh pi"). MMO work committed locally as f89cc7f on claude/mmo-sectors (not pushed). Pi: Debian 11, Node 16 kept as is; relay bundled with esbuild (`npm run relay-bundle`) to /opt/voidforge/relay.mjs, systemd `voidforge-relay` as user `voidforge` on 127.0.0.1:8787, nginx site `voidforge` with a new Let's Encrypt certificate. Verified: health page over HTTPS, foreign Origin refused (403), two clients created and joined a lobby over wss. Load test 200 pilots: 64% of one core, p99 124 ms — about 300 pilots is the Pi's ceiling. The live game page still lacks the multiplayer UI until the branch reaches main.
- Next: play-test online with Nate (local build pointed at the default relay), then decide on a PR.

## Animated Last Forge menu — 2026-11-13
- Pulled main 80eeed8 → 59ab112 with a clean fast-forward, preserving the other developer's new station artwork/tests. Created local codex/animated-main-menu; no upstream configured or changed.
- Added an actual startup menu with Continue, confirmed seeded New Game, Multiplayer Coming Soon, tutorial, Shattering/SPARK lore and existing settings. Reuses game procedural station/ship/asteroid artwork in independently animated stars, service ring/reactor/lights, traffic/docking paths and drifting debris. 30fps bounded Canvas animation suspends when hidden, stays static for reduced motion and stops during gameplay.
- One Phaser game/scene remains; menu freezes gameplay and autosave, including placeholder unload writes. Return via Settings offers save/no-save/cancel, with same-session Continue preserving unsaved changes. Awaited save outcomes report storage failure; failed backup blocks replacement. Backup prefers a valid older save over a corrupt newer copy.
- Validation: 219 tests and production build pass (existing bundle warning). Isolated browser tests verify animation/static reduced motion, initial no-save state, menu simulation freeze, panels/settings, cancel safety, seed generation, saved Continue, backup contents, in-memory resume, movement, single game canvas, stopped menu RAF, responsive/mobile scrolling/tutorial launch and failed durable saves. Desktop/mobile screenshots saved in local Temp; no user save touched.
- Files: src/mainMenu.ts, src/menuBackdrop.ts, src/mainMenu.css; targeted src/main.ts, src/persistence.ts, src/settings.ts; tests/persistence.test.ts and project docs. No conflicts; changes local/uncommitted. Nothing pushed or deployed. Ready for review; next specific task is user visual review before publication authorization.

Menu reference revision: user requested closer resemblance to the supplied composition. Added cached procedural menuArt.ts scenery/portrait (industrial platforms, crimson banner, pink-haired scavenger, ringed violet planet and stepped nebula), enlarged/repositioned the animated Forge and traffic, and strengthened metallic title/chamfered cyan console/armored feature strip. No generated/downloaded bitmap assets or gameplay artwork changes. Desktop/mobile screenshots refreshed; full menu/save/browser regression still passes.

Illustrated reference correction: user rejected the flat procedural approximation. Used the imagegen skill with the supplied reference to create a detailed scene plate (character, industrial docks, purple planet/nebula and Forge), integrated as a local 497-KiB WebP. Removed the earlier menuArt.ts stand-in. Menu controls/title/info/footer remain live HTML; animated stars/rocks/traffic and the illustrated Forge aperture remain separate Canvas layers, with all existing lifecycle/reduced-motion controls. Preview captured at the reference's 1672x941 aspect. No gameplay art or saved state altered. This supersedes the previous code-only menu art choice.

## Integrated menu release — 2026-11-13
- User explicitly authorized integration and live publication after remote main advanced to 4546fd8 (the other developer's multiplayer/relay update). Prepared clean release worktree E:/AI Projects/VOIDFORGE-menu-release on codex/menu-release based on that main; original uncommitted menu checkout remains untouched. Preserved every remote file/change and transplanted only targeted menu edits, adding both sets of documentation without conflicts.
- Updated Multiplayer from the obsolete Coming Soon panel to real lobby controls. Startup defers networking until launch; entering the menu disconnects, normalizes visiting pilots home and suppresses incidental lobby autosaves for the no-save path. Cancel keeps the connection/session intact. No Pi/production relay deployment or restart performed.
- Validation: all 251 tests and production build pass, existing bundle warning only. Integrated browser checks cover menu motion, imagery, save/backup/continue, failures, same-session resume, controls, mobile and reduced motion. A local relay/two-browser test passed explicit host/join/shared-world entry, menu disconnect/home recovery without disk writes and resume. Single-player never auto-connects. Reviewed complete diff; final remote check precedes publication to existing Pages main workflow.

## Menu feedback — 2026-11-13
- Removed the small moving ships and exhaust trails from the illustrated menu; stars, drifting rocks and Forge aperture motion remain.
- Added short hover/focus, click and warning cues through the existing audio engine, respecting master/SFX volume, mute, voice limits and cue gaps. Main menu and confirmation/tutorial/lore dialog buttons share delegated handlers.
- New Game now explicitly warns that world, upgrades, minerals and outposts will be replaced; Cancel is focused by default and the destructive action reads Confirm new game. Existing awaited backup and seed generation remain intact; cancellation writes nothing.
- Validation: browser verified ship removal, three sound cues, mute suppressing synthesis, warning/cancel save preservation and explicit seeded launch. Full 251 tests/build pass after aligning the click cue with the existing minimum cue gap. Existing bundle warning only.
- Git: clean start in integrated E:/AI Projects/VOIDFORGE-menu-release, branch codex/menu-release; fetched origin and HEAD matched main. No pull needed, conflicts or unexpected edits. Files: src/menuBackdrop.ts, src/mainMenu.ts/css, src/main.ts, src/audio.ts and docs. Local uncommitted changes; nothing pushed/deployed. Next: user review of button loudness and confirmation wording.

Menu feedback release: user explicitly requested push live. Origin re-fetched; release branch still matches main, with only the reviewed local menu feedback changes. Revalidated 251 tests/build and publishing to the existing main-triggered Pages target. No relay changes or deployment.

## Compact HUD redesign — 2026-11-13
- Compact toggle now selects a minimal frame rather than shrinking the full cockpit's tall side rails/bottom armor. Full HUD rendering stays intact. Added scoped compactHud.css: floating two-column vitals/cargo card, small radar card, centered 820px maximum command bar and centered message strip. Suppressed redundant target/base panels in compact mode; critical gauges, warnings, radar and all commands remain.
- Density changes rebuild frame geometry only on toggle/resize, retaining native command buttons and preference persistence. Mobile card widths/labels and console spacing are explicitly constrained.
- Validation: production build and 251 tests pass (existing bundle warning). Browser: 2553x1270, 1440x900, 1366x768, 900x650 and 390x667; no overlaps/overflow, clear flight center, roughly 175–199px vital-card height, correct full-frame restoration, persistent preference, stable button identity and working held map/settings clicks. No page errors; screenshots captured.
- Previous requested release 89f611d is deployed successfully; live smoke verified its stronger New Game warning and launch/save/multiplayer flow. This compact-HUD task is local/uncommitted on codex/menu-release in the integrated release worktree. Clean start, origin fetched and matched HEAD, no pull needed/conflicts; nothing newly pushed/deployed for compact mode.
- Files: src/cockpit.ts, src/cockpitArt.ts, src/main.ts, new src/compactHud.css and project docs. Next: user review of compact instrument readability at their screen resolution.

Compact HUD release: user explicitly requested push live. Origin fetched; HEAD/main remain synchronized and only the reviewed compact HUD changes are pending. Revalidated 251 tests and production build, with the existing bundle warning. Publishing to the existing main-triggered Pages target; production relay unchanged.

## Multiplayer play-test fixes and always-online lobby UI — 2026-11-13
- User report after playing online: no remote bullets or collisions, guests did not collide, no host stations/outposts, objects appearing from nowhere, no new map at the edge; then: lobby UI hidden in Settings, no open lobbies, should always be online.
- Causes found: player shots were never sent; rock bumps and ship contact were local only; guests generated a fresh copy of the host sector (different depletion, outposts, belt clock, renewals); guests were refused at edges; enemy-shot casts each frame could exceed the relay's 30 messages/s; world chunks were only sent to pilots within ship-state range; a destroyed authority froze enemies and dragged clocks back.
- Built: fx batching, remote shots, bump sync, pending rock changes, pilot collisions, chunked sector transfer with visitor outposts and clock sync, guest edge travel, live-only authority election, size guard; always-online client with reconnect and Play offline; Multiplayer panel (P / command bar / main menu entry) with open lobby list, open/private create, join by code, rename, pilots here.
- Validation: 262 tests and build pass. Browser (Chrome, local relay, headless bot host): auto-online, open lobby listed and joined in one click, host sync message, remote shots visible, ship push-apart without ally damage, guest crossing east/west in the host grid and re-sync on return, menu Multiplayer opens the panel; QA saves restored afterwards.
- Git: branch claude/mmo-fixes from main after PR #5 merged; merged later main (menu, compact HUD), one import conflict resolved. The relay on the Pi still runs the previous version.
- Next: redeploy the relay on the Pi (approval needed), then merge this PR so the live site uses it; play-test with two people.

## Multiplayer play-test round 2 — 2026-11-13
- User report: no remote tractor/mining beams, pilots vanish when paused, shields not visible, guns fire while using menus; rule: no pausing in multiplayer.
- Built: pilot looks in fx (shield, mining and tractor beams) drawn on remote ships; no pause in multiplayer (Esc, blur and seed typing do not pause; Outfitter/Settings keep simulating hands-off; frame-stall timer keeps simulating and sending); fire/mine only from presses on the game canvas; relay bot `--mine` and auto-respawn for checks.
- Validation: 263 tests and build pass. Browser (Chrome, local relay, mining bot host): remote mining beam visible on the guest, Esc refuses to pause and a forced pause is undone, holding on a panel button fires nothing while holding on the game fires, frame loop stopped for 5 s still sent 8 ship updates and advanced the simulation 3.8 s. QA saves restored. No relay change needed.
- Git: new branch claude/mmo-polish after PR #6 merged. Next: two-person play-test of beams, shields and the no-pause rule.

## Build mode pays from deposits — 2026-11-13
- User request: build mode only used ship cargo; it should also use deposited minerals. New blocks, upgrades and repairs now pay from ship cargo, then the outpost's storage, then station deposits; the build panel shows all three and marks affordability from their total.
- Validation: 264 tests (new payment-order and conservation test) and build pass; browser: panel lists ship cargo and station deposits, an Outpost Core was paid 2 iron from cargo and the rest from deposits. QA save restored. Local and uncommitted.

## Lobby resource sharing — 2026-11-13
- User request: share resources in a lobby when a setting is on. Decisions via questions: station deposits only, each player opts in.
- Built: relay `party` messages (lobby-wide, any sector); `LobbyShare` pool announcements and borrow/give with refunds; model `lobbyCover` on every deposit-spending action with automatic retry; Multiplayer panel switch and pool line; UI keeps lobby-coverable actions clickable; relay bot `--share`.
- Validation: 268 tests (new: amounts, shortfall-only borrowing and retry, relay round trip with exact conservation and opt-out, refund when the borrower left) and build pass. Browser with a sharing bot: pool shown in the panel; with empty ship and deposits an Outpost Core borrowed 240 iron/120 copper/30 crystal and built itself; the bot's pool dropped by exactly that. QA save restored.
- Needs the relay redeployed on the Pi before it works live (new `party` message). Local and uncommitted.

## Industrial audio upgrade / authorized release — 2026-11-13
- Highest-priority fix: successful mineral unloads now queue actual transferred quantity and play clamp/rattle/confirmation layers; full/large holds use deeper texture. Covers Forge E, partial/full outpost deposits and automatic fleet unload; no success cue for empty/failed transfers. No resource/cost changes.
- Added persistent action audio for outfitter/build/repair, aggregated metallic pickups, continuous mining crackle, progressive weapon weight/ultimate release, energy/heat/shield warnings, paid L5 activations, respawn/rebuild and specific menu transitions. Existing music/settings are preserved. Full audit in AUDIO_AUDIT.md.
- Mixing: 24 maximum one-shot sources with reserved priority tiers/preemption and deposit precedence; cached noise, bounded persistent tool loops, explicit fade/disconnect cleanup. Warnings/pickups/deposits rate-limited. Action audio is not saved and is independent of particle budgets.
- Validation: 269 tests pass after integrating the latest multiplayer fixes; build passes with existing large-bundle warning. Browser verifies small/full/empty deposits, aggregated pickups, mining stop/pause/menu, paused outfitter operations, paid Overclock/Warp, effects volume/mute and same music element. OfflineAudioContext stress render admitted deposit under load, capped at 24 one-shots, peak 0.106968 (<1), RMS ~0.007082 and zero remaining one-shots; no browser errors.
- User explicitly requested main/live publication while away. Origin advanced to ac5af55 during final checks; built clean E:/AI Projects/VOIDFORGE-audio-release on codex/audio-release and transplanted only audio edits, preserving all new MMO synchronization/panel/always-online behavior. Earlier checkout remains intact. No merge conflicts or destructive operations; no production relay deployment/restart. Fresh remote comparison precedes publishing.
- Next: human speaker/headphone balance review. Remaining gap: per-remote-pilot shot sounds are not newly transmitted; relay/wire protocol unchanged by this audio update.

## Ship zoom rendering fix — 2026-11-13
- Clean start; fetched origin and safely fast-forwarded 819939b → 5c827ff, preserving the latest lobby/resource-sharing changes. Created local codex/ship-zoom-rendering without changing upstream settings.
- Replaced independent player-module image transforms with one cached assembled hull image: original module textures/paint and connection art baked on one local pixel grid, anchored at the core and rotated/scaled once. Rebuilds only for layout/level/paint edits, never camera zoom/motion. Physics, aiming, zoom limits, effects and saved layouts unchanged.
- Added src/shipImage.ts for layout/baking with a bounded 2048px texture budget; oversized ships retain the old per-block renderer, with no ship-building cap. Full hull texture is replaced/reused without accumulating texture keys. Existing remote-pilot renderer is unchanged.
- Validation: production build and full tests pass (existing bundle warning). Browser tested Canvas/WebGL with actual wheel changes across 0.55–2.2 and fractional intermediate zooms: same source canvas, fixed core anchor/angle/layout, one assembly texture, rebuild after move/upgrade/repaint, north-facing preview and safe oversized fallback. No page errors. Unit coverage checks asymmetric negative-coordinate layout bounds, core anchor and texture budget.
- Files: src/main.ts, new src/shipImage.ts, tests/shipImage.test.ts and project docs. Local uncommitted changes only; no conflicts, commits, push or deployment. Next: user visual verification of the zoom fix on their ship.

## Stronger, visible-only effects — 2026-11-13
- Continued on codex/ship-zoom-rendering with the known local zoom fix intact. Origin had been fetched/pulled to 5c827ff at session start; no upstream was selected and no collaborator work was overwritten.
- World audio uses exact camera bounds, including tool targets, pickups and structure events. Enemy/ore hits and kills carry positions; removed unconditional global-counter sounds. UI confirmations remain audible.
- Effects gain 2.6x, restrained low-priority cues, decaying metallic modulation on mechanical sounds, stronger mining grit, brief music ducking and bounded output saturation. Existing settings/music, 24-source cap and cleanup preserved.
- Validation: 280 tests and production build pass (existing bundle-size warning). Browser verifies off-screen shots/hits/structures silent, visible equivalents audible, duck/restore, no page errors. Offline comparison RMS 0.009278 → 0.024117 (2.599x); crowded stress peak 0.269604, max 24 sources, zero left afterward.
- Files: src/audio.ts, src/model.ts, src/main.ts, src/effectEvents.ts, new src/soundVisibility.ts and tests/soundVisibility.test.ts; project docs and AUDIO_AUDIT.md. Earlier shipImage files remain local. No conflicts; all changes uncommitted, nothing pushed or deployed. Next: user listening pass and zoom visual check.

- Publication authorized by user ('push live'): fetched origin, confirmed HEAD equals origin/main 5c827ff and no collaborator commits to integrate. Re-ran all 280 tests; build and diff checks pass. Publishing only the reviewed audio/visibility and ship-zoom fixes via a normal fast-forward push; Pages workflow handles deployment. No relay restart.

## Enemy retaliation — 2026-11-13
- Fetched origin; clean HEAD matched origin/main 464c3df, so no pull/integration needed. Created local codex/enemy-retaliation; no upstream selected.
- Damaging hits now start/refresh a configured 10-second pursuit, following the shooter beyond detection. Authority prefers the remote attacker over nearer pilots. Visibility still gates fire; safe zones cancel pursuit, guard leashes/tactical retreats remain. Collision damage does not provoke. Existing memory handles searching after timeout.
- Files: src/model.ts, src/enemyAI.ts, src/data.ts, tests/enemies.test.ts, new tests/retaliation.test.ts and project docs. Validation: 284 tests pass, production build passes (existing bundle warning), diff checks clean. Updated old out-of-sight hit regression to expect chase; it exercises actual projectile damage.
- No conflicts or pre-existing local edits; changes remain local/uncommitted. Nothing pushed or deployed. Next: playtest pursuit/disengagement duration.

## Destructible enemy missiles — 2026-11-13
- Continued the requested changes on codex/enemy-retaliation, preserving known uncommitted pursuit work after user steering. Fetched origin; HEAD still matches origin/main 464c3df. No upstream selected or pull needed.
- Enemy missiles now have 90 durability, cumulative shot damage, impact feedback and a visual/audio explosion when destroyed. Defensive interception disarms the warhead without splash damage or rewards. Relative sweeps and nearest-contact priority preserve asteroid cover. Existing pooled bullets clear health on reuse; legacy shots default health lazily. Remote visual-only shots cannot damage missiles; network protocol unchanged.
- Files added/changed for this feature: src/model.ts, src/data.ts, tests/missileDefense.test.ts and project docs. Validation: 288 full-suite tests pass; build passes with existing bundle-size warning; diff checks pass. Prior pursuit changes remain intact.
- No conflicts, commits, push or deployment. Next: playtest missile durability/hit radius and pursuit timing.

- User authorized live publication. Fetched origin and verified unchanged main 464c3df; reran 288 tests and production build successfully. Publishing pursuit/interception changes via normal fast-forward push and the existing Pages workflow; no relay changes.

## Active-flight zoom correction — 2026-11-13
- Clean start on codex/enemy-retaliation; fetched origin, HEAD equals origin/main 1beff1c, no pull required. Created local codex/zoom-aim-fix; no upstream selected.
- Found wheel changes current zoom while Phaser getWorldPoint still uses the preceding rendered matrix. This mixed-state aim can rotate the ship abruptly; earlier paused texture tests missed it. Added current-value flightWorldPoint for input/reticle/build preview and disabled roundPixels on follow to avoid fractional-zoom snapping. Existing composite hull cache preserved.
- Files: src/main.ts, new src/flightCamera.ts, tests/flightCamera.test.ts and project docs. Validation: 290 tests pass, production build passes (existing bundle warning). Real wheel browser checks during unpaused flight at world 49000/48000 show stable heading 0.302884868 across zoom changes in Canvas/WebGL, no browser errors. Projection tests cover fractional zoom, viewport offsets and scroll.
- No conflicts, pre-existing edits, commits, push or deployment. Next: user visual check of active zoom; changes remain local/uncommitted.

- User authorized live publication: fetched origin, confirmed main unchanged at 1beff1c, reran 290 tests and production build successfully. Publishing the reviewed camera fix via normal fast-forward push and existing Pages deployment; no relay changes.

## Zoom heading reversal — 2026-11-13
- Clean start; fetched origin, HEAD equals origin/main c0443bf, no pull needed. Created codex/zoom-heading-lock; no upstream selected.
- Previous distant-cursor test missed near-cursor camera-follow lag: reproduced heading 0 → pi during wheel zoom in WebGL while moving. Kept current-value projection but added a wheel heading lock until actual mouse movement; input and reticle use the same direction. Model switches clear lock. No ship layout/rendering rewrite.
- Files: src/main.ts, src/flightCamera.ts, tests/flightCamera.test.ts and project docs. 291 tests pass; build passes with existing bundle warning; diff checks clean. Browser moving-flight near-center-cursor wheel test now shows constant heading in Canvas/WebGL; mouse movement releases lock; no page errors.
- No pre-existing edits or conflicts; uncommitted local changes only, nothing pushed/deployed. Next: user check the near-cursor zoom behavior.

- User authorized live publication: fetched origin and confirmed main unchanged at c0443bf; 291 tests and production build pass. Publishing the reviewed wheel-heading fix via normal fast-forward push and existing Pages workflow; no relay changes.

## Multiplayer performance pass — 2026-11-13
- User request: deep performance review, slowdown when enemies arrive with other pilots connected; ten rounds until smooth.
- Rounds: (1) streaming refresh reuses live rocks; (2) collision bodies pooled, numeric grids; (3) hostile-fire module positions once per frame, shot box rejection, allocation-free targeting; (4) sector sync keeps sprites/backdrop with fingerprint-verified, rate-limited repaints; (5) per-frame rock grid for enemy avoidance and shots, moving-rock list for steering; (6) asteroid arrival budget per tick; (7) bullet caps counted once per batch; (8) peer labels restyle only on change; (9) cached line of sight (0.1 s, cleared on rock changes); (10) enemy spacing grid.
- Same machine, main vs this branch (simulation ms per frame, mean / p99): single-player 1.02/2.3 → 0.39/1.1; authority with two pilots 1.73/3.4 → 0.53/1.5; follower 0.49/1.4 → 0.24/0.9; authority with four hordes (69 enemies) 4.24/6.9 → 0.81/2.1; fast flight worst frame 59 → ~6 ms (14.7 ms start-up frame). GCs per 30 s 158 → 34.
- Browser (DevTools Chrome, foreground, 1440×900): follower with a horde and authority with 90 enemies both ~60 fps, p99 frame ≈ 20 ms; sector sync no longer drops frames.
- Validation: 275 tests and build pass. Local and uncommitted on claude/mmo-perf (from main after PR #7 merged).
