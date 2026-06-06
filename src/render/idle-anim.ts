// Live idle animation — the "breathing" + blink that make a near-static sit feel alive.
//
// This is the *live* half of the hybrid animation model (the *baked* half is the
// walk/pounce/sleep frames in the atlas). For resting states (Idle / sit poses) the
// renderer asks this module, every frame, for a small transform to apply on top of the
// base sprite: a gentle vertical squash (breathing) and an occasional blink.
//
// Pure + deterministic: it owns no clock and no RNG. The caller injects elapsed time
// and a 0..1 random source, so blink timing is fully unit-testable. Anchored at the
// feet by the renderer, so the squash reads as a chest rising/falling, not a bounce.

/** States that get the live breathing+blink treatment. Motion states (Walk/Jump…)
 *  are driven by baked frames instead and should NOT be squashed on top. */
const RESTING = new Set(["Idle", "FollowEyes", "Type", "Scroll", "Think", "IdleAlt"]);

export interface IdleTransform {
  /** Vertical scale, ~0.97..1.0. 1 = no squash. */
  readonly squashY: number;
  /** Upward shift in source px (kept 0 here; reserved for hop-style states). */
  readonly offsetY: number;
  /** True while the eyes should be covered (a blink in progress). */
  readonly blink: boolean;
}

export const NEUTRAL: IdleTransform = { squashY: 1, offsetY: 0, blink: false };

export interface IdleAnimConfig {
  /** Full breath cycle length (ms). */
  readonly breathMs: number;
  /** Peak squash depth (0 = none, 0.03 = 3% compression at the bottom of a breath). */
  readonly breathDepth: number;
  /** Shortest gap between blinks (ms). */
  readonly blinkMinMs: number;
  /** Longest gap between blinks (ms). */
  readonly blinkMaxMs: number;
  /** How long a blink holds the eyes shut (ms). */
  readonly blinkHoldMs: number;
}

export const DEFAULT_IDLE_ANIM: IdleAnimConfig = {
  breathMs: 2600,
  breathDepth: 0.03,
  blinkMinMs: 2800,
  blinkMaxMs: 6500,
  blinkHoldMs: 120,
};

/**
 * Stateful but tiny driver. Owns only elapsed phase + the current blink schedule;
 * the caller feeds it dt and an rng. Reset when leaving a resting state so breathing
 * doesn't carry a stale phase into the next rest.
 */
/** Quantize squashY to this many discrete steps for change-detection. The breath spans
 *  ~3% over 2.6s; at 64px on screen a step finer than this moves the sprite top < 0.1px,
 *  which is sub-pixel and invisible. Repainting only when the quantized level changes lets
 *  a resting cat coast at the idle FPS cap between visible steps. */
const SQUASH_QUANTUM = 0.005;

function quantizeSquash(squashY: number): number {
  return Math.round(squashY / SQUASH_QUANTUM);
}

export class IdleAnimator {
  private breathPhase = 0; // ms into the breath cycle
  private sinceBlink = 0; // ms since last blink started
  private nextBlinkAt: number;
  private blinking = 0; // ms remaining in the current blink, 0 = eyes open
  /** Last squashY produced by {@link update}, read by {@link changedSince}. */
  private lastEmittedSquash = 1;
  /** Last *painted* transform fingerprint, for the renderer's dirty check. */
  private lastSquashQ = quantizeSquash(1);
  private lastBlink = false;
  private lastResting = false;

  constructor(
    private readonly cfg: IdleAnimConfig = DEFAULT_IDLE_ANIM,
    private readonly rng: () => number = Math.random,
  ) {
    this.nextBlinkAt = this.rollBlinkGap();
  }

  /** Should this state animate via breathing/blink (vs. baked frames)? */
  static isResting(state: string): boolean {
    return RESTING.has(state);
  }

  private rollBlinkGap(): number {
    const { blinkMinMs, blinkMaxMs } = this.cfg;
    return blinkMinMs + this.rng() * (blinkMaxMs - blinkMinMs);
  }

  /** Clear phase + reschedule — call when the cat enters a resting state afresh. */
  reset(): void {
    this.breathPhase = 0;
    this.sinceBlink = 0;
    this.blinking = 0;
    this.nextBlinkAt = this.rollBlinkGap();
  }

  /**
   * Has the *visible* idle transform changed since the last call, for the given state?
   * Compares a coarse fingerprint (quantized squash + blink + resting/not) and latches the
   * new value. The renderer calls this once per frame to decide whether a resting cat needs
   * a repaint — true means a perceptible step, false means coast at the idle FPS cap.
   * Reading `update`'s result directly would dirty every frame (the raw squash always moves),
   * so the quantization here is what actually saves the redraws.
   */
  changedSince(state: string): boolean {
    const resting = IdleAnimator.isResting(state);
    const squashQ = resting ? quantizeSquash(this.lastEmittedSquash) : quantizeSquash(1);
    const blink = resting && this.blinking > 0;
    const changed =
      resting !== this.lastResting || squashQ !== this.lastSquashQ || blink !== this.lastBlink;
    this.lastResting = resting;
    this.lastSquashQ = squashQ;
    this.lastBlink = blink;
    return changed;
  }

  /** Advance by dt and return the transform to apply this frame for `state`. Non-resting
   *  states return NEUTRAL (their motion comes from baked frames). */
  update(dtMs: number, state: string): IdleTransform {
    if (!IdleAnimator.isResting(state)) return NEUTRAL;
    const dt = Math.max(0, dtMs);

    // Breathing: a sine over the cycle, deepest at the trough.
    this.breathPhase = (this.breathPhase + dt) % this.cfg.breathMs;
    const t = this.breathPhase / this.cfg.breathMs; // 0..1
    // 0 at the top of the breath, 1 at the bottom — squash is downward only.
    const depth = (1 - Math.cos(t * 2 * Math.PI)) / 2;
    const squashY = 1 - this.cfg.breathDepth * depth;
    this.lastEmittedSquash = squashY;

    // Blink schedule.
    if (this.blinking > 0) {
      this.blinking -= dt;
    } else {
      this.sinceBlink += dt;
      if (this.sinceBlink >= this.nextBlinkAt) {
        this.blinking = this.cfg.blinkHoldMs;
        this.sinceBlink = 0;
        this.nextBlinkAt = this.rollBlinkGap();
      }
    }

    return { squashY, offsetY: 0, blink: this.blinking > 0 };
  }
}
