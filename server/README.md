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
