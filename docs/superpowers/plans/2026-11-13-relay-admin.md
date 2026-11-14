# Relay Admin Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A password-protected admin console served by the VOIDFORGE relay at `/admin`, with pilot and lobby
management, a live universe map that can watch and follow pilots, and in-game admin commands.

**Architecture:** `server/admin.ts` owns auth, the static files, the admin sockets and the audit log. It
reads and acts on relay state through a narrow hooks object that `startRelay` passes in. Observer taps
forward a watched room's traffic to admin sockets, bounded. Commands that change the game travel as
`{t:'admin'}` server messages to the affected client. There, `src/adminControl.ts` applies them to the
`GameModel` and acks back. The admin page is a second Vite entry using Canvas 2D and the game's world
generator.

**Tech Stack:** Node built-ins only on the server (`node:http`, `node:crypto`, `node:fs`). TypeScript,
Vite 7, and Canvas 2D for the page. Tests use `node:test` (Node 24).

**Spec:** `docs/superpowers/specs/2026-11-13-relay-admin-design.md`

## Global Constraints

- No npm dependencies added. Server code must bundle for `--target=node16`, so no `fetch`/`WebSocket`
  globals in `server/`.
- The admin is disabled when `ADMIN_PASSWORD` is unset: every `/admin*` path returns 404.
- **Session:** 32 random bytes, hex encoded, 12-hour expiry, kept in memory.
- **Cookie:** `vf_admin=<token>; HttpOnly; SameSite=Strict; Path=/admin`, plus `Secure` on HTTPS.
- **Login lockout:** 5 failures per IP leads to a 15-minute lockout.
- **Password compare:** `timingSafeEqual(sha256(given), sha256(expected))`.
- **Admin sockets:** at most 4. Each may send at most 20 msgs/s and watch at most 3 rooms. Observer traffic
  is skipped when the admin socket backlog exceeds `NET.backlog`. Each watched room's casts are capped at
  96 KB/s.
- Overview is sent at 1 Hz. Admin results become `no response` after 5 s. The audit log keeps the last 200
  entries and also prints to stdout.
- `TRUST_PROXY=1` plus a loopback peer means the IP is the last `X-Forwarded-For` entry. `BANS_FILE`
  defaults to `./bans.json`. `ADMIN_DIR` defaults to `dist-admin`.
- Player socket rules and the public `GET /` and `/stats` responses stay unchanged and carry no player
  data.
- The `NET.version` bump is not needed. Old clients ignore `admin` messages.
- **AGENTS.md overrides the skill:** no commits, pushes or deploys. Leave every change uncommitted. The
  "Commit" steps are replaced by a `git diff --stat` review.
- Client edits stay small and append-only in `src/net.ts`, `src/main.ts` and `src/netProtocol.ts`, because
  PR #9 also edits them.

## Review Focus

1. **An expired or forged session cookie on `/admin/ws` or an asset is refused** (401/403), not served.
   Test it in Task 2.
2. **A cross-origin page holding a session tries the admin socket.** It must be refused with 403, even with
   a valid cookie. Test it in Task 2.
3. **A pilot's ack for a `ref` they never got, or a flood of `admin-ack`.** It must be dropped without
   producing a result. Test it in Task 4.
4. **A watched room empties or its pilots leave mid-watch.** The observer gets `gone`, and the room's taps
   are released with no leak or crash. Test it in Task 3.
5. **A ban expires, or the bans file is missing or corrupt at start.** The relay starts with an empty list
   and logs a warning; the expired IP reconnects. Test it in Task 2.

---

### Task 1: Admin protocol types and validators

**Files:**
- Create: `src/adminProtocol.ts`
- Modify: `src/netProtocol.ts`. Add `{t:'admin'; ref:number; c:AdminCommand}` to `ServerMessage` and
  `{t:'admin-ack'; ref:number; ok:boolean; message?:string; data?:unknown}` to `ClientMessage`, with
  validators in `parseServer` and `parseClient`. `AdminCommand` is imported from `adminProtocol.ts`.
- Test: `tests/adminProtocol.test.ts`

**Interfaces:**
- Produces:
  - `AdminRequest`, the admin-to-server union from the spec: `watch`, `kick`, `ban`, `unban`, `rename`,
    `disband`, `remove`, `lobby-open`, `lock`, `broadcast`, `teleport`, `spawn`, `clear`, `evict`,
    `inspect`, `cargo`, `station`, `structure`. Each carries `ref:number`.
  - `parseAdmin(raw: string): AdminRequest | undefined`
  - `AdminCommand`, the client-executed union:
    - `{op:'notice', text}`
    - `{op:'teleport', x, y, world?: WorldRef, cell?: [number, number]}`
    - `{op:'spawn', kind, count, x, y}`
    - `{op:'clear'}`
    - `{op:'evict', reason}`
    - `{op:'inspect'}`
    - `{op:'cargo', target:'cargo'|'stored'|{outpost:number}, delta}`
    - `{op:'station', index, unlocked}`
    - `{op:'structure', outpost, structure?, action:'repair'|'upgrade'|'destroy'}`
    - `{op:'rename', name}`
  - `readAdminCommand(v: unknown): AdminCommand | undefined`
  - `AdminServerMessage`: `overview`, `obs`, `report`, `result`, `log`.
  - Types `AdminPilot` and `AdminLobby`, with fields exactly as in the spec's Goals list.
  - `ADMIN` constants holding the Global Constraints numbers: `maxSockets:4`, `rate:20`, `maxWatch:3`,
    `castBytes:98304`, `resultTimeout:5000`, `logSize:200`, `sessionMs:43200000`, `lockFailures:5`,
    `lockMs:900000`, `maxSpawn:12`, `maxDelta:100000`.

- [ ] **Step 1: Write tests.**
  - `parseAdmin` accepts one valid example of each kind.
  - It rejects non-integer `ref`, `watch` with 4 rooms, `spawn` with `count` 13, `count` 0 and unknown
    `kind` (a kind must be a key of `ENEMIES` in `src/data.ts`), `cargo` delta with a non-resource key or
    `|n| > maxDelta`, `broadcast` text over 200 chars, and a `teleport` with both `world` and `cell`.
  - `parseServer` round-trips `{t:'admin', ref:1, c:{op:'notice', text:'hi'}}`.
  - `parseClient` round-trips an `admin-ack`, and rejects one whose `JSON.stringify(data)` exceeds 12000
    chars.
- [ ] **Step 2:** Run `node --experimental-strip-types --test tests/adminProtocol.test.ts`. Expected:
  FAIL, module not found.
- [ ] **Step 3: Implement.** Names go through `cleanName`, and text is trimmed and capped at 200.
- [ ] **Step 4:** Run the same command. Expected: PASS. Run `npm test`. Expected: all pass.

### Task 2: Auth, static serving, bans and admin socket (server)

**Files:**
- Create: `server/admin.ts`, `server/bans.ts`
- Modify:
  - `server/relay.ts`. Extend `RelayOptions` with
    `admin?: { password?: string; dir?: string; bansFile?: string; trustProxy?: boolean }`. Route
    `/admin*` requests and upgrades to the admin module. Check bans on player upgrade. Add `ip` to
    `Client`.
  - `server/main.ts` (env vars), `server/websocket.ts` (ping timing: `pingSent`, `rtt`).
- Test: `tests/admin.test.ts`

**Interfaces:**
- Consumes: `parseAdmin` and `ADMIN` from Task 1.
- Produces:
  - In `server/admin.ts`:
    - `passwordMatches(given: string, expected: string): boolean`
    - `parseCookies(header?: string): Record<string, string>`
    - `clientIp(req: IncomingMessage, trustProxy: boolean): string`
    - `createAdmin(options, hooks: RelayHooks): { handleHttp(req, res): boolean; handleUpgrade(req, socket): boolean; tick(): void; close(): void }`
  - `RelayHooks`, defined in `server/admin.ts` and implemented in `relay.ts`:
    `overview()`, `kick(id, reason)`, `rename(id, name)`, `disband(code)`, `remove(code, id)`,
    `setOpen(code, open)`, `lock(seed, locked)`, `command(id, cmd: AdminCommand): Promise<AdminAck|undefined>`,
    `authorityOf(seed): string|undefined`, `watch(socket, seeds)`, `dropIp(ip)`.
  - In `server/bans.ts`:
    `class Bans { constructor(file?: string); add(ip, minutes, reason, name); remove(ip); isBanned(ip, now?): boolean; list(); }`.
    It loads lazily, rewrites the file atomically (temp file plus rename) and prunes expired entries.
  - `WebSocketPeer.rtt?: number` (milliseconds).

- [ ] **Step 1: Write tests in `tests/admin.test.ts`.** Use raw `node:http` requests and upgrades so the
  Origin and Cookie headers can be set.
  - `passwordMatches('a','a')` is true; `('a','ab')` is false.
  - With no password, `GET /admin/` returns 404.
  - With a password:
    - `GET /admin/` with no cookie returns 302 to `/admin/login`.
    - `POST /admin/login` with a wrong password returns 401. After 5 wrong attempts, the right password
      returns 429.
    - The right password, on a fresh relay, returns 303 with a `Set-Cookie` that contains
      `HttpOnly; SameSite=Strict; Path=/admin`.
    - `GET /admin/` with that cookie returns 200, with `Cache-Control: no-store` and
      `X-Frame-Options: DENY`.
    - A forged cookie returns 302.
    - An `/admin/ws` upgrade with the cookie and `Origin: http://127.0.0.1:<port>` gets 101. With
      `Origin: https://evil.example` it gets 403. With no cookie it gets 401.
    - A fifth admin socket gets 503.
  - Session expiry: inject a clock (`createAdmin(..., { now })`) and advance it 12 hours.
  - Bans:
    - Ban an IP, then a player socket from that IP (via `X-Forwarded-For` with `trustProxy:true`) gets 403.
    - An entry that has expired (`minutes` small, clock advanced) lets the IP connect.
    - A corrupt bans file means the relay still starts with an empty list.
  - `GET /` and `/stats` contain no pilot names.
- [ ] **Step 2:** Run `node --experimental-strip-types --test tests/admin.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The login page is inline HTML.
  - Static files come from `options.dir`, with path traversal rejected (the resolved path must start
    with the directory) and the MIME type taken from the extension.
  - Security headers as in the spec.
  - The admin socket reuses `upgrade()` from `websocket.ts` with an origin check of `origin === expected`.
  - Each admin message is parsed with `parseAdmin` and dispatched to hooks.
  - Every action writes an audit entry: `{at, action, target, detail}`.
  - `tick()` runs on a 1 s interval and sends the overview.
- [ ] **Step 4:** Run the test. Expected: PASS. Run `npm test`. Expected: all pass.

### Task 3: Overview, management actions and observer fan-out (server)

**Files:**
- Modify: `server/relay.ts`, which implements `RelayHooks`, adds `watchers` to `Room`, keeps a `locked`
  set, and tracks the per-client message rate.
- Test: `tests/admin.test.ts`, in a new describe block. Add a helper `adminSocket(relay)` that logs in and
  returns an inbox the same way the `client()` helper in `tests/relay.test.ts` does.

**Interfaces:**
- Consumes: `RelayHooks` and `createAdmin` from Task 2.
- Produces: `Client` gains `ip`, `rate` (msgs/s over the last 5 s), `angle` (taken from the last `state`)
  and `since`. `Room` gains `watchers: Set<AdminSocket>` and `castBudget`.

- [ ] **Step 1: Write tests.**
  - **Overview:** two pilots in a lobby in sector `s1`. The admin `overview` lists both, with `room:'s1'`,
    `lobby` code, `authority` true for one, `at`, `name`, `ip`, `since`, and `rate >= 0`. `lobbies` has
    the code with 2 members.
  - **kick:** the pilot's socket closes with code 4001, and the audit log has the entry.
  - **rename:** the next `overview` shows the new name, and the pilot receives
    `{t:'admin', c:{op:'rename'}}`.
  - **disband:** both members get `left-lobby`, and the lobby is gone from the overview.
  - **remove:** the target gets `left-lobby`.
  - **lobby-open** flips `open`.
  - **lock:** a non-owner already in `s1` receives `{op:'evict'}`. A new non-owner `sector` join to `s1` is
    not in the room's `room` member count and receives `{op:'evict', reason:'This sector is locked.'}`. An
    owner join (`owner:true`) is admitted.
  - **watch `s1`:**
    - A pilot 20,000 units away from the other (beyond `NET.interest`) still has its `state` reach the
      admin as `obs` with `r:'s1'`.
    - A `cast` reaches the admin as `obs`.
    - When the last pilot leaves, the admin gets `obs` with `gone`, and the room is deleted (no throw).
    - `watch` with 4 rooms is rejected with `result ok:false`.
  - **Cast budget:** casts totalling more than 96 KB within one second to a watched room are delivered to
    room members but not all to the observer. The overview's stats show a `obsDropped` count above 0.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3: Implement.** The observer tap is a helper `tap(room, text, replaceable)` called from the
  `state`, `cast`, `room` and `gone` paths. It is a no-op when `room.watchers.size === 0`.
- [ ] **Step 4:** Run the tests and `npm test`. Expected: PASS.

### Task 4: Client-routed commands and acks (server)

**Files:**
- Modify: `server/relay.ts`. `command()` sends `{t:'admin', ref, c}`, keeps
  `pending: Map<ref, {client, resolve, timer}>`, and accepts an `admin-ack` only from the client that holds
  that pending `ref`. `spawn` and `clear` go to `authorityOf(seed)`. `evict` goes to every non-owner in the
  room. `broadcast` sends a `notice` to the chosen recipients (no ack expected; the result counts
  recipients). Evicting a guest, or teleporting one into another world, also runs `leaveLobby` with
  reason `Removed from the lobby by an admin.`
- Test: `tests/admin.test.ts`

**Interfaces:**
- Consumes: `AdminCommand`, plus the `admin-ack` `ClientMessage` from Task 1.
- Produces: admin `result {ref, ok, message}` and `report {id, ref, data}` (for `inspect`).

- [ ] **Step 1: Write tests.**
  - A pilot that replies with `admin-ack` `{ref, ok:true, data:{x:1}}` to an `inspect` makes the admin get
    `report` with `data.x === 1` and then `result ok:true`.
  - A pilot that never replies leads to `result ok:false, message:'no response'` after 5 s. Use a
    `resultTimeout` override of 50 ms in test options.
  - An ack with an unknown `ref` produces no `result`.
  - `spawn` for `s1` reaches only the authority.
  - `broadcast {all:true}` reaches every pilot as `{op:'notice'}`.
  - Evicting a lobby guest gives the guest `left-lobby`, and the lobby shrinks.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run the tests and `npm test`. Expected: PASS.

### Task 5: Client command handler

**Files:**
- Create: `src/adminControl.ts`
- Modify:
  - `src/sectors.ts`: add
    `moveToSector(model: GameModel, x: number, y: number, at?: Point): GameModel`, which uses the same
    stash and arrive path as `travel`, works within the pilot's own grid, and clears `galaxy.away` by
    stashing the away sector into `foreign`. Also add `goHome(model): GameModel`, which is
    `returnHome` if away, else `moveToSector(model, 0, 0, home station)`.
  - `src/net.ts`: `onAdmin: (ref: number, c: AdminCommand) => void`, a `case 'admin'`, and
    `adminAck(ref, ok, message?, data?)`.
  - `src/main.ts`: wire `onAdmin`.
- Test: `tests/adminControl.test.ts`

**Interfaces:**
- Consumes: `AdminCommand` from Task 1.
- Produces:
  `applyAdminCommand(model: GameModel, c: AdminCommand, ctx: { authority: boolean }): { model?: GameModel; ok: boolean; message?: string; data?: unknown; rename?: string }`.

- [ ] **Step 1: Write tests on `new GameModel('admin-test')`.**
  - `notice` sets `model.message` to `[Admin] hi`.
  - `teleport {x:5000, y:6000}` moves the player there with velocity 0.
  - `teleport {cell:[1,0]}` returns a model with `galaxy.x === 1`. After `toSave`/`fromSave` it is still
    `galaxy.x === 1` and `galaxy.away` is undefined.
  - `teleport {world}` returns a model with `galaxy.away.seed === world.seed`.
  - `spawn {kind:'raider', count:3}` with `authority:false` gives `ok:false`. With `authority:true` it adds
    3 enemies flagged `populationExempt`.
  - `clear` with `authority:true` leaves 0 non-boss enemies.
  - `evict` when away returns a home model. When in the own sector (0,0) it reports `ok:true` and
    "already home" with no model change.
  - `inspect` returns `cargo`, `stored`, `bases[i].unlocked` and `outposts`, with
    `JSON.stringify(data).length < 12000`.
  - `cargo {target:'cargo', delta:{iron:50}}` raises iron by 50. `{iron:-1e5}` clamps at 0.
  - `station {index:0, unlocked:false}` gives `ok:false`. `index:1` with `true` unlocks it.
  - `structure` repair, upgrade and destroy work on an outpost built through the model's own build path
    in a test fixture (see `tests/outposts.test.ts`). Destroy bumps `revision` and removes the block.
  - `rename {name:'Ace'}` returns `rename:'Ace'`.
- [ ] **Step 2:** Run `node --experimental-strip-types --test tests/adminControl.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - In `main.ts`, the handler calls `applyAdminCommand(this.model, c, {authority: this.net.room?.authority === this.net.id})`.
  - If a model comes back, it calls `switchModel` and `saveGame`, as `onLobbyWorld` does.
  - On `rename`, it stores `voidforge.pilot`, calls `net.rename`, and acks with
    `this.net.adminAck(ref, r.ok, r.message, r.data)`.
- [ ] **Step 4:** Run the tests, `npm test` and `npm run build`. Expected: PASS, with no type errors.

### Task 6: Admin page and live map

**Files:**
- Create:
  - `admin/index.html`
  - `src/admin/main.ts`: socket, state store, panels.
  - `src/admin/map.ts`: universe and sector camera, drawing, hit-testing.
  - `src/admin/sectorView.ts`: rocks per seed via `createWorld` plus `generateChunk` for visible chunks,
    LRU cache of 6 seeds, live `fx.r` overlay, enemies from the `enemies` cast and from `fx` `n` if
    present, ship interpolation.
  - `src/admin/admin.css`
  - `vite.admin.config.ts`: root `admin/`, `base:'./'`, `outDir:'../dist-admin'`.
- Modify: `package.json`. Add `"admin-build": "vite build --config vite.admin.config.ts"`, and add it to
  `build`, giving `tsc && vite build && vite build --config vite.admin.config.ts`. Also update
  `tsconfig.json` if its include set needs `admin`. Add `.gitignore` entries for `dist-admin`, `bans.json`
  and `dist-relay` if missing.

**Interfaces:**
- Consumes: the `AdminServerMessage` and `AdminRequest` types (Task 1). `decodeRocks`, `decodeShots` and
  the enemy row decoder from `src/shared.ts`. `createWorld` and `generateChunk` from `src/world.ts`.
  Ship and enemy sprite helpers from `src/sprites.ts` and `src/shipImage.ts`, where they run without
  Phaser. Otherwise draw outlined polygons in the game palette.

- [ ] **Step 1: Build the page.**
  - **Layout:** a top bar (online count, relay stats, logout), the map filling the left, and tabbed panels
    on the right (Pilots, Lobbies, Bans, Log), with an inspector drawer.
  - **Universe view:** home clusters on a stable spiral, lit room cells with pilot dots, and link lines.
  - **Sector view:** entered at zoom of 0.02 world-px or more, or when following. It sends `watch`.
  - **Controls:** drag to pan, wheel to zoom about the cursor, click to follow.
  - **Context menus:** pilot, sector and lobby menus per the spec. Teleport and spawn use a "click a
    destination" mode.
  - **Inspector:** shows the `report` with cargo and storage +/- inputs, station toggles, and outpost
    block actions.
  - Destructive actions use `confirm()`. `result` messages show as toasts.
- [ ] **Step 2:** Run `npm run build`. Expected: succeeds, and `dist-admin/index.html` exists.

### Task 7: End-to-end check and docs

**Files:**
- Modify: `ARCHITECTURE.md`, `PROGRESS.md`, `TASKS.md`, `server/README.md` (env vars, Pi setup, nginx
  headers, security note), and `AGENTS.md` (one paragraph on the admin invariants).

- [ ] **Step 1: Run the local stack.**
  - Start the relay with `ADMIN_PASSWORD=dev ADMIN_DIR=dist-admin npm run relay` in the background.
  - Start a bot with `npm run relay-bot -- ws://127.0.0.1:8787 - bot-seed --horde --fire`.
  - In the browser pane, open `http://127.0.0.1:8787/admin/`.
- [ ] **Step 2: Verify in the browser.**
  - The login refuses a wrong password.
  - The pilot table shows Test Pilot with ping.
  - The map shows the bot's cluster. Following it shows rocks, the orbiting ship, the horde and shots.
  - Inspect returns a report.
  - Broadcast, spawn and kick work.
  - Take screenshots for the user but do not save them in the repo.
- [ ] **Step 3:** Run `npm test` and `npm run build`. Expected: all pass.
- [ ] **Step 4:** Update the docs.
- [ ] **Step 5:** Run `git status` and `git diff --stat` and review for unrelated changes. Do not commit.
