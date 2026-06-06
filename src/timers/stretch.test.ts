import { describe, it, expect } from "vitest";
import {
  initStretch,
  tickStretch,
  isStretching,
  forceStretch,
  type StretchConfig,
} from "./stretch";

const cfg: StretchConfig = { enabled: true, intervalMs: 1000, durationMs: 300 };

describe("stretch reminder clock (pure)", () => {
  it("starts quiet and not stretching", () => {
    const s = initStretch();
    expect(s).toEqual({ sinceLastMs: 0, activeMs: 0 });
    expect(isStretching(s)).toBe(false);
  });

  it("accumulates quiet time and fires at the interval", () => {
    let s = initStretch();
    let r = tickStretch(s, 600, cfg);
    expect(r.started).toBe(false);
    expect(r.state.sinceLastMs).toBe(600);
    r = tickStretch(r.state, 600, cfg); // 1200 >= 1000
    expect(r.started).toBe(true);
    expect(isStretching(r.state)).toBe(true);
    expect(r.state.activeMs).toBe(cfg.durationMs);
  });

  it("counts the stretch down, then ends it (started only on the first tick)", () => {
    let r = tickStretch({ sinceLastMs: 0, activeMs: 300 }, 200, cfg);
    expect(r.started).toBe(false);
    expect(isStretching(r.state)).toBe(true);
    expect(r.state.activeMs).toBe(100);
    r = tickStretch(r.state, 200, cfg); // past the end
    expect(isStretching(r.state)).toBe(false);
    expect(r.state.activeMs).toBe(0);
  });

  it("does not immediately re-fire after a stretch ends (quiet clock resets)", () => {
    let r = tickStretch({ sinceLastMs: 0, activeMs: 100 }, 100, cfg); // ends
    expect(isStretching(r.state)).toBe(false);
    r = tickStretch(r.state, 100, cfg);
    expect(r.started).toBe(false);
    expect(r.state.sinceLastMs).toBe(100);
  });

  it("a long gap (system slept) still fires exactly one stretch", () => {
    const r = tickStretch(initStretch(), 60_000, cfg);
    expect(r.started).toBe(true);
    expect(isStretching(r.state)).toBe(true);
  });

  it("when disabled it never fires and holds at rest", () => {
    const off: StretchConfig = { ...cfg, enabled: false };
    const r = tickStretch({ sinceLastMs: 5000, activeMs: 0 }, 5000, off);
    expect(r.started).toBe(false);
    expect(r.state).toEqual({ sinceLastMs: 0, activeMs: 0 });
  });

  it("forceStretch begins a stretch on demand", () => {
    const s = forceStretch(initStretch(), cfg);
    expect(isStretching(s)).toBe(true);
    expect(s.activeMs).toBe(cfg.durationMs);
  });

  it("ignores negative dt", () => {
    const r = tickStretch({ sinceLastMs: 100, activeMs: 0 }, -9999, cfg);
    expect(r.state.sinceLastMs).toBe(100);
  });
});
