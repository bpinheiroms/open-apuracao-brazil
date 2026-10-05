import { useMemo, useState } from 'preact/hooks';
import { html } from '../lib/html.js';
import { compact, int, marginShare, normalize, percent, share } from '../lib/format.js';
import { aggregate, CANDIDATES, REGIONS, STATES } from '../data/mocks.js';
import { BackButton } from './BackButton.js';
import { Icon } from './Icon.js';
import { PlaceRow } from './PlaceRow.js';
import { DuelBar } from './Scoreboard.js';

const TOP_MUNICIPALITIES = 14;
const MAX_FILTERED = 50;
const STATE_CODES = Object.keys(STATES);
const STATE_SORTS = {
  nome: { label: 'A–Z', compare: (a, b) => a.name.localeCompare(b.name, 'pt-BR') },
  disputa: { label: 'Mais apertados', compare: (a, b) => marginShare(a.result) - marginShare(b.result) },
};

const SectionHead = ({ title, children }) => html`<div class="section-head"><h3>${title}</h3>${children}</div>`;

function PlaceHeader({ title, detail, backTo, backArticle, onBack, children }) {
  return html`<header class="place-header">
    <div class="place-header-nav">
      <${BackButton} to=${backTo} article=${backArticle} onClick=${onBack}/>
      <div class="place-header-actions">${children}</div>
    </div>
    <h2>${title}</h2>
    <p>${detail}</p>
  </header>`;
}

/** Parent scopes shown for comparison while a state or municipality is open. */
function Compare({ rows }) {
  return html`<section class="panel-section">
    <${SectionHead} title="Para comparar"/>
    <ul class="compare">${rows.map(({ label, result }) => html`<li key=${label}>
      <span>${label}</span>
      <${DuelBar} result=${result}/>
      <span class="compare-shares"><b class="tone-blue">${percent(share(result, 0))}</b><b class="tone-red">${percent(share(result, 1))}</b></span>
    </li>`)}</ul>
  </section>`;
}

function NationalPanel({ snapshot, theme, onState }) {
  const [sort, setSort] = useState('nome');
  const regions = useMemo(() => REGIONS.map(name => ({
    name,
    result: aggregate(STATE_CODES.filter(uf => STATES[uf][2] === name).map(uf => snapshot.states[uf])),
  })), [snapshot]);
  const states = STATE_CODES.map(uf => ({ uf, name: STATES[uf][0], result: snapshot.states[uf] })).sort(STATE_SORTS[sort].compare);

  return html`
    <section class="panel-section">
      <${SectionHead} title="Regiões"/>
      <ul class="place-list">${regions.map(({ name, result }) => html`<li key=${name}>
        <${PlaceRow} name=${name} result=${result} theme=${theme}
          detail=${`${percent(result.completion)} · faltam ${compact(result.electorate * (1 - result.completion))}`}/>
      </li>`)}</ul>
    </section>

    <section class="panel-section">
      <${SectionHead} title="Estados">
        <div class="segmented" role="group" aria-label="Ordenar estados">
          ${Object.entries(STATE_SORTS).map(([key, { label }]) => html`<button key=${key} aria-pressed=${sort === key} onClick=${() => setSort(key)}>${label}</button>`)}
        </div>
      <//>
      <ul class="place-list">${states.map(({ uf, name, result }) => html`<li key=${uf}>
        <${PlaceRow} tag=${uf} name=${name} result=${result} theme=${theme}
          onClick=${() => onState(uf)} label=${`Abrir ${name}`}/>
      </li>`)}</ul>
    </section>`;
}

function StatePanel({ geo, uf, snapshot, theme, route }) {
  const [query, setQuery] = useState('');
  const all = geo.states[uf].municipalities;
  const needle = normalize(query.trim());
  const visible = useMemo(() => all
    .filter(m => !needle || normalize(m.name).includes(needle))
    .sort((a, b) => b.population - a.population)
    .slice(0, needle ? MAX_FILTERED : TOP_MUNICIPALITIES), [all, needle]);
  const result = snapshot.states[uf];
  const index = STATE_CODES.indexOf(uf);
  const step = offset => route.openState(STATE_CODES[(index + offset + STATE_CODES.length) % STATE_CODES.length]);

  return html`
    <${PlaceHeader} title=${STATES[uf][0]} detail=${`${STATES[uf][2]} · ${compact(result.electorate)} eleitores`}
      backTo="Brasil" backArticle="o " onBack=${route.back}>
      <div class="stepper" role="group" aria-label="Trocar de estado">
        <button onClick=${() => step(-1)} aria-label="Estado anterior" title="Estado anterior"><${Icon} name="left" size=${16}/></button>
        <span>Outro estado</span>
        <button onClick=${() => step(1)} aria-label="Próximo estado" title="Próximo estado"><${Icon} name="right" size=${16}/></button>
      </div>
    <//>
    <${Compare} rows=${[{ label: 'Brasil', result: snapshot.national }]}/>

    <section class="panel-section">
      <${SectionHead} title="Municípios"><span class="section-count">${int(all.length)}</span><//>
      <label class="filter">
        <${Icon} name="search" size=${16}/>
        <input type="search" placeholder="Filtrar municípios" aria-label="Filtrar municípios" value=${query}
          onInput=${event => setQuery(event.currentTarget.value)}/>
      </label>
      ${visible.length
        ? html`<ul class="place-list">${visible.map(m => html`<li key=${m.id}>
            <${PlaceRow} name=${m.name} result=${snapshot.results.get(m.id)} theme=${theme}
              detail=${compact(snapshot.results.get(m.id).electorate) + ' eleitores'}
              onClick=${() => route.openMunicipality(m.id)} label=${`Abrir ${m.name}`}/>
          </li>`)}</ul>`
        : html`<p class="empty">Nenhum município com “${query.trim()}” em ${STATES[uf][0]}.</p>`}
      ${!needle && all.length > TOP_MUNICIPALITIES && html`<p class="note">Os ${TOP_MUNICIPALITIES} maiores. Use o filtro ou clique no mapa para os demais.</p>`}
    </section>`;
}

function ZoneResult({ zone, onClear }) {
  return html`<section class="panel-section zone-result" aria-live="polite">
    <${SectionHead} title=${`${zone.number}ª zona · ${zone.name}`}>
      <button class="icon-button" aria-label="Limpar seleção da zona" onClick=${onClear}><${Icon} name="close" size=${16}/></button>
    <//>
    <${DuelBar} result=${zone}/>
    <ul class="zone-shares">${[0, 1].map(index => html`<li key=${index}>
      <i class=${'swatch tone-' + CANDIDATES[index].tone}></i>
      <span>${CANDIDATES[index].name}</span>
      <b>${percent(share(zone, index))}</b>
      <small>${int(zone.votes[index])} votos</small>
    </li>`)}</ul>
  </section>`;
}

function MunicipalityPanel({ municipality, snapshot, zoneRows, theme, route }) {
  const { uf } = route;
  const result = snapshot.results.get(municipality.id);
  const selected = zoneRows?.find(zone => zone.number === route.zone);

  return html`
    <${PlaceHeader} title=${municipality.name} detail=${`${STATES[uf][0]} · ${compact(result.electorate)} eleitores`}
      backTo=${STATES[uf][0]} onBack=${route.back}/>
    <${Compare} rows=${[{ label: STATES[uf][0], result: snapshot.states[uf] }, { label: 'Brasil', result: snapshot.national }]}/>
    ${selected && html`<${ZoneResult} zone=${selected} onClear=${() => route.selectZone(null)}/>`}

    <section class="panel-section">
      <${SectionHead} title="Zonas eleitorais">${zoneRows?.length > 0 && html`<span class="section-count">${zoneRows.length}</span>`}<//>
      ${zoneRows?.length
        ? html`<ul class="place-list">${zoneRows.map(zone => html`<li key=${zone.number}>
            <${PlaceRow} tag=${zone.number} name=${zone.name} result=${zone} theme=${theme}
              detail=${compact(zone.electorate) + ' eleitores'} selected=${route.zone === zone.number}
              onClick=${() => route.selectZone(zone.number)} label=${`Selecionar a ${zone.number}ª zona, ${zone.name}`}/>
          </li>`)}</ul>
          <p class="note">Áreas aproximadas a partir dos locais de votação, não limites oficiais do TSE.</p>`
        : html`<p class="empty">Sem recorte por zona para este município. O placar acima mostra o total municipal.</p>`}
    </section>`;
}

const TABS = { lugares: 'Lugares', andamento: 'Andamento' };

/**
 * The contextual column. When `insights` is given (no room for its own column) it becomes a
 * second tab; when `sheet` is given (narrow screens) the panel is a bottom sheet over the map.
 */
export function SidePanel({ geo, snapshot, route, municipality, zoneRows, theme, placeName, insights, sheet, live }) {
  const [tab, setTab] = useState('lugares');
  const current = insights ? tab : 'lugares';
  const places = municipality
    ? html`<${MunicipalityPanel} key=${municipality.id} municipality=${municipality} snapshot=${snapshot} zoneRows=${zoneRows} theme=${theme} route=${route}/>`
    : route.uf
      ? html`<${StatePanel} key=${route.uf} geo=${geo} uf=${route.uf} snapshot=${snapshot} theme=${theme} route=${route}/>`
      : html`<${NationalPanel} snapshot=${snapshot} theme=${theme} onState=${route.openState}/>`;

  return html`<aside class=${'panel' + (sheet?.open ? ' is-open' : '')} aria-label="Resultados por lugar" data-testid="detail-panel">
    ${sheet && html`<button class="sheet-handle" aria-expanded=${sheet.open} onClick=${sheet.toggle}>
      <span class="sheet-grip"></span>
      <b>${placeName}</b>
      <span>${sheet.open ? 'Fechar' : 'Lugares e andamento'}</span>
      <${Icon} name=${sheet.open ? 'down' : 'up'} size=${16}/>
    </button>`}
    ${insights && html`<div class="panel-tabs" role="tablist" aria-label="Conteúdo do painel">
      ${Object.entries(TABS).map(([key, label]) => html`<button key=${key} role="tab" aria-selected=${current === key} onClick=${() => setTab(key)}>${label}</button>`)}
    </div>`}
    <div class="panel-body" role=${insights ? 'tabpanel' : null} inert=${sheet && !sheet.open}>
      ${current === 'lugares' ? places : insights}
      <footer class="panel-foot">
        ${live
          ? html`<p><strong>Dados oficiais do TSE</strong>, coletados por um único servidor e servidos por CDN.</p>`
          : html`<p><strong>Demonstração.</strong> Todos os votos, percentuais e o andamento da apuração são simulados.</p>`}
        <p>Malha municipal do IBGE · zonas em áreas aproximadas</p>
      </footer>
    </div>
  </aside>`;
}
