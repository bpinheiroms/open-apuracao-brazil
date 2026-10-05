import { useEffect, useState } from 'preact/hooks';
import { buildSnapshot } from '../data/mocks.js';
import { SAMPLE_MINUTES, toSample } from '../data/history.js';

const START_DELAY_MS = 400;
const STEP_DELAY_MS = 30;
const cache = new Map();

/**
 * Past snapshots for the trend chart. Each one costs a full national recount, so they are
 * computed one per timer tick after first paint and kept per office for the session.
 */
export function useHistory(geo, office) {
  const [samples, setSamples] = useState(() => cache.get(office) ?? []);

  useEffect(() => {
    if (!geo) return;
    let timer;
    const step = () => {
      const done = cache.get(office) ?? [];
      if (done.length >= SAMPLE_MINUTES.length) return;
      const minute = SAMPLE_MINUTES[done.length];
      const next = [...done, toSample(minute, buildSnapshot(geo, minute, office))];
      cache.set(office, next);
      setSamples(next);
      timer = setTimeout(step, STEP_DELAY_MS);
    };
    setSamples(cache.get(office) ?? []);
    timer = setTimeout(step, START_DELAY_MS);
    return () => clearTimeout(timer);
  }, [geo, office]);

  return samples;
}
