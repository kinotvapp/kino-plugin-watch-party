// Playback sync (pure): the host's clock offset, where its video should be now, and what a guest's player should do.

import { LIMITS, SPEEDS } from "../limits.js";

/** The last offset samples (this device's clock minus the host's, latency included); the host's offset is their minimum. */
export function observeSkew(samples, sample) {
  return [...samples, sample].slice(-10);
}
export const skewOf = (samples) => (samples.length ? Math.min(...samples) : 0);

/** Where the host's video should be now, from its last state. */
export function expectedPos(st, now, skew) {
  if (st.paused) return st.pos;
  const age = Math.max(0, now - st.at - skew);
  return st.pos + age * (SPEEDS.includes(st.speed) ? st.speed : 1);
}

/** Whether a seek may run now: at most LIMITS.seeksPerMinute a minute, LIMITS.seekGapMs after the last one, doubling. */
export function seekAllowed(seeks, now) {
  const recent = seeks.filter((t) => now - t < 60000);
  if (recent.length >= LIMITS.seeksPerMinute) return false;
  if (!recent.length) return true;
  return now - recent[recent.length - 1] >= LIMITS.seekGapMs * 2 ** (recent.length - 1);
}

/**
 * What a guest's player should do to follow the host: a `KinoPlayerAction` (`pause`, `seekToMs`, `speed`) or null. Nothing
 * while following is off, the title or the source differ, the person paused or resumed by themselves (`hold`), or the host's
 * state is stale. A pause or speed change at least LIMITS.actionGapMs after the last correction; a seek only past
 * LIMITS.driftMs and only when [seekAllowed], aimed ahead by the lag the last seek left ([lead], at most 5 s).
 */
export function syncAction({ local, st, stAt, now, skew = 0, follow = true, match = { ok: true }, hold = false, lastAction = 0, durationMs = null, seeks = [], lead = 0 }) {
  if (!follow || !match.ok || hold || !st) return null;
  if (now - stAt > LIMITS.stateStaleMs) return null;
  const action = {};
  const soon = now - lastAction < LIMITS.actionGapMs;
  if (!soon && st.paused !== Boolean(local.paused)) action.pause = st.paused;
  const want = Math.round(expectedPos(st, now, skew));
  if (Math.abs(want - local.pos) > LIMITS.driftMs && seekAllowed(seeks, now)) {
    const target = want + (st.paused ? 0 : Math.max(0, Math.min(lead, 5000)));
    action.seekToMs = Math.max(0, durationMs ? Math.min(target, durationMs) : target);
  }
  const speed = SPEEDS.includes(st.speed) ? st.speed : 1;
  const mine = SPEEDS.includes(local.speed) ? local.speed : 1;
  if (!soon && speed !== mine) action.speed = speed;
  return Object.keys(action).length ? action : null;
}
