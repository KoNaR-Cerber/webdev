// Nagrywanie: wideo przez MediaMTX (record na sciezce, przelaczany jego API) i telemetria z ramek, ktore panel
// i tak dostaje z gatewaya. Jedno nagranie = katalog <dir>/<id>/ z video.mp4 (fMP4 z MediaMTX, bez transkodowania),
// telemetry.ndjson (koperty WS gatewaya, jedna na linie) i meta.json. Wybor demo = dwa pliki-wskazniki w <dir>/demo/,
// ktore czytaja skrypt demo MediaMTX (video) i gateway (telemetria); jedna linia = jedno nagranie, kilka linii =
// playlista odtwarzana po kolei w petli (najwyzej MAX_DEMO). Limity: czas i rozmiar jednego nagrania,
// liczba i laczny rozmiar nagran (rotacja najstarszych; nagranie ustawione jako demo nie jest kasowane).
import { mkdir, readdir, readFile, rename, rm, stat, writeFile, open } from 'node:fs/promises';
import { join, basename } from 'node:path';

const ID_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/;
const MTX_SUBDIR = 'mtx';
export const MAX_DEMO = 5;
const FILES = { 'video.mp4': 'video/mp4', 'telemetry.ndjson': 'application/x-ndjson', 'meta.json': 'application/json' };

export function recordingId(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');
}

async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; }
}

async function writeAtomic(path, text) {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, text);
  await rename(tmp, path);
}

async function fileSize(path) {
  try { return (await stat(path)).size; } catch { return 0; }
}

export function createRecorder({
  dir,
  cameraPath = 'video/normal_cam',
  mediamtxApi,
  mediamtxUser = '',
  mediamtxPass = '',
  maxSeconds = 600,
  maxBytes = 600 * 1024 * 1024,
  keep = 30,
  totalBytes = 6 * 1024 * 1024 * 1024,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  pollMs = 2_000,
  finishWaitMs = 6_000,
  onChange = () => {},
  log = () => {},
}) {
  if (!dir) throw new Error('recorder needs a directory');
  if (!/^video\/[A-Za-z0-9_]+$/.test(cameraPath)) throw new Error('camera path must look like video/<name>');
  for (const [name, value] of Object.entries({ maxSeconds, maxBytes, keep, totalBytes })) {
    if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  }
  const cameraName = cameraPath.slice('video/'.length);
  const mtxDir = join(dir, MTX_SUBDIR, cameraPath);
  const demoDir = join(dir, 'demo');
  const limits = { maxSeconds, maxBytes, keep, totalBytes };
  let active = null;
  let stopping = null;
  const api = { onChange };
  const notify = () => { try { api.onChange?.(); } catch { /* sluchacz nie moze zepsuc nagrywania */ } };

  const authHeaders = mediamtxUser
    ? { Authorization: `Basic ${Buffer.from(`${mediamtxUser}:${mediamtxPass}`).toString('base64')}` }
    : {};

  async function mtx(method, path, body) {
    if (!mediamtxApi) throw new Error('MediaMTX API not configured');
    const response = await fetchImpl(`${mediamtxApi}${path}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(5_000),
      headers: { ...authHeaders, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text().catch(() => '');
    if (!response.ok) throw new Error(`MediaMTX API ${method} ${path}: HTTP ${response.status}`);
    try { return text ? JSON.parse(text) : null; } catch { return null; }
  }
  const setRecord = (on) => mtx('PATCH', `/v3/config/paths/patch/${cameraPath}`, { record: on });
  async function publisherReady() {
    try { return (await mtx('GET', `/v3/paths/get/${cameraPath}`))?.ready === true; } catch { return false; }
  }

  async function newestMtxFile(sinceMs) {
    let names;
    try { names = await readdir(mtxDir); } catch { return null; }
    let best = null;
    for (const name of names) {
      if (!name.endsWith('.mp4')) continue;
      const path = join(mtxDir, name);
      const info = await stat(path).catch(() => null);
      if (!info || info.mtimeMs < sinceMs - 5_000) continue;
      if (!best || info.mtimeMs > best.mtimeMs) best = { path, size: info.size, mtimeMs: info.mtimeMs };
    }
    return best;
  }

  async function listIds() {
    let names;
    try { names = await readdir(dir); } catch { return []; }
    return names.filter(n => ID_RE.test(n)).sort();
  }

  async function readDemo() {
    // Wskaznik telemetrii jest zapisywany zawsze (wideo tylko, gdy nagranie ma obraz), wiec to on wyznacza demo.
    // Kolejnosc linii = kolejnosc odtwarzania.
    const pointer = await readFile(join(demoDir, 'telemetry.path'), 'utf8').catch(() => '');
    const ids = [];
    for (const line of pointer.split('\n')) {
      const id = basename(line.trim().replace(/\/telemetry\.ndjson$/, ''));
      if (ID_RE.test(id) && !ids.includes(id)) ids.push(id);
    }
    return ids.slice(0, MAX_DEMO);
  }

  async function writeDemo(ids) {
    await mkdir(demoDir, { recursive: true });
    const metas = [];
    for (const id of ids) {
      const meta = await readJson(join(dir, id, 'meta.json'));
      if (meta && !meta.active) metas.push({ id, video: !!meta.video });
    }
    await writeAtomic(join(demoDir, `${cameraName}.path`),
      metas.filter(m => m.video).map(m => `${join(dir, m.id, 'video.mp4')}\n`).join(''));
    await writeAtomic(join(demoDir, 'telemetry.path'), metas.map(m => `${join(dir, m.id, 'telemetry.ndjson')}\n`).join(''));
    notify();
  }

  async function list() {
    const demo = await readDemo();
    const items = [];
    for (const id of await listIds()) {
      const meta = await readJson(join(dir, id, 'meta.json'));
      if (!meta) continue;
      items.push({ ...meta, id, demo: demo.includes(id) ? demo.indexOf(id) + 1 : null });
    }
    return items.reverse();
  }

  function activeInfo() {
    if (!active) return null;
    const elapsedS = Math.max(0, Math.round((now() - active.startedMs) / 1000));
    return {
      id: active.id, startedAt: active.startedAt, elapsedS,
      bytes: active.videoBytes + active.telemetryBytes, videoBytes: active.videoBytes,
      telemetryBytes: active.telemetryBytes, events: active.events, video: active.videoExpected,
    };
  }

  async function status() {
    return { active: activeInfo(), demo: await readDemo(), maxDemo: MAX_DEMO, limits, recordings: await list() };
  }

  async function start(seed = []) {
    if (active) throw Object.assign(new Error('Recording already active'), { code: 409 });
    if (stopping) await stopping;
    const startedMs = now();
    const id = recordingId(new Date(startedMs));
    const recDir = join(dir, id);
    await mkdir(recDir, { recursive: true });
    const handle = await open(join(recDir, 'telemetry.ndjson'), 'w');
    const rec = {
      id, startedAt: new Date(startedMs).toISOString(), startedMs, dir: recDir, handle,
      videoBytes: 0, telemetryBytes: 0, events: 0, videoExpected: false, videoPath: null, timers: [],
      writeQueue: Promise.resolve(),
    };
    active = rec;
    try {
      await writeAtomic(join(recDir, 'meta.json'), JSON.stringify({ id, startedAt: rec.startedAt, active: true }));
      rec.videoExpected = await publisherReady();
      await setRecord(true);
    } catch (error) {
      active = null;
      await handle.close().catch(() => {});
      await rm(recDir, { recursive: true, force: true });
      throw Object.assign(new Error('Camera recorder unavailable'), { code: 502, cause: error });
    }
    for (const message of seed) record(message);
    const maxTimer = setTimeout(() => { void stop('time'); }, maxSeconds * 1000);
    const poll = setInterval(() => { void checkSize(rec); }, pollMs);
    maxTimer.unref(); poll.unref();
    rec.timers.push(maxTimer, poll);
    log(`recording ${id} started`);
    notify();
    return activeInfo();
  }

  async function checkSize(rec) {
    if (active !== rec) return;
    const file = await newestMtxFile(rec.startedMs);
    if (file) { rec.videoPath = file.path; rec.videoBytes = file.size; rec.videoExpected = true; }
    if (rec.videoBytes + rec.telemetryBytes >= maxBytes) await stop('size');
    else notify();
  }

  function record(message) {
    const rec = active;
    if (!rec) return;
    const line = `${JSON.stringify(message)}\n`;
    rec.events++;
    rec.telemetryBytes += Buffer.byteLength(line);
    rec.writeQueue = rec.writeQueue.then(() => rec.handle.write(line)).catch(() => {});
    if (rec.videoBytes + rec.telemetryBytes >= maxBytes) void stop('size');
  }

  async function stop(reason = 'user') {
    const rec = active;
    if (!rec) {
      if (stopping) return stopping;
      throw Object.assign(new Error('No active recording'), { code: 409 });
    }
    active = null;
    stopping = (async () => {
      for (const t of rec.timers) clearTimeout(t);
      const stoppedMs = now();
      let recordOff = true;
      try { await setRecord(false); } catch { recordOff = false; }
      await rec.writeQueue;
      await rec.handle.close().catch(() => {});
      // MediaMTX zamyka segment po wylaczeniu record; czekamy, az plik przestanie rosnac, i przenosimy go.
      let video = null;
      const deadline = now() + finishWaitMs;
      let last = -1;
      while (now() < deadline) {
        const file = await newestMtxFile(rec.startedMs);
        if (file && file.size === last) { video = file; break; }
        last = file ? file.size : -1;
        await new Promise(r => setTimeout(r, Math.min(500, pollMs)));
      }
      if (!video) video = await newestMtxFile(rec.startedMs);
      let videoBytes = 0;
      if (video) {
        try { await rename(video.path, join(rec.dir, 'video.mp4')); videoBytes = video.size; } catch (error) {
          log(`recording ${rec.id}: cannot move video: ${error.message}`);
        }
      }
      const meta = {
        id: rec.id, startedAt: rec.startedAt, stoppedAt: new Date(stoppedMs).toISOString(),
        durationS: Math.round((stoppedMs - rec.startedMs) / 1000), stoppedBy: reason,
        videoBytes, telemetryBytes: rec.telemetryBytes, events: rec.events,
        video: videoBytes > 0 ? 'video.mp4' : null, telemetry: 'telemetry.ndjson',
        camera: cameraPath, recordOff,
      };
      await writeAtomic(join(rec.dir, 'meta.json'), JSON.stringify(meta));
      log(`recording ${rec.id} stopped (${reason}): ${meta.durationS} s, video ${videoBytes} B, ${rec.events} events`);
      await rotate();
      stopping = null;
      notify();
      return meta;
    })();
    return stopping;
  }

  async function rotate() {
    // Najstarsze najpierw; nagranie demo i trwajace sa poza limitami (nie liczone i nie kasowane).
    const items = (await list()).reverse().filter(m => !m.demo && !m.active);
    let count = items.length;
    let total = items.reduce((sum, m) => sum + (m.videoBytes || 0) + (m.telemetryBytes || 0), 0);
    for (const item of items) {
      if (count <= keep && total <= totalBytes) break;
      await rm(join(dir, item.id), { recursive: true, force: true });
      count--;
      total -= (item.videoBytes || 0) + (item.telemetryBytes || 0);
      log(`recording ${item.id} removed by rotation`);
    }
  }

  async function finishedMeta(id) {
    if (!ID_RE.test(id)) throw Object.assign(new Error('Unknown recording'), { code: 404 });
    const meta = await readJson(join(dir, id, 'meta.json'));
    if (!meta || meta.active) throw Object.assign(new Error('Unknown recording'), { code: 404 });
    return meta;
  }

  // Playlista demo: addDemo doklada nagranie na koniec (kolejnosc klikniec = kolejnosc odtwarzania),
  // removeDemo wyjmuje jedno, setDemo(id) zastepuje cala playliste jednym nagraniem, setDemo(null) czysci.
  async function setDemo(id) {
    if (id === null) return writeDemo([]);
    await finishedMeta(id);
    await writeDemo([id]);
  }

  async function addDemo(id) {
    await finishedMeta(id);
    const ids = await readDemo();
    if (ids.includes(id)) return;
    if (ids.length >= MAX_DEMO) throw Object.assign(new Error(`Demo playlist holds at most ${MAX_DEMO} recordings`), { code: 409 });
    await writeDemo([...ids, id]);
  }

  async function removeDemo(id) {
    if (!ID_RE.test(id)) throw Object.assign(new Error('Unknown recording'), { code: 404 });
    const ids = await readDemo();
    if (!ids.includes(id)) return;
    await writeDemo(ids.filter(x => x !== id));
  }

  // Plik gotowego nagrania do pobrania: { path, size, type } albo 404 (nieznane / trwajace / brak pliku).
  async function file(id, name) {
    const meta = await finishedMeta(id);
    const type = FILES[name];
    if (!type) throw Object.assign(new Error('Unknown file'), { code: 404 });
    if (name === 'video.mp4' && !meta.video) throw Object.assign(new Error('Recording has no video'), { code: 404 });
    const path = join(dir, id, name);
    let size;
    try { size = (await stat(path)).size; } catch { throw Object.assign(new Error('File missing'), { code: 404 }); }
    return { path, size, type };
  }

  async function remove(id) {
    if (!ID_RE.test(id)) throw Object.assign(new Error('Unknown recording'), { code: 404 });
    if (active?.id === id) throw Object.assign(new Error('Recording is active'), { code: 409 });
    if ((await readDemo()).includes(id)) throw Object.assign(new Error('Recording is the demo source'), { code: 409 });
    const meta = await readJson(join(dir, id, 'meta.json'));
    if (!meta) throw Object.assign(new Error('Unknown recording'), { code: 404 });
    await rm(join(dir, id), { recursive: true, force: true });
    notify();
  }

  async function recover() {
    // Po restarcie panelu: record w MediaMTX moze byc wlaczony, a katalog z meta.active zostal bez zakonczenia.
    await mkdir(dir, { recursive: true }).catch(() => {});
    try { await setRecord(false); } catch { /* MediaMTX jeszcze nie wstal; record i tak nie przezywa jego restartu */ }
    for (const id of await listIds()) {
      const metaPath = join(dir, id, 'meta.json');
      const meta = await readJson(metaPath);
      if (!meta?.active) continue;
      const startedMs = Date.parse(meta.startedAt) || 0;
      const telemetryBytes = await fileSize(join(dir, id, 'telemetry.ndjson'));
      let videoBytes = await fileSize(join(dir, id, 'video.mp4'));
      if (!videoBytes) {
        const stray = await newestMtxFile(startedMs);
        if (stray) { try { await rename(stray.path, join(dir, id, 'video.mp4')); videoBytes = stray.size; } catch { /* zostaje bez wideo */ } }
      }
      await writeAtomic(metaPath, JSON.stringify({
        id, startedAt: meta.startedAt, stoppedAt: new Date(now()).toISOString(), durationS: null, stoppedBy: 'restart',
        videoBytes, telemetryBytes, events: null, video: videoBytes > 0 ? 'video.mp4' : null,
        telemetry: 'telemetry.ndjson', camera: cameraPath,
      }));
      log(`recording ${id} finalized after restart`);
    }
    await rotate();
  }

  async function close() {
    if (active) await stop('shutdown');
    else if (stopping) await stopping;
  }

  Object.assign(api, { start, stop, record, list, status, setDemo, addDemo, removeDemo, file, remove, recover, rotate, close, limits });
  Object.defineProperty(api, 'active', { get: activeInfo, enumerable: true });
  return api;
}
