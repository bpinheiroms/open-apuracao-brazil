import { useState } from 'preact/hooks';
import { html } from '../lib/html.js';
import { percent } from '../lib/format.js';
import { CANDIDATES } from '../data/mocks.js';
import { useWidth } from '../hooks/useWidth.js';

const HEIGHT = 220;
const MARGIN = { top: 10, right: 52, bottom: 26, left: 36 };
const X_TICKS = [0, .5, 1];
const MIN_LABEL_GAP = 15;
const SERIES = [0, 1];

/** Y axis in whole points, widened so the lines never touch the frame. */
function shareScale(points) {
  const values = points.flatMap(point => point.shares.map(value => value * 100));
  const min = Math.min(...values), max = Math.max(...values);
  const step = max - min > 12 ? 5 : max - min > 5 ? 2 : 1;
  const low = Math.floor((min - step / 2) / step) * step, high = Math.ceil((max + step / 2) / step) * step;
  const ticks = [];
  for (let tick = low; tick <= high; tick += step) ticks.push(tick);
  return { low, high, ticks };
}

/** Pushes the two end labels apart when the lines finish close together. */
function endLabels(ys) {
  const [upper, lower] = ys[0] <= ys[1] ? [0, 1] : [1, 0];
  const overlap = MIN_LABEL_GAP - (ys[lower] - ys[upper]);
  const placed = [...ys];
  if (overlap > 0) {
    placed[upper] -= overlap / 2;
    placed[lower] += overlap / 2;
  }
  return placed;
}

export function TrendChart({ points, place, onMoment, pending = 'Recontando as parciais anteriores…' }) {
  const [ref, width] = useWidth();
  const [active, setActive] = useState(null);
  const ready = points.length > 1 && width > 0;

  let plot = null;
  if (ready) {
    const { low, high, ticks } = shareScale(points);
    const innerWidth = width - MARGIN.left - MARGIN.right, innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
    const x = completion => MARGIN.left + completion * innerWidth;
    const y = value => MARGIN.top + (high - value * 100) / (high - low) * innerHeight;
    const last = points.at(-1);
    const labelYs = endLabels(last.shares.map(y));
    const focus = active != null ? points[Math.min(active, points.length - 1)] : null;

    const nearest = clientX => {
      const completion = (clientX - ref.current.getBoundingClientRect().left - MARGIN.left) / innerWidth;
      return points.reduce((best, point, i) =>
        Math.abs(point.completion - completion) < Math.abs(points[best].completion - completion) ? i : best, 0);
    };
    const onKeyDown = event => {
      if (event.key === 'Enter' && active != null) return onMoment(points[active].minute);
      const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
      if (!step) return;
      event.preventDefault();
      setActive(index => Math.max(0, Math.min(points.length - 1, (index ?? points.length - 1) + step)));
    };

    plot = html`
      <svg width=${width} height=${HEIGHT} role="img" tabindex="0"
        aria-label=${`Percentual de cada candidato ao longo da apuração em ${place}. Use as setas para percorrer e Enter para levar o mapa a esse momento.`}
        onPointerMove=${event => setActive(nearest(event.clientX))} onPointerLeave=${() => setActive(null)}
        onClick=${event => onMoment(points[nearest(event.clientX)].minute)}
        onKeyDown=${onKeyDown} onBlur=${() => setActive(null)}>
        ${ticks.map(tick => html`<g key=${tick}>
          <line class="trend-grid" x1=${MARGIN.left} x2=${width - MARGIN.right} y1=${y(tick / 100)} y2=${y(tick / 100)}/>
          <text class="trend-tick" x=${MARGIN.left - 8} y=${y(tick / 100)} dy="0.32em" text-anchor="end">${tick}%</text>
        </g>`)}
        ${X_TICKS.map(tick => html`<text key=${tick} class="trend-tick" x=${x(tick)} y=${HEIGHT - 6}
          text-anchor=${tick === 0 ? 'start' : tick === 1 ? 'end' : 'middle'}>${tick * 100}%${tick === 0 ? ' das seções' : ''}</text>`)}

        ${focus && html`<line class="trend-crosshair" x1=${x(focus.completion)} x2=${x(focus.completion)} y1=${MARGIN.top} y2=${HEIGHT - MARGIN.bottom}/>`}
        ${SERIES.map(index => html`<path key=${index} class=${'trend-line tone-' + CANDIDATES[index].tone}
          d=${points.map((point, i) => `${i ? 'L' : 'M'}${x(point.completion).toFixed(1)} ${y(point.shares[index]).toFixed(1)}`).join('')}/>`)}
        ${SERIES.map(index => html`<g key=${index}>
          <circle class=${'trend-dot tone-' + CANDIDATES[index].tone} cx=${x(last.completion)} cy=${y(last.shares[index])} r="4"/>
          <text class="trend-value" x=${x(last.completion) + 9} y=${labelYs[index]} dy="0.32em">${percent(last.shares[index])}</text>
          ${focus && focus !== last && html`<circle class=${'trend-dot tone-' + CANDIDATES[index].tone} cx=${x(focus.completion)} cy=${y(focus.shares[index])} r="4"/>`}
        </g>`)}
      </svg>
      ${focus && html`<div class="trend-tooltip" style=${{ left: Math.max(0, Math.min(width - 216, x(focus.completion) + 10)) + 'px' }}>
        <span>${percent(focus.completion)} das seções</span>
        ${SERIES.map(index => html`<p key=${index}><i class=${'line-key tone-' + CANDIDATES[index].tone}></i><b>${percent(focus.shares[index])}</b>${CANDIDATES[index].name}</p>`)}
        <span>Clique para ver o mapa nesse momento</span>
      </div>`}
      <table class="sr-only">
        <caption>Percentual dos votos válidos conforme as seções foram apuradas em ${place}</caption>
        <thead><tr><th>Seções apuradas</th>${SERIES.map(index => html`<th key=${index}>${CANDIDATES[index].name}</th>`)}</tr></thead>
        <tbody>${points.filter((_, i) => i % 4 === 0 || i === points.length - 1).map(point => html`<tr key=${point.minute}>
          <td>${percent(point.completion)}</td>${SERIES.map(index => html`<td key=${index}>${percent(point.shares[index])}</td>`)}
        </tr>`)}</tbody>
      </table>`;
  }

  return html`<section class="insight">
    <h3>Ao longo da apuração</h3>
    <ul class="trend-legend">${SERIES.map(index => html`<li key=${index}><i class=${'line-key tone-' + CANDIDATES[index].tone}></i>${CANDIDATES[index].name}</li>`)}</ul>
    <div class="trend-plot" ref=${ref} style=${{ height: HEIGHT + 'px' }}>
      ${plot || html`<p class="trend-loading">${pending}</p>`}
    </div>
  </section>`;
}
