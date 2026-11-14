# Dynamic music audit

## Assets
All 12 original MP3s were copied byte-for-byte from E:/AI Projects/VOIDFORGE/src/Background Music into this worktree. No songs renamed, deleted or generated. SHA-256 comparison passed for every file. No requested tracks are missing.

- `Deep Space Mining — Main Gameplay Music 1.mp3`
- `Deep Space Mining — Main Gameplay Music 2.mp3`
- `Forge-01 — Station and Shipbuilding Theme 1.mp3`
- `Forge-01 — Station and Shipbuilding Theme 2.mp3`
- `Hostile Sector — Combat Music 1.mp3`
- `No Mercy in the Void — PvP Combat Theme 1.mp3`
- `No Mercy in the Void — PvP Combat Theme 2.mp3`
- `The Last Forge — Main Menu Theme.mp3`
- `The Shattered Expanse — Exploration Theme 1.mp3`
- `The Shattered Expanse — Exploration Theme 2.mp3`
- `The Shattering — Boss Battle Theme 1.mp3`
- `The Shattering — Boss Battle Theme 2.mp3`

## Behavior
- Central priority: menu > active boss > confirmed PvP > active/recent PvE > station/outfitter > sustained mining > exploration.
- Mining starts after 5 seconds of sustained mining; retained for 15 seconds without mining. PvE cooldown 12 seconds; PvP 15 seconds, refreshed by real interactions.
- Normal transitions 6 seconds, same-category rotation 8 seconds, menu transitions 4 seconds, entering PvE 1.5 seconds, entering PvP/boss 1 second. Equal-power Web Audio gain curves overlap streamed HTML audio, starting the fade only after the incoming track plays. Track rotation begins 8 seconds before the end, including two overlapping instances for the single combat/menu tracks.
- Shuffle bags avoid immediate repeats; with exactly two tracks this necessarily alternates. Short returns reuse still-playing tracks or resume a bookmark for 30 seconds instead of restarting.
- At most three streaming elements during interrupted fades. Quiet outgoing voices are retired smoothly before another is admitted. Disposal pauses media, clears sources/handlers and disconnects nodes. Missing/failed assets are skipped with bounded retries; the old Deep Space Patrol is only a fallback through the same controller.
- Uses the existing context/master/music/effects buses, music ducking, compressor and saturation. Per-voice headroom is 0.55, bounding three equal-power voices below full-scale before user gains. No MP3 decode bank, external service or library.
- Mute/music-zero/master-zero, manual pause and hidden tabs pause media and fade progression. Resume retains track position; browser unlock remains required.
- Build module still unlocks at Core 2, carried over from the previous local task. Zach's performance changes remain intact.

## Validation
- 298 automated tests and production build pass; existing Vite bundle-size warning remains.
- Real Chromium checks decoded metadata for all 12 files (122.8–254 seconds) and played every category. Verified overlapping/interrupted fades, <=3 voices, station continuity, mute/volume/pause/resume/menu cleanup, unchanged SFX operation, and actual game station/exploration integration. No browser page errors.
- Real near-end playback checks verified mining alternation and smooth single-track PvE rotation; outgoing elements cleaned up after the 8-second overlap.
- Unit tests cover state priority/delays, refreshed combat cooldowns, pause, fair rotation, equal-power envelopes, interrupted fades, failure fallback, disposal, friendly-PvP exclusion, confirmed hits, boss activation/defeat and incoming follower beams.

## Limits / next check
- A new game spawns at its station, so station music correctly takes priority immediately after the menu; exploration begins when leaving that area.
- Browser autoplay restrictions require a user interaction before music can start.
- Shared-sector follower snapshots do not include enemies' last-known targets or boss IDs on projectiles. Follower PvE reacts to actual local attacks/damage; boss music can latch on a confirmed local boss hit and mirrored active boss state. It does not guess a boss encounter from proximity. No relay/protocol change was made.
- Playback/automation checks do not replace listening on the user's speakers/headphones; final music/SFX balance remains a playtest task.
- Nothing committed, pushed or deployed in this session.
