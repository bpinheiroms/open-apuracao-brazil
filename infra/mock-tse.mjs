import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { municipalityResult } from '../src/data/mocks.js';

const PORT = +process.env.MOCK_PORT || 8787;
const SPEED = +process.env.SPEED || 10;
const START = +process.env.MOCK_START || 17 * 60 + 5;
const ELE = process.env.ELE || '6257';
const started = Date.now();

const topology = JSON.parse(readFileSync(new URL('../public/data/brasil.topo.json', import.meta.url), 'utf8'));
const municipalities = topology.objects.municipios.geometries.map(g => ({ id: String(g.properties.id), name: g.properties.n, uf: g.properties.uf, population: g.properties.p }));
const byUf = Object.groupBy(municipalities, m => m.uf.toLowerCase());
const stats = { total: 0, byKind: {} };

const simMinute = () => Math.min(23 * 60, START + (Date.now() - started) / 60000 * SPEED);
const hhmmss = minute => [Math.floor(minute / 60), Math.floor(minute) % 60, Math.floor(minute * 60) % 60].map(n => String(n).padStart(2, '0')).join(':');

function tse(m, minute) {
  const r = municipalityResult(m, minute, 'Presidente');
  return { st: Math.round(r.sections * r.completion), ts: r.sections, te: r.electorate, est: Math.round(r.electorate * r.completion), c: r.cast, vv: r.valid, vb: r.blank, vn: r.nulls, v: r.votes };
}
function lastChange(m, minute) {
  const now = tse(m, minute).st;
  for (let back = 1; back <= 120; back++) if (tse(m, minute - back).st !== now) return minute - back + 1;
  return minute - 120;
}
const sum = rows => rows.reduce((t, r) => { for (const k of ['st', 'ts', 'te', 'est', 'c', 'vv', 'vb', 'vn']) t[k] += r[k]; r.v.forEach((x, i) => t.v[i] += x); return t; },
  { st: 0, ts: 0, te: 0, est: 0, c: 0, vv: 0, vb: 0, vn: 0, v: [0, 0, 0] });
const result = (r, minute) => ({
  dg: '04/10/2026', ht: hhmmss(minute),
  s: { st: String(r.st), ts: String(r.ts), pst: (r.st / Math.max(1, r.ts) * 100).toFixed(2).replace('.', ',') },
  e: { te: String(r.te), est: String(r.est), c: String(r.c) },
  v: { vv: String(r.vv), vb: String(r.vb), tvn: String(r.vn) },
  carg: [{ agr: [{ par: [{ cand: [22, 13, 30].map((n, i) => ({ n: String(n), vap: String(r.v[i]) })) }] }] }],
});

function route(path) {
  const minute = Math.floor(simMinute());
  let match;
  if ((match = path.match(/\/config\/mun-e00\d+-cm\.json$/))) return ['cm', { abr: Object.entries(byUf).map(([uf, list]) => ({ cd: uf.toUpperCase(), mu: list.map(m => ({ cd: m.id, cdi: m.id, nm: m.name })) })) }];
  if ((match = path.match(/\/dados\/br\/br-c0001-e00\d+-u\.json$/))) return ['br', result(sum(municipalities.map(m => tse(m, minute))), minute)];
  if ((match = path.match(/\/dados\/([a-z]{2})\/\1-e00\d+-ab\.json$/))) {
    const list = byUf[match[1]] || [];
    return ['ab', { abr: [
      { tpabr: 'uf', cdabr: match[1].toUpperCase(), ht: hhmmss(minute), s: { st: String(sum(list.map(m => tse(m, minute))).st) } },
      ...list.map(m => { const r = tse(m, minute); return { tpabr: 'mun', cdabr: m.id, ht: hhmmss(lastChange(m, minute)), s: { st: String(r.st), ts: String(r.ts) }, e: { te: String(r.te) } }; }),
    ] }];
  }
  if ((match = path.match(/\/dados\/([a-z]{2})\/\1-c0001-e00\d+-u\.json$/))) return ['uf', result(sum((byUf[match[1]] || []).map(m => tse(m, minute))), minute)];
  if ((match = path.match(/\/dados\/([a-z]{2})\/\1(\d{7})-c0001-e00\d+-u\.json$/))) {
    const m = municipalities.find(x => x.id === match[2]);
    return m ? ['mu', result(tse(m, minute), lastChange(m, minute))] : null;
  }
  return null;
}

createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://x');
  if (pathname === '/__stats') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ...stats, simTime: hhmmss(simMinute()) })); }
  stats.total++;
  const hit = route(pathname);
  if (!hit) { res.writeHead(404).end(); return; }
  stats.byKind[hit[0]] = (stats.byKind[hit[0]] || 0) + 1;
  res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'max-age=56' });
  res.end(JSON.stringify(hit[1]));
}).listen(PORT, () => console.log(`TSE simulado (eleição ${ELE}, ${SPEED}x) em http://127.0.0.1:${PORT}/oficial/ele2026`));
