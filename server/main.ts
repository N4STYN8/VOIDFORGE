import { readFileSync } from 'node:fs';
import { startRelay, DEFAULT_ORIGINS } from './relay.ts';

/**
 * Relay entry point. Environment:
 *   PORT (default 8787), HOST (default 0.0.0.0)
 *   TLS_CERT / TLS_KEY: Let's Encrypt fullchain.pem / privkey.pem paths to serve wss:// directly;
 *     leave unset when a reverse proxy (nginx, Caddy) terminates TLS in front of the relay.
 *   ORIGINS: comma-separated browser origins allowed to connect (default: the live site and localhost).
 */
const env = process.env;
const tls = env.TLS_CERT && env.TLS_KEY ? { cert: readFileSync(env.TLS_CERT), key: readFileSync(env.TLS_KEY) } : undefined;
const relay = await startRelay({ port: Number(env.PORT ?? 8787), host: env.HOST ?? '0.0.0.0', tls, origins: env.ORIGINS ? env.ORIGINS.split(',').map(s => s.trim()).filter(Boolean) : DEFAULT_ORIGINS });
console.log(`VOIDFORGE relay listening on ${tls ? 'wss' : 'ws'}://${env.HOST ?? '0.0.0.0'}:${relay.port}`);
const stop = () => { void relay.close().then(() => process.exit(0)); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
