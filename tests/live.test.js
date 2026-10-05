import assert from 'node:assert/strict';
import { test } from 'node:test';
import { config, minuteOf, parseResult } from '../infra/tse.mjs';
import { liveFlips, liveUpdates, toResult } from '../src/data/live.js';
import { outlook } from '../src/data/outlook.js';
import { STATES } from '../src/data/mocks.js';

const tseFile = {
  dg: '04/10/2026', ht: '19:14:35',
  s: { st: '27', ts: '27', pst: '100,00' }, e: { te: '7523', est: '7523', c: '6262' }, v: { vv: '6114', vb: '54', tvn: '94' },
  carg: [{ agr: [{ par: [{ cand: [{ n: '13', vap: '3379' }, { n: '22', vap: '2277' }, { n: '70', vap: '259' }] }] }] }],
};

test('TSE URLs follow the election id, so the 2nd round only needs ELE=6258', () => {
  const { urls } = config({ ELE: '6258' });
  assert.equal(urls.mu('sp', '71072'), 'https://resultados.tse.jus.br/oficial/ele2026/6258/dados/sp/sp71072-c0001-e006258-u.json');
  assert.equal(urls.ab('sp'), 'https://resultados.tse.jus.br/oficial/ele2026/6258/dados/sp/sp-e006258-ab.json');
  assert.equal(urls.cm, 'https://resultados.tse.jus.br/oficial/ele2026/6258/config/mun-e006258-cm.json');
});

test('a TSE result file becomes the same result shape the simulation uses', () => {
  const { row, ht } = parseResult(tseFile, [22, 13]);
  assert.deepEqual(row, [27, 27, 7523, 7523, 6262, 6114, 54, 94, 2277, 3379]);
  assert.equal(minuteOf(ht), 19 * 60 + 14 + 35 / 60);
  const result = toResult(row);
  assert.equal(result.completion, 1);
  assert.equal(result.winner, 1);
  assert.deepEqual(result.votes, [2277, 3379, 6114 - 2277 - 3379]);
  assert.equal(result.cast, result.valid + result.blank + result.nulls);
  assert.equal(outlook(result).status, 'closed');
});

const sample = (minute, rows) => ({ minute, national: toResult(rows.BR), states: Object.fromEntries(Object.keys(STATES).map(uf => [uf, toResult(rows[uf])])) });

test('bulletins and flips come from consecutive collector rounds', () => {
  const samples = [
    sample(1030, { BR: [10, 100, 1000, 100, 80, 75, 2, 3, 40, 30], SP: [5, 50, 500, 50, 40, 38, 1, 1, 20, 15] }),
    sample(1031, { BR: [30, 100, 1000, 300, 240, 225, 6, 9, 110, 100], SP: [17, 50, 500, 150, 120, 114, 3, 3, 50, 60], RJ: [10, 30, 300, 100, 80, 76, 2, 2, 30, 40] }),
  ];
  const [update] = liveUpdates(samples, null, 1031);
  assert.equal(update.sections, 20);
  assert.deepEqual(update.states, ['SP', 'RJ']);
  const flips = liveFlips(samples, 1032, samples[1].states);
  assert.deepEqual(flips.map(flip => [flip.uf, flip.winner]), [['SP', 1]]);
});
