import { html } from '../lib/html.js';
import { OFFICES } from '../data/mocks.js';
import { Icon } from './Icon.js';

export function TopBar({ office, offices = OFFICES, live, onOffice, theme, onToggleTheme, onSearch, onDownload }) {
  const nextTheme = theme === 'dark' ? 'claro' : 'escuro';
  return html`<header class="topbar">
    <div class="brand">
      <h1>Apuração 2026</h1>
      ${live
        ? html`<span class=${'sim-chip ' + (live.stale ? 'is-stale' : 'is-live')} role="status"
            title=${live.final ? `Resultado final do TSE, totalizado em ${live.tse?.dg} às ${live.tse?.ht}.` : live.archived ? `Instantâneo estático dos dados do TSE coletados em ${live.tse?.dg} às ${live.tse?.ht}. Não é atualizado.` : `Dados oficiais do TSE totalizados às ${live.tse?.ht}. Última coleta há ${Math.round(live.age / 1000)} s.`}>
            ${live.final ? `TSE · resultado final ${live.tse?.dg?.slice(0, 5) ?? ''}` : live.archived ? html`TSE · <span class="chip-extra">instantâneo </span>${live.tse?.dg?.slice(0, 5)}<span class="chip-extra"> ${live.tse?.ht?.slice(0, 5)}</span>` : live.stale ? `Atrasado · ${Math.round(live.age / 60000)} min` : `TSE · ${live.tse?.ht?.slice(0, 5) ?? '--:--'}`}</span>`
        : html`<span class="sim-chip" title="Todos os votos, percentuais e o andamento da apuração são fictícios.">Simulação</span>`}
    </div>

    <nav class="office-tabs" aria-label="Cargo">
      ${offices.map(name => html`<button key=${name} class="office-tab" aria-pressed=${name === office}
        onClick=${() => onOffice(name)}>${name}</button>`)}
    </nav>

    <div class="topbar-actions">
      <button class="search-trigger" onClick=${onSearch} aria-label="Buscar estado ou município" aria-keyshortcuts="/">
        <${Icon} name="search" size=${16}/><span>Buscar um lugar</span><kbd>/</kbd>
      </button>
      <button class="icon-button" onClick=${onToggleTheme} aria-label=${`Mudar para o tema ${nextTheme}`} title=${`Tema ${nextTheme}`}>
        <${Icon} name=${theme === 'dark' ? 'sun' : 'moon'}/>
      </button>
      <button class="icon-button" onClick=${onDownload} aria-label="Salvar mapa como imagem" title="Salvar mapa como imagem">
        <${Icon} name="download"/>
      </button>
    </div>
  </header>`;
}
