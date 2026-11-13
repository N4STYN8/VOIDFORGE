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
- Core levels provide 100/150/225 base hull and better energy/cooling. Equipment cannot exceed core level. There are no per-type or total module-count caps. Each equipment item supports three levels.
- Equipment: autocannon, pulse laser, railgun, plasma cannon, missile launcher, flak cannon, EMP emitter, mining beam, cargo hold, armor, tractor, shield, booster, reactor and cooler. Exact stats/costs/limits live in src/data.ts and are shown in the outfitter.
- E unloads resources and attempts a paid repair. Repair charges iron for missing hull/module integrity and copper for damaged module integrity; failed payment never heals. Shop quotes the cost. Shield recharge is free.
- G near a locked outpost activates it with its displayed mineral cost, using carried ore plus shared base storage. Seven bases exist per world, including the starting base. Active bases offer repair, storage, outfitting and nearby respawn.

## Persistence and scope
- Autosave every 10 seconds and on hide/exit. Save/Load buttons manage browser storage; Export/Import uses JSON save files. New world creates a new seed unless a seed is entered. Previous local save is backed up before replacement.
- Saves include seed/geography, starting coordinates, player/ship, resources, asteroid modifications/tombstones, discovered map, outpost unlocks and simulation actors.
- Research, refining, crafting chains, player-placed structures, power/heat, additional equipment tiers and full progression balancing remain future work. Existing outposts and ship construction are persisted; no separate player-built structure system exists yet.

## Module freedom, tractors and ship systems
- Build grid pans/zooms beyond its viewport. Valid attached blocks can be installed repeatedly without type/count caps. Mass affects speed/thrust; reactors combine energy generation/storage and cooling systems combine dissipation/thermal capacity. Operating equipment consumes real energy and adds heat, pausing if unavailable or overheated.
- Tractor levels: range 180/300/450; exactly 1/2/3 independent target slots; pull speed 150/225/300. Targets persist until lost, collected or out of range, are exclusively claimed, and pull toward the module's collection point. Cargo full stops collection.
- Cargo holds add 60/120/200 capacity plus pickup reach. Full cargo stops mining. Removal that would overfill cargo is rejected; destruction/load overflow becomes nearby pickups, preserving quantities.
- Level-2/3 boosters keep cruise bonuses and add Shift bursts: +150/+240 raw speed and +400/+650 thrust for 1.8/2.2 seconds, with 6/5-second cooldowns and upfront energy/heat cost. Multiple boosters combine, subject to mass and power.
- EMP emits a growing pulse that damages each enemy once and temporarily disables it. Other new weapons have independent projectiles/loadouts; no additional ammunition inventory is required.
- Q outfitter has categorized/searchable catalog, north-facing construction grid, exact current → next comparisons, action costs/refunds, live ship overview and clear failure feedback. Flight HUD groups vitals and carried/stored minerals; secondary details expand.
- Bounded pooled procedural effects support trails, muzzle/impact/shield flashes, collection bursts, debris, rings and animated beams. V toggles enhanced effects without affecting gameplay. All tractor levels use purple tones; mining uses green/cyan/pale-yellow tones.
- N mutes; Audio settings provide master/effects volume. Default volume is moderately louder, weapon profiles differ, and mining/tractor hums stop when their actions end.

## Next staged expansion
The newer six enemy classes, tactical AI expansion, seeded danger regions and three bosses are queued after the outfitter stage. Current four classes/patrol AI remain in place; this update does not claim those later stages are complete.

Shots push asteroids along projectile travel; explosive hits push outward. Impulse scales with damage and inversely with rock mass, capped at 300 units/s from gunfire. Weapons remove material at 10% of nominal damage and recover 35% of removed ore; mining remains efficient. Moving rocks can damage and kill enemies through normal impact contacts.
