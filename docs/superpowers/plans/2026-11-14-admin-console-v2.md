# Admin Console v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real game art on the admin map, plus a searchable roster, bulk actions, a pilot detail drawer and an
activity feed with alerts.

**Architecture:**

- **Relay:** gains an event ring, a cache of each pilot's last block layout, a `pilot` detail request and a
  `bulk` request. All of these go through the existing `RelayHooks` and admin dispatch.
- **Admin page:** reuses `src/sprites.ts` painters, plus `drawModule` through a Canvas adapter, cached in
  `src/admin/art.ts`.
- **Roster:** the logic is pure and tested (`src/admin/roster.ts`). The UI is split into small modules under
  `src/admin/ui/`.

**Tech Stack:** TypeScript, Canvas 2D, Vite (the admin entry), and Node `node:test`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-14-admin-console-v2-design.md`

## Global Constraints

- No new dependencies. Server code must bundle for Node 16 (`npm run relay-bundle`) and use no Node 17+
  APIs.
- The only game-code change is the type-only Phaser import in `src/visuals.ts`.
- **Limits:** events ring 500, sent on connect 200; `bulk` at most 500 ids; `ADMIN.maxWatch` stays 3.
- **Alert thresholds:**
  - token-bucket drops in a 10 s window over 30
  - 5 deaths in 120 s
  - a banned address retrying (each refused upgrade, at most 1 alert per address per minute)
  - more than 5 joins from one IP in 60 s
- **Bulk actions:** `message`, `kick`, `ban`, `evict-pilot`, `teleport`. No rename-prefix.
- AGENTS.md overrides the plan's commit steps: no commits or pushes unless the user asks. Review with
  `git diff --stat` instead.

## Review Focus

1. **A bulk request naming pilots who left mid-flight** gets "not online" counts, never a throw or a hung
   result. Tested in Task 1.
2. **A pilot whose block layout never arrived** gets a drawer showing "layout unknown", not a crash. Tested
   in Task 1 (`pilot` returns `blocks: undefined`) and handled in Task 4.
3. **Events and alert counters under churn** (100 joins and leaves) stay bounded. Tested in Task 1.
4. **The Graphics adapter given any module kind or level** draws without throwing. Tested in Task 2.
5. **Roster filters with an empty or odd search string** (regex characters) match literally. Tested in
   Task 3.

---

### Task 1: Relay events, alerts, pilot detail and bulk

**Files:**
- Modify: `src/adminProtocol.ts`, `server/admin.ts`, `server/relay.ts`
- Test: `tests/admin.test.ts`

**Interfaces:**

- **Produces, in `adminProtocol.ts`:**
  - `AdminEvent = { at: number; kind: EventKind; id?: string; name?: string; ip?: string; seed?: string; code?: string; detail?: string; alert?: true }`
  - `EventKind = 'join'|'leave'|'rename'|'sector'|'died'|'respawn'|'lobby'|'authority'|'kick'|'ban'|'admin'|'flood'|'deaths'|'banned-retry'|'join-burst'`
  - Server message `{t:'events'; entries: AdminEvent[]}`
  - Request `{t:'pilot', ref, id}`, answered by `{t:'pilot', ref, id, blocks?: ShipBlock[], paint?: number}`
  - Request `{t:'bulk', ref, ids: string[] (1..500), action: 'message'|'kick'|'ban'|'evict-pilot'|'teleport', text?, reason?, minutes?, x?, y?, world?}`
  - `ADMIN.maxEvents = 500`, `ADMIN.eventsOnConnect = 200`, `ADMIN.maxBulk = 500`
- **Produces, in `RelayHooks`:**
  - `event(e: Omit<AdminEvent,'at'>)`, which the relay calls and admin.ts pushes to its ring and broadcasts
  - `pilotDetail(id): { blocks?: ShipBlock[]; paint?: number } | undefined`

- [ ] **Step 1: Write tests.**
  - A pilot connecting leads to an admin `events` entry with `kind:'join'` and its name. Closing leads to
    `leave`.
  - `state` with `dead:true` leads to `died`; back to alive leads to `respawn`.
  - A lobby create or join leads to `lobby`.
  - A pilot sending 200 messages in 2 s (over the token bucket) leads to an event with `kind:'flood'` and
    `alert:true`.
  - `pilot {id}` after a state carrying blocks returns those blocks. Before any blocks, `blocks` is
    `undefined`.
  - `bulk kick` of 3 ids, where one already left, returns
    `result ok:true message 'Kick: 2 done, 1 not online'` and writes one `log` entry with action `bulk-kick`.
  - `bulk message` reaches each target as `{op:'notice'}`.
  - `bulk` with 501 ids gives `result ok:false`.
  - 600 events (via 300 join/leave pairs) leave a new admin with 200 events on connect, and the ring never
    exceeds 500. Expose the length through the stats field `events`.
- [ ] **Step 2:** Run `node --experimental-strip-types --test tests/admin.test.ts`. Expected: the new tests
  fail.
- [ ] **Step 3: Implement.**
  - Events are emitted in the relay at the existing points: connect, close, hello rename, sector change,
    dead flip, lobby changes, elect authority change, admit drop (counted per 10 s window), and the
    banned-upgrade refusal.
  - Alert counters live in Maps keyed by id/IP, pruned when entries expire.
  - Bulk uses the existing hooks and per-pilot `command()` promises, aggregated into counts:
    done, not online, no response, refused.
- [ ] **Step 4:** Run `npm test`. Expected: all pass.

### Task 2: Game art for the admin

**Files:**
- Modify: `src/visuals.ts` (line 1 becomes `import type Phaser from 'phaser';`)
- Create: `src/admin/art.ts`
- Test: `tests/adminArt.test.ts` (pure parts only; the canvas parts are checked in the browser)

**Interfaces:**
- **Produces:**
  - `class CanvasGraphics` implements the `drawModule` subset (`fillStyle, lineStyle, lineBetween, fillCircle, strokeCircle, fillTriangle, fillPoints, strokePoints, fillRect, fillRoundedRect, save, restore, translateCanvas, rotateCanvas`) on a `CanvasRenderingContext2D`.
  - `moduleIcon(kind, level): HTMLCanvasElement` (24×24, `crispModule`)
  - `shipImage(blocks: ShipBlock[], paint: number): { canvas; ox; oy } | undefined`
  - `enemySprite(kind)`, `stationSprite(on)`, `backdrop(seed)`, `rockSprite(seed, rock)`
  - `class Lru<K,V>(max)` with `get/set/size`
  - Cache sizes: ships 300, rocks 3000, backdrops 4.

- [ ] **Step 1: Write tests.**
  - `Lru` evicts the oldest past `max` and refreshes on `get`.
  - `CanvasGraphics`, driven by a recording fake context, translates every `drawModule` call for every
    `['core', ...Object.keys(MODULES)]` × levels `1..equipment(kind).levels.length` without throwing, and
    issues at least one fill per call.
- [ ] **Step 2:** Run the test. Expected: it fails (module missing).
- [ ] **Step 3: Implement.** Colours use the same `css()` from `sprites.ts`. `fillPoints(points, close)`
  draws a polygon path.
- [ ] **Step 4:** Run `npm test` and `npx tsc`. Expected: both pass.

### Task 3: Roster logic

**Files:**
- Create: `src/admin/roster.ts`
- Test: `tests/adminRoster.test.ts`

**Interfaces:**
- **Produces:**
  - `type RosterFilter = { text: string; status: Set<'alive'|'dead'|'solo'|'lobby'|'sharing'|'authority'|'bots'|'humans'>; seed?: string; lobby?: string }`
  - `filterPilots(pilots: AdminPilot[], f: RosterFilter, rooms: AdminRoom[]): AdminPilot[]`
  - `sortPilots(list, key: 'name'|'where'|'ping'|'rate'|'power'|'since', dir: 1|-1)`
  - `class Selection` with `toggle(id)`, `range(ids, from, to)`, `setAll(ids)`, `clear()`, `has(id)`,
    `ids(online: Set<string>)`, which drops ids no longer online.

- [ ] **Step 1: Write tests.**
  - Text matches name, IP, id or lobby, case-insensitively and literally (`'.*'` matches nothing in the
    fixtures).
  - `bots` matches names starting with `Sim `.
  - `sharing` means the pilot's room has more than one member.
  - `solo` means no lobby and a room with one member.
  - Sorting by ping puts `undefined` last.
  - `Selection.range` selects inclusively; `ids()` drops offline ids.
- [ ] **Step 2:** Run the test. Expected: it fails.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run `npm test`. Expected: all pass.

### Task 4: Admin page UI

**Files:**
- Modify: `admin/index.html`, `src/admin/admin.css`, `src/admin/main.ts`, `src/admin/map.ts`,
  `src/admin/sectorView.ts`
- Create: `src/admin/ui/roster.ts` (windowed table, filter chips, selection, bulk bar),
  `src/admin/ui/drawer.ts` (pilot drawer with mini-map, ship preview, tabs Overview/Activity/Inspector),
  `src/admin/ui/activity.ts` (feed with filters, alert counter and dismiss)

**Interfaces:**
- Consumes Task 1's messages, Task 2's art and Task 3's roster functions.

- [ ] **Step 1: Map.**
  - Sector detail draws `backdrop(seed)` parallax, `rockSprite` (rotated, scaled one texel per world unit,
    nearest-neighbour), `stationSprite`, `enemySprite`, and `shipImage` with heading and a thrust flame.
  - Effects are bounded: at most 400 shots and 16 death bursts per watched sector.
  - Outposts are drawn when `fx.o` parts arrive.
  - Below about 0.03 px per unit, it falls back to the current icons.
- [ ] **Step 2: Layout and shortcuts.**
  - Top bar with counts, alerts and broadcast. Map on the left with a draggable divider. Side panel with
    tabs Roster, Lobbies, Activity, Bans, Log. Drawer.
  - Shortcuts: `/` search, `Esc` close or cancel, `F` follow, `I` inspect, `Del` bulk kick with confirm.
  - Divider width and roster filter persist in `localStorage`, wrapped in try/catch.
- [ ] **Step 3: Watch priority.** The drawer's pilot sector first, then the followed pilot's, then the
  sectors in view, capped at 3.
- [ ] **Step 4:** Run `npm run build`. Expected: it succeeds.

### Task 5: Verification and docs

- [ ] **Step 1: Browser check.**
  - Start a local relay with `ADMIN_PASSWORD` set, and the swarm:
    `node --experimental-strip-types scripts/swarm.ts ws://127.0.0.1:8787 40 300 4`.
  - Check search, the bots filter, select all and bulk message ("40 refused" is expected for bots, since
    they refuse admin commands), and bulk kick of 3.
  - Check the drawer mini-map and ship preview, the activity feed (joins, a death), an alert by flooding with
    a raw script, and the sector view's real art.
- [ ] **Step 2:** Run `npm test`, `npm run build` and `npm run relay-bundle`. Expected: all pass.
- [ ] **Step 3: Update docs:** ARCHITECTURE.md, PROGRESS.md, TASKS.md and server/README.md (the Admin
  console section). Add a swarm usage note.
- [ ] **Step 4:** Run `git diff --stat` and review it. Do not commit.
