import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, appendFile, stat, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createRecorder, recordingId } from './recorder.mjs';

const CAMERA = 'video/normal_cam';
const envelope = (type, n) => ({ event: { type, robot_id: 'r1', ts: 1000 + n, data: { n } } });

async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'cerber-rec-'));
  const mtxDir = join(dir, 'mtx', CAMERA);
  await mkdir(mtxDir, { recursive: true });
  const calls = [];
  const changes = [];
  const recorder = createRecorder({
    dir, mediamtxApi: 'http://mediamtx:9997', mediamtxUser: 'panel', mediamtxPass: 'secret-api-pass',
    pollMs: 30, finishWaitMs: 300, keep: 20,
    fetchImpl: async (url, init) => {
      calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null, auth: init.headers.Authorization });
      if (init.method === 'GET') return Response.json({ ready: true });
      return Response.json({});
    },
    onChange: () => changes.push(Date.now()),
    ...options,
  });
  t.after(() => recorder.close());
  // MediaMTX pisze plik w swoim katalogu, dopoki record jest wlaczony
  const mtxWrite = async (name, bytes) => appendFile(join(mtxDir, name), Buffer.alloc(bytes, 1));
  return { dir, recorder, calls, changes, mtxWrite, mtxDir };
}

test('recording id is a filesystem-safe UTC stamp', () => {
  assert.equal(recordingId(new Date('2026-11-03T10:05:07.123Z')), '2026-11-03T10-05-07Z');
});

test('start toggles MediaMTX record with basic auth, stop moves the finished file and writes meta', async t => {
  const { dir, recorder, calls, mtxWrite, mtxDir } = await fixture(t);
  const info = await recorder.start([envelope('snapshot', 0), envelope('imu', 1)]);
  assert.match(info.id, /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/);
  assert.equal(info.video, true, 'publisher ready -> video expected');
  assert.deepEqual(calls.map(c => [c.method, c.url, c.body]), [
    ['GET', `http://mediamtx:9997/v3/paths/get/${CAMERA}`, null],
    ['PATCH', `http://mediamtx:9997/v3/config/paths/patch/${CAMERA}`, { record: true }],
  ]);
  assert.equal(calls[1].auth, `Basic ${Buffer.from('panel:secret-api-pass').toString('base64')}`);
  recorder.record(envelope('joints', 2));
  await mtxWrite('2026-11-03_10-05-07-000000.mp4', 1000);
  await delay(80);
  assert.equal(recorder.active.videoBytes, 1000);
  assert.equal(recorder.active.events, 3);
  await mtxWrite('2026-11-03_10-05-07-000000.mp4', 500);
  const meta = await recorder.stop('user');
  assert.equal(meta.stoppedBy, 'user');
  assert.equal(meta.videoBytes, 1500);
  assert.equal(meta.events, 3);
  assert.equal(meta.video, 'video.mp4');
  assert.deepEqual(calls.at(-1).body, { record: false });
  assert.equal((await stat(join(dir, meta.id, 'video.mp4'))).size, 1500);
  assert.deepEqual(await readdir(mtxDir), [], 'file moved out of the MediaMTX directory');
  const lines = (await readFile(join(dir, meta.id, 'telemetry.ndjson'), 'utf8')).trim().split('\n').map(l => JSON.parse(l).event.type);
  assert.deepEqual(lines, ['snapshot', 'imu', 'joints']);
  const saved = JSON.parse(await readFile(join(dir, meta.id, 'meta.json'), 'utf8'));
  assert.equal(saved.active, undefined);
  assert.equal(saved.telemetryBytes, meta.telemetryBytes);
  assert.equal(recorder.active, null);
  assert.equal((await recorder.status()).recordings[0].id, meta.id);
});

test('second start is refused while active; stop without recording is refused', async t => {
  const { recorder } = await fixture(t);
  await assert.rejects(recorder.stop(), { code: 409 });
  await recorder.start();
  await assert.rejects(recorder.start(), { code: 409 });
  await recorder.stop();
});

test('MediaMTX failure at start leaves nothing behind', async t => {
  const { dir, recorder } = await fixture(t, { fetchImpl: async () => new Response('nope', { status: 500 }) });
  await assert.rejects(recorder.start(), { code: 502 });
  assert.deepEqual((await readdir(dir)).filter(n => n !== 'mtx'), []);
});

test('size and time limits stop the recording on their own', async t => {
  const small = await fixture(t, { maxBytes: 200 });
  await small.recorder.start();
  for (let i = 0; i < 10; i++) small.recorder.record(envelope('imu', i));
  await delay(400);
  const [meta] = await small.recorder.list();
  assert.equal(meta.stoppedBy, 'size');
  assert.equal(small.recorder.active, null);

  const short = await fixture(t, { maxSeconds: 1 });
  await short.recorder.start();
  await delay(1_500);
  assert.equal(short.recorder.active, null);
  assert.equal((await short.recorder.list())[0].stoppedBy, 'time');
});

test('demo selection writes pointer files for MediaMTX and the gateway, and protects the recording', async t => {
  const { dir, recorder, mtxWrite } = await fixture(t);
  await recorder.start();
  await mtxWrite('a.mp4', 10);
  const meta = await recorder.stop();
  await recorder.setDemo(meta.id);
  assert.equal((await readFile(join(dir, 'demo', 'normal_cam.path'), 'utf8')).trim(), join(dir, meta.id, 'video.mp4'));
  assert.equal((await readFile(join(dir, 'demo', 'telemetry.path'), 'utf8')).trim(), join(dir, meta.id, 'telemetry.ndjson'));
  assert.equal((await recorder.status()).demo, meta.id);
  assert.equal((await recorder.list())[0].demo, true);
  await assert.rejects(recorder.remove(meta.id), { code: 409 });
  await assert.rejects(recorder.setDemo('2000-01-01T00-00-00Z'), { code: 404 });
  await assert.rejects(recorder.setDemo('../etc'), { code: 404 });
  await recorder.setDemo(null);
  assert.equal((await readFile(join(dir, 'demo', 'telemetry.path'), 'utf8')), '');
  await recorder.remove(meta.id);
  assert.deepEqual(await recorder.list(), []);
});

test('a recording without video selects telemetry only', async t => {
  const { dir, recorder } = await fixture(t, { fetchImpl: async (url, init) => init.method === 'GET' ? Response.json({ ready: false }) : Response.json({}) });
  const info = await recorder.start();
  assert.equal(info.video, false);
  const meta = await recorder.stop();
  assert.equal(meta.video, null);
  await recorder.setDemo(meta.id);
  assert.equal(await readFile(join(dir, 'demo', 'normal_cam.path'), 'utf8'), '');
  assert.match(await readFile(join(dir, 'demo', 'telemetry.path'), 'utf8'), /telemetry\.ndjson/);
});

test('rotation removes the oldest recordings beyond count or total size, never the demo one', async t => {
  const { dir, recorder } = await fixture(t, { keep: 2, totalBytes: 5000 });
  const ids = ['2026-01-01T00-00-00Z', '2026-01-02T00-00-00Z', '2026-01-03T00-00-00Z', '2026-01-04T00-00-00Z'];
  for (const id of ids) {
    await mkdir(join(dir, id));
    await writeFile(join(dir, id, 'meta.json'), JSON.stringify({ id, videoBytes: 3000, telemetryBytes: 10, video: 'video.mp4' }));
    await writeFile(join(dir, id, 'video.mp4'), 'x');
  }
  await recorder.setDemo(ids[0]);
  await recorder.rotate();
  assert.deepEqual((await recorder.list()).map(r => r.id), [ids[3], ids[0]], 'demo kept, then the newest; total 6020 > 5000 drops down to one more');
});

test('recover finalizes a recording left active by a crash and switches MediaMTX record off', async t => {
  const { dir, recorder, calls, mtxWrite } = await fixture(t);
  const id = '2026-05-05T05-05-05Z';
  await mkdir(join(dir, id));
  await writeFile(join(dir, id, 'meta.json'), JSON.stringify({ id, startedAt: new Date().toISOString(), active: true }));
  await writeFile(join(dir, id, 'telemetry.ndjson'), 'x\n');
  await mtxWrite('stray.mp4', 42);
  await recorder.recover();
  assert.deepEqual(calls[0].body, { record: false });
  const [meta] = await recorder.list();
  assert.equal(meta.stoppedBy, 'restart');
  assert.equal(meta.videoBytes, 42);
  assert.equal((await stat(join(dir, id, 'video.mp4'))).size, 42);
});
