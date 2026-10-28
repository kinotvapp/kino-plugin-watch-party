// The guest's player: the correction a panel call carries to follow the host, and the lag a seek left.

import { LIMITS } from "../limits.js";
import { mediaMatch } from "../protocol/media.js";
import { expectedPos, skewOf, syncAction } from "../protocol/playback.js";

/**
 * The correction this panel call carries, recorded so the player events it causes are known as ours. After a seek, once the
 * video moves again (or LIMITS.seekGapMs passed), the lag it left is measured against where the host is NOW and folded into
 * `lead` (`lead + residual`, kept within 0..5 s): a slow first seek and fast later ones converge instead of overshooting.
 */
export function correction(p, ctx, now) {
  if (p.phase !== "party" || p.role !== "guest" || !p.handle || p.awaiting) return null;
  const local = { pos: Number(ctx.positionMs) || 0, paused: ctx.paused, speed: ctx.player && ctx.player.speed };
  const skew = skewOf(p.skew);
  const sp = p.seekPending;
  if (sp && !sp.measured && p.st && !p.st.paused && (local.pos > sp.to + 300 || now - sp.at >= LIMITS.seekGapMs)) {
    const residual = Math.round(expectedPos(p.st, now, skew) - local.pos);
    p.lead = Math.max(0, Math.min(5000, p.lead + residual));
    p.seekPending = { ...sp, measured: true };
  }
  p.seeks = p.seeks.filter((t) => now - t < 60000);
  const action = syncAction({
    local, st: p.st, stAt: p.stAt, now, skew, follow: p.follow, match: mediaMatch(ctx, p.media), hold: p.hold,
    lastAction: p.lastAction, durationMs: Number.isFinite(ctx.durationMs) ? ctx.durationMs : null, seeks: p.seeks, lead: p.lead,
  });
  const off = p.st && p.follow && !p.hold && Math.abs(expectedPos(p.st, now, skew) - local.pos) > LIMITS.driftMs;
  p.stuck = Boolean(off && p.seeks.length >= LIMITS.seeksPerMinute);
  if (!action) return null;
  if (action.pause !== undefined || action.speed !== undefined) p.lastAction = now;
  if (action.pause !== undefined) p.expect = { paused: action.pause, at: now };
  if (action.seekToMs !== undefined) {
    p.seeks = [...p.seeks, now];
    p.seekPending = { to: action.seekToMs, at: now, measured: false };
    p.correctedTo = action.seekToMs;
    p.correctedAt = now;
  }
  return action;
}
