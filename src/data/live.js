import { useEffect, useMemo, useState } from 'preact/hooks';
import { share } from '../lib/format.js';
import { aggregate, STATES } from './mocks.js';

const POLL_MS = 15000;
export const STALE_MS = 3 * 60000;
const STATE_CODES = Object.keys(STATES);

async function getJson(url) {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

/** Boots live mode when a collector publishes /live/status.json; `?simulado` forces the simulation. */
export async function loadLive() {
  const required = import.meta.env?.VITE_LIVE === '1';
  if (!required && new URLSearchParams(location.search).has('simulado')) return null;
  let status;
  try { status = await getJson('/live/status.json'); } catch { status = null; }
  if (!status?.snap) {
    if (required) throw new Error('Os dados do TSE ainda não estão disponíveis. Tente de novo em alguns segundos.');
    return null;
  }
  const [data, history] = await Promise.all([getJson(`/live/${status.snap}`), getJson('/live/history.json')]);
  return { status, data, history };
}

/** One TSE row [st, ts, te, est, c, vv, vb, vn, v0, v1] in the shape the simulation produces. */
export function toResult(row) {
  const [st, ts, te, est, cast, valid, blank, nulls, a, b] = row ?? [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  return {
    electorate: te, sections: ts, completion: ts ? st / ts : 0, turnout: est ? cast / est : 0,
    cast, blank, nulls, valid, votes: [a, b, Math.max(0, valid - a - b)], winner: a >= b ? 0 : 1,
  };
}

const stateRow = (uf, row, fallback) => ({ ...(row ? toResult(row) : aggregate(fallback())), name: STATES[uf][0] });

function toSnapshot(geo, data) {
  const results = new Map(geo.municipalities.map(m => [m.id, { ...toResult(data.mu[m.id]), id: m.id, name: m.name, uf: m.uf }]));
  const states = Object.fromEntries(Object.keys(geo.states).map(uf =>
    [uf, stateRow(uf, data.uf[uf], () => geo.states[uf].municipalities.map(m => results.get(m.id)))]));
  return { results, states, adjustments: {}, national: toResult(data.br) };
}

const toSample = entry => ({
  minute: entry.m, snap: entry.s, national: toResult(entry.br),
  states: Object.fromEntries(STATE_CODES.map(uf => [uf, { ...toResult(entry.uf?.[uf]), name: STATES[uf][0] }])),
});

/** Polls the tiny status file; fetches a new immutable snapshot only when the collector wrote one. */
export function useLive(geo, boot, replayMinute) {
  const [status, setStatus] = useState(boot?.status);
  const [data, setData] = useState(boot?.data);
  const [history, setHistory] = useState(boot?.history ?? []);
  const [replay, setReplay] = useState(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!boot) return;
    let timer, current = boot.status.snap, entries = boot.history;
    const poll = async () => {
      try {
        const next = await getJson('/live/status.json');
        setStatus(next);
        if (next.snap && next.snap !== current) {
          setData(await getJson(`/live/${next.snap}`));
          current = next.snap;
        }
        if (next.n > entries.length + 1) entries = await getJson('/live/history.json');
        else if (next.h?.br && (next.n !== entries.length || next.h.m !== entries.at(-1)?.m || next.h.br[0] !== entries.at(-1)?.br[0]))
          entries = next.n === entries.length ? [...entries.slice(0, -1), next.h] : [...entries, next.h];
        setHistory(entries);
      } catch {}
      timer = setTimeout(poll, document.hidden ? POLL_MS * 4 : POLL_MS + Math.random() * 3000);
    };
    timer = setTimeout(poll, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 5000);
    return () => { clearTimeout(timer); clearInterval(tick); };
  }, [boot]);

  const samples = useMemo(() => history.map(toSample), [history]);

  useEffect(() => {
    if (!boot || replayMinute == null) return setReplay(null);
    const kept = samples.filter(sample => sample.snap);
    const target = kept.findLast(sample => sample.minute <= replayMinute) ?? kept[0];
    if (!target) return;
    let cancelled = false;
    getJson(`/live/${target.snap}`).then(json => !cancelled && setReplay(json)).catch(() => {});
    return () => { cancelled = true; };
  }, [boot, replayMinute, samples]);

  const shown = replayMinute != null && replay ? replay : data;
  const snapshot = useMemo(() => shown && toSnapshot(geo, shown), [geo, shown]);
  if (!boot) return null;
  const age = now - status.t;
  return { snapshot, samples, minute: Math.floor(data.m ?? 0), tse: status.tse, age, stale: age > STALE_MS };
}

const toPoint = (minute, result) => ({ minute: Math.floor(minute), completion: result.completion, shares: [share(result, 0), share(result, 1)] });
const pick = (sample, uf) => uf ? sample.states[uf] : sample.national;

/** National and state series come from the collector's history; municipalities only have the current point. */
export function liveTrend(samples, { uf, municipality }, minute, current) {
  const past = municipality ? [] : samples.filter(sample => sample.minute < minute && pick(sample, uf).valid > 0);
  return [...past.map(sample => toPoint(sample.minute, pick(sample, uf))), toPoint(minute, current)];
}

/** Real bulletins: sections added between consecutive collector rounds, and which states reported. */
export function liveUpdates(samples, uf, minute, count = 7) {
  const updates = [], seen = samples.filter(sample => sample.minute <= minute);
  for (let i = seen.length - 1; i > 0 && updates.length < count; i--) {
    const before = pick(seen[i - 1], uf), after = pick(seen[i], uf);
    const sections = Math.round(after.sections * after.completion - before.sections * before.completion);
    if (sections < 1) continue;
    const states = uf ? [] : STATE_CODES
      .map(code => [code, seen[i].states[code].sections * seen[i].states[code].completion - seen[i - 1].states[code].sections * seen[i - 1].states[code].completion])
      .filter(([, added]) => added >= 1).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([code]) => code);
    updates.push({ minute: Math.floor(seen[i].minute), sections, states, shares: [share(after, 0), share(after, 1)] });
  }
  return updates;
}

export function liveFlips(samples, minute, currentStates) {
  const moments = [...samples.filter(sample => sample.minute < minute), { minute, states: currentStates }];
  const flips = [];
  for (let i = 1; i < moments.length; i++) for (const uf of STATE_CODES) {
    const before = moments[i - 1].states[uf], after = moments[i].states[uf];
    if (before.valid > 0 && after.valid > 0 && before.winner !== after.winner) flips.push({ minute: Math.floor(moments[i].minute), uf, winner: after.winner });
  }
  return flips.reverse();
}
