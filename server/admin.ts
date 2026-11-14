import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { upgrade, textFrame, type WebSocketPeer } from './websocket.ts';
import { Bans } from './bans.ts';
import { NET } from '../src/netProtocol.ts';
import { ADMIN, parseAdmin, type AdminCommand, type AdminLobby, type AdminPilot, type AdminRequest, type AdminRoom, type AdminServerMessage, type AuditEntry, type BroadcastTarget } from '../src/adminProtocol.ts';

/**
 * Relay admin console: password login, the built admin page (ADMIN_DIR), the admin socket at /admin/ws,
 * bans and the audit log. It reads and acts on relay state only through `RelayHooks`, which
 * server/relay.ts implements; the relay still never simulates. With no password configured every
 * /admin path is a 404, so the console can never be reached without auth.
 */
export type AdminOptions = { password?: string; dir?: string; bansFile?: string; trustProxy?: boolean; now?: () => number; resultTimeout?: number; /** Keep-alive ping interval for admin sockets (default NET.ping seconds). */ pingMs?: number };
export type CommandResult = { ok: boolean; message?: string; data?: unknown };
/** An open admin socket and the sector rooms it watches. */
export type AdminSocket = { peer: WebSocketPeer; watching: Set<string>; tokens: number; refilled: number };
export type RelayHooks = {
  overview(): { pilots: AdminPilot[]; lobbies: AdminLobby[]; rooms: AdminRoom[]; stats: Record<string, number> };
  pilot(id: string): { ip: string; name: string } | undefined;
  /** Disconnects every pilot from this IP; returns how many. */
  dropIp(ip: string, reason: string): number;
  kick(id: string, reason: string): string | undefined;
  rename(id: string, name: string): string | undefined;
  disband(code: string): string | undefined;
  remove(code: string, id: string): string | undefined;
  setOpen(code: string, open: boolean): string | undefined;
  lock(seed: string, locked: boolean): string | undefined;
  broadcast(to: BroadcastTarget, text: string): number;
  /** Sends a command to one pilot and resolves with its ack, or `no response` after the timeout. */
  command(id: string, c: AdminCommand): Promise<CommandResult>;
  authorityOf(seed: string): string | undefined;
  /** Sends every non-owner in the room home; resolves with how many acknowledged. */
  evict(seed: string, reason: string): Promise<number>;
  watch(socket: AdminSocket, seeds: string[]): void;
  release(socket: AdminSocket): void;
};
export type Admin = {
  enabled: boolean;
  bans: Bans;
  handleHttp(request: IncomingMessage, response: ServerResponse): boolean;
  handleUpgrade(request: IncomingMessage, socket: Duplex): boolean;
  log(action: string, target: string, detail?: string): void;
  sockets: Set<AdminSocket>;
  close(): void;
};

const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest();
/** Constant-time password check: equal-length digests, so neither content nor length leaks through timing. */
export function passwordMatches(given: string, expected: string) { return timingSafeEqual(digest(given), digest(expected)); }
export function parseCookies(header?: string) {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); }
  return out;
}
const loopback = (a?: string) => a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
/** The connecting address; behind a trusted local proxy (nginx), the last X-Forwarded-For hop. */
export function clientIp(request: IncomingMessage, trustProxy: boolean) {
  const remote = request.socket.remoteAddress ?? '';
  const forwarded = request.headers['x-forwarded-for'];
  if (trustProxy && loopback(remote) && typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',').map(s => s.trim()).filter(Boolean).pop()!;
  return remote.replace(/^::ffff:/, '');
}

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const COOKIE = 'vf_admin';
const loginPage = (message = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VOIDFORGE admin</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#07090f;color:#d8e2f0;font:15px system-ui,sans-serif}form{background:#111725;border:1px solid #263248;padding:28px;border-radius:8px;width:min(320px,90vw);display:grid;gap:12px}h1{margin:0;font-size:18px;letter-spacing:.12em;color:#ffb347}input,button{font:inherit;padding:10px;border-radius:5px;border:1px solid #33415c;background:#0a0f1a;color:inherit}button{background:#ff8a1f;color:#111;border:0;font-weight:600;cursor:pointer}p{margin:0;color:#ff6b6b;min-height:1em}</style></head>
<body><form method="post" action="/admin/login"><h1>VOIDFORGE ADMIN</h1><input type="password" name="password" placeholder="Admin password" autocomplete="current-password" autofocus required><button>Sign in</button><p>${message}</p></form></body></html>`;

export function createAdmin(options: AdminOptions, hooks: RelayHooks): Admin {
  const password = options.password || undefined, now = options.now ?? Date.now, trustProxy = Boolean(options.trustProxy);
  const dir = resolve(options.dir ?? 'dist-admin');
  const bans = new Bans(options.bansFile, now);
  const sessions = new Map<string, number>(), failures = new Map<string, { count: number; until: number }>();
  const sockets = new Set<AdminSocket>(), entries: AuditEntry[] = [];

  const secure = (request: IncomingMessage) => Boolean((request.socket as { encrypted?: boolean }).encrypted) || trustProxy && loopback(request.socket.remoteAddress) && request.headers['x-forwarded-proto'] === 'https';
  const session = (request: IncomingMessage) => {
    const token = parseCookies(request.headers.cookie)[COOKIE];
    if (!token) return false;
    const until = sessions.get(token);
    if (!until) return false;
    if (until <= now()) { sessions.delete(token); return false; }
    return true;
  };
  const headers = (request: IncomingMessage, type: string, extra: Record<string, string> = {}) => {
    const host = String(request.headers.host ?? '');
    return {
      'Content-Type': type, 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': `default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://${host} wss://${host}; frame-ancestors 'none'; form-action 'self'`,
      ...extra,
    };
  };
  /** A stalled admin socket (sleeping laptop, dead link) is skipped rather than buffered without limit; the keep-alive reaps it. */
  const send = (s: AdminSocket, m: AdminServerMessage) => { if (s.peer.backlog <= NET.backlog) s.peer.sendFrame(textFrame(JSON.stringify(m))); };
  const log = (action: string, target: string, detail?: string) => {
    const entry: AuditEntry = { at: now(), action, target, detail };
    entries.push(entry); if (entries.length > ADMIN.logSize) entries.shift();
    console.log(`[admin] ${new Date(entry.at).toISOString()} ${action} ${target}${detail ? ` ${detail}` : ''}`);
    for (const s of sockets) send(s, { t: 'log', entries: [entry] });
  };

  function login(request: IncomingMessage, response: ServerResponse) {
    const ip = clientIp(request, trustProxy);
    let body = '';
    request.on('data', chunk => { body += chunk; if (body.length > 4096) request.destroy(); });
    request.on('end', () => {
      // Looked up here, after the body: parallel attempts from one address share a single record.
      const fail = failures.get(ip);
      if (fail && fail.until > now()) { response.writeHead(429, headers(request, 'text/html; charset=utf-8')); response.end(loginPage('Too many attempts. Try again later.')); return; }
      const given = new URLSearchParams(body).get('password') ?? '';
      if (!passwordMatches(given, password!)) {
        const f = fail ?? { count: 0, until: 0 };
        f.count++; if (f.count >= ADMIN.lockFailures) { f.until = now() + ADMIN.lockMs; f.count = 0; }
        failures.set(ip, f);
        if (failures.size > 10000) for (const [key, v] of failures) if (v.until <= now()) failures.delete(key);
        log('login-failed', ip);
        response.writeHead(401, headers(request, 'text/html; charset=utf-8')); response.end(loginPage('Wrong password.')); return;
      }
      failures.delete(ip);
      for (const [t, until] of sessions) if (until <= now()) sessions.delete(t);
      const token = randomBytes(32).toString('hex'); sessions.set(token, now() + ADMIN.sessionMs);
      log('login', ip);
      response.writeHead(303, headers(request, 'text/plain', { Location: '/admin/', 'Set-Cookie': `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=${ADMIN.sessionMs / 1000}${secure(request) ? '; Secure' : ''}` }));
      response.end();
    });
  }

  function serveFile(request: IncomingMessage, response: ServerResponse, path: string) {
    let rel: string;
    try { rel = decodeURIComponent(path.replace(/^\/admin\/?/, '')) || 'index.html'; } catch { response.writeHead(400); response.end(); return; }
    if (rel.includes(' ')) { response.writeHead(400, headers(request, 'text/plain')); response.end('Bad request'); return; }
    const file = resolve(dir, rel);
    if (file !== dir && !file.startsWith(dir + sep)) { response.writeHead(403, headers(request, 'text/plain')); response.end('Forbidden'); return; }
    readFile(file, (error, data) => {
      if (error) { response.writeHead(404, headers(request, 'text/plain')); response.end(rel === 'index.html' ? 'Admin page not built: run npm run admin-build and set ADMIN_DIR.' : 'Not found'); return; }
      response.writeHead(200, headers(request, MIME[extname(file).toLowerCase()] ?? 'application/octet-stream')); response.end(data);
    });
  }

  function handleHttp(request: IncomingMessage, response: ServerResponse) {
    const path = (request.url ?? '/').split('?')[0];
    if (path !== '/admin' && !path.startsWith('/admin/')) return false;
    if (!password) { response.writeHead(404, { 'Content-Type': 'text/plain' }); response.end('Not found'); return true; }
    if (path === '/admin/login') {
      if (request.method === 'POST') { login(request, response); return true; }
      response.writeHead(200, headers(request, 'text/html; charset=utf-8')); response.end(loginPage()); return true;
    }
    if (path === '/admin/logout') {
      const token = parseCookies(request.headers.cookie)[COOKIE]; if (token) sessions.delete(token);
      response.writeHead(303, headers(request, 'text/plain', { Location: '/admin/login', 'Set-Cookie': `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=0` })); response.end(); return true;
    }
    if (!session(request)) { response.writeHead(302, headers(request, 'text/plain', { Location: '/admin/login' })); response.end(); return true; }
    if (path === '/admin') { response.writeHead(302, headers(request, 'text/plain', { Location: '/admin/' })); response.end(); return true; }
    serveFile(request, response, path);
    return true;
  }

  const result = (s: AdminSocket, ref: number, ok: boolean, message?: string) => send(s, { t: 'result', ref, ok, message });
  const simple = (s: AdminSocket, ref: number, error: string | undefined, action: string, target: string, detail?: string) => {
    if (error) { result(s, ref, false, error); return; }
    log(action, target, detail); result(s, ref, true);
  };
  const forward = (s: AdminSocket, r: AdminRequest & { ref: number }, to: string | undefined, c: AdminCommand, action: string, target: string, detail?: string) => {
    if (!to) { result(s, r.ref, false, 'No pilot runs that sector.'); return; }
    log(action, target, detail);
    void hooks.command(to, c).then(answer => {
      if (answer.data !== undefined) send(s, { t: 'report', id: to, ref: r.ref, data: answer.data });
      result(s, r.ref, answer.ok, answer.message);
    });
  };
  const name = (id: string) => hooks.pilot(id)?.name ?? id;

  function dispatch(s: AdminSocket, r: AdminRequest) {
    switch (r.t) {
      case 'watch':
        hooks.watch(s, r.rooms); result(s, r.ref, true); return;
      case 'kick': {
        // The game reconnects on its own within seconds, so a kick also keeps the address out for a short while.
        const target = hooks.pilot(r.id), error = hooks.kick(r.id, r.reason ?? 'Disconnected by an admin.');
        if (!error && target && !loopback(target.ip) && target.ip !== '127.0.0.1') bans.add(target.ip, ADMIN.kickMinutes, `Kicked${r.reason ? `: ${r.reason}` : ''}`, target.name);
        simple(s, r.ref, error, 'kick', target?.name ?? r.id, r.reason); return;
      }
      case 'ban': {
        const target = r.id ? hooks.pilot(r.id) : undefined, ip = r.ip ?? target?.ip;
        if (!ip) { result(s, r.ref, false, 'That pilot is not online.'); return; }
        if (loopback(ip) || ip === '127.0.0.1') { result(s, r.ref, false, 'Cannot ban a local address: without TRUST_PROXY=1 behind nginx every player shows as 127.0.0.1.'); return; }
        bans.add(ip, r.minutes, r.reason ?? '', target?.name ?? '');
        const dropped = hooks.dropIp(ip, r.reason ? `Banned: ${r.reason}` : 'Banned by an admin.');
        log('ban', `${target?.name ?? ''} ${ip}`.trim(), `${r.minutes} min${r.reason ? `, ${r.reason}` : ''}, ${dropped} disconnected`);
        result(s, r.ref, true, `Banned ${ip} for ${r.minutes} minutes.`); return;
      }
      case 'unban': simple(s, r.ref, bans.remove(r.ip) ? undefined : 'No ban for that address.', 'unban', r.ip); return;
      case 'rename': { const before = name(r.id); simple(s, r.ref, hooks.rename(r.id, r.name), 'rename', before, `to ${r.name}`); return; }
      case 'disband': simple(s, r.ref, hooks.disband(r.code), 'disband', r.code); return;
      case 'remove': { const who = name(r.id); simple(s, r.ref, hooks.remove(r.code, r.id), 'remove', who, `from ${r.code}`); return; }
      case 'lobby-open': simple(s, r.ref, hooks.setOpen(r.code, r.open), r.open ? 'lobby-open' : 'lobby-private', r.code); return;
      case 'lock': simple(s, r.ref, hooks.lock(r.seed, r.locked), r.locked ? 'lock' : 'unlock', r.seed); return;
      case 'broadcast': {
        const count = hooks.broadcast(r.to, r.text);
        log('broadcast', JSON.stringify(r.to), r.text); result(s, r.ref, count > 0, `Sent to ${count} pilot${count === 1 ? '' : 's'}.`); return;
      }
      case 'teleport': forward(s, r, hooks.pilot(r.id) ? r.id : undefined, { op: 'teleport', x: r.x, y: r.y, world: r.world, cell: r.cell }, 'teleport', name(r.id), r.world ? `to ${r.world.seed}` : r.cell ? `to cell ${r.cell}` : `to ${Math.round(r.x)},${Math.round(r.y)}`); return;
      case 'spawn': forward(s, r, hooks.authorityOf(r.seed), { op: 'spawn', kind: r.kind, count: r.count, x: r.x, y: r.y }, 'spawn', r.seed, `${r.count} ${r.kind}`); return;
      case 'clear': forward(s, r, hooks.authorityOf(r.seed), { op: 'clear' }, 'clear-enemies', r.seed); return;
      case 'evict': {
        log('evict', r.seed);
        void hooks.evict(r.seed, 'An admin cleared this sector.').then(count => result(s, r.ref, true, `Evicted ${count} pilot${count === 1 ? '' : 's'}.`)); return;
      }
      case 'inspect': forward(s, r, hooks.pilot(r.id) ? r.id : undefined, { op: 'inspect' }, 'inspect', name(r.id)); return;
      case 'cargo': forward(s, r, hooks.pilot(r.id) ? r.id : undefined, { op: 'cargo', target: r.target, delta: r.delta }, 'edit-minerals', name(r.id), `${typeof r.target === 'string' ? r.target : `outpost ${r.target.outpost}`} ${JSON.stringify(r.delta)}`); return;
      case 'station': forward(s, r, hooks.pilot(r.id) ? r.id : undefined, { op: 'station', index: r.index, unlocked: r.unlocked }, r.unlocked ? 'unlock-station' : 'lock-station', name(r.id), `station ${r.index}`); return;
      case 'structure': forward(s, r, hooks.pilot(r.id) ? r.id : undefined, { op: 'structure', outpost: r.outpost, structure: r.structure, action: r.action }, `${r.action}-structure`, name(r.id), `outpost ${r.outpost}${r.structure === undefined ? '' : ` block ${r.structure}`}`); return;
    }
  }

  function handleUpgrade(request: IncomingMessage, socket: Duplex) {
    const path = (request.url ?? '/').split('?')[0];
    if (path !== '/admin/ws') return false;
    const fail = (status: string) => { socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); return true; };
    if (!password) return fail('404 Not Found');
    if (!session(request)) return fail('401 Unauthorized');
    if (sockets.size >= ADMIN.maxSockets) return fail('503 Service Unavailable');
    const expected = `${secure(request) ? 'https' : 'http'}://${request.headers.host ?? ''}`;
    const peer = upgrade(request, socket, 4096, origin => origin === expected);
    if (!peer) return true;
    const s: AdminSocket = { peer, watching: new Set(), tokens: ADMIN.rate, refilled: now() };
    sockets.add(s);
    peer.onmessage = text => {
      const t = now(); s.tokens = Math.min(ADMIN.rate, s.tokens + (t - s.refilled) / 1000 * ADMIN.rate); s.refilled = t;
      if (s.tokens < 1) return; s.tokens--;
      const r = parseAdmin(text);
      if (!r) { try { const ref = JSON.parse(text)?.ref; if (Number.isSafeInteger(ref)) result(s, ref, false, 'Invalid request.'); } catch { /* ignore */ } return; }
      dispatch(s, r);
    };
    peer.onclose = () => { sockets.delete(s); hooks.release(s); };
    send(s, { t: 'log', entries: [...entries] });
    sendOverview(s);
    return true;
  }

  const sendOverview = (only?: AdminSocket) => {
    if (!sockets.size) return;
    const text = JSON.stringify({ t: 'overview', ...hooks.overview(), bans: bans.list() } satisfies AdminServerMessage), frame = textFrame(text);
    for (const s of only ? [only] : sockets) if (s.peer.backlog <= NET.backlog) s.peer.sendFrame(frame);
  };
  const timer = setInterval(() => sendOverview(), ADMIN.overviewMs); timer.unref();
  const keepAlive = setInterval(() => { for (const s of sockets) { if (!s.peer.alive) { s.peer.close(1001); continue; } s.peer.alive = false; s.peer.ping(); } }, options.pingMs ?? NET.ping * 1000);
  keepAlive.unref();

  return {
    enabled: Boolean(password), bans, handleHttp, handleUpgrade, log, sockets,
    close: () => { clearInterval(timer); clearInterval(keepAlive); for (const s of sockets) s.peer.close(1001); },
  };
}
