// Locomotion controller (KITTO_AMBIENT.md §2, MA-0).
//
// A thin motion layer that owns the cat's on-screen *position* and *facing* and
// moves it toward a target at a steady speed. It is deliberately separate from the
// pure CatStateMachine: the machine owns *which pose* per frame; this owns *where*
// the cat is and *which way* it faces. The Director (MA-1+) will hand it targets;
// for MA-0 the targets come from a spike trigger.
//
// PURE-ish: no Date.now() / Math.random() / DOM. Time is injected as `dtMs` per
// frame (from the animation clock) and the caller chooses targets, so the motion
// is deterministic and unit-tested.

export interface Vec2 {
  x: number;
  y: number;
}

/** Horizontal facing: +1 faces right (sprite's default), -1 faces left (mirrored). */
export type Facing = -1 | 1;

/** Below this horizontal delta we don't flip facing — avoids jitter on near-vertical paths. */
const FACING_EPS = 0.5;

export class Locomotion {
  private pos: Vec2;
  private target: Vec2 | null = null;
  private facingX: Facing = 1;
  /** Speed of the *current* trip (logical px/sec). Defaults to the stroll speed; a
   *  `walkTo` may override it per-trip (e.g. a fast zoomies dash) — reset on arrival. */
  private activeSpeed: number;

  /**
   * @param start  Initial position (logical px; the cat sprite's centre).
   * @param speedPxPerSec  Walk speed. A leisurely default — cats stroll.
   */
  constructor(
    start: Vec2,
    private readonly speedPxPerSec = 90,
  ) {
    this.pos = { x: start.x, y: start.y };
    this.activeSpeed = speedPxPerSec;
  }

  /** Current position (logical px, sprite centre). Returns a copy. */
  get position(): Vec2 {
    return { x: this.pos.x, y: this.pos.y };
  }

  /** True while there is an active target the cat is still travelling toward. */
  get moving(): boolean {
    return this.target !== null;
  }

  get facing(): Facing {
    return this.facingX;
  }

  /** Command a walk toward (x, y). Replaces any prior target. An optional
   *  `speedPxPerSec` overrides the stroll speed for this trip only (a fast zoomies
   *  dash); it resets to the leisurely default once the target is reached/cleared. */
  walkTo(x: number, y: number, speedPxPerSec?: number): void {
    this.target = { x, y };
    this.activeSpeed = speedPxPerSec ?? this.speedPxPerSec;
  }

  /** Abandon the current target (stop where we are). Facing is left as-is. */
  stop(): void {
    this.target = null;
    this.activeSpeed = this.speedPxPerSec;
  }

  /** Teleport (no walk) — e.g. initial placement or a drag-drop. Clears the target. */
  placeAt(x: number, y: number): void {
    this.pos = { x, y };
    this.target = null;
    this.activeSpeed = this.speedPxPerSec;
  }

  /**
   * Advance toward the target by one frame of `dtMs`. Returns true on the frame the
   * target is reached (and clears it). A no-op (returns false) when there's no
   * target. Updates facing toward travel direction. Negative/zero dt is a no-op step.
   */
  update(dtMs: number): boolean {
    if (!this.target) return false;

    const dx = this.target.x - this.pos.x;
    const dy = this.target.y - this.pos.y;

    if (dx > FACING_EPS) this.facingX = 1;
    else if (dx < -FACING_EPS) this.facingX = -1;

    const dist = Math.hypot(dx, dy);
    const step = (this.activeSpeed * Math.max(0, dtMs)) / 1000;

    // Reached (or would overshoot) the target this frame: snap and clear.
    if (dist === 0 || dist <= step) {
      this.pos = { x: this.target.x, y: this.target.y };
      this.target = null;
      this.activeSpeed = this.speedPxPerSec; // back to the leisurely stroll for next time
      return true;
    }

    this.pos = {
      x: this.pos.x + (dx / dist) * step,
      y: this.pos.y + (dy / dist) * step,
    };
    return false;
  }
}
