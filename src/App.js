import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { html } from './lib/html.js';
import { buildTrend, recentUpdates, stateFlips } from './data/history.js';
import { liveFlips, liveTrend, liveUpdates, useLive } from './data/live.js';
import { buildSnapshot, OFFICES, STATES, zoneResults } from './data/mocks.js';
import { useClock } from './hooks/useClock.js';
import { useHistory } from './hooks/useHistory.js';
import { useHotkey } from './hooks/useHotkey.js';
import { useMediaQuery } from './hooks/useMediaQuery.js';
import { useRoute } from './hooks/useRoute.js';
import { useTheme } from './hooks/useTheme.js';
import { exportMap } from './map/exportMap.js';
import { Insights } from './components/Insights.js';
import { MapStage } from './components/MapStage.js';
import { Scoreboard } from './components/Scoreboard.js';
import { SearchDialog } from './components/SearchDialog.js';
import { SidePanel } from './components/SidePanel.js';
import { TopBar } from './components/TopBar.js';

// The capital's presidential zones have hand-set shares, so the state calibration skips it.
const FIXED_CAPITAL = '3550308';
// Mirrors styles/layout.css: three columns when wide, a bottom sheet when narrow.
const WIDE_LAYOUT = '(min-width: 1440px)';
const SHEET_LAYOUT = '(max-width: 999px)';
const FLIP_HIGHLIGHT_MS = 2500;
const NO_FLIPS = new Set();

/** States that changed hands since the previous snapshot, kept for a moment so the map can outline them. */
function useFlipped(states, office) {
  const [flipped, setFlipped] = useState(NO_FLIPS);
  const previous = useRef(null), timer = useRef();

  useEffect(() => {
    const winners = Object.fromEntries(Object.entries(states).map(([uf, result]) => [uf, result.winner]));
    const before = previous.current;
    previous.current = { office, winners };
    if (!before || before.office !== office) return;
    const changed = Object.keys(winners).filter(uf => winners[uf] !== before.winners[uf]);
    if (!changed.length) return;
    setFlipped(new Set(changed));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setFlipped(NO_FLIPS), FLIP_HIGHLIGHT_MS);
  }, [states]);
  useEffect(() => () => clearTimeout(timer.current), []);

  return flipped;
}

export function App({ geo, live }) {
  const route = useRoute(geo);
  const feed = useLive(geo, live, route.replay);
  const clock = useClock(route.replay, minute => route.setReplay(minute == null ? null : Math.round(minute)), feed?.minute);
  const [theme, toggleTheme] = useTheme();
  const [searching, setSearching] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const wide = useMediaQuery(WIDE_LAYOUT), asSheet = useMediaQuery(SHEET_LAYOUT);
  const stage = useRef();

  const { uf } = route;
  const office = feed ? OFFICES[0] : route.office;
  const municipality = route.municipalityId ? geo.byId.get(route.municipalityId) : null;
  const snapshot = useMemo(() => feed?.snapshot ?? buildSnapshot(geo, clock.minute, office), [geo, feed?.snapshot, clock.minute, office]);
  const zoneRows = useMemo(() => {
    const geometry = !feed && municipality && geo.zonesFor(municipality.id);
    if (!geometry) return null;
    const fixed = municipality.id === FIXED_CAPITAL && office === OFFICES[0];
    return zoneResults(municipality, geometry, clock.minute, office, fixed ? 0 : snapshot.adjustments[municipality.uf]);
  }, [geo, municipality, snapshot]);

  const scope = municipality
    ? { name: municipality.name, result: snapshot.results.get(municipality.id) }
    : uf ? { name: STATES[uf][0], result: snapshot.states[uf] } : { name: 'Brasil', result: snapshot.national };

  const simHistory = useHistory(feed ? null : geo, office);
  const history = feed ? feed.samples : simHistory;
  const trend = useMemo(
    () => feed ? liveTrend(history, { uf, municipality }, clock.minute, scope.result)
      : buildTrend(geo, history, { uf, municipality }, office, clock.minute, scope.result),
    [geo, history, municipality, snapshot, uf],
  );
  const updates = useMemo(() => feed ? liveUpdates(history, uf, clock.minute)
    : recentUpdates(trend, scope.result, clock.minute, { national: !uf }), [trend]);
  const flips = useMemo(() => uf ? null : (feed ? liveFlips : stateFlips)(history, clock.minute, snapshot.states), [history, snapshot, uf]);
  const flipped = useFlipped(snapshot.states, office);

  // Picking a place from the sheet closes it, so the map underneath shows the result.
  const navigation = {
    ...route,
    openState: code => { route.openState(code); setSheetOpen(false); },
    openMunicipality: id => { route.openMunicipality(id); setSheetOpen(false); },
  };

  useHotkey('/', event => { event.preventDefault(); setSearching(true); }, { enabled: !searching });
  useHotkey('Escape', () => {
    if (asSheet && sheetOpen) setSheetOpen(false);
    else if (uf) route.back();
  }, { enabled: !searching });

  const saveMap = () => exportMap({
    frame: stage.current,
    theme,
    filename: `mapa-${municipality?.id || uf || 'brasil'}-${feed ? 'tse' : 'simulado'}.png`,
  });

  const insights = html`<${Insights} place=${scope.name} result=${scope.result} trend=${trend}
    flips=${flips} updates=${updates} onMoment=${clock.replay}
    pending=${feed ? (municipality ? 'A série histórica cobre o Brasil e os estados.' : 'Aguardando a próxima coleta…') : undefined}/>`;

  return html`<div class="app">
    <${TopBar} office=${office} offices=${feed ? [OFFICES[0]] : OFFICES} live=${feed} onOffice=${route.setOffice} theme=${theme} onToggleTheme=${toggleTheme}
      onSearch=${() => setSearching(true)} onDownload=${saveMap}/>

    <main>
      <${Scoreboard} office=${office} scope=${scope.name} result=${scope.result} majorityRule=${office === OFFICES[0] && !uf}/>
      <div class=${'workspace' + (wide ? ' is-wide' : '')}>
        ${wide && html`<aside class="insights-column" aria-label="Andamento da apuração">${insights}</aside>`}
        <${MapStage} stageRef=${stage} geo=${geo} snapshot=${snapshot} route=${navigation}
          municipality=${municipality} zoneRows=${zoneRows} theme=${theme} clock=${clock} flipped=${flipped}/>
        ${asSheet && sheetOpen && html`<div class="sheet-backdrop" onClick=${() => setSheetOpen(false)}></div>`}
        <${SidePanel} geo=${geo} snapshot=${snapshot} route=${navigation} municipality=${municipality}
          zoneRows=${zoneRows} theme=${theme} placeName=${scope.name} insights=${wide ? null : insights}
          sheet=${asSheet ? { open: sheetOpen, toggle: () => setSheetOpen(open => !open) } : null} live=${!!feed}/>
      </div>
    </main>

    ${searching && html`<${SearchDialog} geo=${geo} onState=${navigation.openState}
      onMunicipality=${navigation.openMunicipality} onClose=${() => setSearching(false)}/>`}
  </div>`;
}
