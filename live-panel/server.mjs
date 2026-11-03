import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createRecorder } from './recorder.mjs';

export const DEFAULT_API_ORIGIN = 'https://cerber.machinekind.ai';
export const DEFAULT_ROBOT_ID = 'cerber-lite3-01';
const CAMERA_PATH = '/video/normal_cam/whep';
const EVENT_TYPES = new Set(['snapshot', 'status', 'imu', 'joints', 'odometry', 'ultrasound', 'gps', 'ptz', 'sensors_alive']);
const MAX_BODY = 65_536;
const MAX_RESPONSE = 131_072;
const MAX_BUFFER = 262_144;

export function parseOrigin(value, name = 'origin') {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name} must be an http(s) origin`); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error(`${name} must be an http(s) origin without path, credentials or query`);
  }
  return url.origin;
}

export function cameraSessionUrl(location, cameraUrl = `${DEFAULT_API_ORIGIN}${CAMERA_PATH}`) {
  if (!location) throw new Error('Missing camera session');
  const base = new URL(cameraUrl);
  const url = new URL(location, cameraUrl);
  const rest = url.pathname.startsWith(`${base.pathname}/`) ? url.pathname.slice(base.pathname.length + 1) : '';
  if (url.origin !== base.origin || url.username || url.password || url.search || url.hash || !/^[a-zA-Z0-9_-]{8,128}$/.test(rest)) {
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
  apiOrigin = DEFAULT_API_ORIGIN,
  videoOrigin = apiOrigin,
  robotId = DEFAULT_ROBOT_ID,
  hosts = [],
  bind = hosts.length ? '0.0.0.0' : '127.0.0.1',
  maxViewers = 8,
  recorder = null,
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
  apiOrigin = parseOrigin(apiOrigin, 'CERBER_API_ORIGIN');
  videoOrigin = parseOrigin(videoOrigin, 'CERBER_VIDEO_ORIGIN');
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(robotId)) throw new Error('CERBER_ROBOT_ID must be a plain identifier');
  if (!Array.isArray(hosts) || hosts.some(h => !/^[a-z0-9.-]+(:\d{1,5})?$/i.test(h))) {
    throw new Error('CERBER_PANEL_HOSTS must be a comma-separated list of host[:port] names');
  }
  if (!Number.isInteger(maxViewers) || maxViewers < 1 || maxViewers > 64) throw new Error('CERBER_PANEL_MAX_VIEWERS must be 1-64');
  const cameraUrl = `${videoOrigin}${CAMERA_PATH}`;
  const streamUrl = `${apiOrigin.replace(/^http/, 'ws')}/api/v1/robots/${robotId}/telemetry/stream?api_key=${encodeURIComponent(apiKey)}`;
  const page = html ?? await readFile(htmlPath, 'utf8');
  if (page.includes(apiKey)) throw new Error('Panel HTML must not contain the API key.');
  const clients = new Set();
  const sessions = new Map();
  const cache = new Map();
  const counts = Object.create(null);
  const pending = new Set();
  const allowedHosts = new Set(hosts);
  const allowedOrigins = new Set(hosts.flatMap(h => [`https://${h}`, `http://${h}`]));
  let ws, retryTimer, orphanTimer, heartbeatTimer;
  let stopping = false, lastFrame = 0, openedAt = 0, retry = retryDelayMs, pendingCameras = 0;
  let upstreamState = 'connecting';
  let recordingBroadcast = null;

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
      ws = new WebSocketImpl(streamUrl);
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
        recorder?.record(message);
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
  function broadcastRecording() {
    // Stan nagrywania do wszystkich kart; jedno odswiezenie na zmiane, nawet gdy zmian jest kilka naraz.
    if (!recorder || recordingBroadcast) return;
    recordingBroadcast = tracked((async () => {
      try { broadcast(await recorder.status(), 'recording'); } catch { /* lista nagran chwilowo nieczytelna */ }
      recordingBroadcast = null;
    })());
  }
  if (recorder) recorder.onChange = broadcastRecording;
  function scheduleReconnect() {
    upstreamState = 'disconnected';
    clearTimeout(retryTimer);
    retryTimer = setTimeout(connectUpstream, retry);
    retryTimer.unref();
    retry = Math.min(retry * 2, 15_000);
  }

  function localRequest(req) {
    // Loopback always works for the operator and container health checks; configured public hosts work behind a
    // reverse proxy that passes the browser's Host header through (Caddy does). Anything else is refused.
    const localHost = `127.0.0.1:${server.address()?.port}`;
    const host = req.headers.host ?? '';
    if (host !== localHost && !allowedHosts.has(host)) return false;
    const origin = req.headers.origin;
    if (origin && origin !== `http://${localHost}` && !allowedOrigins.has(origin)) return false;
    // A link from another site is a cross-site top-level navigation and must open the page; every other
    // cross-site request (a form, fetch or EventSource from a foreign page) is refused.
    if (req.headers['sec-fetch-site'] === 'cross-site' && !(req.method === 'GET' && req.headers['sec-fetch-mode'] === 'navigate')) return false;
    return true;
  }

  async function handle(req, res) {
    if (!localRequest(req)) return reply(res, 403, 'Local requests only');
    if (stopping) return reply(res, 503, 'Panel is stopping');
    if (req.method === 'GET' && req.url === '/') return reply(res, 200, page, 'text/html; charset=utf-8');
    if (req.method === 'GET' && req.url === '/health-local') {
      return reply(res, 200, JSON.stringify({
        connected: connected(), state: upstreamState,
        lastFrameAgeMs: lastFrame ? Date.now() - lastFrame : null,
        events: counts, viewers: clients.size, recording: recorder?.active ?? null,
      }), 'application/json');
    }
    if (req.url === '/recordings' || req.url?.startsWith('/recordings/')) return handleRecordings(req, res);
    if (req.method === 'GET' && req.url === '/events') {
      if (clients.size >= maxViewers) return reply(res, 503, 'Too many viewers');
      clearTimeout(orphanTimer);
      orphanTimer = undefined;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store',
        Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
      });
      clients.add(res);
      writeEvent(res, `event: connection\ndata: ${JSON.stringify({ connected: connected(), state: upstreamState })}\n\n`);
      for (const message of cache.values()) writeEvent(res, `data: ${JSON.stringify(message)}\n\n`);
      if (recorder) broadcastRecording();
      res.on('close', () => { clients.delete(res); scheduleOrphanCleanup(); });
      return;
    }
    if (req.method === 'POST' && req.url === '/whep') {
      if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/sdp') return reply(res, 415, 'Expected SDP');
      if (sessions.size + pendingCameras >= maxViewers) return reply(res, 503, 'Too many camera sessions');
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
        const remote = await fetchImpl(cameraUrl, {
          method: 'POST', redirect: 'error',
          headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/sdp' },
          body, signal: AbortSignal.timeout(12_000),
        });
        if (remote.status !== 201) {
          await remote.body?.cancel();
          return reply(res, 502, 'Camera receiver unavailable');
        }
        remoteUrl = cameraSessionUrl(remote.headers.get('Location'), cameraUrl);
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
  const json = (res, status, data) => reply(res, status, JSON.stringify(data), 'application/json');
  async function handleRecordings(req, res) {
    if (!recorder) return reply(res, 404, 'Recording is not configured');
    const { method, url } = req;
    try {
      if (method === 'GET' && url === '/recordings') return json(res, 200, await recorder.status());
      if (method === 'POST' && url === '/recordings') {
        if (!connected()) return reply(res, 503, 'Telemetry upstream is not connected');
        return json(res, 201, await recorder.start([...cache.values()]));
      }
      if (method === 'POST' && url === '/recordings/stop') return json(res, 200, await recorder.stop('user'));
      if (method === 'DELETE' && url === '/recordings/demo') { await recorder.setDemo(null); return reply(res, 204); }
      const demo = /^\/recordings\/([A-Za-z0-9-]{20})\/demo$/.exec(url ?? '');
      if (method === 'POST' && demo) { await recorder.setDemo(demo[1]); return reply(res, 204); }
      const one = /^\/recordings\/([A-Za-z0-9-]{20})$/.exec(url ?? '');
      if (method === 'DELETE' && one) { await recorder.remove(one[1]); return reply(res, 204); }
      return reply(res, 404, 'Not found');
    } catch (error) {
      const status = Number.isInteger(error?.code) ? error.code : 500;
      return reply(res, status, status === 500 ? 'Recorder error' : error.message);
    }
  }
  const server = http.createServer((req, res) => {
    tracked(handle(req, res)).catch(() => reply(res, 500, 'Local panel error'));
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.maxConnections = 4 * maxViewers;

  return {
    server,
    async listen(port = 8765) {
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid panel port');
      await new Promise((resolveListen, reject) => {
        server.once('error', reject);
        server.listen(port, bind, () => { server.off('error', reject); resolveListen(); });
      });
      if (recorder) await recorder.recover();
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
      if (recorder) await recorder.close().catch(() => {});
      await Promise.allSettled([...pending]);
      await closed;
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const env = process.env;
  const optional = (value) => (value?.trim() ? value.trim() : undefined);
  try {
    const port = Number(env.CERBER_PANEL_PORT || 8765);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid CERBER_PANEL_PORT');
    const maxViewers = optional(env.CERBER_PANEL_MAX_VIEWERS);
    const integer = (name) => {
      const value = optional(env[name]);
      if (value === undefined) return undefined;
      if (!/^\d+$/.test(value)) throw new Error(`${name} must be an integer`);
      return Number(value);
    };
    // Nagrywanie tylko z CERBER_RECORDINGS_DIR (na serwerze, wspolny wolumen z MediaMTX i gatewayem).
    const recorder = optional(env.CERBER_RECORDINGS_DIR) ? createRecorder({
      dir: env.CERBER_RECORDINGS_DIR.trim(),
      mediamtxApi: optional(env.CERBER_MEDIAMTX_API) ?? 'http://mediamtx:9997',
      mediamtxUser: optional(env.CERBER_MEDIAMTX_USER) ?? '',
      mediamtxPass: optional(env.CERBER_MEDIAMTX_PASS) ?? '',
      maxSeconds: integer('CERBER_RECORD_MAX_SECONDS'),
      maxBytes: integer('CERBER_RECORD_MAX_BYTES'),
      keep: integer('CERBER_RECORD_KEEP'),
      totalBytes: integer('CERBER_RECORD_TOTAL_BYTES'),
      log: (line) => console.log(`[recorder] ${line}`),
    }) : null;
    const panel = await createPanelServer({
      recorder,
      apiKey: env.CERBER_API_KEY,
      apiOrigin: optional(env.CERBER_API_ORIGIN),
      videoOrigin: optional(env.CERBER_VIDEO_ORIGIN),
      robotId: optional(env.CERBER_ROBOT_ID),
      hosts: (env.CERBER_PANEL_HOSTS || '').split(',').map(h => h.trim()).filter(Boolean),
      bind: optional(env.CERBER_PANEL_BIND),
      maxViewers: maxViewers === undefined ? undefined : Number(maxViewers),
    });
    console.log(`Cerber live panel: ${await panel.listen(port)}`);
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void panel.close(); });
  } catch (error) {
    // Configuration errors name the variable; they never contain the key itself.
    console.error(`Cannot start panel: ${error?.message ?? error}`);
    process.exitCode = 1;
  }
}
