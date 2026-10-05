import { useEffect, useState } from 'preact/hooks';
import { CLOCK } from '../data/clock.js';

const LIVE_SECOND_OFFSET = 7;

/**
 * Simulated counting clock: advances locally while live, or sits on `replayMinute`
 * (owned by the route, so a replayed moment can be shared as a link).
 */
export function useClock(replayMinute, setReplayMinute, liveMinute = null) {
  const [ticks, setTicks] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTicks(t => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const live = replayMinute == null;
  if (liveMinute != null) {
    const minute = live ? liveMinute : replayMinute;
    return { live, seconds: minute * 60, minute, replay: setReplayMinute, goLive: () => setReplayMinute(null) };
  }
  const liveSeconds = Math.min(CLOCK.end * 60, CLOCK.live * 60 + LIVE_SECOND_OFFSET + ticks);
  return {
    live,
    seconds: live ? liveSeconds : replayMinute * 60,
    // Results are recomputed at most every 15 seconds while live.
    minute: live ? Math.min(CLOCK.end, CLOCK.live + Math.floor(ticks / 15) / 4) : replayMinute,
    replay: setReplayMinute,
    goLive: () => setReplayMinute(null),
  };
}
