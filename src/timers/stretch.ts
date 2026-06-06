// Stretch-reminder clock — M4 (KITTO_SPEC §5: "Stretch reminder (configurable
// interval) → Stretch state").
//
// PURE and wall-clock-driven: it takes an elapsed-milliseconds delta and returns
// the next state. It holds no clock of its own, so the caller can feed it *real*
// elapsed time (Date.now() deltas) and the reminder fires correctly across system
// sleep/wake — a long gap simply lands the cat in (or past) a stretch. The visible
// Stretch pose lives in the CatStateMachine; this module only decides *when*.

export interface StretchConfig {
  /** Master on/off for the reminder. */
  readonly enabled: boolean;
  /** Quiet time between reminders, in ms. */
  readonly intervalMs: number;
  /** How long the cat holds the stretch pose once a reminder fires, in ms. */
  readonly durationMs: number;
}

export const DEFAULT_STRETCH: StretchConfig = {
  enabled: true,
  intervalMs: 30 * 60_000, // every 30 minutes
  durationMs: 2_500, // a ~2.5s stretch
};

export interface StretchState {
  /** Accumulated quiet time since the last stretch finished, in ms. */
  readonly sinceLastMs: number;
  /** Remaining stretch-pose time, in ms; > 0 ⇒ the cat is mid-stretch. */
  readonly activeMs: number;
}

export function initStretch(): StretchState {
  return { sinceLastMs: 0, activeMs: 0 };
}

export function isStretching(s: StretchState): boolean {
  return s.activeMs > 0;
}

/**
 * Advance the reminder by `dtMs`. Returns the next state plus `started: true` on
 * the single tick a stretch begins (so the caller can fire a one-shot effect).
 *
 * While disabled the clock is held at rest. While a stretch is active it counts
 * down (no new reminder can start). Otherwise quiet time accumulates until it
 * reaches the interval, which begins a stretch for `durationMs`.
 */
export function tickStretch(
  s: StretchState,
  dtMs: number,
  cfg: StretchConfig,
): { state: StretchState; started: boolean } {
  const dt = Math.max(0, dtMs);

  if (!cfg.enabled) return { state: initStretch(), started: false };

  if (s.activeMs > 0) {
    const activeMs = s.activeMs - dt;
    // Whether it ended this tick or not, quiet time only restarts once it ends.
    return { state: { sinceLastMs: 0, activeMs: Math.max(0, activeMs) }, started: false };
  }

  const sinceLastMs = s.sinceLastMs + dt;
  if (sinceLastMs >= cfg.intervalMs) {
    return { state: { sinceLastMs: 0, activeMs: cfg.durationMs }, started: true };
  }
  return { state: { sinceLastMs, activeMs: 0 }, started: false };
}

/** Begin a stretch immediately (manual "stretch now" / Pomodoro phase change). */
export function forceStretch(_s: StretchState, cfg: StretchConfig): StretchState {
  return { sinceLastMs: 0, activeMs: cfg.durationMs };
}
