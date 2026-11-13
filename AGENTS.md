# VOIDFORGE project instructions

Build gameplay first using TypeScript, Phaser 3 and Vite. Keep graphics procedural, lightweight and replaceable: baked low-resolution pixel-art sprites from src/sprites.ts (one pixel per world unit, small palettes, dark outlines, nearest-neighbour scaling, one upper-left light). No downloaded art, shaders, services or unnecessary dependencies.

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

All 16 existing equipment types now have five levels; keep existing saved levels valid and preserve per-installed-item upgrades. Core stays unique and gates tiers. Level-5 ability configuration is in abilityConfig.ts; reusable gameplay hooks in abilities.ts. Keep cascade/reflection non-recursive, flak one-generation, special projectile/field budgets bounded, and extraction strictly from finite ore. C triggers Command Overclock; Shift triggers Phase Dash on L5 boosters.

World populations are renewable per the latest brief. Preserve finite per-asteroid reserves; depleted slots receive new seeded deposits at different safe positions after configurable game-time cooldowns. Population config is in populationConfig.ts. EnemyPopulation owns regional reinforcements/dormancy and the boss cooldown/reward ledger. It picks classes from ENEMY_SPAWN.normal/elite by regionDanger; enemies flagged populationExempt (bosses, their parts, escorts, reinforcements, drones) are never slept or counted. Bosses return: a defeat starts the ledger cooldown (POPULATION.bossInterval), defeatedBosses is derived from it, and repeat kills pay HORDE.repeatBossLoot of the reward. Never resume the old global ten-second enemy spawner. Persist game clock, slots/counters and dormant enemies; distinguish local budgets from geographic targets.

Latest balance: L1 weapon damage is intentionally reduced about 40%; later tiers unchanged. Weapon asteroid impulse is 0.3 per damage, capped at 12 units/s for resting rocks; weak hits must not erase faster ship/collision momentum. Denser fields use a separate persisted populationFields layer and positive template ID namespace at 200,000,000, with safe gradual arrivals. Local budgets are 2,400 asteroids and 36 enemies. Keep outfitter catalog/grid/detail scroll positions across DOM refreshes, including drag/drop.

Moving belts use beltMotion.ts and BELT_MOTION in populationConfig.ts: seeded static/drifting/orbital/flowing definitions, game-time epoch, analytical poses and sparse collision offsets. Preserve inverse-motion source-chunk queries, current-space deduplication and rotation-aware mining/LOS/contacts. Mineral drops inherit half rock velocity. Use cached sprites with rotation, never regenerate textures for motion alone. Ambient drift is seeded for a minority of rocks; retain safe starting/base exclusions.

Enemy classes live in ENEMIES/ENEMY_SPAWN/ENEMY_AI in src/data.ts; add or tune enemies there, route damage through hitEnemy/damageEnemy and fire through enemyShot. Keep the legacy keys raider/scout/tank/sniper for save compatibility. Enemy state selection is the pure nextEnemyState in src/enemyAI.ts; timing lives in ENEMY_AI. Danger levels come from dangerAt in src/world.ts (derived from the spec only; never store them in saves); tune via DANGER. Bosses are ENEMIES entries with a boss block plus part enemies (see ARCHITECTURE.md); sites come from bossSites in src/world.ts and only defeatedBosses is saved. All three bosses exist. Simulation sounds are cue events (GameModel.cue) with profiles in SOUND_PROFILES in src/audio.ts. The brief's remaining work is combat-effect polish and balancing, which need human play; do one stage per change. When staging browser checks, back up the local save to sessionStorage first: navigating saves the current model.

Horde events (user request): away from the start a timer by danger level leads to a 10-second red alert (flashing HUD, banner, siren, direction chevrons) and then a horde of populationExempt enemies that always tracks the player. Docking during the alert cancels it; outrun hordes give up; clearing one pays a bonus. Config is HORDE in src/data.ts, logic is updateHorde/spawnHorde in the model, state is saved in the optional horde field. This is an event, not a return of the global timed spawner.

## Mandatory Git collaboration and deployment safety rules

Two developers work on this repository. These rules apply to every agent session and task (Codex, Claude or any other), and they take precedence over anything above that conflicts with them, including the earlier "Publishing is authorized" paragraph: that paragraph describes where the project is hosted, not permission to push or publish without being asked.

Deployment fact: `.github/workflows/pages.yml` publishes the live game at https://n4styn8.github.io/VOIDFORGE/ on every push to `main` (and on manual `workflow_dispatch`). Pull requests only build and test. Treat `main` as a protected, auto-deploying branch.

### 1. Always check Git before editing

Before modifying any project files:

1. Run `git status --short --branch`.
2. Run `git branch --show-current`.
3. Run `git remote -v`.
4. Run `git fetch` from the configured upstream remote.
5. Check whether the current branch is behind, ahead of, or diverged from its upstream.
6. Check for uncommitted or untracked files.

If the working tree is clean, the branch has an upstream, and the upstream can be fast-forwarded safely, pull the latest changes using `git pull --ff-only`.

If there are local modifications, untracked-file conflicts, diverged histories, or any uncertainty: STOP and explain the situation. Do not automatically stash, reset, discard, overwrite, rebase, or merge anything. Ask how to proceed.

If no upstream is configured, explain that and ask before selecting one.

### 2. Never overwrite another developer's work

Assume another developer may be modifying the project at any time. Before editing:

- Inspect the latest code.
- Understand the current architecture.
- Identify files relevant to the requested task.
- Preserve changes made by other developers.
- Avoid unrelated refactoring.
- Avoid replacing entire files when small targeted edits are sufficient.

Never use destructive Git commands without explicit permission. Prohibited without approval:

- `git reset --hard`
- `git clean -fd`
- Force pushes
- Destructive checkouts or restores
- Discarding uncommitted changes
- Overwriting another developer's commits
- Automatic conflict resolution that discards either side

If conflicts occur, STOP and show the conflicting files and the available options.

### 3. Never push automatically

An agent may modify files locally to complete an authorized development task. It must NOT automatically:

- Run `git push`
- Push new branches
- Push commits
- Open or merge pull requests
- Merge branches into `main`, `master` or `production`
- Create releases
- Publish changes

Only perform these actions when the user explicitly requests that specific action. A request such as "fix this bug", "add this feature" or "update the game" does NOT authorize pushing or publishing. Completing a coding task is not permission to push.

### 4. Never update the live website automatically

The live VOIDFORGE website must remain unchanged unless the user explicitly authorizes deployment. Do not:

- Trigger production deployments.
- Run production deployment scripts.
- Upload production files.
- Modify production hosting settings.
- Trigger GitHub Actions deployment workflows.
- Push to branches that automatically deploy.
- Update the live game.

Do not assume a Git commit or push is safe for production. If a requested action could trigger deployment, explain the risk and ask for confirmation first.

### 5. Use safe development branches

Prefer a dedicated development or feature branch over working directly on `main`. Suggested naming: `codex/feature-description` (or the agent's own prefix, for example `claude/feature-description`).

Before creating or switching branches:

- Check for local changes.
- Check the current branch.
- Check the configured upstream.
- Ensure switching will not overwrite files.

Never switch branches in a way that discards uncommitted work. Creating a local feature branch is allowed when safe. Do not push the branch without permission. Do not automatically merge it into `main`.

### 6. Local commits

Do not create Git commits unless the user explicitly requests a commit. An agent may edit authorized project files, run local builds, run tests, review diffs and report completed work. At the end of a task, leave changes local and uncommitted unless instructed otherwise. Do not use automatic commits as checkpoints without permission.

### 7. Before every new task

1. Inspect Git status and the current branch.
2. Fetch the latest remote changes.
3. Safely fast-forward the current branch if possible.
4. Check for conflicts or uncommitted changes.
5. Review relevant existing code.
6. Make only the requested changes.
7. Run relevant tests and builds.
8. Review `git diff` to verify that unrelated work was not modified.
9. Report what changed.
10. STOP. Do not commit, push, merge, or deploy.

### 8. Task completion report

After each development task, provide:

- Current Git branch
- Whether remote changes were fetched and pulled
- Whether local modifications existed before starting
- Files changed
- Features implemented
- Tests performed
- Any conflicts or warnings
- Whether changes remain uncommitted
- Confirmation that nothing was pushed
- Confirmation that no deployment was initiated

### 9. Explicit permission required

These are separate operations and each needs its own authorization:

- "Commit my changes" allows a local commit only.
- "Push my branch" allows pushing the specifically requested branch only.
- "Merge into main" allows merging into `main` only after checking for conflicts and confirming that the merge is authorized.
- "Deploy to production" allows deployment only after confirming the intended target and reviewing the deployment procedure.

Permission for one operation does not imply permission for another.

### 10. Most important rule

Protect both developers' work. Always synchronize safely before starting new work. Never discard another developer's changes. Never automatically push. Never automatically merge. Never automatically deploy. When uncertain, STOP and ask. Development work stays local until the user explicitly authorizes the next Git operation.
