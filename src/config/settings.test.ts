import { describe, it, expect } from "vitest";
import {
  normalize,
  DEFAULT_SETTINGS,
  DEFAULT_FUR,
  DEFAULT_REACTIONS,
} from "./settings";

// normalize() is the single trusted boundary: every settings file (hand-edited,
// stale, or pre-M6) passes through it. These lock its clamping/upgrade behavior.
describe("settings normalize (M6: appearance / reactions / autostart)", () => {
  it("returns full defaults for empty / nullish input", () => {
    expect(normalize(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalize({})).toEqual(DEFAULT_SETTINGS);
    expect(normalize(null)).toEqual(DEFAULT_SETTINGS);
  });

  it("upgrades a pre-M6 file (timers only) by filling in M6 defaults", () => {
    const old = {
      soundOnDone: false,
      pomodoro: { focusMs: 30 * 60_000 },
      stretch: { enabled: false },
    };
    const s = normalize(old);
    expect(s.soundOnDone).toBe(false); // preserved
    expect(s.pomodoro.focusMs).toBe(30 * 60_000); // preserved
    expect(s.appearance).toEqual(DEFAULT_SETTINGS.appearance); // filled
    expect(s.reactions).toEqual(DEFAULT_REACTIONS); // filled
    expect(s.autostart).toBe(false); // filled
  });

  it("accepts a valid #rrggbb fur color and lowercases it", () => {
    expect(normalize({ appearance: { furColor: "#AABBCC" } }).appearance.furColor).toBe("#aabbcc");
  });

  it("rejects malformed fur colors, falling back to the default", () => {
    for (const bad of ["red", "#abc", "#12345g", "#1234567", "", 123]) {
      expect(normalize({ appearance: { furColor: bad } }).appearance.furColor).toBe(DEFAULT_FUR);
    }
  });

  it("coerces an unknown pattern to 'none' and keeps a known one", () => {
    expect(normalize({ appearance: { pattern: "calico" } }).appearance.pattern).toBe("calico");
    expect(normalize({ appearance: { pattern: "leopard" } }).appearance.pattern).toBe("none");
  });

  it("defaults the cat breed to gray and accepts a known one", () => {
    expect(normalize({}).appearance.cat).toBe("gray"); // pre-feature file upgrades cleanly
    expect(normalize({ appearance: { cat: "tuxedo" } }).appearance.cat).toBe("tuxedo");
  });

  it("coerces an unknown cat breed back to gray", () => {
    expect(normalize({ appearance: { cat: "sphynx" } }).appearance.cat).toBe("gray");
    expect(normalize({ appearance: { cat: 7 } }).appearance.cat).toBe("gray");
  });

  it("reads reaction toggles, defaulting any missing/non-boolean field", () => {
    const s = normalize({ reactions: { hunt: false, pet: "yes", scroll: false } });
    expect(s.reactions.hunt).toBe(false); // explicit
    expect(s.reactions.pet).toBe(DEFAULT_REACTIONS.pet); // non-boolean → default
    expect(s.reactions.scroll).toBe(false); // explicit
    expect(s.reactions.keyboard).toBe(DEFAULT_REACTIONS.keyboard); // missing → default
  });

  it("reads the autostart flag", () => {
    expect(normalize({ autostart: true }).autostart).toBe(true);
    expect(normalize({ autostart: "true" }).autostart).toBe(false); // only real booleans
  });

  // --- Ambient-life energy (MA-4 / A4) -------------------------------------------
  it("defaults the ambient section when absent (pre-MA-4 file upgrades cleanly)", () => {
    expect(normalize({}).ambient).toEqual(DEFAULT_SETTINGS.ambient);
  });

  it("reads a valid ambient config", () => {
    const a = normalize({
      ambient: { level: "playful", dayNight: false, play: false, idleDelayMsOverride: 120_000 },
    }).ambient;
    expect(a).toEqual({
      level: "playful",
      dayNight: false,
      play: false,
      idleDelayMsOverride: 120_000,
    });
  });

  it("coerces an unknown energy level to the default", () => {
    expect(normalize({ ambient: { level: "turbo" } }).ambient.level).toBe(
      DEFAULT_SETTINGS.ambient.level,
    );
  });

  it("clamps a wild idle-delay override and keeps 0 (= auto)", () => {
    expect(normalize({ ambient: { idleDelayMsOverride: 0 } }).ambient.idleDelayMsOverride).toBe(0);
    expect(
      normalize({ ambient: { idleDelayMsOverride: 999_999_999 } }).ambient.idleDelayMsOverride,
    ).toBe(30 * 60_000); // capped at the 30-min ceiling
    // Junk → 0 (auto), not NaN.
    expect(normalize({ ambient: { idleDelayMsOverride: "soon" } }).ambient.idleDelayMsOverride).toBe(0);
  });
});
