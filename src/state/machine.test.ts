import { describe, it, expect } from "vitest";
import {
  reduce,
  initialState,
  CatStateMachine,
  DEFAULT_CONFIG,
  type MachineConfig,
} from "./machine";

const cfg: MachineConfig = {
  sleepAfterMs: 1000,
  huntSpeed: 2,
  moveEps: 0.05,
  typeRate: 3,
  overheatRate: 8,
};

/** Build a per-frame `sense` snapshot, defaulting every sensor to "quiet". */
const sense = (
  o: Partial<{
    overCat: boolean;
    cursorSpeed: number;
    keyRate: number;
    scrolling: boolean;
    agentWorking: boolean;
  }> = {},
) =>
  ({
    type: "sense",
    overCat: false,
    cursorSpeed: 0,
    keyRate: 0,
    scrolling: false,
    agentWorking: false,
    ...o,
  }) as const;

describe("reduce (pure transitions)", () => {
  it("starts Idle with a zeroed idle clock", () => {
    expect(initialState()).toEqual({ state: "Idle", idleMs: 0 });
  });

  it("Idle → Sleep once inactivity reaches the threshold", () => {
    let s = initialState();
    s = reduce(s, { type: "tick", dtMs: 600 }, cfg);
    expect(s.state).toBe("Idle"); // not yet
    s = reduce(s, { type: "tick", dtMs: 600 }, cfg);
    expect(s.state).toBe("Sleep"); // 1200ms >= 1000ms
  });

  it("does not sleep one tick before the threshold (boundary)", () => {
    let s = initialState();
    s = reduce(s, { type: "tick", dtMs: 999 }, cfg);
    expect(s.state).toBe("Idle");
    s = reduce(s, { type: "tick", dtMs: 1 }, cfg);
    expect(s.state).toBe("Sleep"); // exactly 1000ms triggers
  });

  it("Sleep → Idle on any activity", () => {
    let s = reduce(initialState(), { type: "tick", dtMs: 2000 }, cfg);
    expect(s.state).toBe("Sleep");
    s = reduce(s, { type: "activity" }, cfg);
    expect(s).toEqual({ state: "Idle", idleMs: 0 });
  });

  it("activity resets the idle clock so sleep is deferred", () => {
    let s = reduce(initialState(), { type: "tick", dtMs: 900 }, cfg);
    s = reduce(s, { type: "activity" }, cfg);
    expect(s.idleMs).toBe(0);
    s = reduce(s, { type: "tick", dtMs: 900 }, cfg);
    expect(s.state).toBe("Idle"); // would have slept without the activity reset
  });

  it("Idle → Walk and Walk → Idle via walk/rest", () => {
    let s = initialState();
    s = reduce(s, { type: "walk" }, cfg);
    expect(s.state).toBe("Walk");
    s = reduce(s, { type: "rest" }, cfg);
    expect(s.state).toBe("Idle");
  });

  it("sleep command lies down immediately, regardless of the idle clock", () => {
    // The Director walks the cat to a corner then commands a nap (MA-1): unlike the
    // tick-timeout doze, it isn't gated by sleepAfterMs and can fire from any pose.
    let s = reduce(initialState(), { type: "walk" }, cfg);
    s = reduce(s, { type: "sleep" }, cfg);
    expect(s.state).toBe("Sleep");
  });

  it("sleep preserves the idle clock, and activity still wakes the nap", () => {
    let s = reduce(initialState(), { type: "tick", dtMs: 4000 }, cfg);
    s = reduce(s, { type: "sleep" }, cfg);
    expect(s).toEqual({ state: "Sleep", idleMs: 4000 }); // nap continues the idle run
    s = reduce(s, { type: "activity" }, cfg);
    expect(s).toEqual({ state: "Idle", idleMs: 0 }); // a real cue still interrupts it
  });

  it("a walking cat never falls asleep from ticks", () => {
    let s = reduce(initialState(), { type: "walk" }, cfg);
    s = reduce(s, { type: "tick", dtMs: 10_000 }, cfg);
    expect(s.state).toBe("Walk");
  });

  it("walk wakes a sleeping cat directly", () => {
    let s = reduce(initialState(), { type: "tick", dtMs: 2000 }, cfg);
    expect(s.state).toBe("Sleep");
    s = reduce(s, { type: "walk" }, cfg);
    expect(s.state).toBe("Walk");
  });

  it("rest is a no-op when not walking", () => {
    const s = reduce(initialState(), { type: "rest" }, cfg);
    expect(s.state).toBe("Idle");
  });

  it("is deterministic: same event sequence → same state", () => {
    const seq = [
      { type: "tick", dtMs: 500 },
      { type: "activity" },
      { type: "walk" },
      { type: "tick", dtMs: 5000 },
      { type: "rest" },
    ] as const;
    const run = () => seq.reduce((s, e) => reduce(s, e, cfg), initialState());
    expect(run()).toEqual(run());
  });

  it("ignores negative dt (clock cannot run backwards)", () => {
    const s = reduce(initialState(), { type: "tick", dtMs: -5000 }, cfg);
    expect(s.idleMs).toBe(0);
    expect(s.state).toBe("Idle");
  });
});

describe("cursor reactions (M2: FollowEyes / Hunt / Pet)", () => {
  const cursor = (overCat: boolean, speed: number) =>
    sense({ overCat, cursorSpeed: speed });

  it("a gentle move (off the cat) → FollowEyes", () => {
    const s = reduce(initialState(), cursor(false, 0.5), cfg);
    expect(s).toEqual({ state: "FollowEyes", idleMs: 0 });
  });

  it("a fast flick (off the cat) → Hunt", () => {
    const s = reduce(initialState(), cursor(false, 5), cfg);
    expect(s.state).toBe("Hunt");
  });

  it("hovering the cat → Pet, regardless of speed", () => {
    expect(reduce(initialState(), cursor(true, 0), cfg).state).toBe("Pet");
    // overCat outranks a fast flick.
    expect(reduce(initialState(), cursor(true, 99), cfg).state).toBe("Pet");
  });

  it("priority is Pet > Hunt > FollowEyes", () => {
    const from = (st: "Idle") => ({ state: st, idleMs: 0 }) as const;
    expect(reduce(from("Idle"), cursor(false, cfg.moveEps), cfg).state).toBe("FollowEyes");
    expect(reduce(from("Idle"), cursor(false, cfg.huntSpeed), cfg).state).toBe("Hunt");
    expect(reduce(from("Idle"), cursor(true, cfg.huntSpeed), cfg).state).toBe("Pet");
  });

  it("a still cursor off the cat relaxes a transient Hunt/Pet to FollowEyes", () => {
    let s = reduce(initialState(), cursor(false, 5), cfg);
    expect(s.state).toBe("Hunt");
    s = reduce(s, cursor(false, 0), cfg);
    expect(s.state).toBe("FollowEyes");

    let p = reduce(initialState(), cursor(true, 0), cfg);
    expect(p.state).toBe("Pet");
    p = reduce(p, cursor(false, 0), cfg);
    expect(p.state).toBe("FollowEyes");
  });

  it("FollowEyes settles back to Idle once the cursor stops moving", () => {
    let s = reduce(initialState(), cursor(false, 0.5), cfg); // moving → tracking
    expect(s.state).toBe("FollowEyes");
    s = reduce(s, cursor(false, 0), cfg); // cursor now still
    expect(s.state).toBe("Idle"); // settles to the animated Idle, not stuck staring
    s = reduce(s, cursor(false, 0), cfg);
    expect(s.state).toBe("Idle"); // and stays there
  });

  it("a still cursor does not reset the idle clock (cat can still doze off)", () => {
    let s = reduce(initialState(), { type: "tick", dtMs: 700 }, cfg);
    s = reduce(s, cursor(false, 0), cfg); // motionless: not activity
    expect(s.idleMs).toBe(700);
    s = reduce(s, { type: "tick", dtMs: 400 }, cfg);
    expect(s.state).toBe("Sleep"); // 1100ms total
  });

  it("FollowEyes drifts to Sleep after inactivity, like Idle", () => {
    let s = reduce(initialState(), cursor(false, 0.5), cfg);
    expect(s.state).toBe("FollowEyes");
    s = reduce(s, { type: "tick", dtMs: 1000 }, cfg);
    expect(s.state).toBe("Sleep");
  });

  it("a moving cursor wakes a sleeping cat into FollowEyes", () => {
    let s = reduce(initialState(), { type: "tick", dtMs: 2000 }, cfg);
    expect(s.state).toBe("Sleep");
    s = reduce(s, cursor(false, 0.5), cfg);
    expect(s.state).toBe("FollowEyes");
  });

  it("Hunt/Pet never doze off from ticks while held", () => {
    let h = reduce(initialState(), cursor(false, 5), cfg);
    h = reduce(h, { type: "tick", dtMs: 10_000 }, cfg);
    expect(h.state).toBe("Hunt");
    let p = reduce(initialState(), cursor(true, 0), cfg);
    p = reduce(p, { type: "tick", dtMs: 10_000 }, cfg);
    expect(p.state).toBe("Pet");
  });

  it("convenience cursor() mirrors the reducer", () => {
    const m = new CatStateMachine(cfg);
    expect(m.cursor(false, 0.5)).toBe("FollowEyes");
    expect(m.cursor(false, 5)).toBe("Hunt");
    expect(m.cursor(true, 0)).toBe("Pet");
  });
});

describe("keyboard + scroll reactions (M3: Type / Overheat / Scroll)", () => {
  it("typing at a moderate rate → Type", () => {
    const s = reduce(initialState(), sense({ keyRate: 4 }), cfg);
    expect(s).toEqual({ state: "Type", idleMs: 0 });
  });

  it("typing below the threshold does not type", () => {
    // keyRate under typeRate (3) and no other cue → stays Idle.
    const s = reduce(initialState(), sense({ keyRate: 2 }), cfg);
    expect(s.state).toBe("Idle");
  });

  it("sustained fast typing → Overheat (outranks Type)", () => {
    expect(reduce(initialState(), sense({ keyRate: 8 }), cfg).state).toBe("Overheat");
    expect(reduce(initialState(), sense({ keyRate: 20 }), cfg).state).toBe("Overheat");
  });

  it("scrolling → Scroll", () => {
    const s = reduce(initialState(), sense({ scrolling: true }), cfg);
    expect(s).toEqual({ state: "Scroll", idleMs: 0 });
  });

  it("priority ladder: Overheat > Type > Scroll > Pet > Hunt > FollowEyes", () => {
    const from = { state: "Idle", idleMs: 0 } as const;
    // Everything firing at once → Overheat wins.
    expect(
      reduce(from, sense({ keyRate: 20, scrolling: true, overCat: true, cursorSpeed: 99 }), cfg).state,
    ).toBe("Overheat");
    // Drop below overheat → Type.
    expect(
      reduce(from, sense({ keyRate: 4, scrolling: true, overCat: true, cursorSpeed: 99 }), cfg).state,
    ).toBe("Type");
    // No keyboard → Scroll beats the mouse cues.
    expect(reduce(from, sense({ scrolling: true, overCat: true, cursorSpeed: 99 }), cfg).state).toBe("Scroll");
    // No keyboard/scroll → Pet (the M2 ladder still holds underneath).
    expect(reduce(from, sense({ overCat: true, cursorSpeed: 99 }), cfg).state).toBe("Pet");
  });

  it("typing is real activity: resets the idle clock and wakes from Sleep", () => {
    let s = reduce(initialState(), { type: "tick", dtMs: 900 }, cfg);
    s = reduce(s, sense({ keyRate: 4 }), cfg);
    expect(s.idleMs).toBe(0);

    let slept = reduce(initialState(), { type: "tick", dtMs: 2000 }, cfg);
    expect(slept.state).toBe("Sleep");
    slept = reduce(slept, sense({ keyRate: 4 }), cfg);
    expect(slept.state).toBe("Type");
  });

  it("scrolling wakes a sleeping cat into Scroll", () => {
    let s = reduce(initialState(), { type: "tick", dtMs: 2000 }, cfg);
    expect(s.state).toBe("Sleep");
    s = reduce(s, sense({ scrolling: true }), cfg);
    expect(s.state).toBe("Scroll");
  });

  it("Type/Overheat/Scroll relax to FollowEyes when the input stops", () => {
    for (const cue of [{ keyRate: 4 }, { keyRate: 20 }, { scrolling: true }]) {
      let s = reduce(initialState(), sense(cue), cfg);
      expect(["Type", "Overheat", "Scroll"]).toContain(s.state);
      s = reduce(s, sense({}), cfg); // all sensors quiet
      expect(s.state).toBe("FollowEyes");
    }
  });

  it("Type/Overheat never doze off from ticks while held", () => {
    let t = reduce(initialState(), sense({ keyRate: 4 }), cfg);
    t = reduce(t, { type: "tick", dtMs: 10_000 }, cfg);
    expect(t.state).toBe("Type");
    let o = reduce(initialState(), sense({ keyRate: 20 }), cfg);
    o = reduce(o, { type: "tick", dtMs: 10_000 }, cfg);
    expect(o.state).toBe("Overheat");
  });

  it("convenience sense() mirrors the reducer", () => {
    const m = new CatStateMachine(cfg);
    const base = { overCat: false, cursorSpeed: 0, keyRate: 0, scrolling: false, agentWorking: false };
    expect(m.sense({ ...base, keyRate: 4 })).toBe("Type");
    expect(m.sense({ ...base, keyRate: 20 })).toBe("Overheat");
    expect(m.sense({ ...base, scrolling: true })).toBe("Scroll");
  });
});

describe("stretch reminder (M4: Stretch)", () => {
  it("a stretch event strikes the Stretch pose and resets the idle clock", () => {
    const s = reduce(initialState(), { type: "stretch" }, cfg);
    expect(s).toEqual({ state: "Stretch", idleMs: 0 });
  });

  it("stretch interrupts whatever the cat was doing", () => {
    // From a fast-flick Hunt, a stretch reminder still wins.
    let s = reduce(initialState(), sense({ cursorSpeed: 5 }), cfg);
    expect(s.state).toBe("Hunt");
    s = reduce(s, { type: "stretch" }, cfg);
    expect(s.state).toBe("Stretch");
  });

  it("stretch wakes a sleeping cat (a 'time to stretch!' nudge)", () => {
    let s = reduce(initialState(), { type: "tick", dtMs: 2000 }, cfg);
    expect(s.state).toBe("Sleep");
    s = reduce(s, { type: "stretch" }, cfg);
    expect(s.state).toBe("Stretch");
  });

  it("Stretch holds while re-asserted, then relaxes to FollowEyes when it stops", () => {
    let s = reduce(initialState(), { type: "stretch" }, cfg);
    // Re-asserting keeps the pose (the Cat does this each frame for the duration).
    s = reduce(s, { type: "stretch" }, cfg);
    expect(s.state).toBe("Stretch");
    // When the reminder stops, a quiet sense collapses it like any transient pose.
    s = reduce(s, sense({}), cfg);
    expect(s.state).toBe("FollowEyes");
  });

  it("a live cue (typing) still overrides a finished stretch", () => {
    let s = reduce(initialState(), { type: "stretch" }, cfg);
    s = reduce(s, sense({ keyRate: 4 }), cfg);
    expect(s.state).toBe("Type");
  });

  it("Stretch does not doze off from ticks while held", () => {
    let s = reduce(initialState(), { type: "stretch" }, cfg);
    s = reduce(s, { type: "tick", dtMs: 10_000 }, cfg);
    expect(s.state).toBe("Stretch");
  });

  it("convenience stretch() mirrors the reducer", () => {
    const m = new CatStateMachine(cfg);
    expect(m.stretch()).toBe("Stretch");
  });
});

describe("AI-agent reactions (M5: Think / Jump)", () => {
  it("a working agent makes the cat Think when otherwise idle", () => {
    const s = reduce(initialState(), sense({ agentWorking: true }), cfg);
    expect(s).toEqual({ state: "Think", idleMs: 0 });
  });

  it("Think outranks the ambient mouse-follow but yields to direct interaction", () => {
    // A working agent beats a gentle cursor move (FollowEyes)…
    expect(
      reduce(initialState(), sense({ agentWorking: true, cursorSpeed: cfg.moveEps }), cfg).state,
    ).toBe("Think");
    // …but a hunt-flick, petting, scrolling and typing all still win.
    expect(
      reduce(initialState(), sense({ agentWorking: true, cursorSpeed: cfg.huntSpeed }), cfg).state,
    ).toBe("Hunt");
    expect(reduce(initialState(), sense({ agentWorking: true, overCat: true }), cfg).state).toBe("Pet");
    expect(reduce(initialState(), sense({ agentWorking: true, scrolling: true }), cfg).state).toBe(
      "Scroll",
    );
    expect(reduce(initialState(), sense({ agentWorking: true, keyRate: 4 }), cfg).state).toBe("Type");
  });

  it("a working agent keeps the cat awake — Think never dozes off from ticks", () => {
    let s = reduce(initialState(), sense({ agentWorking: true }), cfg);
    s = reduce(s, { type: "tick", dtMs: 10_000 }, cfg);
    expect(s.state).toBe("Think");
  });

  it("Think wakes a sleeping cat (the agent started working)", () => {
    let s = reduce(initialState(), { type: "tick", dtMs: 2000 }, cfg);
    expect(s.state).toBe("Sleep");
    s = reduce(s, sense({ agentWorking: true }), cfg);
    expect(s.state).toBe("Think");
  });

  it("Think relaxes to FollowEyes once the agent stops working", () => {
    let s = reduce(initialState(), sense({ agentWorking: true }), cfg);
    expect(s.state).toBe("Think");
    s = reduce(s, sense({ agentWorking: false }), cfg);
    expect(s.state).toBe("FollowEyes");
  });

  it("a jump event strikes the Jump pose and resets the idle clock", () => {
    const s = reduce(initialState(), { type: "jump" }, cfg);
    expect(s).toEqual({ state: "Jump", idleMs: 0 });
  });

  it("Jump interrupts an in-progress Think (agent finished mid-task)", () => {
    let s = reduce(initialState(), sense({ agentWorking: true }), cfg);
    expect(s.state).toBe("Think");
    s = reduce(s, { type: "jump" }, cfg);
    expect(s.state).toBe("Jump");
  });

  it("Jump holds while re-asserted, then relaxes to FollowEyes", () => {
    let s = reduce(initialState(), { type: "jump" }, cfg);
    s = reduce(s, { type: "jump" }, cfg);
    expect(s.state).toBe("Jump");
    s = reduce(s, sense({}), cfg);
    expect(s.state).toBe("FollowEyes");
  });

  it("Jump does not doze off from ticks while held", () => {
    let s = reduce(initialState(), { type: "jump" }, cfg);
    s = reduce(s, { type: "tick", dtMs: 10_000 }, cfg);
    expect(s.state).toBe("Jump");
  });

  it("convenience jump() mirrors the reducer", () => {
    const m = new CatStateMachine(cfg);
    expect(m.jump()).toBe("Jump");
  });
});

describe("idle fillers (MA-3 / A3: Groom / Yawn)", () => {
  it("groom/yawn strike their pose but PRESERVE the idle clock (ambient, not activity)", () => {
    // Unlike a reaction, a filler happens *because* the cat is idle — so it must not
    // reset idleMs, or the cat could never drift on to its nap.
    let s = reduce(initialState(), { type: "tick", dtMs: 500 }, cfg);
    expect(s).toEqual({ state: "Idle", idleMs: 500 }); // calm, below the 1s sleep threshold
    const groomed = reduce(s, { type: "groom" }, cfg);
    expect(groomed).toEqual({ state: "Groom", idleMs: 500 });
    const yawned = reduce(s, { type: "yawn" }, cfg);
    expect(yawned).toEqual({ state: "Yawn", idleMs: 500 });
  });

  it("a held groom relaxes to FollowEyes when it stops (transient like Stretch)", () => {
    let s = reduce(initialState(), { type: "groom" }, cfg);
    s = reduce(s, { type: "groom" }, cfg); // re-asserted each frame for the hold
    expect(s.state).toBe("Groom");
    s = reduce(s, sense({}), cfg);
    expect(s.state).toBe("FollowEyes");
  });

  it("a real cue (typing) overrides a groom immediately", () => {
    let s = reduce(initialState(), { type: "groom" }, cfg);
    s = reduce(s, sense({ keyRate: 4 }), cfg);
    expect(s.state).toBe("Type");
  });

  it("convenience groom()/yawn() mirror the reducer", () => {
    const m = new CatStateMachine(cfg);
    expect(m.groom()).toBe("Groom");
    expect(m.yawn()).toBe("Yawn");
  });
});

describe("CatStateMachine (stateful shell)", () => {
  it("uses the default 8s sleep threshold", () => {
    expect(DEFAULT_CONFIG.sleepAfterMs).toBe(8000);
    const m = new CatStateMachine();
    m.tick(7999);
    expect(m.state).toBe("Idle");
    m.tick(1);
    expect(m.state).toBe("Sleep");
  });

  it("convenience methods mirror the reducer", () => {
    const m = new CatStateMachine(cfg);
    expect(m.tick(2000)).toBe("Sleep");
    expect(m.activity()).toBe("Idle");
    expect(m.walk()).toBe("Walk");
    expect(m.rest()).toBe("Idle");
    expect(m.snapshot).toEqual({ state: "Idle", idleMs: 0 });
  });
});
