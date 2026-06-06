import type { AtlasState, Frame } from "../sprites/loader";
import type { CanvasRenderer } from "./canvas";

/** Clamp per-frame delta time so a stalled tab can't fast-forward the animation. */
const MAX_DT_MS = 250;

/**
 * Idle redraw cap. When nothing has changed since the last *drawn* frame (same sprite
 * frame, same live transform), we still wake on rAF to advance time — but we only repaint
 * at this slower cadence. A resting cat breathing imperceptibly doesn't need 60fps; ~12fps
 * is indistinguishable and cuts idle GPU/CPU ~5×. Motion frames bypass this via `markDirty`.
 */
const IDLE_REDRAW_MS = 1000 / 12;

/**
 * Drives frame-based sprite animation on a {@link CanvasRenderer} via
 * requestAnimationFrame. Each tick it (1) hands elapsed time to `onTick` so the
 * owner can advance the state machine, (2) reads the resulting state name, and
 * (3) plays that state's frames on a loop, honoring each frame's `duration`.
 *
 * Switching state restarts its animation from frame 0 — no tearing between cycles.
 */
export class AnimationController {
  private currentState: string;
  private frames: Frame[];
  private index = 0;
  private elapsed = 0;
  private rafId = 0;
  private lastTs = 0;

  constructor(
    private readonly renderer: CanvasRenderer,
    private image: CanvasImageSource,
    private readonly states: Record<string, AtlasState>,
    /** Returns the current state name to animate (e.g. from the state machine). */
    private readonly getState: () => string,
    /** Called once per frame with clamped elapsed ms, before `getState`. */
    private readonly onTick?: (dtMs: number) => void,
    /**
     * Called after each frame is blitted, with the state just drawn. Lets the
     * owner paint a live overlay on top of the sprite — e.g. cursor-tracking
     * pupils in FollowEyes/Hunt (M2) — without the controller knowing the detail.
     */
    private readonly onDraw?: (state: string) => void,
    /**
     * Optional per-frame blit override. When provided, the controller calls this
     * INSTEAD of {@link CanvasRenderer.drawFrame} for the current frame, handing the
     * owner the frame + state so it can apply a live transform (the MA breathing/blink
     * squash on resting states). Returning nothing is fine — the owner does the draw.
     */
    private readonly drawFrame?: (frame: Frame, state: string) => void,
    /**
     * Optional idle-redraw gate. Returns true when the live overlay/transform changed
     * since the last paint (e.g. the breathing squash crossed a perceptible step, or a
     * blink toggled) and so the canvas must be repainted even though the baked frame index
     * is unchanged. When it returns false and the frame index also held, the controller
     * skips the repaint until {@link IDLE_REDRAW_MS} elapses — throttling a resting cat to
     * ~12fps. Omit it (legacy callers) to keep the old always-redraw behavior.
     */
    private readonly wantsRedraw?: (state: string) => boolean,
  ) {
    this.currentState = getState();
    this.frames = this.framesFor(this.currentState);
  }

  /** ms since the last actual repaint — drives the idle FPS cap. */
  private sinceDraw = 0;

  private framesFor(state: string): Frame[] {
    const atlasState = this.states[state];
    if (!atlasState || atlasState.frames.length === 0) {
      throw new Error(`no frames for state "${state}"`);
    }
    return atlasState.frames;
  }

  /** Begin the animation loop. Idempotent. */
  start(): void {
    if (this.rafId !== 0) return;
    this.lastTs = 0;
    const loop = (ts: number): void => {
      if (this.lastTs === 0) this.lastTs = ts;
      const dt = Math.min(MAX_DT_MS, ts - this.lastTs);
      this.lastTs = ts;
      this.step(dt);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  /** Stop the loop. Idempotent. */
  stop(): void {
    if (this.rafId !== 0) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  /** Swap the sprite source live (custom-fur recolor, M6). Same frame geometry, so
   *  the in-flight animation continues uninterrupted — only the pixels change. */
  setImage(image: CanvasImageSource): void {
    this.image = image;
  }

  /** Advance one frame of wall-clock time. Exposed for deterministic testing. */
  step(dtMs: number): void {
    this.onTick?.(dtMs);
    this.sinceDraw += dtMs;

    // `dirty` = the visible output must change this tick. A state change or a baked
    // frame advance always dirties; the owner's `wantsRedraw` reports live-overlay
    // changes (breathing step crossing, blink toggle) on otherwise-static poses.
    let dirty = false;

    const next = this.getState();
    if (next !== this.currentState) {
      const frames = this.states[next];
      if (frames && frames.frames.length > 0) {
        this.currentState = next;
        this.frames = frames.frames;
        this.index = 0;
        this.elapsed = 0;
        dirty = true;
      }
    }

    this.elapsed += dtMs;
    // Advance as many frames as the elapsed time covers (handles long dt).
    let guard = this.frames.length * 4;
    while (this.elapsed >= this.frames[this.index]!.duration && guard-- > 0) {
      this.elapsed -= this.frames[this.index]!.duration;
      this.index = (this.index + 1) % this.frames.length;
      dirty = true; // a new baked frame is showing
    }

    if (this.wantsRedraw?.(this.currentState)) dirty = true;

    // Idle FPS cap: when nothing's dirty, still repaint occasionally so a slow-drifting
    // breath never freezes mid-cycle — but at ~12fps, not 60. A `wantsRedraw`-less caller
    // has no notion of idle, so it always repaints (dirty stays the old default).
    const gated = this.wantsRedraw !== undefined;
    if (!gated || dirty || this.sinceDraw >= IDLE_REDRAW_MS) {
      const frame = this.frames[this.index]!;
      if (this.drawFrame) {
        this.drawFrame(frame, this.currentState);
      } else {
        this.renderer.drawFrame(this.image, frame);
      }
      this.onDraw?.(this.currentState);
      this.sinceDraw = 0;
    }
  }
}
