// TimerManager — the thin runtime glue around the pure stretch/pomodoro clocks.
//
// Like the Cat, this is an adapter, not logic: every decision lives in the pure,
// unit-tested modules (stretch.ts / pomodoro.ts). Its one real job is the clock.
//
// It ticks on its OWN `setInterval` driven by `Date.now()` deltas — deliberately
// NOT the Cat's requestAnimationFrame loop, whose delta is clamped and measured
// with performance.now() (both of which pause/stall while the display sleeps). Real
// wall-clock deltas are what make timers "fire reliably across sleep/wake"
// (KITTO_SPEC §5 M4): after a long sleep the next tick sees the full elapsed gap
// and the pure clocks reconcile it (a fired stretch, the correct Pomodoro phase).
//
// One manager is app-global (a single Pomodoro / stretch reminder), not per-cat.

import {
  initStretch,
  tickStretch,
  forceStretch,
  isStretching,
  type StretchState,
} from "./stretch";
import {
  initPomodoro,
  tickPomodoro,
  startPomodoro,
  pausePomodoro,
  resetPomodoro,
  skipPomodoro,
  type PomodoroState,
} from "./pomodoro";
import type { Settings } from "../config/settings";

/** 250ms: a smooth-enough MM:SS countdown without spinning the CPU. Accuracy is
 *  independent of this — it comes from the Date.now() delta, not the cadence. */
const TICK_MS = 250;

export interface TimerCallbacks {
  /** Fired on the rising/falling edge of "is the cat mid-stretch". */
  readonly onStretchChange: (active: boolean) => void;
  /** Fired every tick so the floating timer overlay can repaint. */
  readonly onChange: (pomodoro: PomodoroState) => void;
}

export class TimerManager {
  private settings: Settings;
  private stretch: StretchState = initStretch();
  private pomo: PomodoroState;
  private wasStretching = false;
  private lastTickAt: number | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(
    settings: Settings,
    private readonly cb: TimerCallbacks,
  ) {
    this.settings = settings;
    this.pomo = initPomodoro(settings.pomodoro);
  }

  start(): void {
    if (this.intervalId !== null) return;
    this.lastTickAt = Date.now();
    this.intervalId = setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private tick(): void {
    const now = Date.now();
    // Real elapsed wall-clock since the last tick. We do NOT clamp this: a large
    // value is exactly how a post-sleep catch-up is meant to reconcile.
    const dt = this.lastTickAt === null ? 0 : Math.max(0, now - this.lastTickAt);
    this.lastTickAt = now;

    const sres = tickStretch(this.stretch, dt, this.settings.stretch);
    this.stretch = sres.state;

    const pres = tickPomodoro(this.pomo, dt, this.settings.pomodoro);
    this.pomo = pres.state;
    // A finished focus/break is a natural moment to stretch — celebrate it.
    if (pres.completed) this.stretch = forceStretch(this.stretch, this.settings.stretch);

    this.emitStretchEdge();
    this.cb.onChange(this.pomo);
  }

  /** Notify only when the mid-stretch flag flips, so the Cat holds/releases cleanly. */
  private emitStretchEdge(): void {
    const active = isStretching(this.stretch);
    if (active !== this.wasStretching) {
      this.wasStretching = active;
      this.cb.onStretchChange(active);
    }
  }

  get pomodoro(): PomodoroState {
    return this.pomo;
  }

  // --- Controls (delegate to the pure reducers, then surface the change) ---

  /** Start if idle/paused, pause if running — the panel's main button. */
  toggle(): void {
    this.pomo =
      this.pomo.status === "running"
        ? pausePomodoro(this.pomo)
        : startPomodoro(this.pomo, this.settings.pomodoro);
    this.cb.onChange(this.pomo);
  }

  reset(): void {
    this.pomo = resetPomodoro(this.settings.pomodoro);
    this.cb.onChange(this.pomo);
  }

  skip(): void {
    this.pomo = skipPomodoro(this.pomo, this.settings.pomodoro);
    this.cb.onChange(this.pomo);
  }

  /** Manual "stretch now" + the trigger we reuse for testing the pose. */
  stretchNow(): void {
    this.stretch = forceStretch(this.stretch, this.settings.stretch);
    this.emitStretchEdge();
  }

  /**
   * Apply edited settings. The running Pomodoro keeps its phase/remaining time; the
   * new durations take effect at the next phase boundary, which is the least
   * surprising behaviour mid-session.
   */
  updateSettings(settings: Settings): void {
    this.settings = settings;
    if (this.pomo.status === "idle") this.pomo = initPomodoro(settings.pomodoro);
    this.cb.onChange(this.pomo);
  }

  get currentSettings(): Settings {
    return this.settings;
  }
}
