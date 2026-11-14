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
strip TypeScript, so the relay is bundled into one JavaScript file:

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

### Raspberry Pi setup (when a deployment is approved)

1. Build both parts:
   ```bash
   npm run relay-bundle
   npm run admin-build
   ```
2. Copy `dist-relay/relay.mjs` to `/opt/voidforge/relay.mjs`, and `dist-admin/` to `/opt/voidforge/admin/`,
   both owned by root and readable by `voidforge`.
3. Create a bans directory writable by the service: `sudo install -d -o voidforge -g voidforge /var/lib/voidforge`.
4. Put the secrets in a root-only systemd drop-in, `sudo systemctl edit voidforge-relay`:
   ```ini
   [Service]
   Environment=ADMIN_PASSWORD=<long random password>
   Environment=ADMIN_DIR=/opt/voidforge/admin
   Environment=BANS_FILE=/var/lib/voidforge/bans.json
   Environment=TRUST_PROXY=1
   ```
5. In the nginx `location` for the relay, make sure these headers are set (the WebSocket upgrade headers
   are already there):
   ```nginx
   proxy_set_header Host $host;
   proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
   proxy_set_header X-Forwarded-Proto $scheme;
   ```
6. Run `sudo systemctl daemon-reload && sudo systemctl restart voidforge-relay`, then open
   `https://voidforge.2dq.us/admin/`.

The in-game commands need the matching game build on the live site as well (a GitHub Pages deploy). Both
deployments need explicit approval and a word with the other developer first.

