import { render } from 'preact';
import { html } from './lib/html.js';
import { createGeography } from './map/geography.js';
import { App } from './App.js';
import { loadLive } from './data/live.js';
import './styles/index.css';

const DATA_FILES = ['/data/brasil.topo.json', '/data/zonas.json'];
const root = document.getElementById('app');

async function loadJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Não foi possível carregar ${url} (HTTP ${response.status}).`);
  return response.json();
}

function BootError({ error }) {
  return html`<div class="boot" role="alert">
    <h1>O mapa não carregou</h1>
    <p>${error.message}</p>
    <button class="button" onClick=${() => location.reload()}>Tentar de novo</button>
  </div>`;
}

try {
  const [topology, zones, live] = await Promise.all([...DATA_FILES.map(loadJson), loadLive()]);
  root.replaceChildren();
  render(html`<${App} geo=${createGeography(topology, zones)} live=${live}/>`, root);
} catch (error) {
  root.replaceChildren();
  render(html`<${BootError} error=${error}/>`, root);
}
