# Architecture

## Structure
- src/data.ts: typed resource/equipment/enemy/core/base templates and tuning constants.
- src/model.ts: plain TypeScript simulation: ships, inputs, weapons, shields/integrity, layouts, ore pickups/tractors, bases, AI integration and save state.
- src/world.ts: seeded RNG, world metadata, continuous belt/cluster fields, spawn validation, deterministic chunk generation, sparse modification/tombstone storage and surveyed ore markers.
- src/asteroidGeometry.ts: seeded 10–16 vertex radial polygons, inward deformation, point/edge/segment geometry.
- src/mining.ts: asteroid state hydration, impact points, finite material removal and geometry revision updates.
- src/effectEvents.ts: renderer-independent transient visual event contract; src/effects.ts owns the reusable fixed-budget particle pool.
- src/collisions.ts: circle contacts and circle-vs-carved-polygon contacts; no Phaser dependency.
- src/enemyAI.ts: polygon-aware visibility tests. Model owns detection, squad patrol/formation and combat state.
- src/persistence.ts: browser storage adapter. GameModel.toSave/fromSave use a versioned JSON schema, also exported/imported as files.
- src/main.ts: Phaser scene/input and UI coordination; src/outfitter.ts generates the three-panel outfitter and exact stat comparisons; src/hud.ts generates the flight HUD. src/visuals.ts provides primitive drawing helpers; src/map.ts draws the explored map; src/audio.ts provides gesture-unlocked synthesized weapon profiles, loops, bus volumes and rate/voice limits. src/effectsRender.ts draws lightweight beams, projectiles, EMP and pooled effects.
- tests/: Node built-in tests. fixtures.ts isolates old unit scenarios from randomized world generation.

## Important decisions
- World metadata is generated once from a string seed. Belts/clusters use global coordinates and continuous seeded value noise. Chunks independently sample the same field with per-chunk RNG, stable asteroid IDs and world-seeded shape IDs; visiting order does not change terrain.
- Chunk size is 1200 units; a 5×5 neighborhood is active. Leaving a chunk unloads unchanged objects; modified rocks are stored sparsely and destruction leaves permanent tombstones. No random asteroid replenishment resets mined ore.
- Save version 1 includes the generator version/spec, seed, world deltas, ship/modules, bases, exploration, inventory, pickups, projectiles, enemies/squads and RNG/timers. Runtime effects/sounds are transient. Base-building structures are not implemented yet; existing outposts are saved.
- Asteroid angles stay ordered and radii stay positive, preventing polygon self-intersections. Mining dents neighboring radii around the impact direction, then reduces area toward remaining material. Geometry changes only when whole units of material are removed.
- Ore health is fractional mining progress; amount is remaining finite yield. Ordinary mining releases all removed units; gunfire records unrecovered waste. Destruction only releases amount, then removes the asteroid. Pickups merge locally to control entity counts.
- Ships use polygon narrow-phase against carved ore; asteroid-pair contacts use updated conservative bounds. Per-block projectile hits can damage integrity and detach disconnected branches. Core-centered circle contacts remain an approximation for physical ship hulls.
- Performance: background baked into a repeating texture; asteroid textures rasterized only on first visibility/revision changes, bounded to 128 cached textures; visible sprite pool reused. Distant sleeping rocks skip contact simulation; local contacts use spatial buckets. HUD refreshes at 10 Hz, minimap/map at 5 Hz. No shaders or graphics dependencies.
- Earlier headless comparison improved from ~10 FPS to ~50–60 FPS after caching; benchmark values are environment-specific, not a universal hardware guarantee.
- Audio is gesture-unlocked, short synthesized cues with a master mute. M is map, N is mute. Presentation remains replaceable without changing model rules.
- Phaser's production bundle causes Vite's size warning (~350 KB gzip); accepted for the local prototype.

## Current interface/effects decisions
- Module definitions have no quantity limits and the editor is a panning viewport rather than a placement bounding box. Old 8/16/24 slot caps are superseded by the latest request. Core/item tiers remain progression prerequisites.
- Cached aggregate ship stats make power/thermal checks O(1) per operation. Per-module cooldowns, tractor target IDs and boost timers are independent. Mass affects movement and physical contact response.
- A module's operating power/heat is per second for continuous tools, per volley for weapons; volley consumption covers all flak pellets. Reactors generate energy, cooling dissipates heat, and weapons/miners/tractors/shield recharge/boosters refuse unavailable operations.
- Particle objects are preallocated once, reused and capped at 320. Offscreen effects are culled; important nearby events can replace lower-priority particles. Effects have their own deterministic visual RNG and do not alter model RNG or resources. Legacy mining fragment runtime was consolidated into the pool.
- Gameplay EMP pulses and projectile collision/damage are separate from their visual particles. VFX-disabled simulations are checked against identical effect-enabled game states.
- Default renderer is Phaser Canvas: a 33-module/eight-enemy/multi-beam combat fixture measured ~60 FPS versus ~35 using software WebGL. The background uses a viewport-sized repeating tile, avoiding a world-sized canvas. Optional `?renderer=webgl` is available for diagnosis.
- Cached ship sprites replace per-frame module vector drawing. Asteroid canvas textures are refreshed in place only when geometry revisions change; their shapes are not scaled as a substitute for deformation.
- Save v1 accepts optional energy/heat/EMP state and per-module target/burst fields; older v1 files receive safe power defaults. Overflow from older unlimited inventories is preserved as drops.

## Deployment
- GitHub Pages publishes the Vite dist artifact from main after npm ci/test/build. PRs only validate. Relative Vite asset URLs support the /VOIDFORGE/ project path.
- Browser saves belong to their site origin. Export/import moves a localhost save to the hosted page. The repository never contains player saves or credentials.

Editor dragging lives in `src/moduleDrag.ts`, uses pointer events with a movement threshold, and delegates validation/actions to the model. `moveError` shares side-effect-free validation between preview and committed movement. Builder DOM refresh pauses during active dragging to preserve the source and destination.

World expansion keeps the original 16-column asteroid ID namespace inside the former 19,200-square region; outer chunks use an offset namespace with fixed stride 4096. Optional generationSize/expansion fields migrate old v1 specs without moving original geography. Additional outer-field influence fades in over 2,000 units past the old boundary. The active 5×5 chunk window is independent of world area.

Module art remains centralized in drawModule: primitive beveled housings and equipment-specific hardware are baked into the existing texture cache and shared with editor icons/salvage. Tier bars are presentation only; module coordinates, collision and equipment definitions remain independent.

GameAudio routes the supplied MP3 media element and procedural effects through separate music/effects gain buses, then master gain/limiter. Vite bundles the local track using an import.meta.url asset reference. GameSettings owns the native paused modal and local preferences; particle density changes only the cosmetic pool RNG, never the simulation.

Weapon-to-ore impulse is applied in shootOre before deformation, using ORE_COMBAT tuning and existing asteroid velocity fields. Direct hits supply projectile direction; area hits supply outward blast direction. Existing contact resolution handles enemy damage and kill rewards without another physics system.

Five-tier progression extends the existing definitions without changing tiers 1–3. data.ts owns normal stats/durability/costs; abilityConfig.ts owns special names, descriptions and tuning; abilities.ts exposes shared onFire/onHit/onMiningHit/onDamageTaken/onBoost/onEnergyDeficit/onOverheat hooks and timer utilities. GameModel applies returned plans through normal damage, power and finite-ore paths. Side effects use bounded presentation events; arcs and fields are rendered independently.
Optional per-module AbilityState, coreAbility, novaFields and special projectile flags persist in v1 saves; older saves default safely. Piercing uses per-projectile hit IDs with a bounded swept-hit loop. EMP secondaries share the pulse hit set and cannot cascade. Reflection applies direct enemy damage. Nova overlaps take maximum rather than summed damage. Global special limits are 24 guided missiles, 96 one-generation fragments and 8 nova fields; normal installation quantities remain unlimited.

Regional populations: populationConfig.ts centralizes timing, threat targets, placement safety and active-area budgets. world.ts retains original seeded generation (arrival salts affect only replacement candidates), stores depleted field slots plus one current generation each, and uses a separate negative numeric ID namespace for replacements. Capture/snapshot preserve replacement geometry/momentum; original IDs remain tombstones. Active-region lookup is bounded to the 5×5 chunk neighborhood.
EnemyPopulation stores per-region reinforcement deadlines/counters, dormant Enemy records and patrol anchors. GameModel schedules population work every five game seconds, passes camera/ship blockers and supplies unique actor IDs; existing AI/contact/projectile paths remain in charge of combat. Defeat recording guards reward duplication. Optional world.population and GameSave.population fields migrate v1 saves; deadlines use saved elapsed game time, so unloaded catch-up needs no distant object creation or wall-clock awards. Sleeping actors count against geographic targets. Boss cooldown/reward hooks are implemented as a ledger only because no boss actor system currently exists.
