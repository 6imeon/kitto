// Ambient Director (KITTO_AMBIENT.md §2, §3 A1 — MA-1).
//
// The cat is *reactive* on its own (cursor, keyboard, timers, agent). The Director
// gives it an inner life when it's left alone: after a stretch of idleness it leaves
// its spot, walks to a cozy corner, and naps — waking the moment real input returns.
//
// It sits ABOVE the pure CatStateMachine and BELOW real input (spec §2): it only
// proposes *intent* (a target to walk to, a command to lie down, a wake) — exactly
// like the cursor/timer inputs do. It never reaches into the machine's internals,
// and the existing priority ladder still wins on any genuine interaction. The Cat
// applies these intents to its Locomotion + machine.
//
// It reads one signal — the machine's idle clock (ms since the last real cue) — to
// know when to wander, and detects a *reset* of that clock (an interaction happened)
// to know when to stand down. Decisions that need randomness (which corner) take an
// injected rng, so the whole module is deterministic and unit-tested — no
// Date.now()/Math.random()/DOM inside (spec §8, KITTO_AMBIENT §5 "Determinism").

import type { Vec2 } from "./locomotion";

/** The Director's coarse lifecycle. `dwell` = hanging out where it is; `travel` =
 *  walking the route to its nap corner; `nap` = asleep in the corner. */
export type DirectorPhase = "dwell" | "travel" | "nap";

export interface Bounds {
  readonly w: number;
  readonly h: number;
}

export interface DirectorConfig {
  /** Master switch for ambient wandering/napping. Off ⇒ the cat only reacts. */
  readonly enabled: boolean;
  /** Idle time (ms, since the last real interaction) before the cat leaves to nap. */
  readonly wanderAfterMs: number;
  /** Inset from each screen edge for the nap corner (logical px, from the cat centre). */
  readonly cornerMargin: number;
}

/** A corner of the screen, as a pair of edge signs. -1 = the low (left/top) edge,
 *  +1 = the high (right/bottom) edge. The Director remembers its last nap corner as
 *  one of these and biases toward it (A4 favourite-corner memory). */
export interface Corner {
  readonly sx: -1 | 1;
  readonly sy: -1 | 1;
}

/** Probability the Director re-picks its remembered favourite corner over a fresh
 *  random one (A4: "weighted toward its last favourite"). High enough to feel like a
 *  habit, low enough that it still roams. */
const FAVOURITE_BIAS = 0.7;

export const DEFAULT_DIRECTOR_CONFIG: DirectorConfig = {
  enabled: true,
  // Short for the MA-1 spike so the wander → nap loop is observable in a live demo.
  // KITTO_AMBIENT A1 wants a ~3 min production default; MA-4 wires this to a setting
  // (idle delay + the Calm↔Playful energy slider) alongside the rest of §5.
  wanderAfterMs: 8_000,
  cornerMargin: 8,
};

export interface DirectorInput {
  /** Time since the last real interaction (ms) — the pure machine's idle clock. */
  readonly idleMs: number;
  /** The cat's current centre (logical px). */
  readonly position: Vec2;
  /** The overlay size (logical px). */
  readonly bounds: Bounds;
  /** Half-extents of the cat sprite (logical px) so a corner nap isn't clipped. */
  readonly half: Vec2;
  /** True on the frame the locomotion target was reached. */
  readonly arrived: boolean;
}

/** What the Director proposes this frame. The Cat translates these to Locomotion +
 *  machine calls; everything but `walkTo`/`sleep` is a one-frame signal. */
export type DirectorIntent =
  | { readonly kind: "none" } // nothing to do — the cat is free to idle/react
  | { readonly kind: "walkTo"; readonly target: Vec2 } // head here (next leg of the route)
  | { readonly kind: "sleep" } // arrived at the corner — lie down and nap
  | { readonly kind: "wake" } // a cue interrupted the nap — play a wake-stretch
  | { readonly kind: "cancel" }; // a cue interrupted the trip — abandon the route

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export class AmbientDirector {
  private phase: DirectorPhase = "dwell";
  /** Remaining waypoints to the nap corner (current leg first). Empty off-trip. */
  private route: Vec2[] = [];
  /** Last frame's idle clock — a drop means a real interaction reset it. */
  private lastIdleMs = 0;
  /** The corner it last napped in (A4 favourite-corner memory). Null until the first
   *  nap; once set, future routes bias toward it. A drag-to-bed nap also records here,
   *  so placing the cat in a corner teaches it a new favourite. */
  private favourite: Corner | null = null;

  constructor(
    private cfg: DirectorConfig = DEFAULT_DIRECTOR_CONFIG,
    private readonly rng: () => number = Math.random,
  ) {}

  get currentPhase(): DirectorPhase {
    return this.phase;
  }

  /** Live-swap config (settings change, MA-4). Disabling stands the cat down — it
   *  stops wandering/napping on its own; a real cue still wakes it through the
   *  normal ladder (we don't force-wake here). */
  configure(cfg: DirectorConfig): void {
    this.cfg = cfg;
    if (!cfg.enabled && this.phase !== "dwell") {
      this.phase = "dwell";
      this.route = [];
    }
  }

  /**
   * Advance the Director one frame and return its proposed intent. Pure given the
   * inputs and the injected rng: the same (inputs, rng) sequence yields the same
   * decisions.
   */
  update(input: DirectorInput): DirectorIntent {
    // A drop in the idle clock means the machine saw a real cue (cursor/key/scroll/
    // pet/agent/activity) — i.e. the user is back. That interrupts the Director.
    const interrupted = input.idleMs < this.lastIdleMs;
    this.lastIdleMs = input.idleMs;

    if (!this.cfg.enabled) {
      if (this.phase !== "dwell") {
        this.phase = "dwell";
        this.route = [];
      }
      return { kind: "none" };
    }

    switch (this.phase) {
      case "nap":
        if (interrupted) {
          this.phase = "dwell";
          return { kind: "wake" };
        }
        return { kind: "none" };

      case "travel":
        if (interrupted) {
          this.phase = "dwell";
          this.route = [];
          return { kind: "cancel" };
        }
        if (input.arrived) {
          this.route.shift(); // reached this leg
          const next = this.route[0];
          if (next) return { kind: "walkTo", target: next };
          this.phase = "nap";
          return { kind: "sleep" };
        }
        return { kind: "none" };

      case "dwell":
      default:
        if (input.idleMs >= this.cfg.wanderAfterMs) {
          this.route = this.planRoute(input);
          this.phase = "travel";
          return { kind: "walkTo", target: this.route[0]! };
        }
        return { kind: "none" };
    }
  }

  /**
   * A user-commanded wander target (tap-to-wander, MA-2): a random on-screen point
   * inside the same safe margins a nap corner uses, so the cat can't walk off-screen.
   * Stateless — it does NOT touch the Director's phase; the caller (Cat.wanderNow)
   * drives this trip directly and the autonomous idle wander/nap loop resumes after.
   * Uses the injected rng, so it's deterministic under test.
   */
  pickWanderSpot(input: { readonly bounds: Bounds; readonly half: Vec2 }): Vec2 {
    const { bounds, half } = input;
    const lo = { x: half.x + this.cfg.cornerMargin, y: half.y + this.cfg.cornerMargin };
    const hi = { x: bounds.w - half.x - this.cfg.cornerMargin, y: bounds.h - half.y - this.cfg.cornerMargin };
    return {
      x: clamp(lo.x + this.rng() * (hi.x - lo.x), Math.min(lo.x, hi.x), Math.max(lo.x, hi.x)),
      y: clamp(lo.y + this.rng() * (hi.y - lo.y), Math.min(lo.y, hi.y), Math.max(lo.y, hi.y)),
    };
  }

  /** The corner the cat last napped in, or null until it has napped (A4). Exposed so
   *  the app can persist a favourite across restarts (settings/store). */
  get favouriteCorner(): Corner | null {
    return this.favourite;
  }

  /** Seed the remembered favourite corner (e.g. restored from disk on launch). */
  setFavouriteCorner(corner: Corner | null): void {
    this.favourite = corner;
  }

  /**
   * Put the cat straight into the nap phase where it stands (drag-to-bed, A4). The
   * caller has already walked it into the corner; this hands the nap to the Director's
   * normal `nap` state so its existing interrupt-wakes-it logic (a dropped idle clock →
   * `wake`) applies uniformly. Resets the idle-clock baseline so the *next* frame's
   * interaction — not this settle — is what counts as an interrupt.
   */
  napInPlace(idleMs: number): DirectorIntent {
    this.phase = "nap";
    this.route = [];
    this.lastIdleMs = idleMs;
    return { kind: "sleep" };
  }

  /**
   * Drag-to-bed (A4): the user dropped the cat at `position`; settle it into the
   * nearest corner and remember that as the new favourite, so it both naps where it
   * was placed and prefers there next time. Returns the corner's centre point (the
   * caller walks/teleports the cat the last little way into it and calls `sleep`),
   * or null if the corner is degenerate. Stateless re: phase — the caller drives it.
   */
  cornerNear(input: { readonly bounds: Bounds; readonly half: Vec2; readonly position: Vec2 }): Vec2 {
    const { bounds, half, position } = input;
    const lo = { x: half.x + this.cfg.cornerMargin, y: half.y + this.cfg.cornerMargin };
    const hi = { x: bounds.w - half.x - this.cfg.cornerMargin, y: bounds.h - half.y - this.cfg.cornerMargin };
    const sx: -1 | 1 = position.x < (lo.x + hi.x) / 2 ? -1 : 1;
    const sy: -1 | 1 = position.y < (lo.y + hi.y) / 2 ? -1 : 1;
    this.favourite = { sx, sy };
    return this.cornerPoint({ sx, sy }, lo, hi);
  }

  /** Map a corner (edge signs) to its on-screen point within the safe margins. */
  private cornerPoint(c: Corner, lo: Vec2, hi: Vec2): Vec2 {
    return {
      x: clamp(c.sx < 0 ? lo.x : hi.x, Math.min(lo.x, hi.x), Math.max(lo.x, hi.x)),
      y: clamp(c.sy < 0 ? lo.y : hi.y, Math.min(lo.y, hi.y), Math.max(lo.y, hi.y)),
    };
  }

  /**
   * Plan a route to a nap corner and hug the wall to reach it. The corner is biased
   * toward the remembered favourite (A4): with probability FAVOURITE_BIAS it returns
   * there, otherwise it picks a fresh random corner — and either way records it as the
   * new favourite. The cat first slides horizontally to the corner's vertical edge,
   * then walks along that edge into the corner — so it "walks along the screen edges"
   * (A1) rather than cutting straight across.
   */
  private planRoute(input: DirectorInput): Vec2[] {
    const { bounds, half, position } = input;
    const lo = { x: half.x + this.cfg.cornerMargin, y: half.y + this.cfg.cornerMargin };
    const hi = { x: bounds.w - half.x - this.cfg.cornerMargin, y: bounds.h - half.y - this.cfg.cornerMargin };

    const corner: Corner =
      this.favourite && this.rng() < FAVOURITE_BIAS
        ? this.favourite
        : { sx: this.rng() < 0.5 ? -1 : 1, sy: this.rng() < 0.5 ? -1 : 1 };
    this.favourite = corner; // remember where it's headed to nap

    const pt = this.cornerPoint(corner, lo, hi);
    const edge: Vec2 = { x: pt.x, y: position.y }; // to the wall at current height
    return [edge, pt]; // then along it into the corner
  }
}
