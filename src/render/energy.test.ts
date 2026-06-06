import { describe, it, expect } from "vitest";
import {
  resolveEnergy,
  pickFiller,
  normalizeEnergyLevel,
  DEFAULT_ENERGY_CONFIG,
  ENERGY_LEVELS,
  type EnergyConfig,
  type FillerWeights,
} from "./energy";

const cfg = (over: Partial<EnergyConfig> = {}): EnergyConfig => ({
  ...DEFAULT_ENERGY_CONFIG,
  dayNight: false, // most tests pin the rhythm off so the level mapping is isolated
  ...over,
});

describe("resolveEnergy", () => {
  it("stands the ambient layer down when energy is off", () => {
    const t = resolveEnergy(cfg({ level: "off" }));
    expect(t.director.enabled).toBe(false);
    expect(t.fillers.enabled).toBe(false);
    expect(t.fillerWeights).toEqual({ groom: 0, yawn: 0, zoomies: 0, play: 0 });
  });

  it("makes a calmer cat wander later and a playful one sooner", () => {
    const calm = resolveEnergy(cfg({ level: "calm" }));
    const playful = resolveEnergy(cfg({ level: "playful" }));
    expect(calm.director.enabled).toBe(true);
    expect(calm.director.wanderAfterMs).toBeGreaterThan(playful.director.wanderAfterMs);
    // …and fidget less often (a longer max gap between fillers).
    expect(calm.fillers.maxGapMs).toBeGreaterThan(playful.fillers.maxGapMs);
  });

  it("suppresses zoomies when calm but enables them at the default (mid)", () => {
    expect(resolveEnergy(cfg({ level: "calm" })).fillerWeights.zoomies).toBe(0);
    // Resolved §7 question: zoomies are ON at the default energy.
    expect(resolveEnergy(cfg({ level: "mid" })).fillerWeights.zoomies).toBeGreaterThan(0);
  });

  it("zeroes the play weight when the play toggle is off, keeping groom/yawn", () => {
    const t = resolveEnergy(cfg({ level: "mid", play: false }));
    expect(t.fillerWeights.play).toBe(0);
    expect(t.fillerWeights.groom).toBeGreaterThan(0);
    expect(t.fillerWeights.yawn).toBeGreaterThan(0);
  });

  it("honours an explicit idle-delay override over the level default", () => {
    const t = resolveEnergy(cfg({ level: "playful", idleDelayMsOverride: 600_000 }));
    expect(t.director.wanderAfterMs).toBe(600_000);
  });

  describe("day/night rhythm", () => {
    it("naps sooner and zooms less after dark", () => {
      const day = resolveEnergy(cfg({ level: "mid", dayNight: true }), 14); // afternoon
      const night = resolveEnergy(cfg({ level: "mid", dayNight: true }), 23); // late
      expect(night.director.wanderAfterMs).toBeLessThan(day.director.wanderAfterMs);
      expect(night.fillerWeights.zoomies).toBeLessThan(day.fillerWeights.zoomies);
    });

    it("zooms more in the morning", () => {
      const day = resolveEnergy(cfg({ level: "mid", dayNight: true }), 14);
      const morning = resolveEnergy(cfg({ level: "mid", dayNight: true }), 8);
      expect(morning.fillerWeights.zoomies).toBeGreaterThan(day.fillerWeights.zoomies);
    });

    it("ignores the hour entirely when day/night is off", () => {
      const a = resolveEnergy(cfg({ level: "mid", dayNight: false }), 3);
      const b = resolveEnergy(cfg({ level: "mid", dayNight: false }), 15);
      expect(a).toEqual(b);
    });

    it("an idle override still wins over the day/night delay bias", () => {
      const t = resolveEnergy(cfg({ level: "mid", dayNight: true, idleDelayMsOverride: 120_000 }), 23);
      expect(t.director.wanderAfterMs).toBe(120_000);
    });
  });
});

describe("pickFiller", () => {
  const W: FillerWeights = { groom: 0.4, yawn: 0.2, zoomies: 0.2, play: 0.2 };

  it("maps the rng draw across the cumulative weight bands", () => {
    expect(pickFiller(W, 0.0)).toBe("groom"); // [0,0.4)
    expect(pickFiller(W, 0.39)).toBe("groom");
    expect(pickFiller(W, 0.45)).toBe("yawn"); // [0.4,0.6)
    expect(pickFiller(W, 0.65)).toBe("zoomies"); // [0.6,0.8)
    expect(pickFiller(W, 0.85)).toBe("play"); // [0.8,1)
  });

  it("never returns a zero-weight filler", () => {
    const noZoom: FillerWeights = { groom: 0.5, yawn: 0.5, zoomies: 0, play: 0 };
    for (const r of [0, 0.25, 0.5, 0.75, 0.99]) {
      expect(pickFiller(noZoom, r)).not.toBe("zoomies");
      expect(pickFiller(noZoom, r)).not.toBe("play");
    }
  });

  it("returns none when every weight is zero", () => {
    expect(pickFiller({ groom: 0, yawn: 0, zoomies: 0, play: 0 }, 0.5)).toBe("none");
  });

  it("normalizes weights that don't sum to 1", () => {
    const w: FillerWeights = { groom: 2, yawn: 2, zoomies: 0, play: 0 };
    expect(pickFiller(w, 0.4)).toBe("groom"); // [0,0.5) of the normalized range
    expect(pickFiller(w, 0.6)).toBe("yawn"); // [0.5,1)
  });
});

describe("normalizeEnergyLevel", () => {
  it("passes through known levels", () => {
    for (const lvl of ENERGY_LEVELS) expect(normalizeEnergyLevel(lvl)).toBe(lvl);
  });
  it("falls back to the default for junk", () => {
    expect(normalizeEnergyLevel("turbo")).toBe(DEFAULT_ENERGY_CONFIG.level);
    expect(normalizeEnergyLevel(undefined)).toBe(DEFAULT_ENERGY_CONFIG.level);
    expect(normalizeEnergyLevel(42)).toBe(DEFAULT_ENERGY_CONFIG.level);
  });
});
