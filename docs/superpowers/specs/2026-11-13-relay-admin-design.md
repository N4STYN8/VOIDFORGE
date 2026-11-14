# Relay admin console — design (2026-11-13)

## Intent

The user wants a "god mode" admin console for the VOIDFORGE multiplayer relay, hosted on the Raspberry Pi
next to the relay. In their words: "an admin that is hosted on the pi side that can manage the lobbys users
and also has a full on super interactive map that sees the entire universe it can spy on all users and
watch what they are doing". In the conversation they also asked for map control: acting on pilots and
sectors from the map, teleporting pilots, spawning or clearing enemies, locking and evicting sectors, and
controlling resources and bases.

## Decisions the user made

- **Access:** public URL with a password, at `https://voidforge.2dq.us/admin`, through the existing nginx
  in front of the relay. They did not choose the SSH-tunnel-only option.
- **Actions:** kick, broadcast, lobby control (disband, remove member, open/private), rename, bans, map
  control.
- **Map control:** act from the map (context menus, follow), teleport pilots, spawn or clear enemies,
  sector controls (lock, evict), and control of resources and bases.
- **Bases:** view a pilot's bases, edit storage and cargo, unlock or lock stations, repair, upgrade or
  destroy outposts.
- **Privacy:** no notice to players. The game client shows nothing about admins.
- **Map detail:** real asteroid fields generated from the sector seed (the admin page reuses the game's
  world generator and sprites), plus live ships, enemies and shots.
- **Staging:** everything at once, both the relay side and the in-game command handling, accepting merge
  friction with open PR N4STYN8/VOIDFORGE#9 (latency; touches `src/net.ts`, `src/sharedLink.ts`,
  `src/shared.ts`, `src/model.ts`, `src/main.ts`).

### Follow-up decisions, after the review

- **Lock means bounce and evict.**
  - Locking a sector sends an evict to every pilot in it except the owner.
  - The relay keeps a set of locked seeds. A `sector` join to a locked seed from anyone except its owner
    (`owner: true`) is not added to the room. Instead the relay sends that pilot an `evict` admin command,
    and its client shows `[Admin] This sector is locked` and goes home.
  - Locks live in memory only and are cleared when the relay restarts.
- **Lobbies:** evicting or teleporting a guest out of the host's sector also removes them from their lobby
  on the relay side (`left-lobby` with an admin reason), so the lobby code does not snap them back.
  Teleporting a lobby host moves only the host. Guests then follow through the existing lobby-world flow.
- **Rename sticks.** Rename is a client command that changes the pilot's saved name and reconnect name.
  The relay also updates `c.name` at once so the change shows straight away.
- **Own-grid teleports stick.**
  - A teleport to a cell of the pilot's own grid is a real move. A new exported
    `moveToSector(model, x, y, at)` in `src/sectors.ts` uses the same stash and arrive path as `travel`, and
    `goHome` is `moveToSector(model, 0, 0, home station)`.
  - A teleport into another player's sector is a visit through `enterWorld`, like joining a lobby, and the
    pilot is sent home on reload.
  - The admin page offers both: "move to cell (x,y) of their grid" and "send to pilot/sector".

## Goals

- Log in from any browser with a password. Everything else under `/admin` refuses without a valid session.
- Live tables of online pilots and lobbies:
  - **Pilot:** id, name, IP, sector or room, lobby, authority, last position and heading, dead or alive,
    progression (home and power), connected since, message rate, ping.
  - **Lobby:** code, host, members, open or private.
- Admin actions, all written to an audit log:
  - **Relay only:** kick, ban and unban (IP, with expiry), rename, disband a lobby, remove a member,
    open/private, lock or unlock a sector.
  - **Executed by the pilot's client:** broadcast notice, teleport, spawn enemies, clear enemies, evict a
    sector, inspect a pilot (cargo, storage, bases, outposts), edit cargo or storage, unlock or lock
    stations, repair, upgrade or destroy outpost blocks or a whole outpost.
- An interactive universe map:
  - **Universe view:** every home's sector grid as a cluster. Active sectors are lit, with pilot counts and
    dots. Links between grids are drawn.
  - **Sector view:** zoom into a sector to see the generated asteroid field plus live changes, ships drawn
    with their block layouts and headings, enemies, and shots.
  - **Controls:** pan with drag, zoom with the wheel, click a pilot to follow them across sectors, and
    right-click pilots, sectors and lobbies for actions.
- Bounded load on the Pi.

## Non-goals and anti-goals

- No player-facing notice, and no other change to the player UI, apart from showing admin broadcasts as an
  in-game note.
- No accounts and no multiple admin roles: one shared admin password.
- The relay still never simulates. Every game-state change is carried out by the affected pilot's own
  client, or for enemies by the sector authority's client.
- **Anti-goal:** the admin endpoint must never be reachable without auth, must never widen the player
  socket's origin rules, and must never leak player data on the public `GET /` or `/stats`.
- **Anti-goal:** the admin must never be able to crash or stall the relay, for example by watching too much.
- No commits, pushes, PRs or deploys as part of this work. Changes stay local for review.

## Constraints

- Dependency-free like the relay: Node built-ins only on the server. The admin page is built by the
  project's existing Vite and TypeScript, with no new packages.
- The relay is bundled for Node 16 on the Pi (`npm run relay-bundle`, esbuild target node16). Avoid newer
  Node APIs in `server/`.
- The game's mineral invariant ("never created or deleted") gets one explicit, logged exception: admin
  edits to cargo or storage.
- **Old clients:** a client without the new handler drops unknown server messages (`parseServer` returns
  undefined). So client-executed commands silently do nothing there. The console must show "no response"
  rather than claim success. No `NET.version` bump is needed.
- Going live needs two separate deployments: the relay on the Pi and the site (GitHub Pages). Each needs
  the user's explicit approval and coordination with the other developer.

## Approaches considered

1. **Two stages:** relay-only console first, in-game commands after PR #9 merges. This avoids conflicts.
   **Not chosen.**
2. **Everything at once (chosen):** one change covers the relay console and the client command handler.
   Keep client edits to a new file plus small, append-only hooks in `net.ts`, `main.ts` and
   `netProtocol.ts` so that merging with PR #9 stays manageable.
3. **Relay-only forever:** drops teleport, enemies and resources. Rejected because it goes against the
   request.

Also considered, for access: SSH-tunnel-only (rejected by the user in favour of a public URL). For map
detail: a no-build HTML page with markers only (rejected in favour of real rocks).

## Design

### Server layout

- **`server/admin.ts`:**
  - **Auth:** `ADMIN_PASSWORD`. When it is unset, the admin is disabled and every `/admin*` path returns 404.
  - **Sessions:** in memory, 32 random bytes, 12-hour expiry, cleared on restart.
  - **Login rate limit:** per IP, 5 failures then a 15-minute lockout.
  - Also holds the static file server, the admin socket handling and the audit log.
- **`server/bans.ts`:** ban list stored as a JSON file at `BANS_FILE` (default `./bans.json`; on the Pi
  `/var/lib/voidforge/bans.json`). Each entry: `{ip, until, reason, name, at}`. Expired entries are pruned.
- **`server/relay.ts`:** routes `/admin*` HTTP requests and `/admin/ws` upgrades to the admin module.
  - Exposes internal read and act hooks to that module, without moving relay state.
  - Checks bans on player upgrade, refusing with 403.
  - Adds observer taps to `state`/`cast`/`room`/`gone` handling.
  - Measures ping from the keep-alive ping/pong round trip (`WebSocketPeer` records when it sent the ping
    and when the pong arrived).
  - Tracks a per-client message rate over a short window.
- **`server/main.ts`:** reads the new env vars `ADMIN_PASSWORD`, `ADMIN_DIR`, `BANS_FILE` and
  `TRUST_PROXY`.

### Auth details

- **Password check:** compare SHA-256 digests of the supplied and expected password with
  `crypto.timingSafeEqual`, so the comparison is constant-time and the length does not leak.
- **Login:** `POST /admin/login` with a form body sets the cookie
  `vf_admin=<token>; HttpOnly; SameSite=Strict; Path=/admin`. Add `Secure` when the request is HTTPS
  (TLS on the relay, or `X-Forwarded-Proto: https` from a trusted proxy). `POST /admin/logout` clears it.
- **Login page:** a small inline HTML form served without auth. Every other `/admin/*` path (page, assets,
  socket) needs the session.
- **Headers on admin responses:**
  - `Cache-Control: no-store`
  - `X-Frame-Options: DENY`
  - `Content-Security-Policy: default-src 'self'; img-src 'self' data: blob:; connect-src 'self'` plus
    `wss:`/`ws:` to the same host
  - `Referrer-Policy: no-referrer`
  - No CORS header.
- **Admin socket `/admin/ws`:**
  - Needs a valid session cookie.
  - `Origin` must equal the request's own origin (built from `Host` and the protocol). This is separate
    from the player `ORIGINS` list.
  - At most 4 admin sockets.
  - Incoming admin messages are limited to 20/s.
  - Admin sockets are not player clients: never in `clients`, rooms or lobbies.
- **Client IP:** taken from the socket address. When `TRUST_PROXY=1` and the socket peer is loopback, use
  the last `X-Forwarded-For` entry. The Pi sets `TRUST_PROXY=1` because nginx proxies from 127.0.0.1.
  Used for bans, login lockout and display.

### Admin protocol (`src/adminProtocol.ts`, shared by server, admin page and tests; no Node or DOM imports)

**Admin to server** (validated by `parseAdmin`):

- `watch {rooms: string[]}`: up to 3 sector seeds to tap. Replaces the previous set.
- `kick {id, reason?}`
- `ban {id? , ip?, minutes, reason?}` (also kicks matching clients)
- `unban {ip}`
- `rename {id, name}`
- `disband {code}`
- `remove {code, id}`
- `lobby-open {code, open}`
- `lock {seed, locked}`
- `broadcast {to: {all:true} | {lobby} | {pilot} | {room}, text}`
- `teleport {id, x, y, world?, cell?}`:
  - `world` (a `WorldRef`) visits another pilot's sector.
  - `cell: [gx, gy]` moves the pilot within their own grid, and the move persists.
  - Neither means a point in their current sector.
- `spawn {seed, kind, count, x, y}`, routed to the room authority.
- `clear {seed}`, routed to the room authority.
- `evict {seed}`
- `inspect {id}`
- `cargo {id, target: 'cargo'|'stored'|{outpost:number}, delta: Partial<Record<Resource, number>>}`
- `station {id, index, unlocked}`
- `structure {id, outpost, structure?, op: 'repair'|'upgrade'|'destroy'}`. No `structure` means the whole
  outpost.

**Server to admin:**

- `overview`, at 1 Hz to each admin socket: `pilots`, `lobbies`, `rooms` (seed, world, authority id,
  members, locked), `bans`, relay `stats`.
- `obs {r: seed, m}`: a tapped room message. `m` is the same shape players get (`state` unfiltered by
  interest, `cast`, `room`, `gone`).
- `report {id, ref, data}`: a pilot's inspection reply.
- `result {ref, ok, message}`: the outcome of an action. Client-executed actions get `ok` once the client
  acknowledges, or `no response` after 5 s.
- `log {entries}`: the audit log, last 200 entries, also printed to stdout (journald on the Pi).

### Relay to game client

- New `ServerMessage`: `{t:'admin', ref, c: AdminCommand}`, where `AdminCommand` is the client-executed
  subset above, minus routing fields.
- New `ClientMessage`: `{t:'admin-ack', ref, ok, message?, data?}`.
  - The relay accepts an ack only for a `ref` it has outstanding for that client. Anything else is
    dropped.
  - The ack goes through the normal token bucket and stays under `NET.maxMessage`. The inspection summary
    is trimmed to fit (outposts as counts plus per-block id, kind, level and health; storage totals).
- Clients trust `admin` messages because only the relay can send server messages. A relay override is
  already restricted to localhost in the game.

### Client changes

- **`src/adminControl.ts` (new, pure, no DOM):**
  `applyAdminCommand(model, cmd, ctx) -> { model?: GameModel; ok: boolean; message?: string; data?: unknown }`.
  - **Notice:** sets `model.message` to `[Admin] text`.
  - **Teleport:**
    - Same sector: set the player position and zero the velocity.
    - Other sector: `enterWorld(model, world, {x, y})`, the same path a lobby guest uses. Returning later
      uses the existing `returnHome`.
  - **Spawn:** authority only. Spawns `count` enemies of an `ENEMIES` kind near the point through the
    model's spawn path, flagged `populationExempt` so the population ledger is not disturbed. The normal
    enemy cast then shows them to everyone.
  - **Clear:** authority only. Removes non-boss enemies, or all enemies (builder's choice, reported back).
  - **Evict:**
    - If `galaxy.away`, use `returnHome`.
    - Else, if the current sector is not the pilot's own home sector, go home to (0,0) through a new
      exported `goHome(model)` in `src/sectors.ts`. That file is not touched by PR #9.
    - The owner of the sector stays.
  - **Inspect:** returns a summary. Fields: ship name, core level, hull, cargo, stored, bases (index, name,
    unlocked, position), outposts (id, name, cell, stored, blocks), galaxy position, kills and deaths.
  - **Cargo:** applies the delta, clamping each mineral at zero. Overflow is allowed, matching the
    never-delete-overflow cargo rule. Logs `[Admin] adjusted your …`.
  - **Station:** sets `bases[index].unlocked`. Base 0 can never be locked, so the pilot always has a home
    station.
  - **Structure:** repair sets health to max; upgrade adds +1 level up to the cap; destroy removes the
    block or the whole outpost. All bypass costs, which is the admin exception, and all keep outpost
    `revision` bumped so sprites redraw.
- **`src/net.ts`:** add an `onAdmin` hook, a `case 'admin'` line in `receive`, and an `adminAck(...)`
  sender. These are appends only.
- **`src/main.ts`:** wire `net.onAdmin` to `applyAdminCommand`. Use `switchModel` when it returns a new
  model, save as other world switches do, and send the ack.
- **`src/netProtocol.ts`:** the two message types, plus validators in `parseServer` and `parseClient`.

### Observer fan-out (bounded)

- Each room keeps a set of watching admin sockets. On `state`, the relay sends the observer copy
  regardless of interest distance. On `cast`, `room` and `gone`, it forwards verbatim.
- Observer traffic is replaceable. It is skipped when the admin socket backlog is over `NET.backlog`.
- Each watched room is capped at about 96 KB/s of cast payload. Over that, casts are dropped for that
  second and counted.
- At most 3 watched rooms per admin socket and at most 4 admin sockets. With no admins, the taps cost one
  empty-set check per message.

### Admin page

- A second Vite entry, `admin/index.html` with `src/admin/*.ts`, built by `vite.admin.config.ts` into
  `dist-admin/`. New script `admin-build`. The relay serves `ADMIN_DIR`, defaulting to `dist-admin` beside
  the working directory.
- **Rendering:** Canvas 2D, not Phaser. Reuse the cached procedural sprites for ships and enemies where
  practical (`src/sprites.ts`, `src/shipImage.ts`). Rocks come from `createWorld(seed)` plus
  `generateChunk` for visible chunks only, cached per seed, with live `fx.r` rock changes overlaid.
- **Universe view:**
  - Clusters, one per home seed seen in `overview`, laid out on a spiral in first-seen order (stable while
    the page is open).
  - Each cluster draws the known grid cells around its active sectors. Sectors in a room are lit, with
    pilot dots.
  - A link is drawn where a room's `WorldRef.home` differs from the grid it sits in.
- **Sector view:**
  - Zooming past a threshold, or following a pilot, switches the camera into world units for that sector
    and sends `watch` for it.
  - Ships are interpolated like the game does, about 150 ms behind.
- **Follow:** click a pilot, in a table or on the map, to follow them. When they change sector, the page
  re-watches.
- **Context menus:**
  - **Pilot:** follow, inspect, message, rename, teleport (click a destination: a point in this sector, or
    another pilot), kick, ban.
  - **Sector:** watch, lock or unlock, evict, spawn (choose kind and count, click a point), clear enemies,
    message room.
  - **Lobby:** message, disband, toggle open, remove a member.
- **Panels:** pilots table (sortable), lobbies table, bans, audit log, and an inspector drawer (bases,
  outposts, cargo and storage editors with +/- fields, station toggles, block actions).
- **Destructive actions** (ban, disband, destroy, evict, clear) ask for confirmation in the page.

### Docs and tests

- **Tests:**
  - `tests/admin.test.ts`:
    - Auth: constant-time compare helper, lockout, session expiry, cookie parsing.
    - Unauthenticated `/admin/` and `/admin/ws` are refused.
    - A wrong-origin admin socket is refused.
    - The admin is disabled with no password.
  - Admin protocol validation.
  - Relay integration:
    - `overview` contents.
    - Kick, ban (blocks reconnect, expiry), rename, disband, lock.
    - Observer receives an unfiltered room `state` and `cast`; the watch cap holds.
    - An admin command reaches a client, the ack becomes a `result`, and an unanswered command becomes
      "no response".
  - `tests/adminControl.test.ts` on a headless `GameModel` for every client command.
- **Docs:** ARCHITECTURE.md, PROGRESS.md, TASKS.md, and server/README.md covering:
  - Env vars.
  - Pi setup: systemd `Environment=ADMIN_PASSWORD=…` in a root-only drop-in, `TRUST_PROXY=1`,
    `BANS_FILE` directory owned by `voidforge`, and copying `dist-admin/` to `/opt/voidforge/admin`.
  - nginx needs `X-Forwarded-For` / `X-Forwarded-Proto` headers set.
  - A security note that a public admin login exists.

## Left to the builder

- Exact visual styling of the admin page (dark, readable, in the game's palette).
- Whether `clear` removes bosses too (report which).
- Whether to request the authority's exact sector copy (`world-req`) for the observer instead of generated
  rocks plus live changes. Optional, only if cheap and bounded.
- How rocks that `beltMotion` moves are posed in the sector view. Use the same analytical poses if simple.
- After PR #9 merges, enemies also ride inside `fx` (`n`/`f`/`x`). The admin page should decode both the
  `enemies` cast and `fx` enemy fields if present, or note it as a follow-up.
