// Wool-ball physics (KITTO_AMBIENT.md §3 A2 — MA-3).
//
// A small prop the cat bats, chases, and pounces during idle play. Deliberately
// simple: a rolling ball with linear friction and walls it bounces off. The cat's
// *decisions* live in PlaySession; this is just the motion.
//
// PURE: no Date.now() / Math.random() / DOM. Time is injected as `dtMs` per frame and
// the live bounds are passed in (so window resizes track), so it's deterministic and
// unit-tested (spec §8, KITTO_AMBIENT §5 "Determinism").

import type { Vec2 } from "../render/locomotion";

export interface Bounds {
  readonly w: number;
  readonly h: number;
}

export interface BallOptions {
  /** Ball radius (logical px) — also the wall inset so it bounces at its edge. */
  readonly radius?: number;
  /** Linear deceleration from rolling friction (logical px/sec²). */
  readonly decelPxPerSec2?: number;
  /** Fraction of speed kept across a wall bounce (0 = dead stop, 1 = perfectly elastic). */
  readonly restitution?: number;
  /** At/below this speed (px/sec) the ball is considered at rest (snaps to still). */
  readonly restSpeed?: number;
}

const DEFAULTS = {
  radius: 9,
  decelPxPerSec2: 360,
  restitution: 0.6,
  restSpeed: 6,
};

export class Ball {
  private pos: Vec2;
  private vel: Vec2 = { x: 0, y: 0 };
  private readonly radius: number;
  private readonly decel: number;
  private readonly restitution: number;
  private readonly restSpeed: number;

  constructor(start: Vec2, opts: BallOptions = {}) {
    this.pos = { x: start.x, y: start.y };
    this.radius = opts.radius ?? DEFAULTS.radius;
    this.decel = opts.decelPxPerSec2 ?? DEFAULTS.decelPxPerSec2;
    this.restitution = opts.restitution ?? DEFAULTS.restitution;
    this.restSpeed = opts.restSpeed ?? DEFAULTS.restSpeed;
  }

  get position(): Vec2 {
    return { x: this.pos.x, y: this.pos.y };
  }

  get velocity(): Vec2 {
    return { x: this.vel.x, y: this.vel.y };
  }

  get speed(): number {
    return Math.hypot(this.vel.x, this.vel.y);
  }

  /** True once friction has all but stopped the ball — the cat's cue to bat it again. */
  get atRest(): boolean {
    return this.speed <= this.restSpeed;
  }

  get r(): number {
    return this.radius;
  }

  /** Teleport the ball and stop it (initial placement). */
  placeAt(x: number, y: number): void {
    this.pos = { x, y };
    this.vel = { x: 0, y: 0 };
  }

  /** Give the ball a velocity (a bat/swat) in logical px/sec. */
  bat(vx: number, vy: number): void {
    this.vel = { x: vx, y: vy };
  }

  /**
   * Advance one frame within `bounds`: apply friction, integrate, and bounce off the
   * four walls (keeping the ball fully on-screen by its radius). Passing the live
   * bounds each frame keeps play correct across window resizes.
   */
  update(dtMs: number, bounds: Bounds): void {
    const dt = Math.max(0, dtMs) / 1000;
    if (dt === 0) return;

    // Friction: shed `decel` px/sec of speed, preserving direction. Once it's down to
    // a crawl, snap to a clean stop so it doesn't creep forever (→ atRest).
    const sp = this.speed;
    if (sp > 0) {
      const next = sp - this.decel * dt;
      if (next <= this.restSpeed) {
        this.vel = { x: 0, y: 0 };
      } else {
        const k = next / sp;
        this.vel = { x: this.vel.x * k, y: this.vel.y * k };
      }
    }

    let nx = this.pos.x + this.vel.x * dt;
    let ny = this.pos.y + this.vel.y * dt;

    const lo = this.radius;
    const hiX = bounds.w - this.radius;
    const hiY = bounds.h - this.radius;

    if (nx < lo) {
      nx = lo;
      this.vel.x = Math.abs(this.vel.x) * this.restitution;
    } else if (nx > hiX) {
      nx = hiX;
      this.vel.x = -Math.abs(this.vel.x) * this.restitution;
    }
    if (ny < lo) {
      ny = lo;
      this.vel.y = Math.abs(this.vel.y) * this.restitution;
    } else if (ny > hiY) {
      ny = hiY;
      this.vel.y = -Math.abs(this.vel.y) * this.restitution;
    }

    this.pos = { x: nx, y: ny };
  }
}
