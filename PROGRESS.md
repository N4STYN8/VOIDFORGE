# Progress

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

## Verification
- 65 tests passing, including prior world/geometry/combat tests and new unlimited module combinations, exact tractor behavior, full cargo, no duplication, energy/heat/mass, weapon origins, EMP, Shift, pool cleanup and effect-disabled equivalence.
- Production build passes; expected Phaser bundle warning only (~368 KB gzip).
- Browser checks: 33-module ship with eight reactors, search using actual keyboard input, three panels, upgrade comparisons, HUD expansion, Shift burst, effects toggle and volume control; layouts inspected at 1440×1000, 1366×768, 1024×768 and 900×650. No runtime errors.
- Heavy simultaneous combat/mining/tractor fixture (~245 active ore, eight enemies, seven weapons) measured ~60 FPS in headless Canvas. Software WebGL measured ~35 FPS, motivating the default Canvas renderer and viewport-sized background.

## Publishing in progress
- User authorized public N4STYN8/VOIDFORGE and GitHub Pages. An empty private repository already exists; it will be made public as explicitly requested.
- Local main repository initialized and remote connected; no existing remote history to overwrite.
- Added test/build/deploy workflow for main and test-only PR validation, plus relative Vite asset paths.
- Push, Pages activation and live verification are the remaining steps.

## Scope and next task
- The later enemy-class, tactical AI, danger-region and three-boss overhaul is explicitly staged. It is queued next; current four enemy classes/patrol systems remain working.
- Next development task after publishing: implement distinct enemy loadouts/classes as one coherent stage, then tactical AI and seeded danger regions before bosses.
- Known limits: balancing/human playtesting remain pending; physical ship contacts still use a core-circle approximation. No new blocking failures found in this stage.

## Run
`npm install`, `npm run dev` (current local URL: http://127.0.0.1:5174/). Use JSON Export/Import to transfer saves between localhost and the hosted page.
