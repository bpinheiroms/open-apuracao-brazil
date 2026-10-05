export const UFS = 'ac al ap am ba ce df es go ma mt ms mg pa pb pr pe pi rj rn rs ro rr sc sp se to'.split(' ');

export const COLS = ['st', 'ts', 'te', 'est', 'c', 'vv', 'vb', 'vn', 'v0', 'v1'];

export function config(env = process.env) {
  const ele = env.ELE || '6257';
  const base = (env.TSE_BASE || 'https://resultados.tse.jus.br/oficial/ele2026').replace(/\/$/, '');
  const cargo = env.CARGO || '0001';
  const cands = (env.CANDS || '22,13').split(',').map(Number);
  const dados = `${base}/${ele}/dados`, e = `e00${ele}`;
  return {
    ele, cargo, cands,
    urls: {
      cm: `${base}/${ele}/config/mun-${e}-cm.json`,
      br: `${dados}/br/br-c${cargo}-${e}-u.json`,
      uf: uf => `${dados}/${uf}/${uf}-c${cargo}-${e}-u.json`,
      ab: uf => `${dados}/${uf}/${uf}-${e}-ab.json`,
      mu: (uf, cd) => `${dados}/${uf}/${uf}${cd}-c${cargo}-${e}-u.json`,
    },
  };
}

export const num = value => Number(String(value ?? '0').replace(/\./g, '').replace(',', '.')) || 0;

export function parseResult(json, cands) {
  const votes = {};
  for (const agr of json.carg?.[0]?.agr || []) for (const par of agr.par || []) for (const cand of par.cand || []) votes[cand.n] = num(cand.vap);
  const s = json.s || {}, e = json.e || {}, v = json.v || {};
  return {
    ht: json.ht || '', dg: json.dg || '',
    row: [num(s.st), num(s.ts), num(e.te), num(e.est), num(e.c), num(v.vv), num(v.vb), num(v.tvn ?? v.vn), ...cands.map(n => votes[n] || 0)],
  };
}

export const minuteOf = ht => {
  const [h, m, s] = String(ht).split(':').map(Number);
  return Number.isFinite(h) ? h * 60 + (m || 0) + (s || 0) / 60 : null;
};
