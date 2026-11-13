# VOIDFORGE project instructions

Build gameplay first using TypeScript, Phaser 3 and Vite. Keep graphics primitive, procedural, lightweight and replaceable. No downloaded art, shaders, services or unnecessary dependencies.

Start sessions by reading AGENTS.md, PROGRESS.md and TASKS.md. Inspect only relevant source. Preserve functioning systems, fix failures before adding features, and follow the user's latest steering. The user has explicitly authorized modules/upgrades, collision/damage, effects/audio, enemy squads, exploration, randomized worlds and persistence beyond the original Phase 1 scope.

Keep simulation independent of Phaser/DOM. Definitions and costs belong in src/data.ts. Geometry, mining, collision, world generation, persistence and rendering have separate files; extend those boundaries. New equipment/resources/enemies must be data-driven.

User requirements:
- Latest cargo rule: base capacity is 120; cargo holds add 60/120/200/300/500 by level. Full cargo pauses mining/collection; never delete overflow minerals.
- Ship blocks match build layout; north-facing shipyard preview with core centered. Q opens the shop; B is an alias.
- Latest module rule: no arbitrary per-type or total count caps. Core tiers still unlock item upgrade levels; placement, attachment, mass, power, heat and resources are the constraints.
- M opens the explored-only map; minimap click also opens it; wheel zooms; N mutes.
- Hold right click or Space to auto-mine. Multiple upgraded mining beams can split targets.
- Ore is finite and deforms at the impact side. Shooting recovers less ore than mining. Never duplicate resources.
- Ships/projectiles collide with ore. Safe zones disable weapons and exclude enemies; enemies patrol and only engage with detection/visibility.
- Seeded chunk generation must be deterministic. Save/load must preserve ore depletion, geometry, resources, layout, discoveries and unlocked bases.

Run npm test and npm run build after meaningful changes; use browser checks for controls/rendering/persistence. Node 22.18+ or 24/26 supports the built-in TypeScript test runner. No test framework dependency is needed.

End sessions by updating PROGRESS.md and TASKS.md, recording decisions in ARCHITECTURE.md, and stating the next specific task. Keep summaries concise. Do not add unrelated progression or base-building systems without user direction.

Latest staged brief: finish the three-panel outfitter/readability stage before expanding enemy classes, danger regions or bosses. Those are explicit later stages, not permission to rebuild all systems at once. Equipment/actions must display real configuration values and clear install vs upgrade states.

Use the shared EffectPool for particles. Effects never change simulation state/RNG. Maintain a bounded particle budget and independent tractor target slots. Tractor levels are 1/2/3/4/5 targets at 150/225/300/375/450 px/s, aimed toward the actual module. Purple/magenta tractor beams must remain distinct from mining beams.

Shift activates short level-2+ engine bursts with power/heat costs and cooldowns. Default Phaser Canvas rendering is intentional after measured heavy-combat gains; keep the background viewport-sized and sprites cached.

Publishing is authorized to the public N4STYN8/VOIDFORGE repository and GitHub Pages. Main pushes must run tests/build before deployment; pull requests validate without publishing. Never commit credentials, browser save files or local QA screenshots.

All 16 existing equipment types now have five levels; preserve levels 1–3 and per-installed-item upgrades. Core stays unique and gates tiers. Level-5 ability configuration is in abilityConfig.ts; reusable gameplay hooks in abilities.ts. Keep cascade/reflection non-recursive, flak one-generation, special projectile/field budgets bounded, and extraction strictly from finite ore. C triggers Command Overclock; Shift triggers Phase Dash on L5 boosters.
