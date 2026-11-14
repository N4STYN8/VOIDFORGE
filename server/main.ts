import { readFileSync } from 'node:fs';
import { startRelay, DEFAULT_ORIGINS } from './relay.ts';

/**
 * Relay entry point. Environment:
 *   PORT (default 8787), HOST (default 0.0.0.0)
 *   TLS_CERT / TLS_KEY: Let's Encrypt fullchain.pem / privkey.pem paths to serve wss:// directly;
 *     leave unset when a reverse proxy (nginx, Caddy) terminates TLS in front of the relay.
 *   ORIGINS: comma-separated browser origins allowed to connect (default: the live site and localhost).
 *   ADMIN_PASSWORD: enables the admin console at /admin (disabled, every /admin path a 404, when unset).
 *   ADMIN_DIR: the built admin page (npm run admin-build; default ./dist-admin).
 *   BANS_FILE: where admin bans are kept (default ./bans.json).
 *   TRUST_PROXY=1: take the client address from X-Forwarded-For (and https from X-Forwarded-Proto) when the
 *     connection comes from a local reverse proxy such as nginx.
 */
const env = process.env;
const tls = env.TLS_CERT && env.TLS_KEY ? { cert: readFileSync(env.TLS_CERT), key: readFileSync(env.TLS_KEY) } : undefined;
const relay = await startRelay({ port: Number(env.PORT ?? 8787), host: env.HOST ?? '0.0.0.0', tls, origins: env.ORIGINS ? env.ORIGINS.split(',').map(s => s.trim()).filter(Boolean) : DEFAULT_ORIGINS,
  admin: { password: env.ADMIN_PASSWORD, dir: env.ADMIN_DIR ?? 'dist-admin', bansFile: env.BANS_FILE ?? 'bans.json', trustProxy: env.TRUST_PROXY === '1' } });
if (env.ADMIN_PASSWORD) console.log(`Admin console enabled at /admin (page from ${env.ADMIN_DIR ?? 'dist-admin'})`);
console.log(`VOIDFORGE relay listening on ${tls ? 'wss' : 'ws'}://${env.HOST ?? '0.0.0.0'}:${relay.port}`);
const stop = () => { void relay.close().then(() => process.exit(0)); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
