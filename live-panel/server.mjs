import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const API_ORIGIN = 'https://cerber.machinekind.ai';
const CAMERA_URL = `${API_ORIGIN}/video/normal_cam/whep`;
const EVENT_TYPES = new Set(['snapshot', 'status', 'imu', 'joints', 'odometry', 'ultrasound', 'gps', 'ptz', 'sensors_alive']);
const MAX_BODY = 65_536;
const MAX_RESPONSE = 131_072;
const MAX_BUFFER = 262_144;

export function cameraSessionUrl(location) {
  if (!location) throw new Error('Missing camera session');
  const url = new URL(location, CAMERA_URL);
  if (url.origin !== API_ORIGIN || url.username || url.password || url.search || url.hash ||
      !/^\/video\/normal_cam\/whep\/[a-zA-Z0-9_-]{8,128}$/.test(url.pathname)) {
    throw new Error('Unexpected camera session');
  }
  return url.href;
}

async function boundedText(stream, limit) {
  const chunks = [];
  let size = 0;
  if (!stream) return '';
  for await (const chunk of stream) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > limit) throw new Error('Body too large');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function createPanelServer({
  apiKey,
  htmlPath = new URL('./public/index.html', import.meta.url),
  html,
  fetchImpl = globalThis.fetch,
  WebSocketImpl = globalThis.WebSocket,
  orphanDelayMs = 15_000,
  retryDelayMs = 1_000,
  heartbeatMs = 5_000,
} = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim() || apiKey.length > 1024 || /[\r\n\0]/.test(apiKey)) {
    throw new Error('Set CERBER_API_KEY in .env before starting the panel.');
  }
  const page = html ?? await readFile(htmlPath, 'utf8');
  if (page.includes(apiKey)) throw new Error('Panel HTML must not contain the API key.');
  const clients = new Set();
  const sessions = new Map();
  const cache = new Map();
  const counts = Object.create(null);
  const pending = new Set();
  let ws, retryTimer, orphanTimer, heartbeatTimer;
  let stopping = false, lastFrame = 0, openedAt = 0, retry = retryDelayMs, pendingCameras = 0;
  let upstreamState = 'connecting';

  const connected = () => ws?.readyState === 1;
  const reply = (res, status, body = '', type = 'text/plain; charset=utf-8', headers = {}) => {
    if (res.destroyed) return;
    res.writeHead(status, {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      ...headers,
    });
    res.end(body);
  };
  function writeEvent(res, frame) {
    if (res.destroyed || res.writableLength + Buffer.byteLength(frame) > MAX_BUFFER) {
      clients.delete(res);
      res.destroy();
      scheduleOrphanCleanup();
      return;
    }
    res.write(frame);
  }
  function broadcast(data, event) {
    const frame = `${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(data)}\n\n`;
    for (const client of clients) writeEvent(client, frame);
  }
  function tracked(promise) {
    pending.add(promise);
    promise.finally(() => pending.delete(promise)).catch(() => {});
    return promise;
  }
  async function deleteRemote(url) {
    try {
      const response = await fetchImpl(url, {
        method: 'DELETE', redirect: 'error', headers: { 'X-API-Key': apiKey },
        signal: AbortSignal.timeout(6_000),
      });
      await response.body?.cancel();
    } catch { /* A disconnected media server will expire the WebRTC session. */ }
  }
  function releaseSession(id) {
    const session = sessions.get(id);
    sessions.delete(id);
    return session ? tracked(deleteRemote(session.url)) : Promise.resolve();
  }
  function scheduleOrphanCleanup() {
    if (clients.size || orphanTimer || stopping || !sessions.size) return;
    orphanTimer = setTimeout(() => {
      orphanTimer = undefined;
      if (!clients.size) for (const id of sessions.keys()) void releaseSession(id);
    }, orphanDelayMs);
    orphanTimer.unref();
  }
  function connectUpstream() {
    if (stopping) return;
    upstreamState = 'connecting';
    openedAt = Date.now();
    lastFrame = 0;
    try {
      ws = new WebSocketImpl(`${API_ORIGIN.replace('https:', 'wss:')}/api/v1/robots/cerber-lite3-01/telemetry/stream?api_key=${encodeURIComponent(apiKey)}`);
    } catch {
      scheduleReconnect();
      return;
    }
    const socket = ws;
    socket.onopen = () => {
      if (socket !== ws || stopping) return;
      retry = retryDelayMs;
      upstreamState = 'connected';
      broadcast({ connected: true }, 'connection');
    };
    socket.onmessage = ({ data }) => {
      if (socket !== ws || stopping || typeof data !== 'string' || Buffer.byteLength(data) > MAX_BUFFER || data.includes(apiKey)) return;
      try {
        const message = JSON.parse(data);
        const type = message?.event?.type;
        if (!EVENT_TYPES.has(type)) return;
        lastFrame = Date.now();
        counts[type] = (counts[type] || 0) + 1;
        if (type === 'snapshot') cache.clear();
        cache.set(type, message);
        broadcast(message);
      } catch { /* Ignore malformed upstream frames without logging their contents. */ }
    };
    socket.onerror = () => {}; // Error events may contain the authenticated upstream URL.
    socket.onclose = ({ code }) => {
      if (socket !== ws) return;
      upstreamState = [4401, 4404].includes(code) ? 'authorization_failed' : 'disconnected';
      broadcast({ connected: false, state: upstreamState }, 'connection');
      if (!stopping && upstreamState !== 'authorization_failed') scheduleReconnect();
    };
  }
  function scheduleReconnect() {
    upstreamState = 'disconnected';
    clearTimeout(retryTimer);
    retryTimer = setTimeout(connectUpstream, retry);
    retryTimer.unref();
    retry = Math.min(retry * 2, 15_000);
  }

  async function handle(req, res) {
    const host = `127.0.0.1:${server.address()?.port}`;
    if (req.headers.host !== host || (req.headers.origin && req.headers.origin !== `http://${host}`) || req.headers['sec-fetch-site'] === 'cross-site') {
      return reply(res, 403, 'Local requests only');
    }
    if (stopping) return reply(res, 503, 'Panel is stopping');
    if (req.method === 'GET' && req.url === '/') return reply(res, 200, page, 'text/html; charset=utf-8');
    if (req.method === 'GET' && req.url === '/health-local') {
      return reply(res, 200, JSON.stringify({
        connected: connected(), state: upstreamState,
        lastFrameAgeMs: lastFrame ? Date.now() - lastFrame : null,
        events: counts, viewers: clients.size,
      }), 'application/json');
    }
    if (req.method === 'GET' && req.url === '/events') {
      if (clients.size >= 8) return reply(res, 503, 'Too many viewers');
      clearTimeout(orphanTimer);
      orphanTimer = undefined;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store',
        Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
      });
      clients.add(res);
      writeEvent(res, `event: connection\ndata: ${JSON.stringify({ connected: connected(), state: upstreamState })}\n\n`);
      for (const message of cache.values()) writeEvent(res, `data: ${JSON.stringify(message)}\n\n`);
      res.on('close', () => { clients.delete(res); scheduleOrphanCleanup(); });
      return;
    }
    if (req.method === 'POST' && req.url === '/whep') {
      if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/sdp') return reply(res, 415, 'Expected SDP');
      if (sessions.size + pendingCameras >= 8) return reply(res, 503, 'Too many camera sessions');
      if (Number(req.headers['content-length']) > MAX_BODY) return reply(res, 413, 'Offer too large', undefined, { Connection: 'close' });
      pendingCameras++;
      let remoteUrl, retained = false;
      try {
        let body = '', size = 0;
        for await (const chunk of req.iterator({ destroyOnReturn: false })) {
          size += chunk.length;
          if (size > MAX_BODY) {
            req.resume();
            return reply(res, 413, 'Offer too large', undefined, { Connection: 'close' });
          }
          body += chunk.toString('utf8');
        }
        const remote = await fetchImpl(CAMERA_URL, {
          method: 'POST', redirect: 'error',
          headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/sdp' },
          body, signal: AbortSignal.timeout(12_000),
        });
        if (remote.status !== 201) {
          await remote.body?.cancel();
          return reply(res, 502, 'Camera receiver unavailable');
        }
        remoteUrl = cameraSessionUrl(remote.headers.get('Location'));
        const answer = await boundedText(remote.body, MAX_RESPONSE);
        if (!answer.startsWith('v=0') || answer.includes(apiKey)) throw new Error('Invalid camera answer');
        if (stopping || res.destroyed) return;
        const id = randomBytes(24).toString('base64url');
        sessions.set(id, { url: remoteUrl, expiresAt: Date.now() + 86_400_000 });
        retained = true;
        scheduleOrphanCleanup();
        reply(res, 201, answer, 'application/sdp', { Location: `/session/${id}` });
      } catch {
        reply(res, 502, 'Camera receiver unavailable');
      } finally {
        pendingCameras--;
        if (remoteUrl && !retained) await deleteRemote(remoteUrl);
      }
      return;
    }
    if (req.method === 'DELETE' && /^\/session\/[a-zA-Z0-9_-]{32}$/.test(req.url ?? '')) {
      await releaseSession(req.url.slice('/session/'.length));
      return reply(res, 204);
    }
    reply(res, 404, 'Not found');
  }
  const server = http.createServer((req, res) => {
    tracked(handle(req, res)).catch(() => reply(res, 500, 'Local panel error'));
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.maxConnections = 32;

  return {
    server,
    async listen(port = 8765) {
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid panel port');
      await new Promise((resolveListen, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolveListen(); });
      });
      connectUpstream();
      heartbeatTimer = setInterval(() => {
        for (const client of clients) writeEvent(client, ': heartbeat\n\n');
        if ((connected() || ws?.readyState === 0) && Date.now() - (lastFrame || openedAt) > 18_000) ws.close();
        for (const [id, session] of sessions) if (Date.now() >= session.expiresAt) void releaseSession(id);
      }, heartbeatMs);
      heartbeatTimer.unref();
      return `http://127.0.0.1:${server.address().port}/`;
    },
    async close() {
      if (stopping) return;
      stopping = true;
      clearTimeout(retryTimer);
      clearTimeout(orphanTimer);
      clearInterval(heartbeatTimer);
      ws?.close();
      for (const client of clients) client.end();
      clients.clear();
      const closed = new Promise(resolveClose => server.close(resolveClose));
      server.closeAllConnections();
      for (const id of sessions.keys()) void releaseSession(id);
      await Promise.allSettled([...pending]);
      await closed;
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const port = Number(process.env.CERBER_PANEL_PORT || 8765);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid CERBER_PANEL_PORT');
    const panel = await createPanelServer({ apiKey: process.env.CERBER_API_KEY });
    console.log(`Cerber live panel: ${await panel.listen(port)}`);
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void panel.close(); });
  } catch {
    console.error('Cannot start panel. Check CERBER_API_KEY, CERBER_PANEL_PORT and that the port is available.');
    process.exitCode = 1;
  }
}
