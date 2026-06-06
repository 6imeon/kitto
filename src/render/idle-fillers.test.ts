import { describe, it, expect } from "vitest";
import { IdleFillers, type FillerConfig } from "./idle-fillers";

const CFG: FillerConfig = { enabled: true, minGapMs: 2000, maxGapMs: 4000 };
// A fixed-gap config: minGap === maxGap ⇒ the gap is exactly 2000ms regardless of
// rng, so the rng stream only drives the *pick* (clearer for the re-arm/reset cases).
const FIXED: FillerConfig = { enabled: true, minGapMs: 2000, maxGapMs: 2000 };

/** A deterministic rng replaying a fixed queue (then holding the last value). */
function seq(...values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)]!;
}

describe("IdleFillers", () => {
  it("stays quiet until the rolled gap elapses, then fires once", () => {
    // First rng (0.5) rolls the gap → 2000 + 0.5*2000 = 3000ms. Second rng picks.
    const f = new IdleFillers(CFG, seq(0.5, 0.1));
    expect(f.update(1000)).toBe("none"); // 1000 < 3000
    expect(f.update(1000)).toBe("none"); // 2000 < 3000
    expect(f.update(1000)).toBe("groom"); // 3000 ≥ 3000 → fires (0.1 → groom)
  });

  it("weights the pick across the four idle activities", () => {
    // FIXED gap (span 0) ⇒ the gap is 2000ms regardless of rng, so a constant rng
    // value only drives the *pick*: groom < 0.38 ≤ yawn < 0.62 ≤ zoomies < 0.82 ≤ play.
    const pick = (v: number): string => new IdleFillers(FIXED, () => v).update(2000);
    expect(pick(0.2)).toBe("groom");
    expect(pick(0.5)).toBe("yawn");
    expect(pick(0.7)).toBe("zoomies");
    expect(pick(0.95)).toBe("play");
  });

  it("re-arms after firing — fillers don't fire every frame", () => {
    const f = new IdleFillers(FIXED, seq(0.1)); // fixed 2000ms gap, always groom
    expect(f.update(2000)).toBe("groom");
    expect(f.update(1000)).toBe("none"); // gap re-armed, accumulating again
    expect(f.update(1000)).toBe("groom");
  });

  it("reset() clears accumulated idle time (leaving the dwell state)", () => {
    const f = new IdleFillers(FIXED, seq(0.1));
    expect(f.update(1500)).toBe("none");
    f.reset(); // cat started reacting/walking — start the gap over
    expect(f.update(1500)).toBe("none"); // would have fired at 2000 without the reset
    expect(f.update(600)).toBe("groom"); // 2100 ≥ 2000
  });

  it("does nothing when disabled", () => {
    const f = new IdleFillers({ enabled: false, minGapMs: 0, maxGapMs: 0 }, seq(0, 0));
    for (let i = 0; i < 10; i++) expect(f.update(1000)).toBe("none");
  });
});
