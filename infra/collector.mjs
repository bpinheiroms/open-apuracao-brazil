import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { COLS, config, minuteOf, parseResult, UFS } from './tse.mjs';

const cfg = config();
const OUT = process.env.OUT || 'live';
const STATE = process.env.STATE || join(OUT, '..', '.collector-state.json');
const INTERVAL_MS = (+process.env.INTERVAL_S || 60) * 1000;
const PARALLEL = Math.min(3, +process.env.PARALLEL || 3);
const MAX_PER_TICK = +process.env.MAX_PER_TICK || 800;
const SNAP_EVERY_MIN = +process.env.SNAP_EVERY_MIN || 5;
const TIMEOUT_MS = 10000;

mkdirSync(join(OUT, 'snap'), { recursive: true });
const log = (...args) => console.log(new Date().toISOString(), ...args);

const saved = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {};
const state = saved.ele === cfg.ele ? saved : { ele: cfg.ele, cm: null, mu: {}, uf: {}, br: null };
const historyFile = join(OUT, 'history.json');
let history = existsSync(historyFile) && saved.ele === cfg.ele ? JSON.parse(readFileSync(historyFile, 'utf8')) : [];
let blockedUntil = 0, backoffMs = 180000, requests = 0, lastError = null, version = null;

let active = 0;
const queue = [];
const slot = () => active < PARALLEL ? (active++, Promise.resolve()) : new Promise(resolve => queue.push(resolve));
const release = () => { const next = queue.shift(); next ? next() : active--; };

async function get(url) {
  if (Date.now() < blockedUntil) throw new Error('backoff');
  await slot();
  try {
    requests++;
    const response = await fetch(`${url}?t=${Math.floor(Date.now() / 60000)}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (response.status === 429 || response.status === 403) {
      blockedUntil = Date.now() + backoffMs;
      backoffMs = Math.min(backoffMs * 2, 900000);
      throw new Error(`${response.status}, pausando ${backoffMs / 2000}s`);
    }
    if (!response.ok) throw new Error(`${response.status} ${url}`);
    return await response.json();
  } finally { release(); }
}

function write(path, body, { compress = true } = {}) {
  const tmp = path + '.tmp';
  writeFileSync(tmp, body); renameSync(tmp, path);
  if (!compress) return;
  writeFileSync(path + '.gz', gzipSync(body, { level: 9 }));
  writeFileSync(path + '.br', brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }));
}

async function loadMunicipalities() {
  if (state.cm) return;
  const cm = await get(cfg.urls.cm);
  state.cm = {};
  for (const uf of cm.abr || []) {
    if (!UFS.includes(uf.cd.toLowerCase())) continue;
    for (const m of uf.mu || []) state.cm[uf.cd.toLowerCase() + m.cd] = m.cdi;
  }
  log('municípios', Object.keys(state.cm).length);
}

async function tick() {
  const before = requests;
  try {
    if (Date.now() < blockedUntil) return log('backoff até', new Date(blockedUntil).toISOString());
    await loadMunicipalities();
    const br = parseResult(await get(cfg.urls.br), cfg.cands);
    const changedUfs = [], changedMus = [];
    await Promise.all(UFS.map(async uf => {
      const ab = await get(cfg.urls.ab(uf)).catch(error => { lastError = error.message; return null; });
      for (const a of ab?.abr || []) {
        const st = +String(a.s?.st ?? 0).replace(/\./g, '');
        const stamp = `${a.ht}|${st}`;
        if (a.tpabr === 'uf' || a.cdabr?.toLowerCase() === uf) {
          if (state.uf[uf]?.stamp !== stamp || !state.uf[uf]?.row) changedUfs.push({ uf, stamp });
          continue;
        }
        const id = state.cm[uf + a.cdabr];
        if (!id || !st) continue;
        const known = state.mu[id];
        if (known?.stamp !== stamp) changedMus.push({ id, uf, cd: a.cdabr, stamp, te: +String(a.e?.te ?? 0).replace(/\./g, '') });
      }
    }));
    for (const uf of UFS) if (!state.uf[uf]) changedUfs.push({ uf, stamp: null });
    const ufJobs = [...new Map(changedUfs.map(job => [job.uf, job])).values()];
    changedMus.sort((a, b) => (state.mu[a.id]?.at ?? 0) - (state.mu[b.id]?.at ?? 0) || b.te - a.te);
    const muJobs = changedMus.slice(0, MAX_PER_TICK);

    await Promise.all([
      ...ufJobs.map(async ({ uf, stamp }) => {
        const result = parseResult(await get(cfg.urls.uf(uf)), cfg.cands);
        state.uf[uf] = { stamp, row: result.row };
      }),
      ...muJobs.map(async ({ id, uf, cd, stamp }) => {
        const result = parseResult(await get(cfg.urls.mu(uf, cd)), cfg.cands);
        state.mu[id] = { stamp, row: result.row, at: Date.now() };
      }),
    ].map(job => job.catch(error => { lastError = error.message; })));

    const snapshot = {
      v: 1, ele: cfg.ele, cands: cfg.cands, cols: COLS, tse: { dg: br.dg, ht: br.ht }, m: minuteOf(br.ht),
      br: br.row,
      uf: Object.fromEntries(UFS.filter(uf => state.uf[uf]?.row).map(uf => [uf.toUpperCase(), state.uf[uf].row])),
      mu: Object.fromEntries(Object.entries(state.mu).map(([id, m]) => [id, m.row])),
    };
    const body = JSON.stringify(snapshot);
    const hash = createHash('sha1').update(body).digest('hex').slice(0, 10);
    if (hash !== version) {
      const minute = Math.floor(snapshot.m ?? 0);
      const file = `snap/${String(minute).padStart(4, '0')}-${hash}.json`;
      write(join(OUT, file), body);
      write(join(OUT, 'latest.json'), body);
      const last = history.at(-1);
      const replace = last && last.br[0] === br.row[0] && last.m === snapshot.m;
      const lastKept = history.findLast((entry, i) => entry.s && !(replace && i === history.length - 1));
      const keep = (replace && last.s) || !lastKept || minute - Math.floor(lastKept.m) >= SNAP_EVERY_MIN;
      const entry = { m: snapshot.m, br: snapshot.br, uf: snapshot.uf, s: keep ? file : undefined, latest: file };
      if (replace) history[history.length - 1] = entry;
      else history.push(entry);
      write(historyFile, JSON.stringify(history.map(({ latest, ...rest }) => rest)));
      version = hash;
      prune(new Set(history.map(entry => entry.s).filter(Boolean)), file);
    }
    write(join(OUT, 'status.json'), JSON.stringify({
      t: Date.now(), ele: cfg.ele, tse: snapshot.tse, m: snapshot.m, snap: history.at(-1)?.latest ?? history.at(-1)?.s, n: history.length,
      h: (({ latest, ...rest }) => rest)(history.at(-1) ?? {}), pending: changedMus.length - muJobs.length, final: br.row[1] > 0 && br.row[0] === br.row[1], error: lastError,
    }), { compress: false });
    writeFileSync(STATE, JSON.stringify(state));
    log(`tick ok: ${requests - before} req ao TSE, ${muJobs.length} municípios, ${(br.row[0] / Math.max(1, br.row[1]) * 100).toFixed(2)}% seções, pendentes ${changedMus.length - muJobs.length}`);
    lastError = null;
  } catch (error) {
    lastError = error.message;
    log('tick erro:', error.message, `(${requests - before} req)`);
  }
}

function prune(keep, current) {
  const dir = join(OUT, 'snap'), cutoff = Date.now() - 10 * 60000;
  for (const name of readdirSync(dir)) {
    const base = 'snap/' + name.replace(/\.(gz|br)$/, '');
    if (keep.has(base) || base === current) continue;
    const path = join(dir, name);
    if (statSync(path).mtimeMs < cutoff) unlinkSync(path);
  }
}

log('coletor', JSON.stringify({ ele: cfg.ele, cargo: cfg.cargo, cands: cfg.cands, base: cfg.urls.br, OUT, INTERVAL_MS, PARALLEL }));
await tick();
if (!process.argv.includes('--once')) setInterval(tick, INTERVAL_MS);
