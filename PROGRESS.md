# Progress

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
- Next development task after publishing: implement distinct enemy loadouts/classes as one coherent stage, then tactical AI and seeded danger regions before bosses.
- Known limits: balancing/human playtesting remain pending; physical ship contacts still use a core-circle approximation. No new blocking failures found in this stage.

## Run
`npm install`, `npm run dev` (current local URL: http://127.0.0.1:5174/). Use JSON Export/Import to transfer saves between localhost and the hosted page.
