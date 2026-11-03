import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { cameraSessionUrl, createPanelServer } from './server.mjs';

const KEY = 'test-only-secret-that-must-stay-on-server';
const SESSION = 'https://cerber.machinekind.ai/video/normal_cam/whep/12345678-abcd-1234-abcd-123456789012';
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
        ? new Response(SDP, { status: 201, headers: { Location: SESSION } })
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
  const second = await events(base);
  t.after(() => second.close());
  assert.match(await second.next(), /event: connection/);
  assert.match(await second.next(), /"type":"snapshot"/);
  assert.match(await second.next(), /"sample":2/);
  assert.match(await second.next(), /"type":"joints"/);
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
