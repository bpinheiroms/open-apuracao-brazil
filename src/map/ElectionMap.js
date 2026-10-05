import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { html } from '../lib/html.js';
import { percent, leaderShare } from '../lib/format.js';
import { CANDIDATES, resultColor } from '../data/mocks.js';
import { Icon } from '../components/Icon.js';
import { cameraFor } from './geography.js';
import { MAP_THEMES, inkOn } from './mapTheme.js';

// Coastal states too small to label in place: listed beside the map with a leader line.
const CALLOUTS = ['RN', 'PB', 'PE', 'AL', 'SE', 'ES', 'RJ'];
const CALLOUT_ROW = 22;
const LABEL_NUDGE = { DF: [3, -3], GO: [-7, 5] };
const DRAG_THRESHOLD = 5;
const ZOOM_STEP = 1.55;
const CAMERA_MS = 520;
// Bubble mode: the largest electorate (São Paulo) gets a radius of 6% of the country's width.
const LARGEST_ELECTORATE = 9.2e6;
const LARGEST_BUBBLE = .06;
const SMALLEST_BUBBLE_PX = 1.5;
// Below this frame width there is no room for a percentage beside each state code.
const MIN_WIDTH_FOR_SHARES = 500;

const inside = (box, x, y) => x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3];
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const calloutPosition = (index, size) => [size.width * .882, size.height * .29 + index * CALLOUT_ROW + (index > 4 ? 7 : 0)];

/**
 * `unit` picks what is drawn before a state is opened (states, municipalities, or one bubble
 * per municipality sized by electorate); `metric` picks the colour (who leads, or how much is counted).
 * `flipped` lists states that just changed hands, outlined until the caller clears them.
 */
export function ElectionMap({ geo, results, stateResults, uf, municipality, zoneRows, selectedZone, theme, unit, metric, flipped, onState, onMunicipality, onZone }) {
  const root = useRef(), canvas = useRef(), camera = useRef(), target = useRef(), frame = useRef(), drawRef = useRef();
  const interaction = useRef({}), touches = useRef(new Map());
  const [size, setSize] = useState({ width: 500, height: 500 });
  const [hover, setHover] = useState(null), [view, setView] = useState(null);
  const zones = municipality && zoneRows && geo.zonesFor(municipality.id);
  const colors = MAP_THEMES[theme];
  const fill = result => resultColor(result, theme, metric);
  const bubbles = unit === 'eleitorado';
  const byMunicipality = uf || unit !== 'estados';
  const largestFirst = useMemo(() => [...geo.municipalities].sort((a, b) => b.population - a.population), [geo]);
  const bubbleScale = LARGEST_BUBBLE * (geo.box[2] - geo.box[0]) / Math.sqrt(LARGEST_ELECTORATE);
  const labelValue = result => percent(metric === 'apurado' ? result.completion : leaderShare(result), 0);

  useLayoutEffect(() => {
    const resize = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width && height) setSize({ width, height });
    });
    resize.observe(root.current);
    return () => resize.disconnect();
  }, []);

  const draw = () => {
    const c = canvas.current;
    if (!c || !camera.current) return;
    const ctx = c.getContext('2d'), dpr = Math.min(devicePixelRatio || 1, 2), { width, height } = size;
    if (c.width !== Math.round(width * dpr) || c.height !== Math.round(height * dpr)) {
      c.width = Math.round(width * dpr);
      c.height = Math.round(height * dpr);
    }
    const { k, x, y } = camera.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.translate(x, y);
    ctx.scale(k, k);
    ctx.lineJoin = 'round';

    const visible = m => !(m.box[2] * k + x < 0 || m.box[0] * k + x > width || m.box[3] * k + y < 0 || m.box[1] * k + y > height);
    // Places outside the open state, or beside the open municipality, are dimmed.
    const emphasis = m => uf && m.uf !== uf ? .13 : municipality && m.id !== municipality.id ? .38 : 1;
    if (!byMunicipality) {
      for (const state of Object.values(geo.states)) {
        ctx.fillStyle = fill(stateResults[state.uf]);
        ctx.fill(state.fill);
      }
    } else if (bubbles) {
      ctx.fillStyle = resultColor(null, theme);
      for (const state of Object.values(geo.states)) {
        ctx.globalAlpha = uf && state.uf !== uf ? .35 : 1;
        ctx.fill(state.fill);
      }
      ctx.strokeStyle = colors.background;
      ctx.lineWidth = .6 / k;
      // Bubbles grow with the square root of the zoom, so a zoomed-in state does not drown in them.
      const zoomDamping = Math.sqrt(k / cameraFor(geo, null, null, width, height).k);
      for (const m of largestFirst) {
        if (!visible(m)) continue;
        const result = results.get(m.id);
        ctx.globalAlpha = emphasis(m) * .92;
        ctx.fillStyle = fill(result);
        ctx.beginPath();
        ctx.arc(m.center[0], m.center[1], Math.max(SMALLEST_BUBBLE_PX / k, Math.sqrt(result.electorate) * bubbleScale / zoomDamping), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    } else {
      for (const m of geo.municipalities) {
        if (!visible(m)) continue;
        ctx.globalAlpha = emphasis(m);
        ctx.fillStyle = fill(results.get(m.id));
        ctx.fill(m.path);
      }
      if (uf) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = colors.municipalityBorder;
        ctx.lineWidth = .5 / k;
        ctx.stroke(geo.borders.municipality);
      }
    }

    ctx.globalAlpha = 1;
    ctx.strokeStyle = colors.background;
    ctx.lineWidth = 1.4 / k;
    ctx.stroke(geo.borders.state);
    ctx.strokeStyle = colors.coast;
    ctx.lineWidth = 1 / k;
    ctx.stroke(geo.borders.coast);
    if (uf) {
      ctx.strokeStyle = colors.stateOutline;
      ctx.lineWidth = 1.4 / k;
      ctx.stroke(geo.states[uf].outline);
    }

    if (!uf && flipped?.size) {
      ctx.strokeStyle = colors.focus;
      ctx.lineWidth = 2.5 / k;
      for (const code of flipped) ctx.stroke(geo.states[code].outline);
    }

    if (municipality) {
      ctx.save();
      ctx.shadowColor = colors.focusGlow;
      ctx.shadowBlur = 8 * dpr;
      ctx.strokeStyle = colors.focus;
      ctx.lineWidth = (zones ? 4 : 2) / k;
      if (zones) for (const path of zones.paths) ctx.stroke(path);
      else ctx.stroke(municipality.path);
      ctx.restore();
      if (zones) {
        zones.paths.forEach((path, i) => {
          ctx.fillStyle = fill(zoneRows[i]);
          ctx.fill(path, 'evenodd');
        });
        ctx.strokeStyle = colors.background;
        ctx.lineWidth = 1.2 / k;
        for (const path of zones.paths) ctx.stroke(path);
        const selected = selectedZone != null ? zones.numbers.indexOf(selectedZone) : -1;
        if (selected >= 0) {
          ctx.strokeStyle = colors.focus;
          ctx.lineWidth = 2 / k;
          ctx.stroke(zones.paths[selected]);
        }
      }
    }

    if (hover && !interaction.current.dragging) {
      ctx.strokeStyle = colors.hover;
      ctx.lineWidth = 1.4 / k;
      if (hover.zoneIndex != null) ctx.stroke(zones.paths[hover.zoneIndex]);
      else if (uf && hover.municipality) ctx.stroke(hover.municipality.path);
      else if (hover.uf) ctx.stroke(geo.states[hover.uf].outline);
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!uf) {
      CALLOUTS.forEach((code, i) => {
        const center = geo.states[code].center, [tx, ty] = calloutPosition(i, size);
        ctx.strokeStyle = colors.calloutLine;
        ctx.lineWidth = .7;
        ctx.beginPath();
        ctx.moveTo(center[0] * k + x, center[1] * k + y);
        ctx.lineTo(tx - 6, ty + 11);
        ctx.stroke();
      });
    }
  };
  drawRef.current = draw;

  const setCamera = next => {
    camera.current = next;
    setView({ ...next });
    drawRef.current();
  };

  const animate = () => {
    cancelAnimationFrame(frame.current);
    const from = { ...camera.current }, to = { ...target.current }, start = performance.now();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const tick = now => {
      const t = reduced ? 1 : Math.min(1, (now - start) / CAMERA_MS), ease = 1 - (1 - t) ** 4;
      setCamera({ k: from.k + (to.k - from.k) * ease, x: from.x + (to.x - from.x) * ease, y: from.y + (to.y - from.y) * ease });
      if (t < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  };

  // Fly to a new place, but snap when only the frame was resized.
  const place = `${uf}/${municipality?.id}`, lastPlace = useRef(place);
  useLayoutEffect(() => {
    target.current = cameraFor(geo, uf, municipality, size.width, size.height);
    if (!camera.current || lastPlace.current === place) setCamera({ ...target.current });
    else animate();
    lastPlace.current = place;
    setHover(null);
    return () => cancelAnimationFrame(frame.current);
  }, [size.width, size.height, place]);

  useLayoutEffect(() => { draw(); }, [results, stateResults, zoneRows, selectedZone, hover, theme, unit, metric, flipped]);

  const position = event => {
    const box = canvas.current.getBoundingClientRect();
    return [event.clientX - box.left, event.clientY - box.top];
  };

  const hit = event => {
    const [sx, sy] = position(event), cam = camera.current, x = (sx - cam.x) / cam.k, y = (sy - cam.y) / cam.k;
    const ctx = canvas.current.getContext('2d');
    // Hit testing uses map coordinates, independent of the drawing transform.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    try {
      if (zones) for (let i = 0; i < zones.paths.length; i++) {
        if (ctx.isPointInPath(zones.paths[i], x, y, 'evenodd')) return { uf, municipality, zoneIndex: i, zone: zones.numbers[i], sx, sy };
      }
      const candidates = uf ? geo.states[uf].municipalities : geo.municipalities;
      for (const m of candidates) {
        if (inside(m.box, x, y) && ctx.isPointInPath(m.path, x, y)) return { uf: m.uf, municipality: m, sx, sy };
      }
      return null;
    } finally {
      ctx.restore();
    }
  };

  const zoom = (factor, anchor = [size.width / 2, size.height / 2], smooth = true) => {
    const old = camera.current, base = cameraFor(geo, uf, municipality, size.width, size.height);
    const k = Math.max(base.k * .65, Math.min(base.k * 10, old.k * factor));
    target.current = { k, x: anchor[0] - (anchor[0] - old.x) * (k / old.k), y: anchor[1] - (anchor[1] - old.y) * (k / old.k) };
    if (smooth) animate();
    else setCamera({ ...target.current });
  };

  const recenter = () => {
    target.current = cameraFor(geo, uf, municipality, size.width, size.height);
    animate();
  };

  const pointerDown = event => {
    if (event.button !== 0) return;
    const p = position(event);
    touches.current.set(event.pointerId, p);
    interaction.current = { start: p, previous: p, dragging: false };
    if (touches.current.size === 2) interaction.current.pinchDistance = distance(...touches.current.values());
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const pointerMove = event => {
    const p = position(event), act = interaction.current;
    if (touches.current.has(event.pointerId)) {
      touches.current.set(event.pointerId, p);
      if (touches.current.size === 2) {
        const [a, b] = [...touches.current.values()], spread = distance(a, b);
        if (act.pinchDistance) zoom(spread / act.pinchDistance, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], false);
        act.pinchDistance = spread;
        act.dragging = true;
        return;
      }
      if (act.start && distance(p, act.start) > DRAG_THRESHOLD) act.dragging = true;
      if (act.dragging) {
        cancelAnimationFrame(frame.current);
        setCamera({ ...camera.current, x: camera.current.x + p[0] - act.previous[0], y: camera.current.y + p[1] - act.previous[1] });
        act.previous = p;
        return;
      }
    }
    if (event.pointerType === 'mouse') setHover(hit(event));
  };

  const pointerUp = event => {
    const dragged = interaction.current.dragging;
    touches.current.delete(event.pointerId);
    if (!dragged) {
      const area = hit(event);
      if (area?.zone != null) onZone(area.zone);
      else if (area && !uf) onState(area.uf);
      else if (area) onMunicipality(area.municipality.id);
    }
    interaction.current = touches.current.size
      ? { ...interaction.current, dragging: true, previous: [...touches.current.values()][0] }
      : {};
  };

  const pointerCancel = () => {
    touches.current.clear();
    interaction.current = {};
  };

  useEffect(() => {
    const c = canvas.current;
    // On narrow screens the wheel scrolls the page; ctrl+wheel (trackpad pinch) still zooms.
    const wheel = event => {
      if (innerWidth < 1000 && !event.ctrlKey) return;
      event.preventDefault();
      zoom(Math.exp(-event.deltaY * .0015), position(event), false);
    };
    c.addEventListener('wheel', wheel, { passive: false });
    return () => c.removeEventListener('wheel', wheel);
  }, [size, uf, municipality?.id]);

  const cam = view || cameraFor(geo, uf, municipality, size.width, size.height);
  const accessibleName = municipality
    ? `Mapa de ${municipality.name}${zones ? ', dividido em zonas eleitorais' : ''}`
    : uf ? `Mapa dos municípios de ${stateResults[uf].name}` : 'Mapa do Brasil por estado';

  const hovered = hover && (hover.zone != null
    ? { name: zones.names[hover.zoneIndex], result: zoneRows[hover.zoneIndex] }
    : byMunicipality ? { name: hover.municipality.name + (uf ? '' : ` (${hover.uf})`), result: results.get(hover.municipality.id) }
    : { name: stateResults[hover.uf].name, result: stateResults[hover.uf] });
  const showShares = size.width >= MIN_WIDTH_FOR_SHARES;
  // Over a single state fill the label takes a contrasting ink; over many small fills it needs a halo.
  const floating = unit !== 'estados';

  return html`<div class=${'map-frame ' + (uf ? 'detail-map' : 'national-map')} ref=${root}>
    <canvas ref=${canvas} role="img" aria-label=${accessibleName} data-testid="election-map"
      class=${interaction.current.dragging ? 'dragging' : ''}
      onPointerDown=${pointerDown} onPointerMove=${pointerMove} onPointerUp=${pointerUp}
      onPointerCancel=${pointerCancel} onPointerLeave=${() => setHover(null)}></canvas>

    ${!uf && html`<div class="state-labels" role="group" aria-label="Selecionar um estado">
      ${Object.values(geo.states).filter(state => !CALLOUTS.includes(state.uf)).map(state => {
        const [dx, dy] = LABEL_NUDGE[state.uf] || [0, 0];
        const result = stateResults[state.uf];
        const style = {
          left: state.center[0] * cam.k + cam.x + dx + 'px',
          top: state.center[1] * cam.k + cam.y + dy + 'px',
          color: floating ? null : inkOn(fill(result)),
        };
        return html`<button key=${state.uf} class=${'state-label' + (floating ? ' is-floating' : '')} style=${style}
          onClick=${() => onState(state.uf)} aria-label=${`Abrir ${result.name}`}>
          <b>${state.uf}</b>${showShares && html`<span>${labelValue(result)}</span>`}
        </button>`;
      })}
      ${CALLOUTS.map((code, i) => {
        const [left, top] = calloutPosition(i, size), result = stateResults[code], background = fill(result);
        return html`<button key=${code} class="state-callout"
          style=${{ left: left + 'px', top: top + 'px', background, color: inkOn(background) }}
          onClick=${() => onState(code)} aria-label=${`Abrir ${result.name}`}>
          <b>${code}</b>${showShares && html`<span>${labelValue(result)}</span>`}
        </button>`;
      })}
    </div>`}

    ${(uf || size.width > 500) && html`<div class="zoom-controls" role="group" aria-label="Zoom do mapa">
      <button onClick=${() => zoom(ZOOM_STEP)} aria-label="Aproximar o mapa"><${Icon} name="plus" size=${16}/></button>
      <button onClick=${() => zoom(1 / ZOOM_STEP)} aria-label="Afastar o mapa"><${Icon} name="minus" size=${16}/></button>
      <button onClick=${recenter} aria-label="Centralizar o mapa"><${Icon} name="recenter" size=${16}/></button>
    </div>`}

    ${hovered && html`<div class="map-tooltip" style=${{ left: Math.max(10, Math.min(size.width - 200, hover.sx + 12)) + 'px', top: Math.max(10, hover.sy - 62) + 'px' }}>
      <strong>${hovered.name}</strong>
      ${metric === 'apurado'
        ? html`<span>${percent(hovered.result.completion)} das seções apuradas</span>`
        : html`<span><i class=${'swatch tone-' + CANDIDATES[hovered.result.winner].tone}></i>
            ${CANDIDATES[hovered.result.winner].name} · ${percent(leaderShare(hovered.result))}</span>`}
    </div>`}
  </div>`;
}
