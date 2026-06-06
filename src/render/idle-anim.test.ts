import { describe, it, expect } from "vitest";
import { IdleAnimator, DEFAULT_IDLE_ANIM, NEUTRAL } from "./idle-anim";

// The idle animator is pure (injected rng, no clock), so blink timing and breathing
// are fully deterministic here.

describe("IdleAnimator.isResting", () => {
  it("treats sit-like states as resting, motion states as not", () => {
    for (const s of ["Idle", "FollowEyes", "Type", "Scroll", "Think", "IdleAlt"]) {
      expect(IdleAnimator.isResting(s)).toBe(true);
    }
    for (const s of ["Walk", "Jump", "Hunt", "Sleep", "Pet"]) {
      expect(IdleAnimator.isResting(s)).toBe(false);
    }
  });
});

describe("IdleAnimator breathing", () => {
  it("returns NEUTRAL for non-resting states (baked frames own those)", () => {
    const a = new IdleAnimator(DEFAULT_IDLE_ANIM, () => 0.5);
    expect(a.update(100, "Walk")).toEqual(NEUTRAL);
    expect(a.update(100, "Jump")).toEqual(NEUTRAL);
  });

  it("squashes downward only — squashY stays within [1-depth, 1]", () => {
    const a = new IdleAnimator(DEFAULT_IDLE_ANIM, () => 0.99); // rng high → no early blink
    let min = 1;
    let max = 0;
    // Walk a full breath cycle in small steps.
    for (let t = 0; t < DEFAULT_IDLE_ANIM.breathMs; t += 50) {
      const tf = a.update(50, "Idle");
      min = Math.min(min, tf.squashY);
      max = Math.max(max, tf.squashY);
    }
    expect(max).toBeLessThanOrEqual(1 + 1e-9);
    expect(min).toBeGreaterThanOrEqual(1 - DEFAULT_IDLE_ANIM.breathDepth - 1e-9);
    // It actually moves (not a frozen 1.0).
    expect(max - min).toBeGreaterThan(0.01);
  });

  it("starts a breath at full height (squashY ≈ 1)", () => {
    const a = new IdleAnimator(DEFAULT_IDLE_ANIM, () => 0.99);
    const tf = a.update(0, "Idle");
    expect(tf.squashY).toBeCloseTo(1, 5);
  });
});

describe("IdleAnimator blinking", () => {
  it("blinks after the scheduled gap, then holds for blinkHoldMs", () => {
    // rng = 0 → gap is exactly blinkMinMs.
    const a = new IdleAnimator(DEFAULT_IDLE_ANIM, () => 0);
    const { blinkMinMs, blinkHoldMs } = DEFAULT_IDLE_ANIM;
    // Just before the gap elapses: eyes open.
    expect(a.update(blinkMinMs - 50, "Idle").blink).toBe(false);
    // Cross the threshold: blink begins.
    expect(a.update(60, "Idle").blink).toBe(true);
    // Still within the hold window.
    expect(a.update(blinkHoldMs - 40, "Idle").blink).toBe(true);
    // Past the hold: eyes open again.
    expect(a.update(80, "Idle").blink).toBe(false);
  });

  it("does not blink while in a non-resting state (timer is gated on resting)", () => {
    const a = new IdleAnimator(DEFAULT_IDLE_ANIM, () => 0);
    // Spend well past a blink gap, but in Walk — no blink, timer not advanced.
    for (let i = 0; i < 20; i++) expect(a.update(1000, "Walk").blink).toBe(false);
    // Now resting: it still needs a fresh gap, not an instant blink.
    expect(a.update(10, "Idle").blink).toBe(false);
  });

  it("reset() reschedules so breathing/blink restart cleanly", () => {
    const a = new IdleAnimator(DEFAULT_IDLE_ANIM, () => 0);
    a.update(DEFAULT_IDLE_ANIM.blinkMinMs + 10, "Idle"); // trigger a blink
    a.reset();
    // After reset, a fresh full gap is required again.
    expect(a.update(DEFAULT_IDLE_ANIM.blinkMinMs - 10, "Idle").blink).toBe(false);
    expect(a.update(40, "Idle").blink).toBe(true);
  });
});

// The idle-redraw gate: a resting cat should report "unchanged" between perceptible
// breathing steps so the renderer can coast at the idle FPS cap (cuts idle CPU).
describe("IdleAnimator.changedSince", () => {
  it("coasts: tiny breath steps within a quantum don't report a change", () => {
    const a = new IdleAnimator(DEFAULT_IDLE_ANIM, () => 0.99); // no early blink
    a.update(0, "Idle");
    a.changedSince("Idle"); // latch the baseline
    // A 1ms step near the top of the breath moves squash sub-quantum — no repaint.
    let unchanged = 0;
    for (let i = 0; i < 10; i++) {
      a.update(1, "Idle");
      if (!a.changedSince("Idle")) unchanged++;
    }
    expect(unchanged).toBeGreaterThan(0);
  });

  it("dirties when a blink toggles on or off", () => {
    const a = new IdleAnimator(DEFAULT_IDLE_ANIM, () => 0); // gap = blinkMinMs
    a.update(0, "Idle");
    a.changedSince("Idle");
    // Step across the blink threshold — the blink turning on is a visible change.
    a.update(DEFAULT_IDLE_ANIM.blinkMinMs + 10, "Idle");
    expect(a.changedSince("Idle")).toBe(true);
  });

  it("dirties on the resting↔motion transition (overlay appears/disappears)", () => {
    const a = new IdleAnimator(DEFAULT_IDLE_ANIM, () => 0.99);
    a.update(0, "Idle");
    a.changedSince("Idle"); // latch resting
    a.update(0, "Walk");
    expect(a.changedSince("Walk")).toBe(true); // left resting → repaint
  });
});
