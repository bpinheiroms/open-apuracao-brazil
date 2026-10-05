import { html } from '../lib/html.js';
import { clockTime } from '../lib/format.js';
import { CLOCK } from '../data/clock.js';

const HOUR_TICKS = [17, 19, 21, 23];

export function Timeline({ clock }) {
  return html`<div class="timeline">
    <time class="timeline-clock">${clockTime(clock.seconds)}</time>
    <div class="timeline-range">
      <input type="range" min=${CLOCK.start} max=${CLOCK.end} step="1" value=${Math.floor(clock.seconds / 60)}
        onInput=${event => clock.replay(+event.currentTarget.value)}
        aria-label="Hora da apuração" aria-valuetext=${clockTime(clock.seconds).slice(0, 5)}/>
      <div class="timeline-ticks" aria-hidden="true">${HOUR_TICKS.map(hour => html`<span key=${hour}>${hour}h</span>`)}</div>
    </div>
    <button class="live-button" aria-pressed=${clock.live} onClick=${clock.goLive}>
      <i class="pulse"></i>${clock.archived ? (clock.live ? 'Último dado' : 'Ir ao último dado') : clock.live ? 'Ao vivo' : 'Voltar ao vivo'}
    </button>
  </div>`;
}
