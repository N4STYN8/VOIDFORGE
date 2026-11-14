import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

/**
 * Minimal RFC 6455 WebSocket server side: handshake, masked client text frames, ping/pong and close.
 * Fragmented and binary messages are refused; the relay only speaks small JSON text frames.
 * Hand-written to keep the relay free of npm dependencies.
 */
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export function acceptKey(key: string) { return createHash('sha1').update(key + GUID).digest('base64'); }

/** Completes the upgrade, or writes an HTTP error and returns undefined. */
export function upgrade(request: IncomingMessage, socket: Duplex, maxMessage: number, allowOrigin: (origin: string | undefined) => boolean): WebSocketPeer | undefined {
  const key = request.headers['sec-websocket-key'];
  const fail = (status: string) => { socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); return undefined; };
  if (String(request.headers.upgrade).toLowerCase() !== 'websocket' || typeof key !== 'string' || request.headers['sec-websocket-version'] !== '13') return fail('400 Bad Request');
  if (!allowOrigin(request.headers.origin)) return fail('403 Forbidden');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`);
  return new WebSocketPeer(socket, maxMessage);
}

/** A complete unmasked server text frame. */
export function textFrame(text: string) {
  const payload = Buffer.from(text, 'utf8'), length = payload.length;
  let header: Buffer;
  if (length < 126) header = Buffer.from([0x81, length]);
  else if (length < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(length, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(length), 2); }
  return Buffer.concat([header, payload]);
}
export class WebSocketPeer {
  onmessage: (text: string) => void = () => {};
  onclose: () => void = () => {};
  closed = false;
  /** Set when a pong (or any frame) arrives; the keep-alive timer clears it before each ping. */
  alive = true;
  /** Keep-alive round trip in milliseconds, measured from the last ping to its pong. */
  rtt?: number;
  private pingSent = 0;
  private buffer = Buffer.alloc(0);
  private socket: Duplex;
  private maxMessage: number;
  constructor(socket: Duplex, maxMessage: number) {
    this.socket = socket; this.maxMessage = maxMessage;
    socket.on('data', chunk => this.receive(chunk as Buffer));
    socket.on('close', () => this.finish());
    socket.on('error', () => this.finish());
  }
  send(text: string) { this.sendFrame(textFrame(text)); }
  /** Sends a frame built once with `textFrame`, so a broadcast encodes its message a single time. */
  sendFrame(frame: Buffer) { if (!this.closed) this.socket.write(frame); }
  /** Bytes queued but not yet written to the network: a slow or stalled client shows up here. */
  get backlog() { return this.socket.writableLength ?? 0; }
  ping() { if (!this.closed) { this.pingSent = Date.now(); this.socket.write(this.header(0x9, 0)); } }
  close(code = 1000) {
    if (this.closed) return;
    const body = Buffer.alloc(2); body.writeUInt16BE(code);
    this.socket.write(Buffer.concat([this.header(0x8, 2), body]));
    this.socket.end(); this.finish();
  }
  private finish() { if (this.closed) return; this.closed = true; this.socket.destroy(); this.onclose(); }
  private header(opcode: number, length: number) {
    if (length < 126) return Buffer.from([0x80 | opcode, length]);
    if (length < 65536) { const h = Buffer.alloc(4); h[0] = 0x80 | opcode; h[1] = 126; h.writeUInt16BE(length, 2); return h; }
    const h = Buffer.alloc(10); h[0] = 0x80 | opcode; h[1] = 127; h.writeBigUInt64BE(BigInt(length), 2); return h;
  }
  private receive(chunk: Buffer) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    while (!this.closed && this.buffer.length >= 2) {
      const first = this.buffer[0], second = this.buffer[1], fin = (first & 0x80) !== 0, opcode = first & 0x0f, masked = (second & 0x80) !== 0;
      let length = second & 0x7f, offset = 2;
      if (length === 126) { if (this.buffer.length < 4) return; length = this.buffer.readUInt16BE(2); offset = 4; }
      else if (length === 127) { if (this.buffer.length < 10) return; const big = this.buffer.readBigUInt64BE(2); if (big > BigInt(this.maxMessage)) return this.close(1009); length = Number(big); offset = 10; }
      if (!masked) return this.close(1002);
      if (length > this.maxMessage) return this.close(1009);
      if (this.buffer.length < offset + 4 + length) return;
      const mask = this.buffer.subarray(offset, offset + 4), payload = Buffer.from(this.buffer.subarray(offset + 4, offset + 4 + length));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buffer = this.buffer.subarray(offset + 4 + length);
      this.alive = true;
      if (opcode === 0x8) return this.close(1000);
      if (opcode === 0x9) { this.socket.write(Buffer.concat([this.header(0xA, payload.length), payload])); continue; }
      if (opcode === 0xA) { if (this.pingSent) { this.rtt = Date.now() - this.pingSent; this.pingSent = 0; } continue; }
      if (opcode !== 0x1 || !fin) return this.close(1003);
      this.onmessage(payload.toString('utf8'));
    }
  }
}
