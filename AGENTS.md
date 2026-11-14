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

These user-mandated rules apply to ALL future Codex sessions and tasks. They supersede any earlier standing permission in this file or conversation to commit, push, publish or deploy. Preserve all other project instructions. Protect both developers' work; when uncertain, STOP and ask the user.

### 1. Always check Git before editing

Before modifying any project files:

1. Run `git status --short --branch`.
2. Run `git branch --show-current`.
3. Run `git remote -v`.
4. Identify the configured upstream and fetch from its configured remote (`git fetch <remote>`).
5. Check whether the branch is behind, ahead of or diverged from its upstream (for example, `git rev-list --left-right --count HEAD...@{upstream}`).
6. Check for uncommitted changes, untracked files and potential conflicts.

Only when the working tree is clean, the branch has an upstream and synchronization can fast-forward safely, run `git pull --ff-only`. If there are local modifications, untracked-file conflicts, diverged histories or any uncertainty, STOP, explain the situation and ask how to proceed. Do not automatically stash, reset, discard, overwrite, rebase or merge anything. If no upstream is configured, explain that and ask before selecting one.

### 2. Never overwrite another developer's work

Assume another developer may modify the project at any time. Before editing, inspect the latest relevant code, understand the current architecture and preserve others' changes. Avoid unrelated refactoring and replacing whole files when targeted edits suffice.

Never use destructive Git commands without explicit permission. Prohibited without approval: `git reset --hard`, `git clean -fd`, force pushes, destructive checkouts/restores, discarding uncommitted changes, overwriting another developer's commits or automatically resolving conflicts by discarding either side. If conflicts occur, STOP and show conflicting files and available options.

### 3. Never push automatically

An authorized development task permits local edits only. Do NOT automatically push commits or branches, open or merge pull requests, merge branches into main/master/production, create releases or publish changes. Perform each of these actions only when the user explicitly requests that specific action. Requests such as "fix this bug", "add this feature" or "update the game" do not authorize pushing or publishing. Task completion is not push permission.

### 4. Never update the live website automatically

The live VOIDFORGE website must remain unchanged unless the user explicitly authorizes deployment. Do not trigger production deployments, run production deployment scripts, upload production files, change production hosting settings, trigger deployment workflows, push to automatically deploying branches or update the live game without that authorization.

Identify automatic deployment branches and treat them as protected. A commit or push is not inherently safe for production. If a requested operation could trigger deployment, explain the risk and obtain deployment confirmation first, in addition to authorization for that Git operation.

Deployment configuration inspected on 2026-11-13: `.github/workflows/pages.yml` publishes GitHub Pages on pushes to `main`, and also supports `workflow_dispatch` (manual runs can deploy their selected ref). Pull requests targeting `main` run validation without publishing. Protect `main` and manual workflow runs. Do not change this workflow or hosting settings as part of routine development without explicit scope/approval; re-inspect it for future tasks rather than assuming it stays unchanged.

### 5. Use safe development branches

Prefer a dedicated local development/feature branch, such as `codex/feature-description`, instead of editing main. Before creating or switching branches, check local changes, current branch and configured upstream, and verify switching cannot overwrite work. Creating a local feature branch is allowed when safe. Never switch in a way that discards changes. Do not push the branch, configure an unrequested upstream or merge it into main automatically.

### 6. Local commits require permission

Do not create Git commits or checkpoint commits unless the user explicitly requests a commit. Authorized local edits, tests, builds and diff review are allowed. Leave completed changes local and uncommitted unless instructed otherwise.

### 7. Required workflow before every new task

1. Inspect Git status and the current branch.
2. Fetch the latest remote changes.
3. Safely fast-forward the current branch if possible.
4. Check for conflicts and uncommitted/untracked changes; STOP and ask if unsafe or uncertain.
5. Review relevant existing code.
6. Make only the requested changes.
7. Run relevant tests and builds.
8. Review `git diff` for unrelated modifications.
9. Report what changed.
10. STOP. Do not commit, push, merge or deploy.

### 8. Task completion report

After every development task, report:

- Current Git branch.
- Whether remote changes were fetched and pulled.
- Whether local modifications existed before starting.
- Files changed and features implemented.
- Tests performed.
- Conflicts or warnings.
- Whether changes remain uncommitted.
- Confirmation that nothing was pushed.
- Confirmation that no deployment was initiated.

### 9. Separate explicit permissions

- "Commit my changes" authorizes a local commit only.
- "Push my branch" authorizes pushing the specifically requested branch only. If it automatically deploys, obtain separate deployment authorization before pushing.
- "Merge into main" authorizes that merge only, after checking for conflicts and confirming the requested merge; it does not authorize a push or deployment.
- "Deploy to production" authorizes deployment only after confirming the intended target and reviewing the deployment procedure; it does not independently authorize other Git operations.

Permission for one operation never implies permission for another.

### 10. Most important rule

Protect both developers' work. Always synchronize safely before new work. Never discard another developer's changes, automatically commit, push, merge or deploy. When uncertain, STOP and ask. Development stays local until the user explicitly authorizes the next Git operation.

Two developers work on this repository. These rules apply to every agent session and task (Codex, Claude or any other), and they take precedence over anything above that conflicts with them, including the earlier "Publishing is authorized" paragraph: that paragraph describes where the project is hosted, not permission to push or publish without being asked.

Deployment fact: `.github/workflows/pages.yml` publishes the live game at https://n4styn8.github.io/VOIDFORGE/ on every push to `main` (and on manual `workflow_dispatch`). Pull requests only build and test. Treat `main` as a protected, auto-deploying branch.

Outposts (user brief, all eight phases built): block types, costs and per-level scaling are STRUCTURES, STRUCTURE_LEVELS, STRUCTURE_ABILITIES, STRUCTURE_SPECIAL, DRONES and OUTPOST in src/data.ts; grid and stat helpers are in src/outposts.ts; rules live in the model. Keep these invariants: blocks sit on the world-aligned grid; minerals only move (ship cargo, outpost storage, drones, pickups) and are never created or deleted; drones and away-mining take ore from real asteroids through mineMaterial; repairs and upgrades always cost minerals; distant outposts are not simulated, they bank time and settle on return; outposts are an optional saved field.

HUD, navigation and fleet (user request): radar and compass drawing and bearing maths are in src/nav.ts and render into DOM canvases, not Phaser objects. Player map markers are GameModel.waypoints (WAYPOINTS in src/data.ts). Extra ships are GameModel.hangar with FLEET in src/data.ts; only one ship flies, switching happens at an active station and must unload carried cargo to storage first so minerals are never lost. shipName, hangar and waypoints are optional saved fields.

Save storage: saves go to IndexedDB and, when they fit, localStorage (src/persistence.ts). loadSavedGame is asynchronous and picks the newest valid copy; saveText is the only serializer for saves and exports. When staging browser checks, back up and restore both stores: after restoring the localStorage text set voidforge.save.at to the current time, click Load, then Save.

## Ultimate five-tier progression — 2026-11-13
- Latest authorized balance supersedes earlier literal cargo/tractor/weapon values above: src/data.ts is authoritative. All 17 equipment types have five tiers; L5 cargo adds 600, tractor pulls at 150/225/300/400/600. Base weapon throughput grows about 3–5×; paid L5 abilities supply larger tactical spikes.
- Keep per-item paid-shot counters, shared armor/shield/cooler/Warp recovery, enemy EMP recovery and fractional fabricator iron debt persistent. Never refresh EMP stuns during recovery or stack plate reductions/phase windows into permanent immunity. Ultimate names and costs live in abilityConfig.ts; operation costs must be paid before advancing shot counters.

## Economy rebalance — 2026-11-13
- ECONOMY in src/economy.ts owns ship prices, destination-tier mineral additions, core milestones, structure multipliers and drone income. Existing enemy rewards/discounts remain centralized in data.ts; renewal intervals remain in populationConfig.ts. Purchases/L2 use common minerals; L3 adds crystal/ice; L4–5 add radioactive. Core upgrades are separate milestones, not discounted module prices.
- ShipModule.invested records actual new purchase/upgrade spending. Missing ledgers use legacyInvestment; never refund old equipment at new prices or reset its level/resources. New WorldSpec.economyVersion=2 enables weighted fields/area yields; missing version retains legacy generation. Preserve seeded RNG call counts and saved geometry/depletion.

## Shared space (MMO) — 2026-11-13
- Each world is one sector on a grid (`src/sectorGrid.ts`, `src/sectors.ts`); keep a sector identical to the single-player world. Travel, lobby worlds and rebuilds move only pilot fields (`PILOT_KEYS`); sector records, `galaxy`, `rebuildDue` and `links` are optional save fields.
- Multiplayer goes through the relay in `server/` (no npm dependencies; protocol in `src/netProtocol.ts`). The relay never simulates. Single-player must keep working with no relay. Per the user's latest request the game is always online during play: it connects (and reconnects with backoff) when play starts unless the player ticked Play offline, and never while only the main menu is showing. Multiplayer UI is the Multiplayer panel (P, or its command-bar button), not the Systems menu.
- Shared-sector rules: one elected authority per sector runs enemies; followers send hits; rock changes need a relay claim (all ore removal goes through `GameModel.take`); pickups are personal; kill salvage and PvP cargo move once and return to the wreck if undelivered. Allies (lobby members) never damage each other; nothing hurts a ship inside a station ring.
- Deploying or restarting the relay on the Pi (`voidforge.2dq.us`) is a deployment: it needs explicit approval, and both developers have Pi access, so coordinate.
- Shared-sector sync: a follower adopts the authority's sector copy once per visit (`adoptWorld`; pickups and loose parts stay personal), and every pilot shares its own outposts live with the sector (`SharedLink.shareOutposts`, OUTPOST_SHARE), shown to others as display-only `visitorOutposts`, follows its clock and renews ore itself. Frame traffic goes in one `fx` cast (own shots, bumps, rock changes, and from the authority its enemies with velocities, enemy fire and clock) at SHARE_RATES.fx; fresh shots and hits may flush early only while NetClient's own send budget (BUDGET) has room, so a pilot stays under NET.maxRate. NetClient never sends a frame over NET.maxMessage. Followers dead-reckon mirrored enemies and fast-forward enemy fire by its age plus the one-way delay; measure changes with scripts/latencyBench.ts. Remote shots are visual only; `fx.l` carries each pilot's look (shield charge, mining/tractor beams as offsets from the ship), drawn from the receiver's interpolated pose. A destroyed pilot is never elected authority. Multiplayer (in a lobby or sharing a sector) cannot be paused: Esc and window blur do not pause, the Outfitter/Settings keep the ship simulating with hands off, and a timer keeps simulating and sending when animation frames stall (hidden tab). Guns and mouse mining fire only for presses that started on the game canvas. Lobby resource sharing is opt-in per player (`voidforge.shareDeposits`): `src/lobbyShare.ts` announces shared station deposits over lobby-wide `party` messages and fulfils borrow requests by moving minerals owner → borrower deposits (refunded if undeliverable, late arrivals kept); spending actions call `lobbyCover` on a mineral shortfall and retry once the minerals arrive. Ship cargo is never shared. New message kinds need the relay redeployed before the site that uses them.

## Animated main menu
- Startup now opens MainMenu; the single gameplay scene stays hidden and simulation/autosave are suspended until an explicit launch. Never save the placeholder model on unload/visibility changes while at the menu.
- Continue uses loadSavedGame for a cold start; after returning, it resumes the current in-memory session. New Game always confirms, awaits existing backup and uses the normal GameModel seed path. Preserve invested modules, IndexedDB/localStorage fallback, settings and source-world backups.
- MenuBackdrop is presentation-only, reuses cached procedural station/enemy/asteroid art, runs at 30fps while shown, suspends in hidden tabs and renders statically under prefers-reduced-motion. Stop its RAF on gameplay entry; never create another Phaser.Game to return to the menu.

Menu artwork exception authorized by the user's repeated request to match the supplied illustrated reference: use the local optimized src/assets/menu-forge-v2.webp for the main menu only. Do not substitute flat primitive portraits for this scene. Gameplay retains its existing procedural art. Keep labels/buttons in HTML and motion as bounded independent layers; no image API or external image host at runtime.
When integrating menu and networking, preserve both lifecycles: no automatic relay connection from merely opening the menu, and no implicit disk save when the player selects Return without saving. The live menu now links to implemented lobby controls, not a Coming Soon mockup.

## Industrial audio upgrade
- Reuse the single GameAudio context/settings and SOUND_PROFILES. Layered cues reserve their whole source count before allocation; low/medium/critical admission budgets are 10/16/24 one-shots, with deposit precedence and lower-priority preemption. Keep loop nodes separate/bounded and disconnect all private nodes on end.
- Completed UI/deposit/build/repair operations queue transient GameModel.actionSounds, drained once even while outfitter simulation is paused. Do not put those exclusively in reset-every-update visual effects. Do not serialize action sounds. EffectEvent.amount carries mineral quantity independently of particle count.
- Deposit cues must follow actual successful transfers (including outpost partial deposits and fleet auto-unload), never proximity/empty cargo. Preserve resource accounting. Pickup aggregation and warning hysteresis/cooldowns prevent spam; keep mining noise as a persistent loop, not per-frame one-shots.
