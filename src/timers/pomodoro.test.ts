import { describe, it, expect } from "vitest";
import {
  initPomodoro,
  tickPomodoro,
  startPomodoro,
  pausePomodoro,
  resetPomodoro,
  skipPomodoro,
  formatClock,
  type PomodoroConfig,
} from "./pomodoro";

// Small, readable durations for tests (ms).
const cfg: PomodoroConfig = {
  focusMs: 1000,
  shortBreakMs: 400,
  longBreakMs: 800,
  sessionsBeforeLongBreak: 4,
};

describe("pomodoro clock (pure)", () => {
  it("starts idle on Focus with the full focus duration", () => {
    expect(initPomodoro(cfg)).toEqual({
      status: "idle",
      phase: "Focus",
      remainingMs: 1000,
      completedFocus: 0,
    });
  });

  it("an idle timer does not tick down", () => {
    const r = tickPomodoro(initPomodoro(cfg), 500, cfg);
    expect(r.state.remainingMs).toBe(1000);
    expect(r.completed).toBeNull();
  });

  it("start → running, then ticks decrement the phase", () => {
    let s = startPomodoro(initPomodoro(cfg), cfg);
    expect(s.status).toBe("running");
    const r = tickPomodoro(s, 300, cfg);
    expect(r.state.remainingMs).toBe(700);
    expect(r.completed).toBeNull();
  });

  it("Focus completes → ShortBreak, reporting the completed phase", () => {
    let s = startPomodoro(initPomodoro(cfg), cfg);
    const r = tickPomodoro(s, 1000, cfg);
    expect(r.completed).toBe("Focus");
    expect(r.state.phase).toBe("ShortBreak");
    expect(r.state.remainingMs).toBe(400);
    expect(r.state.completedFocus).toBe(1);
  });

  it("every Nth focus session yields a LongBreak, then resets the cycle", () => {
    let s = startPomodoro(initPomodoro(cfg), cfg);
    // 3 × (focus → short break)
    for (let i = 0; i < 3; i++) {
      s = tickPomodoro(s, 1000, cfg).state; // focus done
      expect(s.phase).toBe("ShortBreak");
      s = tickPomodoro(s, 400, cfg).state; // short break done
      expect(s.phase).toBe("Focus");
    }
    // 4th focus → long break
    const r = tickPomodoro(s, 1000, cfg);
    expect(r.state.phase).toBe("LongBreak");
    expect(r.state.completedFocus).toBe(4);
    // Long break done → Focus, cycle counter reset
    const back = tickPomodoro(r.state, 800, cfg);
    expect(back.state.phase).toBe("Focus");
    expect(back.state.completedFocus).toBe(0);
  });

  it("reconciles a huge dt across multiple phases (slept through them)", () => {
    let s = startPomodoro(initPomodoro(cfg), cfg);
    // 1000 focus + 400 short + 200 into the next focus = 1600ms remaining of focus.
    const r = tickPomodoro(s, 1600, cfg);
    expect(r.state.phase).toBe("Focus");
    expect(r.state.completedFocus).toBe(1);
    expect(r.state.remainingMs).toBe(800); // 1000 focus - 200 overflow
    expect(r.completed).toBe("ShortBreak"); // most recent boundary crossed
  });

  it("pause freezes the countdown; resume continues it", () => {
    let s = startPomodoro(initPomodoro(cfg), cfg);
    s = tickPomodoro(s, 300, cfg).state; // 700 left
    s = pausePomodoro(s);
    expect(s.status).toBe("paused");
    const frozen = tickPomodoro(s, 500, cfg);
    expect(frozen.state.remainingMs).toBe(700); // unchanged while paused
    s = startPomodoro(s, cfg); // resume keeps remaining
    expect(s.status).toBe("running");
    expect(s.remainingMs).toBe(700);
  });

  it("skip jumps to the next phase without finishing the clock", () => {
    let s = startPomodoro(initPomodoro(cfg), cfg);
    s = skipPomodoro(s, cfg);
    expect(s.phase).toBe("ShortBreak");
    expect(s.remainingMs).toBe(400);
    expect(s.status).toBe("running");
  });

  it("reset returns to the idle initial state", () => {
    let s = startPomodoro(initPomodoro(cfg), cfg);
    s = tickPomodoro(s, 500, cfg).state;
    expect(resetPomodoro(cfg)).toEqual(initPomodoro(cfg));
  });

  it("formatClock renders MM:SS, rounding up", () => {
    expect(formatClock(25 * 60_000)).toBe("25:00");
    expect(formatClock(5_000)).toBe("0:05");
    expect(formatClock(4_001)).toBe("0:05"); // ceil
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(-50)).toBe("0:00");
  });
});
