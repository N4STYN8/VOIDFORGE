# VOIDFORGE

A procedural 2D space mining, combat and modular ship game built with TypeScript, Phaser 3 and Vite. Graphics and effects are generated locally; background music is the bundled Deep Space Patrol track; no accounts or paid APIs are required to play.

**Game:** https://n4styn8.github.io/VOIDFORGE/
**Repository:** https://github.com/N4STYN8/VOIDFORGE

## Run locally
Use Node 24 or newer (Node 22.18+ also supports the tests):

```sh
npm ci
npm run dev
```

Open the URL printed by Vite. Validation:

```sh
npm test
npm run build
npm run preview
```

## Controls
- WASD: thrust with drift; mouse: aim; left click: weapons outside safe zones.
- Hold right click/Space: auto-mine. Multiple upgraded beams can split targets.
- C: level-5 Core Command Overclock (6s efficiency boost, 30s cooldown).
- Shift: brief level-2+ booster burst, with energy/heat costs and cooldown.
- Q/B at an active base: outfitter. Search/filter the catalog; click or drag to install. Select blocks to upgrade, move/swap or remove. The grid faces north and pans/zooms.
- E: unload and attempt mineral-priced repairs. G: unlock a nearby outpost. R: respawn after death.
- M/minimap click: explored map. Wheel: map/playfield zoom. Drag the expanded map to pan.
- Esc: close/pause. N: mute. V: enhanced effects. Settings contain master/music/effects sliders and VFX controls.

Base cargo holds 120 units; cargo modules add 60/120/200/300/500 per tier. Tractors pull 1/2/3/4/5 mineral pickups at 150/225/300/375/450 px/s. Repeated module types have no count caps; resources, connected layout, mass, power and cooling govern the ship.

All 16 module types have five upgrade levels. Each level-5 module unlocks its own special ability, shown in the outfitter. Upgrade the unique Core to unlock higher item tiers.

## Worlds and saves
Optional manual seeds reproduce geography; New world otherwise generates a fresh seed. Autosave runs every ten seconds and on hide/exit. Save/Load use browser storage; Export/Import uses portable JSON files and preserves carved/destroyed ore, upgrades, resources, discoveries and unlocked bases. **Export then import to transfer a localhost save to the live page.**

## Living world
Asteroid fields replenish with new deposits after cooldowns: common ores 2–5 minutes, rare ores 8–15. Mining still consumes finite reserves per rock. Enemies reinforce regions according to mineral richness and threat; distant enemies sleep instead of accumulating active physics. Population timers use unpaused game time and persist in saves. Extra seeded belts/clusters now fill in gradually in existing worlds, with higher regional enemy targets and a 36-enemy active budget. Boss encounter content remains planned; no bosses have been added by this update.

## GitHub and automatic publishing
The main branch is the deployment branch. Every push tests/builds and then publishes the game to GitHub Pages; pull requests run validation without deploying.

Before working on another computer:

```sh
git pull --ff-only
npm ci
```

After a tested edit:

```sh
npm test
npm run build
git add <changed-files>
git commit -m "Describe the change"
git push origin main
```

Pulling receives repository changes locally. Pushing/merging to main triggers the live-page update after checks pass. The Actions tab shows deployment progress.

Current stage and remaining enemy/boss work are tracked in PROGRESS.md and TASKS.md.
