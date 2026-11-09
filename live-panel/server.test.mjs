import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { cameraSessionUrl, createPanelServer, phoneFix } from './server.mjs';

const KEY = 'test-only-secret-that-must-stay-on-server';
// MediaMTX answers with a Location relative to the server root; the panel resolves it against the camera URL.
const SESSION_PATH = '/video/normal_cam/whep/12345678-abcd-1234-abcd-123456789012';
const SESSION = `https://cerber.machinekind.ai${SESSION_PATH}`;
const SDP = 'v=0\r\ns=test\r\n';

async function fixture(t, options = {}) {
  const sockets = [], requests = [];
  class FakeWebSocket {
    readyState = 0;
    constructor(url) { this.url = url; sockets.push(this); }
    open() { this.readyState = 1; this.onopen?.({}); }
    message(type, data) { this.onmessage?.({ data: JSON.stringify({ event: { type, data } }) }); }
    close(code = 1000) { this.readyState = 3; this.onclose?.({ code }); }
  }
  const panel = await createPanelServer({
    apiKey: KEY, html: '<!doctype html><title>Cerber test</title>',
    WebSocketImpl: FakeWebSocket,
    fetchImpl: async (url, init) => {
      requests.push({ url, ...init });
      return init.method === 'POST'
        ? new Response(SDP, { status: 201, headers: { Location: SESSION_PATH } })
        : new Response(null, { status: 204 });
    },
    ...options,
  });
  const base = await panel.listen(0);
  t.after(() => panel.close());
  return { panel, base, sockets, requests };
}

function request(base, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(new URL(path, base), { method, headers }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function events(base) {
  const controller = new AbortController();
  const response = await fetch(new URL('/events', base), { signal: controller.signal });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  let buffer = '';
  return {
    async next() {
      while (!buffer.includes('\n\n')) {
        const { done, value } = await reader.read();
        if (done) throw new Error('Event stream ended');
        buffer += Buffer.from(value).toString();
      }
      const end = buffer.indexOf('\n\n');
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      return frame;
    },
    close() { controller.abort(); return reader.cancel().catch(() => {}); },
  };
}

const postOffer = base => request(base, '/whep', { method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: SDP });

test('requires a key and refuses HTML containing it', async () => {
  await assert.rejects(createPanelServer({ html: 'hello' }), /CERBER_API_KEY/);
  await assert.rejects(createPanelServer({ apiKey: KEY, html: KEY }), /must not contain/);
});

test('loopback HTML and health do not disclose the key; foreign Host and Origin are rejected', async t => {
  const { base, panel } = await fixture(t);
  assert.equal(panel.server.address().address, '127.0.0.1');
  for (const path of ['/', '/health-local']) {
    const result = await request(base, path);
    assert.equal(result.status, 200);
    assert.ok(!JSON.stringify(result).includes(KEY));
    assert.equal(result.headers['cache-control'], 'no-store');
  }
  assert.equal((await request(base, '/', { headers: { Host: 'attacker.example' } })).status, 403);
  assert.equal((await request(base, '/', { headers: { Origin: 'https://attacker.example' } })).status, 403);
  assert.equal((await request(base, '/', { headers: { Origin: new URL(base).origin } })).status, 200);
  assert.equal((await request(base, '/', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
});

test('one upstream socket serves live SSE and replays snapshot plus the latest event per type', async t => {
  const { base, sockets } = await fixture(t);
  assert.equal(sockets.length, 1);
  assert.equal(new URL(sockets[0].url).origin, 'wss://cerber.machinekind.ai');
  assert.equal(new URL(sockets[0].url).searchParams.get('api_key'), KEY);
  sockets[0].open();
  sockets[0].message('snapshot', { imu: null });
  sockets[0].message('imu', { sample: 1 });
  sockets[0].message('imu', { sample: 2 });
  sockets[0].message('unexpected', { leak: KEY });
  const first = await events(base);
  t.after(() => first.close());
  assert.match(await first.next(), /event: connection\ndata: .*"connected":true/);
  assert.match(await first.next(), /"type":"snapshot"/);
  assert.match(await first.next(), /"sample":2/);
  sockets[0].message('joints', { angle: 0.5 });
  assert.match(await first.next(), /"type":"joints"/);
  sockets[0].message('gps_receiver', { fix: false, satellites: 3 });
  assert.match(await first.next(), /"type":"gps_receiver".*"satellites":3/);
  const second = await events(base);
  t.after(() => second.close());
  assert.match(await second.next(), /event: connection/);
  assert.match(await second.next(), /"type":"snapshot"/);
  assert.match(await second.next(), /"sample":2/);
  assert.match(await second.next(), /"type":"joints"/);
  assert.match(await second.next(), /"type":"gps_receiver"/);
  assert.equal(sockets.length, 1);
  const health = JSON.parse((await request(base, '/health-local')).body);
  assert.equal(health.viewers, 2);
  assert.equal(health.events.imu, 2);
  assert.ok(!('unexpected' in health.events));
});

test('reconnects after disconnect but stops retrying after authentication rejection', async t => {
  const { sockets, base } = await fixture(t, { retryDelayMs: 5 });
  sockets[0].open();
  sockets[0].close(1006);
  await delay(25);
  assert.equal(sockets.length, 2);
  sockets[1].close(4401);
  await delay(25);
  assert.equal(sockets.length, 2);
  assert.equal(JSON.parse((await request(base, '/health-local')).body).state, 'authorization_failed');
});

test('camera proxy authenticates only the fixed destination and hides remote session URLs', async t => {
  const { base, requests } = await fixture(t);
  const result = await postOffer(base);
  assert.equal(result.status, 201);
  assert.equal(result.body, SDP);
  assert.match(result.headers.location, /^\/session\/[A-Za-z0-9_-]{32}$/);
  assert.ok(!JSON.stringify(result).includes(KEY));
  assert.ok(!JSON.stringify(result).includes('cerber.machinekind.ai'));
  assert.equal(requests[0].url, 'https://cerber.machinekind.ai/video/normal_cam/whep');
  assert.equal(requests[0].headers['X-API-Key'], KEY);
  assert.equal(requests[0].redirect, 'error');
  assert.equal(requests[0].body, SDP);
  assert.equal((await request(base, result.headers.location, { method: 'DELETE' })).status, 204);
  assert.equal(requests[1].url, SESSION);
  assert.equal(requests[1].method, 'DELETE');
  assert.equal(requests[1].headers['X-API-Key'], KEY);
  assert.equal(requests[1].redirect, 'error');
  await request(base, result.headers.location, { method: 'DELETE' });
  assert.equal(requests.length, 2);
  assert.equal((await request(base, '/session/https://attacker.example', { method: 'DELETE' })).status, 404);
});

test('camera session validation rejects foreign origins, cameras, credentials and query strings', () => {
  assert.equal(cameraSessionUrl('/video/normal_cam/whep/12345678-abcd'), 'https://cerber.machinekind.ai/video/normal_cam/whep/12345678-abcd');
  const internal = 'http://mediamtx:8889/video/normal_cam/whep';
  assert.equal(cameraSessionUrl('/video/normal_cam/whep/12345678-abcd', internal), 'http://mediamtx:8889/video/normal_cam/whep/12345678-abcd');
  assert.throws(() => cameraSessionUrl(SESSION, internal));
  assert.throws(() => cameraSessionUrl('/video/normal_cam/whep/../12345678-abcd', internal));
  for (const location of [null, 'https://attacker.example/video/normal_cam/whep/12345678',
    'https://user:pass@cerber.machinekind.ai/video/normal_cam/whep/12345678',
    '/video/other_cam/whep/12345678', '/video/normal_cam/whep/12345678?key=secret',
    '/api/v1/robots/12345678', '/video/normal_cam/whep/12345678#fragment']) {
    assert.throws(() => cameraSessionUrl(location));
  }
});

test('refuses redirects, invalid session locations and reflected secrets without leaking response bodies', async t => {
  for (const response of [
    () => new Response(KEY, { status: 302, headers: { Location: 'https://attacker.example/' } }),
    () => new Response(SDP, { status: 201, headers: { Location: 'https://attacker.example/session/12345678' } }),
    () => new Response(`v=0\r\ns=${KEY}\r\n`, { status: 201, headers: { Location: SESSION } }),
  ]) {
    const calls = [];
    const { base } = await fixture(t, { fetchImpl: async (url, init) => {
      calls.push({ url, ...init });
      return init.method === 'DELETE' ? new Response(null, { status: 204 }) : response();
    } });
    const result = await postOffer(base);
    assert.equal(result.status, 502);
    assert.ok(!JSON.stringify(result).includes(KEY));
    assert.ok(calls.every(call => new URL(call.url).origin === 'https://cerber.machinekind.ai'));
    assert.ok(calls.every(call => call.redirect === 'error'));
  }
});

test('caps offer size and camera sessions before making upstream requests', async t => {
  const { base, requests } = await fixture(t);
  assert.equal((await request(base, '/whep', { method: 'POST', body: SDP })).status, 415);
  const large = await request(base, '/whep', { method: 'POST', headers: { 'Content-Type': 'application/sdp', 'Content-Length': '70000' }, body: 'x'.repeat(70000) });
  assert.equal(large.status, 413);
  assert.equal(requests.length, 0);
  for (let i = 0; i < 8; i++) assert.equal((await postOffer(base)).status, 201);
  assert.equal((await postOffer(base)).status, 503);
  assert.equal(requests.length, 8);
});

test('keeps video while SSE is connected, then removes orphan sessions and cleans up on shutdown', async t => {
  const { base, requests, panel } = await fixture(t, { orphanDelayMs: 20 });
  const stream = await events(base);
  await postOffer(base);
  await delay(40);
  assert.equal(requests.filter(call => call.method === 'DELETE').length, 0);
  await stream.close();
  await delay(60);
  assert.equal(requests.filter(call => call.method === 'DELETE').length, 1);
  await postOffer(base);
  await panel.close();
  assert.equal(requests.filter(call => call.method === 'DELETE').length, 2);
});

test('configured public hosts work behind a proxy; cross-site is allowed only for navigation', async t => {
  const { base, panel } = await fixture(t, { hosts: ['panel.example', 'panel.example:8443'], bind: '127.0.0.1' });
  assert.equal(panel.server.address().address, '127.0.0.1');
  const get = headers => request(base, '/', { headers });
  assert.equal((await get({})).status, 200, 'loopback host still works');
  assert.equal((await get({ Host: 'panel.example' })).status, 200);
  assert.equal((await get({ Host: 'panel.example:8443' })).status, 200);
  assert.equal((await get({ Host: 'panel.example', Origin: 'https://panel.example' })).status, 200);
  assert.equal((await get({ Host: 'panel.example', Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await get({ Host: 'other.example' })).status, 403);
  assert.equal((await get({ Host: 'localhost:' + panel.server.address().port })).status, 403);
  assert.equal((await get({ Host: 'panel.example', 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate' })).status, 200, 'a link from another site opens the page');
  assert.equal((await get({ Host: 'panel.example', 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'cors' })).status, 403);
  assert.equal((await request(base, '/events', { headers: { Host: 'panel.example', 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'cors' } })).status, 403);
  const sdp = { 'Content-Type': 'application/sdp' };
  assert.equal((await request(base, '/whep', { method: 'POST', headers: { Host: 'panel.example', 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', ...sdp }, body: SDP })).status, 403);
  assert.equal((await request(base, '/whep', { method: 'POST', headers: { Host: 'panel.example', Origin: 'https://panel.example', 'Sec-Fetch-Site': 'same-origin', ...sdp }, body: SDP })).status, 201);
});

test('uses the configured API and video origins for the configured robot', async t => {
  const { base, sockets, requests } = await fixture(t, { apiOrigin: 'http://gateway:8000', videoOrigin: 'http://mediamtx:8889', robotId: 'robot-2' });
  assert.equal(sockets[0].url, `ws://gateway:8000/api/v1/robots/robot-2/telemetry/stream?api_key=${encodeURIComponent(KEY)}`);
  const result = await postOffer(base);
  assert.equal(result.status, 201);
  assert.equal(requests[0].url, 'http://mediamtx:8889/video/normal_cam/whep');
  await request(base, result.headers.location, { method: 'DELETE' });
  assert.equal(requests[1].url, `http://mediamtx:8889${SESSION_PATH}`);
  for (const bad of [{ apiOrigin: 'ftp://x' }, { apiOrigin: 'https://x/path' }, { videoOrigin: 'https://u:p@x' },
    { robotId: 'a/b' }, { hosts: ['bad host'] }, { hosts: 'panel.example' }, { maxViewers: 0 }, { maxViewers: 1.5 }]) {
    await assert.rejects(createPanelServer({ apiKey: KEY, html: 'x', WebSocketImpl: class {}, ...bad }), bad.toString());
  }
});

test('a session location on a foreign origin is refused even when it looks like the public host', async t => {
  const { base, requests } = await fixture(t, { videoOrigin: 'http://mediamtx:8889', fetchImpl: async (url, init) => {
    requests.push({ url, ...init });
    return init.method === 'DELETE' ? new Response(null, { status: 204 }) : new Response(SDP, { status: 201, headers: { Location: SESSION } });
  } });
  assert.equal((await postOffer(base)).status, 502);
  assert.ok(requests.every(call => new URL(call.url).origin === 'http://mediamtx:8889'));
});

test('recording endpoints drive the recorder and push state over SSE', async t => {
  const { mkdtemp, mkdir } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createRecorder } = await import('./recorder.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'cerber-panel-rec-'));
  await mkdir(join(dir, 'mtx', 'video', 'normal_cam'), { recursive: true });
  const recorder = createRecorder({
    dir, mediamtxApi: 'http://mediamtx:9997', pollMs: 30, finishWaitMs: 100,
    fetchImpl: async (url, init) => init.method === 'GET' ? Response.json({ ready: false }) : Response.json({}),
  });
  const { base, sockets } = await fixture(t, { recorder });
  const post = (path) => request(base, path, { method: 'POST' });
  assert.equal((await post('/recordings')).status, 503, 'no upstream yet');
  sockets[0].open();
  sockets[0].message('snapshot', { imu: null });
  const stream = await events(base);
  t.after(() => stream.close());
  await stream.next(); await stream.next();
  assert.match(await stream.next(), /event: recording\ndata: .*"active":null/);
  const started = await post('/recordings');
  assert.equal(started.status, 201);
  const { id } = JSON.parse(started.body);
  assert.equal((await post('/recordings')).status, 409);
  assert.match(await stream.next(), new RegExp(`event: recording\\ndata: .*"active":\\{"id":"${id}"`));
  sockets[0].message('imu', { sample: 1 });
  await stream.next();
  const health = JSON.parse((await request(base, '/health-local')).body);
  assert.equal(health.recording.id, id);
  const status = JSON.parse((await request(base, '/recordings')).body);
  assert.equal(status.active.id, id);
  assert.deepEqual(status.limits, recorder.limits);
  const stopped = await post('/recordings/stop');
  assert.equal(stopped.status, 200);
  assert.equal(JSON.parse(stopped.body).events, 2, 'snapshot seed + imu');
  assert.equal((await post('/recordings/stop')).status, 409);
  assert.equal((await post(`/recordings/${id}/demo`)).status, 204);
  assert.equal((await request(base, `/recordings/${id}`, { method: 'DELETE' })).status, 409, 'demo source is protected');
  assert.deepEqual(JSON.parse((await request(base, '/recordings')).body).demo, [id]);
  assert.equal((await request(base, `/recordings/${id}/demo`, { method: 'DELETE' })).status, 204);
  assert.deepEqual(JSON.parse((await request(base, '/recordings')).body).demo, []);
  assert.equal((await post(`/recordings/${id}/demo`)).status, 204);
  assert.equal((await request(base, '/recordings/demo', { method: 'DELETE' })).status, 204);
  // pobieranie: telemetria (2 koperty) i meta, wideo 404 (kamera nie nadawala), trwajace i obce nazwy 404
  const telemetry = await request(base, `/recordings/${id}/telemetry.ndjson`);
  assert.equal(telemetry.status, 200);
  assert.equal(telemetry.headers['content-type'], 'application/x-ndjson');
  assert.equal(telemetry.headers['content-disposition'], `attachment; filename="${id}-telemetry.ndjson"`);
  assert.equal(Number(telemetry.headers['content-length']), Buffer.byteLength(telemetry.body));
  assert.equal(telemetry.body.trim().split('\n').length, 2);
  const meta = await request(base, `/recordings/${id}/meta.json`);
  assert.equal(meta.status, 200);
  assert.equal(JSON.parse(meta.body).id, id);
  assert.equal((await request(base, `/recordings/${id}/video.mp4`)).status, 404);
  assert.equal((await request(base, `/recordings/${id}/secret.txt`)).status, 404);
  assert.equal((await request(base, '/recordings/2000-01-01T00-00-00Z/meta.json')).status, 404);
  assert.equal((await request(base, `/recordings/${id}`, { method: 'DELETE' })).status, 204);
  assert.equal((await post('/recordings/2000-01-01T00-00-00Z/demo')).status, 404);
  assert.equal((await post('/recordings/../etc/demo')).status, 404);
  assert.deepEqual(JSON.parse((await request(base, '/recordings')).body).recordings, []);
});

test('recording endpoints are absent without a recorder', async t => {
  const { base } = await fixture(t);
  assert.equal((await request(base, '/recordings')).status, 404);
  assert.equal((await request(base, '/recordings', { method: 'POST' })).status, 404);
});

const PHONE = { latitude: 52.3123456, longitude: 21.0123456, accuracy_m: 7.5, altitude: 91.2, time: '2026-11-05T10:30:00.123Z' };
const postPhone = (base, body, headers = { 'Content-Type': 'application/json' }) =>
  request(base, '/gps/phone', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('phone position is validated and forwarded to the gateway with the key', async t => {
  const calls = [];
  const { base } = await fixture(t, {
    fetchImpl: async (url, init) => {
      calls.push({ url, ...init });
      return new Response(JSON.stringify({ ...PHONE, source: 'phone' }), { status: 202, headers: { 'Content-Type': 'application/json' } });
    },
  });
  const ok = await postPhone(base, PHONE);
  assert.equal(ok.status, 202);
  assert.equal(JSON.parse(ok.body).source, 'phone');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://cerber.machinekind.ai/api/v1/robots/cerber-lite3-01/gps');
  assert.equal(calls[0].headers['X-API-Key'], KEY);
  assert.deepEqual(JSON.parse(calls[0].body), PHONE);
  assert.equal((await postPhone(base, { latitude: 91, longitude: 0, accuracy_m: 1 })).status, 422);
  assert.equal((await postPhone(base, 'not json')).status, 400);
  assert.equal((await postPhone(base, PHONE, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await postPhone(base, { ...PHONE, pad: 'x'.repeat(5000) })).status, 413);
  assert.equal(calls.length, 1); // nothing invalid reached the gateway
});

test('phone position maps gateway failures without leaking the key', async t => {
  let status = 503;
  const { base } = await fixture(t, { fetchImpl: async () => new Response(`{"detail":"${KEY}"}`, { status }) });
  assert.equal((await postPhone(base, PHONE)).status, 502); // reflected secret is never passed through
  status = 503;
  const { base: base2 } = await fixture(t, { fetchImpl: async () => new Response('{"detail":"MQTT broker not connected"}', { status }) });
  const down = await postPhone(base2, PHONE);
  assert.equal(down.status, 503);
  assert.ok(!down.body.includes(KEY));
  status = 500;
  assert.equal((await postPhone(base2, PHONE)).status, 502);
});

test('phoneFix keeps only a well-formed position', () => {
  assert.deepEqual(phoneFix({ latitude: 1, longitude: 2, accuracy_m: 3 }), { latitude: 1, longitude: 2, accuracy_m: 3 });
  assert.deepEqual(phoneFix({ latitude: 1, longitude: 2, accuracy_m: 3, altitude: null, time: 'yesterday', extra: 1 }),
    { latitude: 1, longitude: 2, accuracy_m: 3 });
  assert.deepEqual(phoneFix(PHONE), PHONE);
  for (const bad of [null, [], 'x', { latitude: '1', longitude: 2, accuracy_m: 3 }, { latitude: 1, longitude: 2 },
    { latitude: 1, longitude: 2, accuracy_m: -1 }, { latitude: NaN, longitude: 2, accuracy_m: 3 }]) {
    assert.equal(phoneFix(bad), null);
  }
});
