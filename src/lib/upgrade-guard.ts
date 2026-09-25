import http from 'node:http';
import https from 'node:https';
import type { Duplex } from 'node:stream';

/**
 * Refuse every HTTP protocol upgrade (WebSocket, h2c, …) at the Node server.
 *
 * The app exposes no WebSocket endpoints — real-time updates use Server-Sent
 * Events over plain HTTP. Next.js, however, silently ignores upgrade requests
 * it doesn't route: the socket is left open with no HTTP timeouts applying, so
 * a client can pin sockets/file descriptors indefinitely. Answering with a
 * `400` and closing immediately enforces the "no WebSocket" protocol contract
 * and removes that exhaustion vector.
 *
 * Installed in production only (the dev server needs upgrades for HMR).
 */
const INSTALLED = Symbol.for('nibtera.upgradeGuard');
const BODY = 'Protocol upgrade not supported';
const RESPONSE =
  'HTTP/1.1 400 Bad Request\r\n' +
  'Connection: close\r\n' +
  'Content-Type: text/plain; charset=utf-8\r\n' +
  `Content-Length: ${Buffer.byteLength(BODY)}\r\n` +
  'Cache-Control: no-store\r\n' +
  '\r\n' +
  BODY;

function reject(socket: Duplex) {
  socket.on('error', () => {});
  if (socket.writable) socket.end(RESPONSE);
  // Don't wait on a peer that never reads the response.
  setTimeout(() => socket.destroy(), 1000).unref();
}

function guard(proto: any) {
  if (proto[INSTALLED]) return;
  const emit = proto.emit;
  proto.emit = function (this: unknown, event: string | symbol, ...args: unknown[]) {
    if (event === 'upgrade') {
      reject(args[1] as Duplex);
      return true;
    }
    return emit.call(this, event, ...args);
  };
  proto[INSTALLED] = true;
}

export function installUpgradeGuard() {
  guard(http.Server.prototype);
  guard(https.Server.prototype);
}
