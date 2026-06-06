// Pomodoro focus/break clock — M4 (KITTO_SPEC §5: "Pomodoro focus/break loop with
// floating pixel timer overlay").
//
// PURE and wall-clock-driven, like the stretch clock: every transition is a plain
// function of (state, elapsed-ms, config), so it is fully unit-tested and has no
// timer of its own. The caller feeds it *real* elapsed time (Date.now() deltas);
// `tickPomodoro` reconciles arbitrarily large gaps (e.g. the laptop slept through
// several phases) by consuming the overflow phase-by-phase, so on wake the cat is
// in the phase it should actually be in — not merely one boundary late.
//
// The visible floating MM:SS timer (render/timer-overlay.ts) reads this state; the
// cat itself reacts to phase *changes* (a celebratory stretch), not to the phase.

export type PomodoroPhase = "Focus" | "ShortBreak" | "LongBreak";
export type PomodoroStatus = "idle" | "running" | "paused";

export interface PomodoroConfig {
  readonly focusMs: number;
  readonly shortBreakMs: number;
  readonly longBreakMs: number;
  /** A long break replaces the short one after this many focus sessions. */
  readonly sessionsBeforeLongBreak: number;
}

export const DEFAULT_POMODORO: PomodoroConfig = {
  focusMs: 25 * 60_000,
  shortBreakMs: 5 * 60_000,
  longBreakMs: 15 * 60_000,
  sessionsBeforeLongBreak: 4,
};

export interface PomodoroState {
  readonly status: PomodoroStatus;
  readonly phase: PomodoroPhase;
  /** Remaining time in the current phase, in ms. */
  readonly remainingMs: number;
  /** Focus sessions completed in the current cycle (reset after a long break). */
  readonly completedFocus: number;
}

export function initPomodoro(cfg: PomodoroConfig = DEFAULT_POMODORO): PomodoroState {
  return { status: "idle", phase: "Focus", remainingMs: cfg.focusMs, completedFocus: 0 };
}

function durationFor(phase: PomodoroPhase, cfg: PomodoroConfig): number {
  if (phase === "Focus") return cfg.focusMs;
  return phase === "ShortBreak" ? cfg.shortBreakMs : cfg.longBreakMs;
}

/** The phase that follows the current one, with the updated focus-session count. */
function nextPhase(
  s: PomodoroState,
  cfg: PomodoroConfig,
): { phase: PomodoroPhase; completedFocus: number } {
  if (s.phase === "Focus") {
    const completedFocus = s.completedFocus + 1;
    const phase: PomodoroPhase =
      completedFocus % cfg.sessionsBeforeLongBreak === 0 ? "LongBreak" : "ShortBreak";
    return { phase, completedFocus };
  }
  // A break returns to Focus; a long break ends the cycle and resets the counter.
  return { phase: "Focus", completedFocus: s.phase === "LongBreak" ? 0 : s.completedFocus };
}

/**
 * Advance the running timer by `dtMs`. Returns the next state and, when one or
 * more phase boundaries were crossed, the phase that *most recently* completed
 * (for the cat's reaction). A paused/idle timer is returned unchanged.
 */
export function tickPomodoro(
  s: PomodoroState,
  dtMs: number,
  cfg: PomodoroConfig,
): { state: PomodoroState; completed: PomodoroPhase | null } {
  if (s.status !== "running") return { state: s, completed: null };

  let remaining = s.remainingMs - Math.max(0, dtMs);
  if (remaining > 0) return { state: { ...s, remainingMs: remaining }, completed: null };

  // One or more phases elapsed. Walk forward, consuming the overflow into each new
  // phase, so a huge dt (slept through several phases) lands on the right one.
  let cur = s;
  let completed: PomodoroPhase | null = null;
  let guard = 1000; // backstop against a degenerate zero-duration config
  while (remaining <= 0 && guard-- > 0) {
    completed = cur.phase;
    const { phase, completedFocus } = nextPhase(cur, cfg);
    const dur = durationFor(phase, cfg);
    cur = { status: "running", phase, remainingMs: dur, completedFocus };
    if (dur <= 0) break; // avoid an infinite loop on a misconfigured 0-length phase
    remaining += dur;
  }
  return { state: { ...cur, remainingMs: Math.max(0, remaining) }, completed };
}

/** Start (from idle) or resume (from paused). A running timer is unchanged. */
export function startPomodoro(s: PomodoroState, cfg: PomodoroConfig): PomodoroState {
  if (s.status === "running") return s;
  if (s.status === "paused") return { ...s, status: "running" };
  return { status: "running", phase: "Focus", remainingMs: cfg.focusMs, completedFocus: 0 };
}

export function pausePomodoro(s: PomodoroState): PomodoroState {
  return s.status === "running" ? { ...s, status: "paused" } : s;
}

export function resetPomodoro(cfg: PomodoroConfig): PomodoroState {
  return initPomodoro(cfg);
}

/** Jump to the next phase immediately, preserving running/paused status. */
export function skipPomodoro(s: PomodoroState, cfg: PomodoroConfig): PomodoroState {
  if (s.status === "idle") return s;
  const { phase, completedFocus } = nextPhase(s, cfg);
  return { status: s.status, phase, remainingMs: durationFor(phase, cfg), completedFocus };
}

/** Human label for a phase, for the controls panel. */
export function phaseLabel(phase: PomodoroPhase): string {
  return phase === "Focus" ? "Focus" : phase === "ShortBreak" ? "Break" : "Long break";
}

/** Format remaining ms as MM:SS, rounding up so "0:01" shows until truly elapsed. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}
