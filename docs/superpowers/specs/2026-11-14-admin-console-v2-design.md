# Admin console v2 — real game art, roster, bulk actions, activity (2026-11-14)

## Intent

The admin console (`/admin`, design `2026-11-13-relay-admin-design.md`) works, but the sector view is coloured
dots, and pilot management is one long table. That stopped scaling once a 100-pilot swarm ran on the live
relay. The user asked for three things:

- a map that looks like the real game
- a better UI overall
- easier pilot management

For pilot management they chose all four options offered: find pilots fast, act on many at once, see one pilot
in depth, and watch activity.

## Decisions the user made

- **Map art:** reuse the game's own art on the existing Canvas 2D map. Do not embed Phaser.
- **Management:** all four of search/filter/sort, bulk actions, a pilot detail drawer, and an activity
  feed with alerts.

## Goals

- **The sector view looks like the game.**
  - The game's parallax backdrop (`paintBackdrop`), asteroid sprites with their real outlines and dents
    (`paintAsteroid`), stations lit or dark (`paintStation`), enemy sprites per kind (`paintEnemy`), and
    outposts (`paintOutpost`).
  - Ships drawn from the real module art (`drawModule` in `src/visuals.ts`) with paint colours (`paintHull`).
  - Effects in the game's style, drawn with Canvas 2D: shots, beams (mining green, tractor magenta), shields,
    thrust flames and explosions-on-death.
  - Nearest-neighbour scaling and one texel per world unit, like the game.
  - The universe overview (zoomed out) stays schematic, but restyled in the game palette.
- **Find pilots fast.**
  - Roster search over name, IP, id and lobby code.
  - Filter chips: online status (alive, dead), solo, in a lobby, sharing a sector, authority, simulated bots
    (name prefix `Sim `), a sector, a lobby.
  - Sort by any column. The filter state is remembered in `localStorage`.
  - The roster stays usable at 300 pilots: virtualised or windowed rows, and no full DOM rebuild every second.
- **Act on many at once.**
  - Checkbox selection, shift-click ranges, and "select all matching filter".
  - A bulk bar with message, kick, ban, teleport (to a point or a pilot), evict and rename-prefix.
  - Destructive bulk actions confirm with the count.
  - New relay request `bulk`: one admin message carries up to 500 pilot ids and one action, so it doesn't hit
    the admin's 20 messages/s limit. One audit entry summarises it, and a per-pilot result count comes back.
- **See one pilot in depth.**
  - Opening a pilot shows a drawer with a live mini-map of their sector, centred on them and drawn with the
    real art.
  - Ship preview (the block layout drawn with module art), hull and dead state, sector and lobby, ping and
    rate, connected time, IP.
  - Their recent activity events and the admin actions taken on them.
  - The existing inspector (cargo, storage, stations, outposts) as a tab.
  - One-click actions.
- **Watch activity.**
  - The relay emits events: joined, left, renamed, sector change, died, respawned, lobby
    create/join/leave/disband, authority change, kicked/banned, admin action.
  - A live feed with filters, plus clicking an event to select or follow that pilot.
  - Alerts, highlighted and counted in the top bar:
    - message flooding (token-bucket drops)
    - repeated deaths (5 in 2 minutes)
    - a banned address retrying
    - a burst of joins from one IP (more than 5 in a minute)
  - The relay keeps the last 500 events in memory and sends recent ones when an admin connects.
- **Overall UI.**
  - A three-zone layout: a resizable map, a side panel with tabs (Roster, Lobbies, Activity, Bans, Log), and
    the drawer.
  - A top bar with live counts, alerts and broadcast.
  - Keyboard shortcuts: `/` search, `Esc` close or cancel, `F` follow selected, `I` inspect, `Del` kick
    selected (with confirm).
  - Consistent toasts.
  - Works from 1024 px wide upward. The narrow stacked layout stays.

## Non-goals

- Embedding Phaser or the game scene.
- Accounts or roles. It stays one admin password.
- Showing enemy kills. The relay can't see them, since enemy deaths happen inside each game.
- Changing game rules.

## Constraints

- No new dependencies. The relay stays Node 16-compatible (bundled), and the admin page is built by Vite.
- The one game-code change allowed is `src/visuals.ts`: make the Phaser import type-only so `drawModule` can
  be used without the engine. It must stay behaviour-neutral for the game.
- The relay stays bounded:
  - events are a fixed ring
  - alert counters are pruned
  - `bulk` is capped at 500 ids, and its client commands go out with the existing per-client send path
- All the earlier admin invariants hold (see AGENTS.md "Relay admin console").

## Approaches considered

1. **Reuse the game's art on the Canvas 2D map (chosen).** Light, no dependencies, and it follows art changes
   automatically.
2. **Embed the Phaser renderer.** Pixel-identical, but the game scene is tied to single-ship play, it adds
   about 1 MB, and it couples the admin to every scene change. Rejected by the user.

## Design notes

- **Art.** `src/admin/art.ts` caches baked canvases:
  - backdrop layers per sector seed
  - enemies per kind
  - stations on and off
  - module icons per kind and level, drawn through a small Canvas adapter that implements the subset of
    Phaser `Graphics` that `drawModule` uses (fillStyle, lineStyle, lineBetween, fillCircle, strokeCircle,
    fillTriangle, fillPoints, strokePoints, fillRect, fillRoundedRect, save, restore, translateCanvas,
    rotateCanvas) and then `crispModule`
  - ship images per block-layout hash and paint
  - asteroid sprites per rock id and geometry revision

  Caches are LRU-bounded.

- **Rocks.** Asteroid sprites need geometry (`ensureAsteroidGeometry`). Use the generated rock, apply live
  rock changes (including dents, which arrive as `geometry` in rock updates), and re-bake when that rock's
  geometry changes.
- **Outposts.** These are drawn only when the observer sees them in traffic (`fx.o`/`fx.O` outpost parts, as
  shared by `sharedLink`). Otherwise they are omitted.
- **Ship paint.** It comes from the `paint` field of ship state, through `paintHull`.
- **Activity events.** They are produced in `server/relay.ts` where those changes already happen, held in a
  ring in `server/admin.ts`, and sent to admin sockets as `{t:'events', entries}`. On connect the last 200
  are sent.
- **Alerts** are flags on events (`alert: true`) and are counted in the overview.
- **Bulk.** `{t:'bulk', ref, ids, action, …params}`, where `action` is one of message, kick, ban, evict-pilot,
  teleport or rename-prefix. The relay validates it, loops over the existing hooks, writes one audit entry and
  returns `{t:'result', ref, ok, message:'Done for N of M'}`.
- **Roster performance.** The table body is rendered windowed (only visible rows plus a buffer) and updated by
  key, so 300 rows cost no more than about 40.

## Testing

- Relay: event emission for each kind, alert thresholds, the event ring bound, bulk validation (the cap,
  unknown action), bulk kick/message results and the audit summary.
- Admin page:
  - roster filter/sort logic as pure functions with node tests
  - the Graphics adapter draws `drawModule` without throwing for every kind and level
  - an art-cache bounds test
- Browser check against a local relay with a 20–50 bot swarm:
  - search and filters
  - select all bots, bulk message and bulk kick
  - the drawer mini-map
  - the activity feed showing joins and deaths
  - a sector view with real asteroid, station, enemy and ship art
- `npm test` and `npm run build`.

## Calls made after the builder check (the designer's, open to correction)

- **Drawer mini-map and the 3-watch cap.** No relay limit changes. The open drawer's sector takes the first
  watch slot, then the followed pilot's, then the sectors in view. Until its traffic arrives, the mini-map
  draws the static seed-generated sector.
- **Bulk results.**
  - `bulk` replies once every per-pilot outcome is known: an ack, a 5 s timeout, or an immediate relay-side
    result.
  - The reply text breaks it down, for example `Kick: 48 done, 2 not online`, or
    `Teleport: 30 done, 18 no response, 2 refused`.
  - Swarm bots answering `ok:false` count as "refused", which is correct, since bots don't run admin
    commands.
- **Rename-prefix is dropped from bulk.** It is speculative, and single rename stays.
- **Bulk ban** de-duplicates addresses, skips loopback ones, and reports
  `Banned N addresses (M pilots), skipped K local`. Bulk kick follows the single-kick rule: a 2-minute block,
  never for loopback addresses.
- **Alerts** live on the page. The top-bar count is alerts since this admin page opened that haven't been
  dismissed. Dismissing is per admin, and the relay keeps no alert state beyond the event flag.
- **Ship preview.** The relay keeps each pilot's last `blocks` (already validated, at most 400). A new
  admin request `pilot {id}` returns them with the pilot's details, for the drawer. They are not added to the
  1 Hz overview.

## Left to the builder

- Exact visual styling and spacing, and toast placement.
- The windowing implementation details.
- The death explosion effect's look, as long as it stays simple and bounded.
- Whether module-art ships are drawn at all zoom levels or switch to icons below a size.
