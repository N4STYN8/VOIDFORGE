# VOIDFORGE relay

A small Node WebSocket relay for lobbies and shared sectors. It has no npm dependencies and does not
simulate the game: each player's browser runs its own model, and the relay forwards ship state to the
other players in the same sector (a "room" is a sector's world seed). The live game connects to
`wss://voidforge.2dq.us`. Single-player keeps working without it.

Deploying or restarting the relay on the Pi is a deployment: it changes what every online player
connects to. Two developers have access to the Pi, so agree before doing it, and agents must have an
explicit go-ahead for it, the same as for the GitHub Pages site.

## Run locally

```bash
npm run relay
```

Then open the game with a local relay override (only `localhost`/`127.0.0.1` relays are accepted
from the address bar): `http://localhost:5173/?relay=ws://127.0.0.1:8787`.

A scripted test pilot that hosts a lobby and flies a circle by its home station:

```bash
npm run relay-bot -- ws://127.0.0.1:8787
```

It prints the lobby code; join it from the game's Systems menu, or open
`http://localhost:5173/?relay=ws://127.0.0.1:8787&join=CODE`.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8787` | Listening port |
| `HOST` | `0.0.0.0` | Listening address |
| `TLS_CERT`, `TLS_KEY` | unset | Let's Encrypt `fullchain.pem` and `privkey.pem`. When both are set the relay serves `wss://` itself. Leave unset behind a reverse proxy. |
| `ORIGINS` | live site + localhost | Comma-separated browser origins allowed to connect |
| `ADMIN_PASSWORD` | unset | Enables the admin console at `/admin`. Unset: every `/admin` path is a 404. |
| `ADMIN_DIR` | `dist-admin` | The built admin page (`npm run admin-build`) |
| `BANS_FILE` | `bans.json` | Where admin IP bans are kept across restarts |
| `TRUST_PROXY` | unset | `1` behind a local reverse proxy: client address from `X-Forwarded-For`, https from `X-Forwarded-Proto`. Only honoured for connections from 127.0.0.1/::1. |

`GET /` returns a one-line health text with counts (no player data).

## Raspberry Pi (voidforge.2dq.us) — deployed 2026-11-13

The Pi runs Debian 11 with Node 16 (shared with other services, so it was not upgraded). Node 16 cannot
strip TypeScript, so the relay is bundled into one JavaScript file. Node 16 also lacks `structuredClone`;
`server/node16.ts` (the first import of `server/main.ts`) supplies it from `v8.serialize`/`deserialize`. Check that
new server code avoids other Node 17+ APIs.

```bash
npm run relay-bundle
```

That writes `dist-relay/relay.mjs`. On the Pi it lives at `/opt/voidforge/relay.mjs` (owned by root),
run by the `voidforge-relay` systemd service as the unprivileged `voidforge` user with `HOST=127.0.0.1`
and `PORT=8787`. nginx terminates TLS for `voidforge.2dq.us` (`/etc/nginx/sites-available/voidforge`,
certificate from `certbot --nginx`, renewed by certbot's timer with no relay restart) and proxies to it
with the WebSocket upgrade headers. Updating it, after agreeing with the other developer:

```bash
scp dist-relay/relay.mjs pi:/tmp/voidforge-relay.mjs
ssh pi 'sudo install -m 644 /tmp/voidforge-relay.mjs /opt/voidforge/relay.mjs && sudo systemctl restart voidforge-relay'
```

Restarting drops every connected pilot; clients show the disconnect and can reconnect.

## Lobbies

Lobbies are open (listed for everyone, the default from the Multiplayer panel) or private (code and invite link only). A client asks with `{t:'lobbies'}` and gets open lobbies with room, fullest first, with each host's progression score, plus the number of pilots online. The host switches with `{t:'open', open}`. Sending `hello` again renames the pilot.

Lobby members exchange `party` messages (resource sharing) in any sector: to one member or all the others; a `to` outside the lobby gets `party-undelivered`.

The relay checks message kinds, so a new `cast`/`direct` kind (such as `fx`, `world-req`, `world`) needs the relay redeployed before a game build that sends it goes live.

## Limits and load

Per client: 30 messages/second with a burst of 60 (more is dropped; sustained flooding disconnects),
16 KB per message, lobbies of up to 8. Ship state is forwarded only to pilots within 7,000 units, and
skipped for clients whose socket is backed up. These are `NET` in `src/netProtocol.ts`.

Load test (starts its own relay unless given a URL):

```bash
npm run load-test -- 1000 4 20
```

Measured on the development PC with 1,000 pilots in 4-pilot sectors: 30% of one CPU core, 111 MB,
latency p50 22 ms / p99 38 ms, 40.7 Mbit/s outbound. Outbound bandwidth grows with how many pilots are
near each other.

Measured against the Pi over the internet, 200 pilots: 64% of one core, 52 MB, p50 36 ms / p99 124 ms,
8.5 Mbit/s outbound. The relay is one Node process, so the Pi holds roughly 300 pilots; 1,000 needs a
faster host or rooms split across processes. `GET /stats` gives live counters.

## Admin console

A password-protected console for watching and managing players, served by the relay itself at
`/admin` (login page, built page, and the admin socket `/admin/ws`). It shows every online pilot (IP,
sector, lobby, authority, position, progression, ping, message rate) and lobby, and has a live universe
map: one cluster per home grid, zoom into a sector to see its generated asteroid field with live ships,
enemies, shots and beams, and click a pilot to follow them.

Actions, all written to the audit log (also stdout/journald):
- **On the relay:** kick, which also blocks the IP for 2 minutes because the game reconnects by itself;
  ban and unban by IP with an expiry; rename; broadcast to everyone, one lobby, one sector or one pilot;
  disband a lobby, remove a member, or switch a lobby between open and private; lock a sector. A locked
  sector lets in only its owner, sends everyone else home, and stays locked until the relay restarts.
- **In the pilot's own game:**
  - Teleport to a point, to a cell of their own grid (kept), or into another sector (a visit).
  - Spawn or clear enemies, carried out by the sector's authority.
  - Evict everyone from a sector.
  - Inspect a pilot and edit their cargo, station storage, stations and outpost blocks.

  Older game versions ignore these commands, and the console shows "no response".

The console (v2) has the following parts:
- **Map:** the sector view uses the game's own art. Ships appear in their paint, with beams, thrust and death bursts.
- **Pilots tab:** search, filter chips (players, bots, alive, dead, solo, in a lobby, sharing a sector, authority), sortable columns and checkbox selection. A bulk bar sends message, teleport, send home, kick or ban to many pilots as one relay request (at most 500). The result breaks down what happened, for example `Kick: 48 done, 2 not online`.
- **Pilot drawer:** click a pilot to open it. It shows a live mini-map, ship preview, connection stats, one-click actions, their activity, and the cargo/bases inspector.
- **Activity tab:** joins, leaves, sector changes, deaths, lobby changes and admin actions. Alerts (flooding, 5 deaths in 2 minutes, a banned address retrying, more than 5 connections from one address in a minute) are counted in the top bar until dismissed. The relay keeps the last 500 events in memory.
- **Shortcuts:** `/` search, `F` follow, `I` inspect, `Del` kick the selected pilots, `Esc` close.

To try it with simulated pilots: `node --experimental-strip-types scripts/swarm.ts ws://127.0.0.1:8787 40 300 4` runs 40 bots for 300 s across 4 workers. The bots are real headless games: they fly, mine, fight and form lobbies, but never fire at other pilots or use matchmaking. Bots refuse admin commands, so a bulk teleport counts them as "refused". Against the live relay, a swarm is a public load event, so agree it first.

Players are not shown any notice that admins can watch them (the user's decision).

Security: the console exists only when `ADMIN_PASSWORD` is set. The password is compared in constant
time. Sessions are random 12-hour tokens in an HttpOnly, SameSite=Strict cookie limited to `/admin`,
and they are lost on restart. Five wrong passwords lock that address out for 15 minutes. The admin socket
accepts only its own origin, never the player `ORIGINS`. Admin responses send `no-store`, `DENY` framing
and a same-origin CSP. Load is bounded: at most 4 admin sockets, each watching at most 3 sectors, with
watch traffic dropped when an admin's connection backs up. This is still an internet-facing login, so use
a long random password. Never commit it.

### Local

```bash
npm run admin-build
ADMIN_PASSWORD=dev npm run relay
```

Open `http://127.0.0.1:8787/admin/`. Add a pilot with `npm run relay-bot -- ws://127.0.0.1:8787 - bot-seed --horde --fire`.
To see in-game commands work, open the game against the local relay and join the bot's lobby, for example
`http://127.0.0.1:5199/?relay=ws://127.0.0.1:8787&join=CODE`. Using a spare port gives the game fresh
browser storage, so no real save is touched.

### Raspberry Pi setup — deployed 2026-11-13

Live at `https://voidforge.2dq.us/admin/` since PR #11, and updated with PR #13. This is the setup as it
stands on the Pi:

| What | Where |
|---|---|
| Relay bundle | `/opt/voidforge/relay.mjs` (root-owned, mode 644). The previous build is kept beside it as `relay.mjs.prev-<hash>`. |
| Admin page | `/opt/voidforge/admin/` (a copy of `dist-admin/`, root-owned, readable by `voidforge`) |
| Admin password | `/etc/voidforge/admin.env`, holding `ADMIN_PASSWORD=…`. Owned by root with mode 600; it was generated on the Pi and never leaves it. |
| Bans file | `/var/lib/voidforge/bans.json`, created by the relay on the first ban |
| systemd drop-in | `/etc/systemd/system/voidforge-relay.service.d/admin.conf` |
| nginx site | `/etc/nginx/sites-available/voidforge` |

The drop-in:

```ini
[Service]
EnvironmentFile=/etc/voidforge/admin.env
Environment=ADMIN_DIR=/opt/voidforge/admin
Environment=BANS_FILE=/var/lib/voidforge/bans.json
Environment=TRUST_PROXY=1
StateDirectory=voidforge
```

Two details matter here:

- **The password lives in an `EnvironmentFile`, not an `Environment=` line.** Root reads the file when the
  service starts, so it stays mode 600, and it never appears in `systemctl cat` or the unit files.
- **`StateDirectory=voidforge` is required.** The base unit runs with `ProtectSystem=strict`, which makes
  the whole filesystem read-only for the service. `StateDirectory` creates `/var/lib/voidforge`, owned by
  the `voidforge` user, and leaves it writable. Without it, saving a ban fails, and the relay only logs a
  warning.

nginx forwards these headers on the relay's `location /`:

```nginx
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
proxy_set_header Host $host;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
```

Each header has a job:

- **`Host`:** the admin socket's origin check compares the browser's `Origin` against
  `https://<Host>`. Without this header nginx sends the upstream's address, and every admin socket is
  refused.
- **`X-Forwarded-For`:** with `TRUST_PROXY=1`, gives each player's real address for bans, the login
  lockout and the pilot table. If it is missing, everyone shows as 127.0.0.1, the relay refuses bans, and it
  logs a warning.
- **`X-Forwarded-Proto`:** marks the session cookie `Secure` and makes the expected origin `https://`.

#### First-time setup (for a new host)

1. Create the password file: `sudo install -d -m 700 /etc/voidforge`. Then write
   `ADMIN_PASSWORD=<long random password>` to `/etc/voidforge/admin.env` and run
   `sudo chmod 600 /etc/voidforge/admin.env`.
2. Copy the admin page: `sudo mkdir -p /opt/voidforge/admin`, then copy `dist-admin/` into it.
3. Create the drop-in above with `sudo systemctl edit voidforge-relay`, and add the nginx headers above.
4. Run `sudo nginx -t && sudo systemctl reload nginx`, then
   `sudo systemctl daemon-reload && sudo systemctl restart voidforge-relay`.

#### Updating

This is a deployment: agree with the other developer first, and check `curl -s https://voidforge.2dq.us/`
for pilots online, because a restart drops them all.

```bash
npm run relay-bundle
scp dist-relay/relay.mjs pi:/tmp/voidforge-relay.mjs
ssh pi 'sudo cp /opt/voidforge/relay.mjs /opt/voidforge/relay.mjs.prev && sudo install -m 644 /tmp/voidforge-relay.mjs /opt/voidforge/relay.mjs && sudo systemctl restart voidforge-relay'
```

When the admin page changed, also run `npm run admin-build` and copy `dist-admin/` to `/opt/voidforge/admin/`.
The page is served from disk, so that needs no restart.

Check afterwards:

- `sudo journalctl -u voidforge-relay -n 5` should show "Admin console enabled at /admin".
- `https://voidforge.2dq.us/admin/` should redirect to the login page.
- A game client should still connect.

To roll back, copy the `.prev` file back over `relay.mjs` and restart the service.

The in-game commands also need the matching game build on the live site, which a merge to `main` deploys.

## Crew rollout (separate relay deployment)

The crew-capable relay preserves the existing admin console/options. Build with `npm run relay-bundle` on the integrated source; use `dist-relay/relay.mjs` for the documented Node 16 Pi deployment. Do not replace existing admin secrets, drop-ins, bans or admin assets.

Before restart, coordinate with the other developer, back up `/opt/voidforge/relay.mjs` and any existing crew database, and give the `voidforge` service a writable durable directory. Configure `CREW_DATA=/var/lib/voidforge/crews.json` in a separate systemd drop-in, preserving existing `ADMIN_PASSWORD`, `ADMIN_DIR`, `BANS_FILE` and `TRUST_PROXY`. The directory should be owned by `voidforge`, and the database must be backed up across releases. Build/check the admin page only if deploying admin assets separately.

After installing the new relay and restarting `voidforge-relay`, check service health, existing admin login/observer behavior, crew capability on a real player connection, then a two-pilot invite/deposit/build/reconnect check. The site remains compatible with the older relay and shows crews unavailable until the relay is upgraded.

Known observer scope: the existing global-admin feeds remain intact; crew-only server structures/mining do not yet have a dedicated admin observer overlay. Crew members see authoritative crew snapshots in the game. Crew leadership never grants global-admin credentials.
