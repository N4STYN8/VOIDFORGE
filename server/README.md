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

## Raspberry Pi (voidforge.2dq.us)

Requires Node 22.18+ (or 24). The relay only needs the repository's `server/` and `src/netProtocol.ts`.

Option A, relay serves TLS with the existing Let's Encrypt certificate (the certificate files must be
readable by the service user; use a deploy hook or group permission, not a copy committed anywhere):

```ini
# /etc/systemd/system/voidforge-relay.service
[Unit]
Description=VOIDFORGE relay
After=network-online.target

[Service]
WorkingDirectory=/opt/voidforge
ExecStart=/usr/bin/node --experimental-strip-types server/main.ts
Environment=PORT=443
Environment=TLS_CERT=/etc/letsencrypt/live/voidforge.2dq.us/fullchain.pem
Environment=TLS_KEY=/etc/letsencrypt/live/voidforge.2dq.us/privkey.pem
AmbientCapabilities=CAP_NET_BIND_SERVICE
Restart=always
User=voidforge

[Install]
WantedBy=multi-user.target
```

Option B, nginx or Caddy terminates TLS and proxies to the relay on `127.0.0.1:8787` (set
`HOST=127.0.0.1`). nginx needs the WebSocket upgrade headers:

```nginx
location / {
  proxy_pass http://127.0.0.1:8787;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_read_timeout 120s;
}
```

Certificate renewals need a relay restart in option A (`systemctl restart voidforge-relay` from a
certbot deploy hook).

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
near each other, so the Pi's home upload speed is the likely ceiling; run the same test against
`wss://voidforge.2dq.us` from another machine once the relay is deployed. `GET /stats` gives live counters.
