// Play session — the cat's behaviour around the wool ball (KITTO_AMBIENT.md §3 A2, MA-3).
//
// While the ball is on screen this decides what the cat does: chase it, pounce and
// bat it when close, wait a beat between swats, and eventually lose interest and stop.
// The Ball owns the physics; this owns the *intent* (where to walk, when to bat).
//
// PURE: no clock, no DOM, randomness injected. Given the same (cat, ball, dt, rng)
// sequence it makes the same decisions, so it's unit-tested without real timers
// (spec §8, KITTO_AMBIENT §5).

import type { Vec2 } from "../render/locomotion";

/** What the cat should do this frame. The Cat translates these to Locomotion + Ball
 *  + machine calls. `pounce.bat` is the velocity (px/sec) to impart to the ball. */
export type PlayIntent =
  | { readonly kind: "chase"; readonly target: Vec2 } // trot toward the ball
  | { readonly kind: "pounce"; readonly bat: Vec2 } // pounce now — swat the ball away
  | { readonly kind: "wait" } // close but cooling down (or ball still flying) — crouch & watch
  | { readonly kind: "done" }; // lost interest — end play

export interface PlayConfig {
  /** Within this distance (logical px) of the ball the cat can pounce. */
  readonly pounceRangePx: number;
  /** Speed (px/sec) the cat's swat imparts to the ball. */
  readonly batSpeedPxPerSec: number;
  /** Lose interest after this many pounces. */
  readonly maxPounces: number;
  /** Minimum gap between pounces (ms) — a beat to watch the ball roll. */
  readonly cooldownMs: number;
  /** Hard cap on a play session (ms), in case the ball never settles. */
  readonly maxDurationMs: number;
  /** Max angular spread (radians) randomly added to a swat so play isn't a straight line. */
  readonly batSpreadRad: number;
}

export const DEFAULT_PLAY_CONFIG: PlayConfig = {
  pounceRangePx: 44,
  batSpeedPxPerSec: 260,
  maxPounces: 5,
  cooldownMs: 600,
  maxDurationMs: 14_000,
  batSpreadRad: 1.0,
};

export interface PlayInput {
  /** The cat's current centre (logical px). */
  readonly cat: Vec2;
  /** The ball's current centre (logical px). */
  readonly ball: Vec2;
  /** Whether the ball has all but stopped (friction) — the cue to pounce again. */
  readonly ballAtRest: boolean;
  /** Frame delta (ms). */
  readonly dtMs: number;
}

export class PlaySession {
  private pounces = 0;
  private cooldownMs = 0;
  private elapsedMs = 0;

  constructor(
    private readonly cfg: PlayConfig = DEFAULT_PLAY_CONFIG,
    private readonly rng: () => number = Math.random,
  ) {}

  get pounceCount(): number {
    return this.pounces;
  }

  /** Decide one frame of play. */
  update(input: PlayInput): PlayIntent {
    this.elapsedMs += Math.max(0, input.dtMs);
    this.cooldownMs = Math.max(0, this.cooldownMs - Math.max(0, input.dtMs));

    if (this.pounces >= this.cfg.maxPounces || this.elapsedMs >= this.cfg.maxDurationMs) {
      return { kind: "done" };
    }

    const dx = input.ball.x - input.cat.x;
    const dy = input.ball.y - input.cat.y;
    const dist = Math.hypot(dx, dy);

    // Too far → chase the ball down (also chase a ball that's still rolling toward us).
    if (dist > this.cfg.pounceRangePx) {
      return { kind: "chase", target: input.ball };
    }

    // In range but still recovering from the last swat, or the ball is still flying —
    // crouch and watch rather than spamming pounces.
    if (this.cooldownMs > 0 || !input.ballAtRest) {
      return { kind: "wait" };
    }

    // Pounce: swat the ball away from the cat, with a little random angular spread so
    // it scatters around the screen instead of pinging in a straight line.
    this.pounces++;
    this.cooldownMs = this.cfg.cooldownMs;
    const base = Math.atan2(dy, dx); // direction cat → ball (push it onward)
    const spread = (this.rng() - 0.5) * this.cfg.batSpreadRad;
    const a = base + spread;
    return {
      kind: "pounce",
      bat: {
        x: Math.cos(a) * this.cfg.batSpeedPxPerSec,
        y: Math.sin(a) * this.cfg.batSpeedPxPerSec,
      },
    };
  }
}
