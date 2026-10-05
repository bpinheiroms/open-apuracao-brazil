import { html } from '../lib/html.js';
import { blankShare, int, percent } from '../lib/format.js';
import { CANDIDATES, STATES } from '../data/mocks.js';
import { TrendChart } from './TrendChart.js';
import { hourMinute, UpdatesFeed } from './UpdatesFeed.js';

function Turnout({ result }) {
  const stats = [
    ['Votos válidos', int(result.valid)],
    ['Comparecimento', percent(result.turnout)],
    ['Abstenção', percent(1 - result.turnout)],
    ['Brancos e nulos', percent(blankShare(result))],
    ['Seções apuradas', `${int(result.sections * result.completion)} de ${int(result.sections)}`],
  ];
  return html`<section class="insight">
    <h3>Participação</h3>
    <dl class="stats">${stats.map(([label, value]) => html`<div class="stat" key=${label}><dt>${label}</dt><dd>${value}</dd></div>`)}</dl>
  </section>`;
}

function Flips({ flips, onMoment }) {
  return html`<section class="insight">
    <h3>Viradas</h3>
    ${flips.length
      ? html`<ol class="flips">${flips.map(flip => html`<li key=${flip.uf + flip.minute}>
          <button onClick=${() => onMoment(flip.minute)} title="Ver o mapa nesse momento">
            <time>${hourMinute(flip.minute)}</time>
            <span><b>${STATES[flip.uf][0]}</b> virou para <i class=${'swatch tone-' + CANDIDATES[flip.winner].tone}></i>${CANDIDATES[flip.winner].name}</span>
          </button>
        </li>`)}</ol>`
      : html`<p class="note">Nenhum estado mudou de lado até agora.</p>`}
  </section>`;
}

/** Everything about how the count is going, as opposed to where: stats, trend, flips and bulletins. */
export function Insights({ place, result, trend, flips, updates, onMoment, pending }) {
  return html`<div class="insights">
    <${TrendChart} points=${trend} place=${place} onMoment=${onMoment} pending=${pending}/>
    <${Turnout} result=${result}/>
    ${flips && html`<${Flips} flips=${flips} onMoment=${onMoment}/>`}
    <${UpdatesFeed} updates=${updates}/>
  </div>`;
}
