// CatStateMachine — the heart of Kitto (KITTO_SPEC §3, §8).
//
// PURE: no rendering, no IO, no timers, no Date.now(). It takes events and
// returns the next state, so its behavior is fully deterministic and unit-tested.
// The animation loop and input sources live elsewhere and only feed it events.
//
// M1 implemented Idle/Sleep/Walk. M2 added the cursor reactions FollowEyes, Hunt
// and Pet. M3 adds the keyboard/scroll reactions Type, Overheat and Scroll. M4 adds
// the timer-driven Stretch pose. M5 adds the AI-agent reactions: Think (a sustained,
// ambient "my agent is working" pose, carried in the per-frame snapshot) and Jump (a
// one-shot "agent finished" celebration, pulsed like Stretch). All of the reactive
// states are resolved every frame from a single `sense` event that carries the
// current reading of every sensor (cursor hit-test + speed, keyboard rate, scroll
// activity, agent-working flag); the reducer picks the winner from one priority
// ladder (KITTO_SPEC §3: "transitions are driven by events with priorities …
// declaratively in one place"; "AI Think/Jump interrupt idle states"). Continuous render data
// — which way the eyes point — deliberately lives outside this machine (in the
// Cat/renderer), and so does timer bookkeeping: the stretch-reminder / Pomodoro
// *clocks* are pure modules of their own (src/timers/*), wall-clock-driven so they
// survive system sleep/wake; the machine only receives the resulting `stretch`
// pulse and holds the pose while the Cat keeps re-asserting it.

export type CatState =
  | "Idle"
  | "Sleep"
  | "Walk"
  | "FollowEyes"
  | "Hunt"
  | "Pet"
  | "Type"
  | "Overheat"
  | "Scroll"
  | "Stretch"
  | "Think"
  | "Jump"
  | "Groom"
  | "Yawn";

export type CatEvent =
  | { readonly type: "activity" } // any user input — wakes the cat, resets the clock
  | { readonly type: "walk" } // begin walking (manual; locomotion lands later)
  | { readonly type: "rest" } // stop walking
  | { readonly type: "sleep" } // the ambient Director put the cat down for a nap (MA-1)
  | { readonly type: "stretch" } // a stretch reminder fired (M4) — strike the pose
  | { readonly type: "jump" } // an AI agent finished (M5) — celebratory hop
  | { readonly type: "groom" } // ambient idle filler (MA-3 / A3) — licks a paw
  | { readonly type: "yawn" } // ambient idle filler (MA-3 / A3) — a sleepy yawn
  | { readonly type: "tick"; readonly dtMs: number } // time advanced
  // The per-frame sensor snapshot. Every reactive state is derived from this in
  // one place by priority (see `reduce`). `keyRate` is keystrokes/sec, `scrolling`
  // is "scrolled within the recent window", `cursorSpeed` is logical px/ms,
  // `agentWorking` is "a watched AI agent is mid-task" (M5 → Think).
  | {
      readonly type: "sense";
      readonly overCat: boolean;
      readonly cursorSpeed: number;
      readonly keyRate: number;
      readonly scrolling: boolean;
      readonly agentWorking: boolean;
    };

export interface MachineState {
  readonly state: CatState;
  /** Milliseconds since the last activity; drives the (Idle|FollowEyes) → Sleep transition. */
  readonly idleMs: number;
}

export interface MachineConfig {
  /** Stay calm (Idle/FollowEyes) with no activity for this long → Sleep. */
  readonly sleepAfterMs: number;
  /** Pointer speed (logical px/ms) at/above which the cat hunts the cursor. */
  readonly huntSpeed: number;
  /** Pointer speed (logical px/ms) above which counts as "moving" → FollowEyes. */
  readonly moveEps: number;
  /** Keystroke rate (keys/sec) at/above which the cat is typing → Type. */
  readonly typeRate: number;
  /** Keystroke rate (keys/sec) at/above which sustained typing → Overheat. */
  readonly overheatRate: number;
}

export const DEFAULT_CONFIG: MachineConfig = {
  sleepAfterMs: 8000,
  huntSpeed: 2.2,
  moveEps: 0.03,
  typeRate: 2.5,
  overheatRate: 7.5,
};

export function initialState(): MachineState {
  return { state: "Idle", idleMs: 0 };
}

/** States the cat can doze off from — awake-but-calm poses. */
function canSleepFrom(state: CatState): boolean {
  return state === "Idle" || state === "FollowEyes";
}

/**
 * Transient poses. When their triggering cue disappears (cursor goes still,
 * typing/scrolling stops) — or, for Stretch, when the Cat stops re-asserting the
 * reminder — they collapse back to the calm-aware FollowEyes rather than sticking.
 * Idle/Sleep/Walk/FollowEyes are not transient.
 */
function isReactive(state: CatState): boolean {
  return (
    state === "Pet" ||
    state === "Hunt" ||
    state === "Type" ||
    state === "Overheat" ||
    state === "Scroll" ||
    state === "Stretch" ||
    state === "Think" ||
    state === "Jump" ||
    state === "Groom" ||
    state === "Yawn"
  );
}

/**
 * The single declarative transition function. Given the current machine state
 * and an event, return the next machine state.
 *
 * The `sense` ladder (high → low): Overheat > Type > Scroll > Pet > Hunt >
 * Think > FollowEyes. Active input (furious typing, typing, scrolling) and direct
 * play (petting, hunting a flick) outrank Think — when you're interacting, that
 * wins — but a working agent outranks the plain ambient FollowEyes/Idle, so an
 * untended cat "thinks along" instead of idling (and, since working counts as
 * activity, doesn't doze off mid-task). Overheat is the showpiece and tops it.
 * Jump (agent finished) is a one-shot pulse handled like `stretch`, re-asserted
 * by the Cat for its short duration so it overrides the ambient ladder. Any live
 * cue resets the idle clock; a snapshot with no cue holds the pose (or relaxes a
 * transient one) and preserves the clock so a calm cat can still sleep.
 */
export function reduce(
  s: MachineState,
  e: CatEvent,
  cfg: MachineConfig = DEFAULT_CONFIG,
): MachineState {
  switch (e.type) {
    case "activity":
      // Wake a sleeping cat; otherwise stay put. Always reset the idle clock.
      return { state: s.state === "Sleep" ? "Idle" : s.state, idleMs: 0 };

    case "walk":
      return { state: "Walk", idleMs: 0 };

    case "rest":
      // Only Walk returns to Idle; resting is a no-op from other states.
      return { state: s.state === "Walk" ? "Idle" : s.state, idleMs: 0 };

    case "sleep":
      // The ambient Director walked the cat to a cozy corner and it lies down (MA-1,
      // KITTO_AMBIENT A1). Unlike the tick-timeout doze, this is an explicit command,
      // so it isn't gated by `sleepAfterMs`. Preserve the idle clock — the nap is the
      // *continuation* of being idle, not fresh activity — so a later cue still reads
      // as waking a long-idle cat, and an interaction's reset still interrupts it.
      return { state: "Sleep", idleMs: s.idleMs };

    case "stretch":
      // A stretch reminder (M4). It interrupts whatever the cat was doing — that's
      // the point of the nudge — and counts as activity (resets the idle clock).
      // The Cat re-asserts this each frame for the stretch's duration (owned by the
      // pure stretch timer); when it stops, the next `sense` relaxes it (isReactive).
      return { state: "Stretch", idleMs: 0 };

    case "jump":
      // An AI agent just finished (M5). A celebratory one-shot the Cat re-asserts
      // for its short duration (like `stretch`); it interrupts the ambient ladder
      // and counts as activity. Relaxes to FollowEyes (isReactive) when released.
      return { state: "Jump", idleMs: 0 };

    case "groom":
    case "yawn":
      // Ambient idle fillers (MA-3 / A3): the Director plays a short groom/yawn while
      // the cat is hanging out, so it never looks frozen. Unlike a reaction these are
      // NOT activity — they happen *because* the cat is idle — so the idle clock is
      // preserved and the cat still drifts on toward its eventual wander/nap. The Cat
      // re-asserts the pose for its brief hold; the next `sense` relaxes it (isReactive).
      return { state: e.type === "groom" ? "Groom" : "Yawn", idleMs: s.idleMs };

    case "sense": {
      // Priority ladder — first match wins. A live cue is real activity, so it
      // resets the idle clock (idleMs: 0).
      if (e.keyRate >= cfg.overheatRate) return { state: "Overheat", idleMs: 0 };
      if (e.keyRate >= cfg.typeRate) return { state: "Type", idleMs: 0 };
      if (e.scrolling) return { state: "Scroll", idleMs: 0 };
      if (e.overCat) return { state: "Pet", idleMs: 0 };
      if (e.cursorSpeed >= cfg.huntSpeed) return { state: "Hunt", idleMs: 0 };
      // A working agent outranks the plain ambient mouse-follow: an untended cat
      // thinks along (and stays awake — working is activity) rather than idling.
      // Direct interaction above still wins; a hunt-flick still beats it.
      if (e.agentWorking) return { state: "Think", idleMs: 0 };
      if (e.cursorSpeed >= cfg.moveEps) return { state: "FollowEyes", idleMs: 0 };
      // No live cue. A transient reaction relaxes through FollowEyes; once the
      // cursor is also still, the gaze settles back to the calm, *animated* Idle
      // (breathe + blink) rather than stranding the cat in the single static,
      // blank-eyed tracking frame — important now that ambient sleep is
      // Director-driven (a corner nap), not a tick timeout that used to rescue it.
      // The idle clock is preserved (a still cursor is not activity) so calm states
      // keep drifting — toward Sleep via `tick`, and toward a wander via the Director.
      if (isReactive(s.state)) return { state: "FollowEyes", idleMs: s.idleMs };
      if (s.state === "FollowEyes") return { state: "Idle", idleMs: s.idleMs };
      return s;
    }

    case "tick": {
      const idleMs = s.idleMs + Math.max(0, e.dtMs);
      if (canSleepFrom(s.state) && idleMs >= cfg.sleepAfterMs) {
        return { state: "Sleep", idleMs };
      }
      return { state: s.state, idleMs };
    }

    default: {
      // Exhaustiveness guard: a new event variant must be handled above.
      const _exhaustive: never = e;
      return _exhaustive;
    }
  }
}

/**
 * Thin stateful shell around `reduce` for app use. The pure function is the
 * tested core; this just remembers the current snapshot and offers ergonomics.
 */
export class CatStateMachine {
  private current: MachineState = initialState();

  constructor(private readonly cfg: MachineConfig = DEFAULT_CONFIG) {}

  get state(): CatState {
    return this.current.state;
  }

  get snapshot(): MachineState {
    return this.current;
  }

  send(event: CatEvent): CatState {
    this.current = reduce(this.current, event, this.cfg);
    return this.current.state;
  }

  activity(): CatState {
    return this.send({ type: "activity" });
  }

  walk(): CatState {
    return this.send({ type: "walk" });
  }

  rest(): CatState {
    return this.send({ type: "rest" });
  }

  /** Lie down for a nap on the ambient Director's command (MA-1). */
  sleep(): CatState {
    return this.send({ type: "sleep" });
  }

  /** Strike the stretch pose (M4 stretch reminder / Pomodoro phase change). */
  stretch(): CatState {
    return this.send({ type: "stretch" });
  }

  /** Celebratory hop (M5 — a watched AI agent finished its task). */
  jump(): CatState {
    return this.send({ type: "jump" });
  }

  /** Ambient idle filler (MA-3 / A3): a brief paw-licking groom. */
  groom(): CatState {
    return this.send({ type: "groom" });
  }

  /** Ambient idle filler (MA-3 / A3): a sleepy yawn. */
  yawn(): CatState {
    return this.send({ type: "yawn" });
  }

  tick(dtMs: number): CatState {
    return this.send({ type: "tick", dtMs });
  }

  /** Feed the full per-frame sensor snapshot (the M3 unified reactive input). */
  sense(snapshot: {
    overCat: boolean;
    cursorSpeed: number;
    keyRate: number;
    scrolling: boolean;
    agentWorking: boolean;
  }): CatState {
    return this.send({ type: "sense", ...snapshot });
  }

  /** Convenience: a cursor-only snapshot (no keyboard/scroll/agent). Mirrors M2 usage. */
  cursor(overCat: boolean, speed: number): CatState {
    return this.sense({
      overCat,
      cursorSpeed: speed,
      keyRate: 0,
      scrolling: false,
      agentWorking: false,
    });
  }
}
