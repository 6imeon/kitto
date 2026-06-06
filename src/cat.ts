import { CanvasRenderer } from "./render/canvas";
import { AnimationController } from "./render/animation";
import { Locomotion } from "./render/locomotion";
import {
  AmbientDirector,
  DEFAULT_DIRECTOR_CONFIG,
  type Bounds,
  type Corner,
  type DirectorConfig,
  type DirectorIntent,
} from "./render/director";
import { IdleFillers, type FillerConfig, type FillerKind } from "./render/idle-fillers";
import { IdleAnimator, NEUTRAL } from "./render/idle-anim";
import {
  resolveEnergy,
  pickFiller,
  type EnergyConfig,
  type EnergyTuning,
} from "./render/energy";
import { Ball } from "./play/ball";
import { PlaySession } from "./play/session";
import type { BallView } from "./render/ball-renderer";
import { CatStateMachine, DEFAULT_CONFIG } from "./state/machine";
import { DEFAULT_REACTIONS, type Reactions } from "./config/settings";
import type { Atlas, Frame } from "./sprites/loader";
import type { CatState } from "./state/machine";
import type { AgentStatus } from "./ipc/agent";

export interface CatOptions {
  /** Override the (Idle|FollowEyes) → Sleep inactivity threshold (ms). */
  readonly sleepAfterMs?: number;
  /** Called when the cursor enters/leaves the cat sprite — drives click-through. */
  readonly onHover?: (overCat: boolean) => void;
  /** Called once when a celebratory Jump begins (M5 agent-done) — e.g. play a sound. */
  readonly onJump?: () => void;
  /**
   * Overlay size provider (logical px), enabling the ambient Director (MA-1): when
   * present, an idle cat wanders to a corner and naps. Omit it (e.g. in tests) and
   * the cat is purely reactive — no autonomous wandering. The app supplies the live
   * viewport so the Director's nap corners track window resizes.
   */
  readonly viewport?: () => Bounds;
  /** Ambient wander/nap tuning (MA-1). Defaults to the spike config. NOTE: when
   *  `energy` is supplied it owns the Director/filler tuning — this is the bare MA-1
   *  fallback for callers that don't use the energy knob (e.g. some tests). */
  readonly wander?: DirectorConfig;
  /** Idle-filler tuning (MA-3 / A3 — groom/yawn/zoomies). Defaults to the spike config. */
  readonly fillers?: FillerConfig;
  /** Calm↔Playful energy + day/night + play toggle (MA-4 / A4). When present it drives
   *  the Director + filler cadence and the per-filler weights; live-updated via
   *  `setEnergy`. Omit it and the cat uses the bare `wander`/`fillers` configs. */
  readonly energy?: EnergyConfig;
  /** Local hour provider 0–23 for the day/night rhythm (MA-4). Injected for
   *  determinism (spec §8); defaults to reading the system clock. */
  readonly localHour?: () => number;
  /** Eye region to paint over on a blink (MA). Per-cat: the tuxedo cat supplies its
   *  48px-tile eye boxes; the gray cat omits it (its blink isn't wired). */
  readonly blinkEyes?: BlinkEyes | undefined;
  /** Pupil-tracking geometry for the FollowEyes/Hunt overlay (source-tile px). Per-cat;
   *  defaults to the gray 32px cat's eyes. The ginger cat supplies its 88px-tile values. */
  readonly eyes?: EyeConfig | undefined;
  /** Called each frame of wool-ball play (MA-3 / A2) with the ball's position, or
   *  `null` when play ends — the app renders the ball from this (omit in tests). */
  readonly onBall?: (view: BallView | null) => void;
  /** Randomness source for the ambient Director's corner / wander-spot choices.
   *  Injected so the whole cat is deterministic under test (spec §8); defaults to
   *  Math.random in the app. */
  readonly rng?: () => number;
}

const DEFAULT_SLEEP_AFTER_MS = 8000;

/**
 * How long the celebratory Jump pose holds after an agent finishes (ms). The Cat
 * re-asserts `jump` each frame for this long — several happy bounces — then the next
 * quiet `sense` relaxes it. Owned here (not the machine) like the Stretch hold.
 */
const JUMP_HOLD_MS = 2000;

/**
 * How long the wake-stretch pose holds after the ambient Director's nap is
 * interrupted (ms). Reuses the Stretch pose as the placeholder Wake/Stretch (MA-1);
 * dedicated wake art comes in the MA art pass. Like the Jump hold, the Cat
 * re-asserts the pose for this long, then the next quiet sense relaxes it.
 */
const WAKE_STRETCH_MS = 700;

/** Triple-click to wake a deeply-sleeping cat: this many clicks on the cat… */
const SLEEP_WAKE_CLICKS = 3;
/** …landing within this window (ms of each other) wake it. A longer pause resets the run. */
const SLEEP_WAKE_WINDOW_MS = 1200;

/** How close (logical px) to the screen centre counts as "arrived" when delivering a
 *  reminder, so the cat settles into its attention pose instead of inching forever. */
const REMINDER_ARRIVE_EPS = 2;

/** How long the groom idle-filler holds (ms) before the cat relaxes back (MA-3 / A3). */
const GROOM_HOLD_MS = 1500;
/** How long the yawn idle-filler holds (ms). */
const YAWN_HOLD_MS = 1100;
/** Zoomies dash speed (logical px/sec) — a frantic sprint, far faster than the stroll. */
const ZOOMIES_SPEED = 320;

/** How often (ms) to re-resolve the energy tuning so the day/night rhythm (MA-4 / A4)
 *  tracks the drifting local hour over a long session. Cheap + coarse — once a minute. */
const ENERGY_RERESOLVE_MS = 60_000;

/** No fresh cursor sample for this long ⇒ treat the pointer as stopped (speed→0). */
const CURSOR_IDLE_MS = 60;

/**
 * Sliding window over which keystrokes are counted into a rate. 1000ms means
 * `keyRate` is literally "keys pressed in the last second" (keys/sec), matching
 * the machine's typeRate / overheatRate thresholds. Typing lingers for up to this
 * long after you stop before the rate decays back below the Type threshold.
 */
const KEY_WINDOW_MS = 1000;

/** Treat the cat as "scrolling" for this long after the last wheel event. */
const SCROLL_WINDOW_MS = 350;

/** Pixels the cursor must be off-centre before the pupils commit to a direction. */
const LOOK_DEADZONE = 7;

/** Hit-test padding (logical px) around the canvas so petting feels forgiving. */
const HIT_PAD = 4;

/**
 * Per-cat pupil-tracking geometry for the live FollowEyes/Hunt overlay, in that
 * cat's *source-tile* pixels (pre-upscale). The cursor-tracking pupil is a
 * `pupil`×`pupil` square whose home (eyes-forward) top-left is `left`/`right`; each
 * gaze step slides it by `travel` px toward the cursor. Per-cat because tile sizes
 * and eye positions differ between sprite sets — the gray cat's 32px values are the
 * default; the ginger cat (88px tile) supplies its own (see src/main.ts).
 */
export interface EyeConfig {
  readonly left: { readonly x: number; readonly y: number };
  readonly right: { readonly x: number; readonly y: number };
  readonly pupil: number;
  readonly travel: number;
  readonly color: string;
}

// Default (gray 32px cat): a 4×4 sclera box per eye with a 2×2 pupil that slides
// ±1px toward the cursor. These match the blank-eye boxes the art generator draws
// (rows 6-7, cols {3,4}/{11,12} of the 16px grid → ×2 for the 32px tile).
const DEFAULT_EYES: EyeConfig = {
  left: { x: 7, y: 13 },
  right: { x: 23, y: 13 },
  pupil: 2,
  travel: 1,
  color: "#19191e",
};

/** A blink eye region: rectangles (in source-tile px) to paint over with `color` while
 *  the eyes are shut. Per-cat because eye positions/colors differ between sprite sets,
 *  and only valid on the front-facing resting pose where the eyes are drawn open. */
export interface BlinkEyes {
  readonly color: string;
  readonly rects: ReadonlyArray<{ x: number; y: number; w: number; h: number }>;
}

interface Point {
  x: number;
  y: number;
}

/**
 * One desktop cat: its own state machine + animation loop bound to one canvas.
 * Kept fully self-contained (no module-level singletons) so the app can spawn
 * several — multi-cat is in scope for v1 (see v1 scope decisions / KITTO_SPEC §9).
 *
 * M2 feeds it a global cursor stream (window-local logical px) so it follows the
 * cursor with its eyes, hunts a fast flick, and purrs (Pet) when hovered.
 */
export class Cat {
  private readonly machine: CatStateMachine;
  private readonly anim: AnimationController;
  private readonly renderer: CanvasRenderer;
  /** MA: live "breathing" squash on resting poses, so a static sit feels alive. The
   *  baked walk/pounce/sleep frames carry their own motion; this only touches Idle-like
   *  states (see {@link IdleAnimator.isResting}). Blink is driven here but only painted
   *  for cats whose eye region is known (see {@link blinkEyes}). */
  private readonly idleAnim: IdleAnimator;
  /** Breathing/blink transform for the current frame, advanced in {@link frameUpdate}
   *  with real dt and read by {@link drawFrame}. (drawFrame can't advance it itself —
   *  it has no reliable dt.) */
  private idleTf = NEUTRAL;
  /** Eye region to paint over while blinking, or null for cats whose blink isn't wired
   *  (then the IdleAnimator still schedules blinks, they just aren't painted). */
  private blinkEyes: BlinkEyes | null;
  /** Per-cat pupil-tracking geometry for the FollowEyes/Hunt overlay (source-tile px). */
  private readonly eyes: EyeConfig;
  /** The live atlas pixels (raw or recolored). Kept in sync with the animation
   *  controller's image so the breathing draw-override blits the right source. */
  private image: CanvasImageSource;
  /** Owns the cat's on-screen position + facing (MA-0). The machine owns *pose*;
   *  this owns *where*. Starts at the origin; the app `placeAt`s it on launch. */
  private readonly loco = new Locomotion({ x: 0, y: 0 });
  /** Ambient life (MA-1): decides when an idle cat wanders off to nap in a corner.
   *  Sits above the pure machine, below real input — it only proposes intent. Active
   *  only when a `viewport` provider is supplied (so the corner tracks the screen). */
  private readonly director: AmbientDirector;
  /** Idle-filler scheduler (MA-3 / A3): occasionally grooms/yawns/zoomies while the
   *  cat is just hanging out, so it never looks frozen. Ticked only while dwelling. */
  private readonly fillers: IdleFillers;
  /** The Calm↔Playful energy knob + day/night + play toggle (MA-4 / A4). Resolved to
   *  concrete Director/filler tuning via `resolveEnergy`; null ⇒ no energy knob (the
   *  cat uses the bare wander/filler configs it was built with). */
  private energyCfg: EnergyConfig | null;
  /** Local-hour source for the day/night rhythm (MA-4). Injected for determinism. */
  private readonly localHour: () => number;
  /** Last energy tuning applied to the sub-modules — its `fillerWeights` drive each
   *  filler pick so the cadence respects the energy knob. Refreshed by `applyEnergy`. */
  private energyTuning: EnergyTuning | null = null;
  /** Accumulates frame time so the day/night rhythm can re-resolve on a slow cadence
   *  (the local hour drifts over a long session); see ENERGY_RERESOLVE_MS. */
  private energyResolveMs = 0;
  private readonly viewport: (() => Bounds) | undefined;
  private readonly sleepAfterMs: number;
  private readonly onHover: ((overCat: boolean) => void) | undefined;
  private readonly onJump: (() => void) | undefined;
  private readonly onBall: ((view: BallView | null) => void) | undefined;
  /** Randomness source (injected for determinism, spec §8); drives play swat spread. */
  private readonly rng: () => number;

  /** Latest cursor position (window-local logical px), or null until the first sample. */
  private lastCursor: Point | null = null;
  private lastEventAt = 0;
  /** Pointer speed in logical px/ms, decayed to 0 when samples stop arriving. */
  private speed = 0;
  /** Quantised gaze direction, each axis ∈ {-1, 0, 1}; drives the pupil overlay. */
  private lookDir: Point = { x: 0, y: 0 };
  /** Last *painted* gaze, so a still cursor doesn't force pupil repaints (idle-CPU). */
  private paintedLook: Point = { x: 0, y: 0 };
  /** Whether the cursor is currently over the cat (edge-detected for `onHover`). */
  private hoverActive = false;

  /** Timestamps (ms) of recent key presses, trimmed to KEY_WINDOW_MS each frame. */
  private keyTimes: number[] = [];
  /** When the last wheel event arrived; "scrolling" = within SCROLL_WINDOW_MS. */
  private lastScrollAt = -Infinity;
  /** A key/scroll arrived since the last frame ⇒ wake + defer sleep this frame. */
  private pendingActivity = false;
  /** Whether a timer (stretch reminder / Pomodoro phase change) is holding the
   *  Stretch pose. The TimerManager flips this on its edges; while true the Cat
   *  re-asserts `stretch` each frame so the pose holds for the timer's duration. */
  private stretching = false;
  /** Whether a watched AI agent is mid-task (M5). Fed into `sense` each frame → Think. */
  private agentWorking = false;
  /** Wall-clock deadline (performance.now ms) until which the Jump pose holds; 0 = not jumping. */
  private jumpingUntil = 0;
  /** Wall-clock deadline until which the wake-stretch holds after a nap is interrupted; 0 = not waking. */
  private wakeStretchUntil = 0;
  /** Whether a reminder is being delivered (MA-2). While true the cat trots to the
   *  centre of the screen and holds the attention pose until the app dismisses it —
   *  a firing reminder outranks both the ambient Director and the reactive ladder
   *  (KITTO_AMBIENT §2: "a firing timer/reminder interrupts the Director"). */
  private reminderActive = false;
  /** Whether a *user-commanded* wander is in progress (tap-to-wander, MA-2). Unlike
   *  the autonomous Director wander — which yields to any interaction — this is an
   *  explicit "go for a stroll" the tap requested, so it overrides the reactive
   *  ladder (it leaves the very cursor that tapped it). Ends on arrival, on a real
   *  key/scroll cue, or when a drag/grab clears the target (see `notifyActivity`). */
  private commandedWander = false;
  /** A drag-to-bed nap in progress (MA-4 / A4): the cat is walking the last little way
   *  into the corner the user dropped it near, after which it lies down. Like a
   *  commanded wander it overrides the reactive ladder, and a real cue cancels it. */
  private draggedToBed = false;
  /** Deep sleep: once the cat has actually lain down to nap (Sleep pose, whether it
   *  walked to a corner or was dropped there), it sleeps through ordinary interrupts —
   *  keys, scroll, cursor, hover all leave it asleep. Only a deliberate triple-click
   *  on the cat wakes it (see {@link handleSleepClick}). This is what stops a keystroke
   *  cutting a nap to ~0.5s. Cleared on the wake. */
  private deepSleep = false;
  /** Clicks landed on the cat during deep sleep, and when the last one arrived. Three
   *  within {@link SLEEP_WAKE_WINDOW_MS} wake it; the run resets if you pause. */
  private sleepClicks = 0;
  private lastSleepClickAt = 0;
  /** A held groom/yawn idle filler (MA-3 / A3): the pose is re-asserted until this
   *  wall-clock deadline (performance.now ms); null = no filler held. */
  private fillerUntil = 0;
  private fillerKind: "groom" | "yawn" | null = null;
  /** Remaining zoomies dash waypoints (MA-3 / A3). Non-empty ⇒ a zoomies is running:
   *  the cat sprints leg to leg at ZOOMIES_SPEED, asserting Walk, then resumes idling. */
  private zoomiesLegs: Point[] = [];
  /** Active wool-ball play (MA-3 / A2): the cat chases + pounces the `ball`, guided by
   *  the `play` session, until it loses interest. Both null ⇒ not playing. */
  private ball: Ball | null = null;
  private play: PlaySession | null = null;
  /** The Director's idle clock (ms): time since the last *real* interaction. Unlike
   *  the machine's idleMs (which a gentle cursor glance / FollowEyes resets), this
   *  only resets on a genuine interaction per KITTO_AMBIENT §2 — pet/hunt/type/
   *  scroll/drag/agent — so merely moving the cursor to look at the cat doesn't keep
   *  it from wandering. This is what gates (and interrupts) the ambient wander/nap. */
  private ambientIdleMs = 0;
  /** Per-reaction enable toggles (M6). A disabled reaction's sensor is suppressed
   *  before `sense`, so that pose never fires — without touching the baseline
   *  Idle/Sleep/FollowEyes life or the hover hit-test (drag/click-through). */
  private reactions: Reactions = DEFAULT_REACTIONS;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    image: CanvasImageSource,
    atlas: Atlas,
    tile: { readonly w: number; readonly h: number },
    opts: CatOptions = {},
  ) {
    this.renderer = new CanvasRenderer(canvas, tile.w, tile.h);
    this.image = image;
    this.idleAnim = new IdleAnimator(undefined, opts.rng);
    this.blinkEyes = opts.blinkEyes ?? null;
    this.eyes = opts.eyes ?? DEFAULT_EYES;
    this.sleepAfterMs = opts.sleepAfterMs ?? DEFAULT_SLEEP_AFTER_MS;
    this.onHover = opts.onHover;
    this.onJump = opts.onJump;
    this.onBall = opts.onBall;
    this.rng = opts.rng ?? Math.random;
    this.viewport = opts.viewport;
    this.director = new AmbientDirector(opts.wander ?? DEFAULT_DIRECTOR_CONFIG, opts.rng);
    this.fillers = new IdleFillers(opts.fillers, opts.rng);
    this.localHour = opts.localHour ?? (() => new Date().getHours());
    // The energy knob (MA-4): when supplied it overrides the bare wander/filler configs
    // above with the resolved Calm↔Playful tuning. Apply it once up front.
    this.energyCfg = opts.energy ?? null;
    if (this.energyCfg) this.applyEnergy();
    // Reaction thresholds (huntSpeed / moveEps / typeRate / overheatRate) use the
    // machine defaults; only the sleep timeout is configurable per cat.
    this.machine = new CatStateMachine({
      ...DEFAULT_CONFIG,
      sleepAfterMs: this.sleepAfterMs,
    });
    this.anim = new AnimationController(
      this.renderer,
      image,
      atlas.states,
      () => this.machine.state,
      (dtMs) => this.frameUpdate(dtMs),
      (state) => this.drawOverlay(state),
      (frame, state) => this.drawFrame(frame, state),
      (state) => this.wantsRedraw(state),
    );
  }

  /**
   * Idle-redraw gate for the AnimationController: true when the live overlay changed since
   * the last paint, so a resting/holding pose must repaint despite its frame index holding.
   * Two live sources: the breathing+blink transform, and the cursor-tracking pupils. When
   * both are quiet (cat sitting still, cursor parked) this returns false and the controller
   * coasts at the idle FPS cap — the whole point of the throttle.
   */
  private wantsRedraw(state: string): boolean {
    let changed = this.idleAnim.changedSince(state);
    if (state === "FollowEyes" || state === "Hunt") {
      if (this.lookDir.x !== this.paintedLook.x || this.lookDir.y !== this.paintedLook.y) {
        changed = true;
      }
      this.paintedLook = { x: this.lookDir.x, y: this.lookDir.y };
    }
    return changed;
  }

  start(): void {
    this.anim.start();
  }

  stop(): void {
    this.anim.stop();
  }

  /** Swap the cat's sprite source (custom-fur recolor, M6). The owner builds the
   *  recolored atlas (src/sprites/recolor.ts) and hands it in; the running
   *  animation continues seamlessly on the new pixels. */
  setSkin(image: CanvasImageSource): void {
    this.image = image;
    this.anim.setImage(image);
  }

  /**
   * Feed one cursor sample (window-local logical px). Records position + derived
   * speed; the per-frame `frameUpdate` does the hit-test, gaze and state feed so
   * everything stays in lock-step with the animation clock (and a parked cursor
   * is re-evaluated each frame, not just when it moves).
   */
  handleCursor(x: number, y: number): void {
    const now = performance.now();
    if (this.lastCursor) {
      const dist = Math.hypot(x - this.lastCursor.x, y - this.lastCursor.y);
      const dt = Math.max(1, now - this.lastEventAt);
      this.speed = dist / dt;
    }
    this.lastCursor = { x, y };
    this.lastEventAt = now;
  }

  /**
   * Feed one global key press (M3). Records the timestamp so `frameUpdate` can
   * derive a typing rate (keys/sec) → Type / Overheat, and flags activity so even
   * a sub-threshold keystroke wakes the cat and defers sleep.
   */
  handleKey(): void {
    this.keyTimes.push(performance.now());
    this.pendingActivity = true;
  }

  /** Feed one global scroll event (M3). Opens the "scrolling" window → Scroll. */
  handleScroll(): void {
    this.lastScrollAt = performance.now();
    this.pendingActivity = true;
  }

  /** True while the cat is deeply asleep — the app uses this to route a click through
   *  {@link handleSleepClick} (triple-click to wake) instead of the normal grab/wake. */
  get sleeping(): boolean {
    return this.deepSleep;
  }

  /**
   * A primary click landed on a deeply-sleeping cat. It takes {@link SLEEP_WAKE_CLICKS}
   * clicks within {@link SLEEP_WAKE_WINDOW_MS} of each other to rouse it — a stray
   * single click leaves it asleep. Returns true once the cat actually wakes (so the
   * caller can treat that click as the wake, not a tap-to-wander). A drag still wakes
   * it immediately via `notifyActivity` (you grabbed it).
   */
  handleSleepClick(): boolean {
    if (!this.deepSleep) return false;
    const now = performance.now();
    if (now - this.lastSleepClickAt > SLEEP_WAKE_WINDOW_MS) this.sleepClicks = 0;
    this.lastSleepClickAt = now;
    this.sleepClicks += 1;
    if (this.sleepClicks < SLEEP_WAKE_CLICKS) return false;
    this.sleepClicks = 0;
    this.wakeFromDeepSleep();
    return true;
  }

  /** Rouse a deeply-sleeping cat: clear deep sleep, wake the machine, and reset the
   *  ambient clock so it doesn't immediately wander off again. */
  private wakeFromDeepSleep(): void {
    this.deepSleep = false;
    this.director.update({
      idleMs: 0, // a drop → the Director's nap sees an interrupt and wakes
      position: this.loco.position,
      bounds: this.viewport ? this.viewport() : { w: 0, h: 0 },
      half: { x: this.canvas.width / 2, y: this.canvas.height / 2 },
      arrived: false,
    });
    this.machine.activity();
    this.ambientIdleMs = 0;
    this.wakeStretchUntil = performance.now() + WAKE_STRETCH_MS;
  }

  /** Feed a generic activity signal (e.g. the overlay receiving focus, or a drag) —
   *  wakes the cat and counts as a real interaction for the ambient Director. */
  notifyActivity(): void {
    this.deepSleep = false; // a grab/drag always rouses it
    this.sleepClicks = 0;
    this.machine.activity();
    this.ambientIdleMs = 0;
    // A fresh grab/tap/drag supersedes an in-flight commanded wander: a tap re-issues
    // it on pointerup (a new spot), and a drag repositions instead (placeAt clears the
    // loco target). Either way, stand the current commanded stroll down here.
    this.commandedWander = false;
    this.draggedToBed = false; // and any drag-to-bed settle
    this.zoomiesLegs = []; // and any zoomies dash
    this.endPlay(); // and any wool-ball play
  }

  /**
   * Feed a normalized AI-agent status (M5 — the differentiator, KITTO_SPEC §6).
   *   - `working` → the cat thinks along (Think) and stays awake while the task runs.
   *   - `idle`    → stop thinking; the cat returns to its ordinary ambient behavior.
   *   - `done`    → a celebratory Jump (held for JUMP_HOLD_MS) + the one-shot `onJump`
   *                 hook (e.g. a happy sound). Clears `working` so it relaxes after.
   * Driven by edges from the Rust watcher; `frameUpdate` turns the flags into poses.
   */
  handleAgent(status: AgentStatus): void {
    if (!this.reactions.agent) return; // agent reactions disabled (M6) — ignore the signal
    switch (status) {
      case "working":
        this.agentWorking = true;
        break;
      case "idle":
        this.agentWorking = false;
        break;
      case "done":
        this.agentWorking = false;
        this.jumpingUntil = performance.now() + JUMP_HOLD_MS;
        this.onJump?.();
        break;
    }
  }

  /**
   * Hold or release the timer-driven Stretch pose (M4). The TimerManager calls
   * this on the rising/falling edge of a stretch; `frameUpdate` keeps re-asserting
   * the pose while held so it overrides ambient reactions for the stretch's length.
   */
  setStretching(active: boolean): void {
    this.stretching = active;
  }

  /**
   * Apply the per-reaction enable toggles (M6 settings). Disabling the agent
   * reaction also clears any in-flight Think/Jump so the cat relaxes immediately.
   */
  setReactions(reactions: Reactions): void {
    this.reactions = reactions;
    if (!reactions.agent) {
      this.agentWorking = false;
      this.jumpingUntil = 0;
    }
  }

  /** Live-apply ambient wander/nap settings (MA-1; settings UI lands in MA-4). */
  setWander(cfg: DirectorConfig): void {
    this.director.configure(cfg);
  }

  /** Live-apply idle-filler settings (MA-3 / A3; settings UI lands in MA-4). */
  setFillers(cfg: FillerConfig): void {
    this.fillers.configure(cfg);
  }

  /**
   * Live-apply the Calm↔Playful energy knob + day/night + play toggle (MA-4 / A4).
   * Re-resolves the tuning and pushes it to the Director and filler scheduler. From
   * here the energy knob owns the wander/nap cadence and the per-filler weights, so
   * `setWander`/`setFillers` shouldn't be mixed with it on the same cat.
   */
  setEnergy(cfg: EnergyConfig): void {
    this.energyCfg = cfg;
    this.applyEnergy();
  }

  /** Resolve the current energy config (with the day/night hour) and apply it to the
   *  Director + fillers; caches the tuning so `startFiller` can weight its pick. */
  private applyEnergy(): void {
    if (!this.energyCfg) return;
    const tuning = resolveEnergy(this.energyCfg, this.localHour());
    this.energyTuning = tuning;
    this.director.configure(tuning.director);
    this.fillers.configure(tuning.fillers);
  }

  /** The cat's remembered favourite nap corner (A4), or null. Exposed so the app can
   *  persist it across restarts (and re-seed via `setFavouriteCorner`). */
  get favouriteCorner(): Corner | null {
    return this.director.favouriteCorner;
  }

  /** Restore a persisted favourite nap corner on launch (A4). */
  setFavouriteCorner(corner: Corner | null): void {
    this.director.setFavouriteCorner(corner);
  }

  /**
   * Drag-to-bed (MA-4 / A4): the user dropped the cat at its current spot — settle it
   * into the nearest corner and nap there, and remember that corner as the new
   * favourite. Call this on drop (after `placeAt`). The cat walks the last little way
   * into the corner and lies down; any real interaction wakes it as usual. No-op
   * without a viewport (tests/headless) or while a reminder is delivering.
   */
  napAt(): void {
    if (!this.viewport || this.reminderActive) return;
    const corner = this.director.cornerNear({
      bounds: this.viewport(),
      half: { x: this.canvas.width / 2, y: this.canvas.height / 2 },
      position: this.loco.position,
    });
    // Clear any in-flight ambient activity, then walk into the corner. The Director's
    // own dwell→travel→nap loop is bypassed: we drive this trip and call sleep on
    // arrival in `frameUpdate`'s drag-to-bed branch.
    this.commandedWander = false;
    this.zoomiesLegs = [];
    this.endPlay();
    this.draggedToBed = true;
    this.loco.walkTo(corner.x, corner.y);
  }

  /**
   * Send the cat off on a wander *right now* (tap-to-wander, MA-2) — a random
   * on-screen spot, regardless of the idle timer. This sits alongside the autonomous
   * idle wander (the user wanted both): a tap is an explicit command, so it overrides
   * the reactive ladder and the cat actually leaves the cursor that tapped it, walking
   * to the spot before resuming ordinary life. No-op without a viewport (tests/headless).
   */
  wanderNow(): void {
    if (!this.viewport) return;
    const spot = this.director.pickWanderSpot({
      bounds: this.viewport(),
      half: { x: this.canvas.width / 2, y: this.canvas.height / 2 },
    });
    this.loco.walkTo(spot.x, spot.y);
    this.commandedWander = true;
  }

  /**
   * Begin delivering a reminder (MA-2, KITTO_AMBIENT B1): the cat trots to the centre
   * of the screen and holds an attention pose there until `endReminder()`. This
   * outranks the ambient Director and the reactive ladder, so it persists through
   * idleness and ordinary input — the user clears it by dismissing/snoozing. Idempotent.
   */
  deliverReminder(): void {
    this.reminderActive = true;
    this.endPlay(); // a reminder outranks play — pack the ball away while it delivers
  }

  /** Whether a reminder delivery is currently on screen (cat at centre). */
  get deliveringReminder(): boolean {
    return this.reminderActive;
  }

  /** End a reminder delivery — the cat stops holding centre and resumes normal life. */
  endReminder(): void {
    if (!this.reminderActive) return;
    this.reminderActive = false;
    this.loco.stop(); // drop the centre target so it doesn't keep walking there
  }

  /** The cat sprite's on-screen size in logical px (the upscaled canvas box). */
  get size(): { readonly w: number; readonly h: number } {
    return { w: this.canvas.width, h: this.canvas.height };
  }

  /** The cat sprite's current centre (logical px, overlay/DOM space). */
  get position(): { readonly x: number; readonly y: number } {
    return this.loco.position;
  }

  /** Teleport the cat (no walk) — initial placement, recentre, or a drag-drop.
   *  Coordinates are the sprite *centre* in logical px (overlay/DOM space). */
  placeAt(x: number, y: number): void {
    this.loco.placeAt(x, y);
    this.applyPosition();
  }

  /** Command the cat to walk to (x, y) — sprite centre, logical px. Ambient: a real
   *  interaction (pet/hunt/type/scroll/agent) pauses the walk and it resumes after. */
  walkTo(x: number, y: number): void {
    this.loco.walkTo(x, y);
  }

  /** Whether the cat is currently travelling toward a target. */
  get walking(): boolean {
    return this.loco.moving;
  }

  get state(): CatState {
    return this.machine.state;
  }

  /** Per-frame: decay speed, hit-test, aim the eyes, fold in keyboard/scroll, then advance. */
  private frameUpdate(dtMs: number): void {
    const now = performance.now();
    if (now - this.lastEventAt > CURSOR_IDLE_MS) this.speed = 0;

    // Advance the live breathing/blink with real dt; drawFrame reads the result.
    this.idleTf = this.idleAnim.update(dtMs, this.machine.state);

    // Day/night rhythm (MA-4 / A4): re-resolve the energy tuning on a slow cadence so
    // the local hour's bias (more naps after dark, morning zoomies) tracks the clock.
    if (this.energyCfg?.dayNight) {
      this.energyResolveMs += Math.max(0, dtMs);
      if (this.energyResolveMs >= ENERGY_RERESOLVE_MS) {
        this.energyResolveMs = 0;
        this.applyEnergy();
      }
    }

    // Keyboard rate: keys within the trailing window, expressed as keys/sec.
    while (this.keyTimes.length > 0 && now - this.keyTimes[0]! > KEY_WINDOW_MS) {
      this.keyTimes.shift();
    }
    const keyRate = this.keyTimes.length * (1000 / KEY_WINDOW_MS);
    const scrolling = now - this.lastScrollAt < SCROLL_WINDOW_MS;
    const jumping = now < this.jumpingUntil;
    const waking = now < this.wakeStretchUntil;

    // A keystroke/scroll since the last frame wakes the cat and resets the sleep
    // clock, even when it's too gentle to cross the Type/Scroll thresholds. (Held
    // one-shot poses already own the frame, so don't let input disturb them.)
    // EXCEPT while deeply asleep: a sleeping cat ignores keys/scroll entirely (only a
    // triple-click wakes it), so swallow the cue without waking or resetting the clock.
    let activityThisFrame = false;
    if (this.pendingActivity) {
      this.pendingActivity = false;
      if (!this.deepSleep) {
        activityThisFrame = true; // a real key/scroll cue — resets the ambient clock below
        if (!this.stretching && !jumping && !waking) this.machine.activity();
      }
    }

    let overCat = false;
    if (this.lastCursor) {
      const rect = this.canvas.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      this.lookDir = {
        x: axis(this.lastCursor.x - cx),
        y: axis(this.lastCursor.y - cy),
      };
      overCat =
        this.lastCursor.x >= rect.left - HIT_PAD &&
        this.lastCursor.x <= rect.right + HIT_PAD &&
        this.lastCursor.y >= rect.top - HIT_PAD &&
        this.lastCursor.y <= rect.bottom + HIT_PAD;
    }

    // Delivering a reminder (MA-2) outranks everything else: the cat trots to centre
    // and holds the attention pose until the app dismisses/snoozes it. Short-circuit
    // the ambient Director and the reactive ladder, but keep hover/click-through live
    // (the user dismisses by clicking the cat or the banner) and pin the idle clock so
    // it doesn't start wandering the instant it's dismissed.
    if (this.reminderActive) {
      this.runReminderFrame(dtMs); // sets the machine pose (walk → centre, then alert)
      this.ambientIdleMs = 0;
      this.machine.tick(dtMs);
      this.applyPosition();
      this.emitHover(overCat);
      return;
    }

    // User-commanded wander (tap-to-wander, MA-2): outranks the reactive ladder so the
    // cat trots to its spot even while the cursor that tapped it is still on it. It
    // bows out for a real key/scroll cue (genuine work resuming) or once the loco
    // target is gone (arrived, or a drag/grab cleared it) — then control falls through
    // to ordinary handling. The idle clock is pinned so the Director re-arms only after.
    if (this.commandedWander && !activityThisFrame && this.loco.moving) {
      const arrived = this.loco.update(dtMs);
      if (arrived) this.commandedWander = false;
      if (arrived) this.machine.rest();
      else this.machine.walk();
      this.ambientIdleMs = 0;
      this.machine.tick(dtMs);
      this.applyPosition();
      this.emitHover(overCat);
      return;
    }
    if (this.commandedWander) {
      this.commandedWander = false; // interrupted (key/scroll) or target gone — resume normal life
      this.loco.stop();
    }

    // Drag-to-bed (MA-4 / A4): the cat walks the last little way into the corner it was
    // dropped near, then lies down — handing the nap to the Director so its normal
    // interrupt-wakes logic applies. Like a commanded wander it overrides the reactive
    // ladder; a real key/scroll cue cancels the settle and control falls through.
    if (this.draggedToBed && !activityThisFrame && this.loco.moving) {
      const arrived = this.loco.update(dtMs);
      if (arrived) {
        this.draggedToBed = false;
        this.loco.stop();
        this.applyDirectorIntent(this.director.napInPlace(this.ambientIdleMs), this.machine.state);
      } else {
        this.machine.walk();
      }
      this.ambientIdleMs = 0;
      this.machine.tick(dtMs);
      this.applyPosition();
      this.emitHover(overCat);
      return;
    }
    if (this.draggedToBed) {
      this.draggedToBed = false; // interrupted, or already arrived — resume normal life
    }

    // Zoomies (MA-3 / A3): a frantic dash across the screen and back. Like a commanded
    // wander it sprints leg to leg overriding the reactive ladder, but it's the cat's
    // own idle play — a real key/scroll cue cancels it (work resuming) and control
    // falls through to ordinary handling. The idle clock keeps drifting so a calm cat
    // still drifts on toward its nap afterward.
    if (this.zoomiesLegs.length > 0 && !activityThisFrame) {
      const arrived = this.loco.update(dtMs);
      if (arrived) {
        this.zoomiesLegs.shift();
        const next = this.zoomiesLegs[0];
        if (next) this.loco.walkTo(next.x, next.y, ZOOMIES_SPEED);
      }
      if (this.zoomiesLegs.length > 0) this.machine.walk();
      else this.machine.rest();
      this.ambientIdleMs += Math.max(0, dtMs);
      this.machine.tick(dtMs);
      this.applyPosition();
      this.emitHover(overCat);
      return;
    }
    if (this.zoomiesLegs.length > 0) {
      this.zoomiesLegs = []; // a real cue cut the zoomies short
      this.loco.stop();
    }

    // Wool-ball play (MA-3 / A2): the cat chases and pounces the ball until it loses
    // interest. Like the other ambient activities it owns the frame (overriding the
    // reactive ladder), but a real key/scroll cue ends play and control falls through.
    // The idle clock keeps drifting so a calm cat still naps once it's bored of the ball.
    if (this.ball && this.play && !activityThisFrame) {
      this.runPlayFrame(dtMs);
      this.ambientIdleMs += Math.max(0, dtMs);
      this.machine.tick(dtMs);
      this.applyPosition();
      this.emitHover(overCat);
      return;
    }
    if (this.ball || this.play) this.endPlay(); // a real cue (or a finished session) — pack up the ball

    // Held one-shot poses win for their duration (agent-done Jump over a stretch
    // reminder over the ambient ladder); otherwise feed one unified snapshot of
    // every reactive sensor and let the machine pick by priority (Overheat > Type
    // > Scroll > Pet > Hunt > Think > FollowEyes).
    //
    // M6 reaction toggles gate the snapshot here, not in the (pure) machine: a
    // disabled reaction has its sensor neutralized so that pose can't be picked.
    // Hunt clamps to just under its threshold (so FollowEyes/eye-tracking survive);
    // Pet drops only the pose input, never the real `overCat` used for hover.
    let st: CatState;
    if (this.deepSleep) {
      // Deeply asleep: ignore the whole reactive ladder (keys/scroll/hover/hunt/agent)
      // and just keep sleeping. Only handleSleepClick (triple-click) clears deepSleep.
      st = this.machine.sleep();
    } else if (jumping) {
      st = this.machine.jump();
    } else if (this.stretching || waking) {
      // Timer-driven stretch reminder, or the ambient wake-stretch after a nap is
      // interrupted (MA-1) — both strike the Stretch pose and hold it.
      st = this.machine.stretch();
    } else {
      const r = this.reactions;
      st = this.machine.sense({
        overCat: r.pet ? overCat : false,
        cursorSpeed: r.hunt ? this.speed : Math.min(this.speed, DEFAULT_CONFIG.huntSpeed - 0.001),
        keyRate: r.keyboard ? keyRate : 0,
        scrolling: r.scroll ? scrolling : false,
        agentWorking: r.agent ? this.agentWorking : false,
      });
    }

    // Held idle filler (MA-3 / A3): a groom or yawn the scheduler started. Re-assert
    // the pose until its hold expires — but only while the cat is genuinely calm
    // (Idle/FollowEyes, not walking); any real cue (a hover→Pet, a flick→Hunt, typing)
    // makes `st` reactive and cancels the filler so the interaction wins. The idle clock
    // keeps drifting (a filler is *because* it's idle, not activity) so the nap still comes.
    if (this.fillerKind && now < this.fillerUntil && (st === "Idle" || st === "FollowEyes") && !this.loco.moving) {
      st = this.fillerKind === "groom" ? this.machine.groom() : this.machine.yawn();
      this.ambientIdleMs += Math.max(0, dtMs);
      this.machine.tick(dtMs);
      this.applyPosition();
      this.emitHover(overCat);
      return;
    }
    if (this.fillerKind) this.fillerKind = null; // expired or interrupted — done grooming

    // Advance the Director's idle clock. It resets ONLY on a real interaction — a
    // reactive pose (pet/hunt/type/overheat/scroll/think/jump/stretch) or a fresh
    // key/scroll cue — NOT on a gentle cursor glance (Idle/FollowEyes) or the cat's
    // own ambient motion (Walk/Sleep). So you can move the cursor to watch the cat
    // without resetting its wander timer (KITTO_AMBIENT §2 interrupt list).
    this.ambientIdleMs =
      activityThisFrame || isReactivePose(st) ? 0 : this.ambientIdleMs + Math.max(0, dtMs);

    // Locomotion (MA-0). The cat only travels while an *ambient* pose owns the
    // frame; any real interaction (Pet/Hunt/Type/Overheat/Scroll/Think/Jump/Stretch)
    // freezes the walk in place — that's the Director yielding to real input
    // (KITTO_AMBIENT §2). The target is preserved, so the cat resumes afterward.
    // While travelling we assert Walk; on arrival we rest back to Idle.
    let arrived = false;
    if (this.loco.moving && isAmbient(st)) {
      arrived = this.loco.update(dtMs);
      st = arrived ? this.machine.rest() : this.machine.walk();
    }

    // Ambient Director (MA-1). With a viewport it owns the cat's inner life: after a
    // stretch of real idleness it sends the cat to a corner to nap, and wakes it when
    // a real interaction resets the ambient clock. Feeding it `ambientIdleMs` (not the
    // machine's idleMs) is what lets a gentle cursor glance leave the wander running.
    if (this.viewport) {
      const intent = this.director.update({
        idleMs: this.ambientIdleMs,
        position: this.loco.position,
        bounds: this.viewport(),
        half: { x: this.canvas.width / 2, y: this.canvas.height / 2 },
        arrived,
      });
      st = this.applyDirectorIntent(intent, st);
      // Once the cat has actually lain down (Sleep + the Director in its nap phase),
      // engage deep sleep: from here ordinary interrupts (key/scroll/cursor/hover) no
      // longer wake it — only a triple-click does (handleSleepClick). This is what
      // keeps a nap from being cut to ~0.5s by the next keystroke.
      if (st === "Sleep" && this.director.currentPhase === "nap") {
        this.deepSleep = true;
      }
    }

    // Never strand the cat mid-stride. `Walk` is only ever asserted by the loco
    // block above *while actually moving*; if the machine still reads Walk but the
    // locomotion has no target, the trip was stopped out from under it — a glance
    // (FollowEyes) that made the Director cancel the wander, a drag, or a recenter
    // clearing the target. Resolve back to Idle so it doesn't animate a walk in place.
    if (this.machine.state === "Walk" && !this.loco.moving) {
      st = this.machine.rest();
    }

    // Idle-filler scheduler (MA-3 / A3). While the cat is genuinely dwelling — calm,
    // stationary, the Director not already off wandering/napping, no real cue — tick
    // the scheduler; when it fires, start the chosen filler (held groom/yawn, or a
    // zoomies dash), which the dedicated branches above carry out on following frames.
    // Any other frame resets the scheduler so a fresh full gap is required.
    const dwelling =
      !!this.viewport &&
      this.director.currentPhase === "dwell" &&
      !this.loco.moving &&
      !activityThisFrame &&
      (st === "Idle" || st === "FollowEyes");
    if (dwelling) {
      // When the energy knob is in play, weight the filler pick by its resolved
      // per-energy weights (so e.g. a Calm cat never zooms, a Playful one zooms often);
      // otherwise fall back to the scheduler's built-in fixed weighting (MA-3).
      const weights = this.energyTuning?.fillerWeights;
      const choose = weights ? (r: number): FillerKind => pickFiller(weights, r) : undefined;
      this.startFiller(this.fillers.update(dtMs, choose), now);
    } else {
      this.fillers.reset();
    }

    this.machine.tick(dtMs);
    this.applyPosition();
    this.emitHover(overCat);
  }

  /** Begin an idle filler the scheduler chose (MA-3 / A3): a held groom/yawn pose, or
   *  a zoomies dash. `none` is a no-op. Takes effect from the next frame (the dedicated
   *  branches in `frameUpdate` carry it out). */
  private startFiller(kind: FillerKind, now: number): void {
    if (kind === "groom") {
      this.fillerKind = "groom";
      this.fillerUntil = now + GROOM_HOLD_MS;
    } else if (kind === "yawn") {
      this.fillerKind = "yawn";
      this.fillerUntil = now + YAWN_HOLD_MS;
    } else if (kind === "zoomies") {
      this.startZoomies();
    } else if (kind === "play") {
      this.startPlay();
    }
  }

  /** Plan a zoomies burst (MA-3 / A3): dash to a random on-screen spot and scurry back
   *  to where it started, fast. No-op without a viewport (tests/headless). */
  private startZoomies(): void {
    if (!this.viewport) return;
    const back = this.loco.position; // a copy — dash out, then scurry home
    const spot = this.director.pickWanderSpot({
      bounds: this.viewport(),
      half: { x: this.canvas.width / 2, y: this.canvas.height / 2 },
    });
    this.zoomiesLegs = [spot, back];
    this.loco.walkTo(spot.x, spot.y, ZOOMIES_SPEED);
  }

  /** Begin a bout of wool-ball play (MA-3 / A2): drop a ball a little way off and let
   *  the play session drive the chase. No-op without a viewport (tests/headless). */
  private startPlay(): void {
    if (!this.viewport) return;
    const bounds = this.viewport();
    const spot = this.director.pickWanderSpot({
      bounds,
      half: { x: this.canvas.width / 2, y: this.canvas.height / 2 },
    });
    this.ball = new Ball(spot);
    this.play = new PlaySession(undefined, this.rng);
    this.emitBall();
  }

  /** One frame of wool-ball play (MA-3 / A2): advance the ball, ask the session what to
   *  do, and carry it out — chase (walk toward the ball), pounce (swat it, reusing the
   *  Jump hop as the placeholder pounce), wait (crouch & watch), or end. */
  private runPlayFrame(dtMs: number): void {
    const ball = this.ball!;
    const play = this.play!;
    const bounds = this.viewport ? this.viewport() : { w: this.canvas.width, h: this.canvas.height };
    ball.update(dtMs, bounds);
    const intent = play.update({
      cat: this.loco.position,
      ball: ball.position,
      ballAtRest: ball.atRest,
      dtMs,
    });
    switch (intent.kind) {
      case "chase":
        this.loco.walkTo(intent.target.x, intent.target.y);
        if (this.loco.update(dtMs)) this.machine.rest();
        else this.machine.walk();
        break;
      case "pounce":
        this.loco.stop();
        ball.bat(intent.bat.x, intent.bat.y);
        this.machine.jump(); // placeholder pounce pose (dedicated play art → MA art pass)
        break;
      case "wait":
        this.loco.stop();
        this.machine.rest();
        break;
      case "done":
        this.endPlay();
        return; // ball packed up — emitBall(null) already fired
    }
    this.emitBall();
  }

  /** End wool-ball play and pack the ball away (notify the renderer to hide it). */
  private endPlay(): void {
    if (!this.ball && !this.play) return;
    this.ball = null;
    this.play = null;
    this.loco.stop();
    this.emitBall();
  }

  /** Push the current ball position (or null when not playing) to the app's renderer. */
  private emitBall(): void {
    if (!this.onBall) return;
    this.onBall(this.ball ? { x: this.ball.position.x, y: this.ball.position.y, r: this.ball.r } : null);
  }

  /** Edge-detect the cursor entering/leaving the cat and notify (drives click-through). */
  private emitHover(overCat: boolean): void {
    if (overCat !== this.hoverActive) {
      this.hoverActive = overCat;
      this.onHover?.(overCat);
    }
  }

  /**
   * One frame of reminder delivery (MA-2): walk to the screen centre and, on arrival,
   * hold the attention pose (the placeholder Alert/Meow — reusing the Jump hop until
   * dedicated art lands in the MA art pass, as MA-1 reused Stretch for Wake). The
   * idle clocks are pinned so the Director doesn't try to wander mid-delivery.
   */
  private runReminderFrame(dtMs: number): CatState {
    const target = this.viewport ? this.viewport() : null;
    if (!target) return this.machine.jump(); // no viewport (tests) — just hold the pose
    const cx = target.w / 2;
    const cy = target.h / 2;
    const { x, y } = this.loco.position;
    const atCentre = Math.hypot(cx - x, cy - y) <= REMINDER_ARRIVE_EPS;
    if (!atCentre) {
      if (!this.loco.moving) this.loco.walkTo(cx, cy);
      const arrived = this.loco.update(dtMs);
      return arrived ? this.machine.jump() : this.machine.walk();
    }
    this.loco.stop();
    return this.machine.jump();
  }

  /**
   * Translate one Director intent (MA-1) into Locomotion + machine calls and return
   * the resulting pose. Walking targets and the wake-stretch are advisory; only
   * `sleep` actually mutates the machine here (the cat lies down on command).
   */
  private applyDirectorIntent(intent: DirectorIntent, st: CatState): CatState {
    switch (intent.kind) {
      case "walkTo":
        this.loco.walkTo(intent.target.x, intent.target.y);
        return st;
      case "sleep":
        this.loco.stop();
        return this.machine.sleep();
      case "wake":
        // The interrupting cue already woke the machine via the ladder; add the
        // placeholder Wake/Stretch flourish on top (held for WAKE_STRETCH_MS).
        this.wakeStretchUntil = performance.now() + WAKE_STRETCH_MS;
        return st;
      case "cancel":
        // A cue interrupted the trip — drop the nap target so it doesn't resume
        // mid-stroll; the Director will re-plan after the next idle delay.
        this.loco.stop();
        return st;
      case "none":
        return st;
    }
  }

  /** Write the locomotion position + facing onto the canvas transform. The sprite's
   *  centre sits at the locomotion position; scaleX(-1) mirrors it to face left.
   *  getBoundingClientRect() reflects this transform, so the hit-test and eye-aim
   *  (frameUpdate) and the click-through bounds follow the cat automatically. */
  private applyPosition(): void {
    const { x, y } = this.loco.position;
    const left = x - this.canvas.width / 2;
    const top = y - this.canvas.height / 2;
    // Mirror ONLY the Walk sprite to fake travel direction. Every other pose must
    // render un-mirrored: the cursor-tracking pupils (FollowEyes/Hunt) are drawn in
    // canvas space and the fur pattern (e.g. calico's patches) is authored facing one
    // way, so a scaleX left over from a past leftward walk would point the eyes the
    // wrong way and flip the pattern. Facing resets to forward the instant it stops.
    const facing = this.machine.state === "Walk" ? this.loco.facing : 1;
    this.canvas.style.transform = `translate(${left}px, ${top}px) scaleX(${facing})`;
  }

  /** Blit the current frame, applying the live breathing squash on resting poses. The
   *  IdleAnimator already advanced this frame (via frameUpdate); we just read its
   *  transform. Non-resting states fall through to a plain blit so baked motion frames
   *  render untouched. */
  private drawFrame(frame: Frame, _state: string): void {
    const tf = this.idleTf;
    if (tf.squashY === 1 && tf.offsetY === 0) {
      this.renderer.drawFrame(this.image, frame);
    } else {
      this.renderer.drawFrameSquashed(this.image, frame, tf.squashY, tf.offsetY);
    }
  }

  /** Paint live overlays on top of the just-drawn frame: cursor-tracking pupils on the
   *  blank-eyed FollowEyes/Hunt frames, and the blink (eyes painted shut) on resting
   *  poses for cats that supply an eye region. */
  private drawOverlay(state: string): void {
    // Blink: cover the open-eye pixels with fur while the IdleAnimator holds a blink.
    // Only on the resting pose the eye coords were authored for (Idle/FollowEyes front).
    if (
      this.blinkEyes &&
      this.idleTf.blink &&
      (state === "Idle" || state === "FollowEyes")
    ) {
      for (const r of this.blinkEyes.rects) {
        this.renderer.fillTile(r.x, r.y, r.w, r.h, this.blinkEyes.color);
      }
    }

    if (state !== "FollowEyes" && state !== "Hunt") return;
    const e = this.eyes;
    const dx = this.lookDir.x * e.travel;
    const dy = this.lookDir.y * e.travel;
    this.renderer.fillTile(e.left.x + dx, e.left.y + dy, e.pupil, e.pupil, e.color);
    this.renderer.fillTile(e.right.x + dx, e.right.y + dy, e.pupil, e.pupil, e.color);
  }
}

/**
 * Ambient poses — the calm states during which the cat is free to keep walking
 * toward a locomotion target. Every other (reactive) pose means a real interaction
 * is happening, which pauses the walk (KITTO_AMBIENT §2). `Walk` is included so an
 * in-progress walk keeps going frame to frame.
 */
function isAmbient(state: CatState): boolean {
  return state === "Idle" || state === "FollowEyes" || state === "Walk";
}

/**
 * Reactive poses — a genuine interaction is happening (KITTO_AMBIENT §2 interrupt
 * list). These reset the Director's ambient idle clock; the calm Idle/FollowEyes
 * (a gentle glance) and the cat's own Walk/Sleep do not.
 */
function isReactivePose(state: CatState): boolean {
  return (
    state === "Pet" ||
    state === "Hunt" ||
    state === "Type" ||
    state === "Overheat" ||
    state === "Scroll" ||
    state === "Think" ||
    state === "Jump" ||
    state === "Stretch"
  );
}

/** Quantise an offset into {-1, 0, 1} with a deadzone so the eyes don't jitter. */
function axis(delta: number): number {
  if (delta > LOOK_DEADZONE) return 1;
  if (delta < -LOOK_DEADZONE) return -1;
  return 0;
}
