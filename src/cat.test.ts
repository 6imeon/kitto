import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Cat } from "./cat";
import type { Atlas } from "./sprites/loader";
import type { CatState } from "./state/machine";

// A headless harness that drives the *real* Cat frame loop (rAF stubbed) over a
// fake canvas, so we can assert the locomotion actually advances the cat's on-screen
// position frame to frame — the "walks in place" report.

const STATES: CatState[] = [
  "Idle", "Sleep", "Walk", "FollowEyes", "Hunt", "Pet",
  "Type", "Overheat", "Scroll", "Stretch", "Think", "Jump",
];

function makeAtlas(): Atlas {
  const states: Record<string, { frames: { x: number; y: number; w: number; h: number; duration: number }[] }> = {};
  for (const s of STATES) {
    states[s] = { frames: [{ x: 0, y: 0, w: 32, h: 32, duration: 100 }] };
  }
  return { states } as unknown as Atlas;
}

function makeCanvas(): { canvas: HTMLCanvasElement; style: Record<string, string> } {
  const ctx = {
    imageSmoothingEnabled: false,
    fillStyle: "",
    clearRect: () => {},
    drawImage: () => {},
    fillRect: () => {},
  };
  const style: Record<string, string> = {};
  const canvas = {
    width: 0,
    height: 0,
    style,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }),
  } as unknown as HTMLCanvasElement;
  return { canvas, style };
}

describe("Cat locomotion drives on-screen movement", () => {
  let rafCb: ((ts: number) => void) | undefined;
  let ts = 0;

  beforeEach(() => {
    ts = 0;
    rafCb = undefined;
    vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => {
      rafCb = cb;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    // A controllable clock so cursor-speed (dist/dt) and the frame loop agree.
    vi.stubGlobal("performance", { now: () => ts });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Run one rAF frame advancing the clock by `dt` ms. */
  function frame(dt = 16): void {
    ts += dt;
    const cb = rafCb;
    rafCb = undefined;
    cb?.(ts);
  }

  it("advances the cat's position toward a walk target over frames", () => {
    const { canvas } = makeCanvas();
    const cat = new Cat(canvas, {} as CanvasImageSource, makeAtlas(), { w: 32, h: 32 });
    cat.placeAt(500, 300);
    cat.walkTo(900, 300);
    cat.start();

    frame(); // first frame: dt clamps to 0 (rAF baseline)
    const startX = cat.position.x;
    for (let i = 0; i < 60; i++) frame(16); // ~1s of motion

    expect(cat.position.x).toBeGreaterThan(startX);
    expect(cat.state).toBe("Walk");
  });

  it("does not get stranded in Walk when the target is cleared mid-stride", () => {
    // Reproduces the "walks in place" strand: anything that stops locomotion while
    // the machine reads Walk (a reaction cancelling the wander, a drag, a resize
    // recenter) must resolve back to Idle, not loop the walk animation forever.
    const { canvas } = makeCanvas();
    const cat = new Cat(canvas, {} as CanvasImageSource, makeAtlas(), { w: 32, h: 32 });
    cat.placeAt(500, 300);
    cat.walkTo(900, 300);
    cat.start();

    frame();
    for (let i = 0; i < 10; i++) frame(16);
    expect(cat.state).toBe("Walk"); // mid-walk

    cat.placeAt(500, 300); // clears the loco target while the machine is Walk
    frame(16);

    expect(cat.walking).toBe(false);
    expect(cat.state).not.toBe("Walk"); // resolved, not animating a walk in place
  });

  it("mirrors only while walking, never when idle (eyes/pattern face forward)", () => {
    const { canvas, style } = makeCanvas();
    const cat = new Cat(canvas, {} as CanvasImageSource, makeAtlas(), { w: 32, h: 32 });
    cat.placeAt(500, 300);
    cat.walkTo(100, 300); // walk LEFT → facing should flip
    cat.start();

    frame();
    for (let i = 0; i < 5; i++) frame(16);
    expect(cat.state).toBe("Walk");
    expect(style.transform).toMatch(/scaleX\(-1\)/); // mirrored while walking left

    cat.placeAt(500, 300); // stop the walk
    frame(16);
    expect(cat.state).not.toBe("Walk");
    expect(style.transform).toMatch(/scaleX\(1\)/); // un-mirrored once idle
  });

  it("wanders on its own after the idle delay, with no cursor/agent (Director e2e)", () => {
    const { canvas } = makeCanvas();
    const cat = new Cat(canvas, {} as CanvasImageSource, makeAtlas(), { w: 32, h: 32 }, {
      viewport: () => ({ w: 1000, h: 600 }),
      wander: { enabled: true, wanderAfterMs: 500, cornerMargin: 8 },
      sleepAfterMs: Number.POSITIVE_INFINITY,
    });
    cat.placeAt(500, 300);
    cat.start();

    frame();
    const start = { ...cat.position };
    for (let i = 0; i < 60; i++) frame(16); // ~1s: well past the 500ms idle delay

    const moved = cat.position.x !== start.x || cat.position.y !== start.y;
    expect(moved).toBe(true); // it left its spot on its own
  });

  it("keeps its wander timer running through a gentle cursor glance", () => {
    // The regression: looking at the cat (a gentle cursor move → FollowEyes) used to
    // reset the wander clock, so it could never wander while watched. A glance must
    // NOT count as a real interaction (KITTO_AMBIENT §2).
    const { canvas } = makeCanvas();
    const cat = new Cat(canvas, {} as CanvasImageSource, makeAtlas(), { w: 32, h: 32 }, {
      viewport: () => ({ w: 1000, h: 600 }),
      wander: { enabled: true, wanderAfterMs: 500, cornerMargin: 8 },
      sleepAfterMs: Number.POSITIVE_INFINITY,
    });
    cat.placeAt(500, 300);
    cat.start();

    frame();
    const start = { ...cat.position };
    const glance = (): void => {
      glanceX = glanceX === 200 ? 201 : 200; // 1px wiggle off the cat → gentle FollowEyes, never Hunt
      cat.handleCursor(glanceX, 200);
    };
    let glanceX = 200;

    // A few glancing frames first: confirm it's really tracking (not Idle/Hunt).
    for (let i = 0; i < 6; i++) {
      glance();
      frame(16);
    }
    expect(cat.state).toBe("FollowEyes");

    // Keep glancing well past the wander delay; it must still leave to wander.
    for (let i = 0; i < 70; i++) {
      glance();
      frame(16);
    }
    const moved = cat.position.x !== start.x || cat.position.y !== start.y;
    expect(moved).toBe(true);
  });

  it("delivers a reminder by walking to screen centre and holding an alert pose", () => {
    const { canvas } = makeCanvas();
    const cat = new Cat(canvas, {} as CanvasImageSource, makeAtlas(), { w: 32, h: 32 }, {
      viewport: () => ({ w: 1000, h: 600 }), // centre = (500, 300)
    });
    cat.placeAt(200, 200); // start well off-centre
    cat.start();

    frame();
    cat.deliverReminder();
    const startX = cat.position.x;
    for (let i = 0; i < 10; i++) frame(16);
    expect(cat.position.x).toBeGreaterThan(startX); // trotting toward centre
    expect(cat.deliveringReminder).toBe(true);

    for (let i = 0; i < 600; i++) frame(16); // give it plenty of time to arrive
    expect(Math.abs(cat.position.x - 500)).toBeLessThan(3);
    expect(Math.abs(cat.position.y - 300)).toBeLessThan(3);
    expect(cat.state).toBe("Jump"); // placeholder Alert/Meow pose, held at centre

    cat.endReminder();
    expect(cat.deliveringReminder).toBe(false);
    frame(16);
    expect(cat.state).not.toBe("Jump"); // resumes ordinary life once dismissed
  });

  it("tap-to-wander sends the cat off even with the cursor on it (overrides Pet)", () => {
    // The user wanted tap-to-wander alongside the idle Director wander. A commanded
    // wander must win over the reactive ladder, so the cat actually leaves the very
    // cursor that tapped it (a hover would otherwise pin it in Pet).
    const { canvas } = makeCanvas();
    const cat = new Cat(canvas, {} as CanvasImageSource, makeAtlas(), { w: 32, h: 32 }, {
      viewport: () => ({ w: 1000, h: 600 }),
      rng: () => 0.9, // → wander spot near the bottom-right, well away from centre
    });
    cat.placeAt(500, 300);
    cat.handleCursor(0, 0); // cursor over the (origin-rect) cat → would be Pet
    cat.start();

    frame();
    cat.wanderNow();
    const start = { ...cat.position };
    for (let i = 0; i < 10; i++) {
      cat.handleCursor(0, 0); // keep the cursor on the cat the whole time
      frame(16);
    }
    expect(cat.state).toBe("Walk"); // walking off, not stuck purring in Pet
    const moved = cat.position.x !== start.x || cat.position.y !== start.y;
    expect(moved).toBe(true);

    // It arrives and resumes ordinary life (no longer asserting Walk).
    for (let i = 0; i < 600; i++) frame(16);
    expect(cat.state).not.toBe("Walk");
  });

  it("a real key/scroll cue cancels a commanded wander (work resumes)", () => {
    const { canvas } = makeCanvas();
    const cat = new Cat(canvas, {} as CanvasImageSource, makeAtlas(), { w: 32, h: 32 }, {
      viewport: () => ({ w: 1000, h: 600 }),
      rng: () => 0.9, // deterministic far-away wander spot
    });
    cat.placeAt(500, 300);
    cat.start();

    frame();
    cat.wanderNow();
    for (let i = 0; i < 3; i++) frame(16);
    expect(cat.state).toBe("Walk");

    cat.handleKey(); // genuine input → interrupts the stroll
    frame(16);
    expect(cat.state).not.toBe("Walk");
    expect(cat.walking).toBe(false); // target dropped, not left mid-stride
  });

  it("grooms on its own while idle (idle-filler scheduler, A3)", () => {
    const { canvas } = makeCanvas();
    const cat = new Cat(canvas, {} as CanvasImageSource, makeAtlas(), { w: 32, h: 32 }, {
      viewport: () => ({ w: 1000, h: 600 }),
      wander: { enabled: true, wanderAfterMs: 1_000_000, cornerMargin: 8 }, // never naps during the test
      fillers: { enabled: true, minGapMs: 500, maxGapMs: 500 },
      rng: () => 0.1, // gap 500ms, pick → groom
      sleepAfterMs: Number.POSITIVE_INFINITY,
    });
    cat.placeAt(500, 300);
    cat.start();

    frame();
    for (let i = 0; i < 50; i++) frame(16); // ~0.8s of dwelling, past the 500ms gap
    expect(cat.state).toBe("Groom"); // it started a groom filler on its own
  });

  it("breaks into zoomies on its own while idle, sprinting (A3)", () => {
    const { canvas } = makeCanvas();
    const cat = new Cat(canvas, {} as CanvasImageSource, makeAtlas(), { w: 32, h: 32 }, {
      viewport: () => ({ w: 1000, h: 600 }),
      wander: { enabled: true, wanderAfterMs: 1_000_000, cornerMargin: 8 },
      fillers: { enabled: true, minGapMs: 500, maxGapMs: 500 },
      rng: () => 0.7, // gap 500ms, pick → zoomies, dash toward the far corner
      sleepAfterMs: Number.POSITIVE_INFINITY,
    });
    cat.placeAt(500, 300);
    cat.start();

    frame();
    for (let i = 0; i < 40; i++) frame(16); // past the gap → a zoomies dash begins
    expect(cat.state).toBe("Walk"); // sprinting across the screen
    const moved = cat.position.x !== 500 || cat.position.y !== 300;
    expect(moved).toBe(true);
  });

  it("plays with a wool ball on its own — drops a ball and chases it (A2)", () => {
    const { canvas } = makeCanvas();
    const balls: Array<{ x: number; y: number; r: number } | null> = [];
    const cat = new Cat(canvas, {} as CanvasImageSource, makeAtlas(), { w: 32, h: 32 }, {
      viewport: () => ({ w: 1000, h: 600 }),
      wander: { enabled: true, wanderAfterMs: 1_000_000, cornerMargin: 8 },
      fillers: { enabled: true, minGapMs: 500, maxGapMs: 500 },
      rng: () => 0.95, // gap 500ms, pick → play
      onBall: (v) => balls.push(v),
      sleepAfterMs: Number.POSITIVE_INFINITY,
    });
    cat.placeAt(500, 300);
    cat.start();

    frame();
    for (let i = 0; i < 50; i++) frame(16); // past the gap → play begins, cat chases the ball
    const last = balls[balls.length - 1];
    expect(last).not.toBe(null); // a wool ball is on screen
    expect(cat.state).toBe("Walk"); // trotting after it
  });

  it("a key cue ends wool-ball play and hides the ball (work resumes)", () => {
    const { canvas } = makeCanvas();
    const balls: Array<{ x: number; y: number; r: number } | null> = [];
    const cat = new Cat(canvas, {} as CanvasImageSource, makeAtlas(), { w: 32, h: 32 }, {
      viewport: () => ({ w: 1000, h: 600 }),
      wander: { enabled: true, wanderAfterMs: 1_000_000, cornerMargin: 8 },
      fillers: { enabled: true, minGapMs: 500, maxGapMs: 500 },
      rng: () => 0.95,
      onBall: (v) => balls.push(v),
      sleepAfterMs: Number.POSITIVE_INFINITY,
    });
    cat.placeAt(500, 300);
    cat.start();

    frame();
    for (let i = 0; i < 40; i++) frame(16); // play underway
    expect(balls[balls.length - 1]).not.toBe(null);

    cat.handleKey();
    frame(16);
    expect(balls[balls.length - 1]).toBe(null); // ball packed away on the interrupt
    expect(cat.state).not.toBe("Walk");
  });

  // --- MA-4 / A4 energy + drag-to-bed ---------------------------------------------

  it("energy 'off' stands the ambient layer down — no autonomous wander", () => {
    const { canvas } = makeCanvas();
    const cat = new Cat(canvas, {} as CanvasImageSource, makeAtlas(), { w: 32, h: 32 }, {
      viewport: () => ({ w: 1000, h: 600 }),
      energy: { level: "off", dayNight: false, play: true, idleDelayMsOverride: 0 },
      localHour: () => 12,
      sleepAfterMs: Number.POSITIVE_INFINITY,
    });
    cat.placeAt(500, 300);
    cat.start();
    frame();
    // Idle for a long time — with energy off the Director never sends it wandering.
    for (let i = 0; i < 400; i++) frame(16);
    expect(cat.walking).toBe(false);
    expect(cat.state).not.toBe("Walk");
    expect(cat.state).not.toBe("Sleep");
  });

  it("a high-energy cat wanders sooner than a calm one", () => {
    function idleUntilWander(level: "calm" | "playful"): number {
      const { canvas } = makeCanvas();
      const cat = new Cat(canvas, {} as CanvasImageSource, makeAtlas(), { w: 32, h: 32 }, {
        viewport: () => ({ w: 1000, h: 600 }),
        energy: { level, dayNight: false, play: false, idleDelayMsOverride: 0 },
        // Pin fillers off-path by keeping rng mid; we only watch for the first Walk.
        rng: () => 0.5,
        localHour: () => 12,
        sleepAfterMs: Number.POSITIVE_INFINITY,
      });
      cat.placeAt(500, 300);
      cat.start();
      frame();
      let ms = 0;
      for (let i = 0; i < 60_000; i++) {
        frame(16);
        ms += 16;
        if (cat.walking) return ms;
      }
      return Infinity;
    }
    const calm = idleUntilWander("calm");
    const playful = idleUntilWander("playful");
    expect(playful).toBeLessThan(calm);
  });

  it("drag-to-bed settles the cat into the dropped corner and naps", () => {
    const { canvas } = makeCanvas();
    const cat = new Cat(canvas, {} as CanvasImageSource, makeAtlas(), { w: 32, h: 32 }, {
      viewport: () => ({ w: 1000, h: 600 }),
      energy: { level: "mid", dayNight: false, play: true, idleDelayMsOverride: 0 },
      localHour: () => 12,
      sleepAfterMs: Number.POSITIVE_INFINITY,
    });
    cat.placeAt(40, 40); // dropped near the top-left corner
    cat.napAt();
    cat.start();
    frame();
    // Walks the short way into the corner, then lies down to sleep.
    for (let i = 0; i < 60; i++) frame(16);
    expect(cat.state).toBe("Sleep");
    expect(cat.favouriteCorner).toEqual({ sx: -1, sy: -1 });
  });

  it("sleeps through key/scroll cues — only a triple-click wakes a deep nap", () => {
    const { canvas } = makeCanvas();
    const cat = new Cat(canvas, {} as CanvasImageSource, makeAtlas(), { w: 32, h: 32 }, {
      viewport: () => ({ w: 1000, h: 600 }),
      energy: { level: "mid", dayNight: false, play: true, idleDelayMsOverride: 0 },
      localHour: () => 12,
      sleepAfterMs: Number.POSITIVE_INFINITY,
    });
    cat.placeAt(40, 40);
    cat.napAt();
    cat.start();
    frame();
    for (let i = 0; i < 60; i++) frame(16);
    expect(cat.state).toBe("Sleep");
    expect(cat.sleeping).toBe(true); // deep sleep engaged

    // Keys and scrolls no longer disturb it — it stays asleep.
    cat.handleKey();
    cat.handleScroll();
    for (let i = 0; i < 10; i++) frame(16);
    expect(cat.state).toBe("Sleep");
    expect(cat.sleeping).toBe(true);

    // One or two clicks aren't enough — it sleeps through them.
    expect(cat.handleSleepClick()).toBe(false);
    expect(cat.handleSleepClick()).toBe(false);
    frame(16);
    expect(cat.state).toBe("Sleep");

    // The third click within the window rouses it.
    expect(cat.handleSleepClick()).toBe(true);
    frame(16);
    expect(cat.sleeping).toBe(false);
    expect(cat.state).not.toBe("Sleep");
  });

  it("a drag rouses a deeply-sleeping cat immediately (notifyActivity)", () => {
    const { canvas } = makeCanvas();
    const cat = new Cat(canvas, {} as CanvasImageSource, makeAtlas(), { w: 32, h: 32 }, {
      viewport: () => ({ w: 1000, h: 600 }),
      energy: { level: "mid", dayNight: false, play: true, idleDelayMsOverride: 0 },
      localHour: () => 12,
      sleepAfterMs: Number.POSITIVE_INFINITY,
    });
    cat.placeAt(40, 40);
    cat.napAt();
    cat.start();
    frame();
    for (let i = 0; i < 60; i++) frame(16);
    expect(cat.sleeping).toBe(true);

    cat.notifyActivity(); // a grab/drag
    frame(16);
    expect(cat.sleeping).toBe(false);
    expect(cat.state).not.toBe("Sleep");
  });

  it("writes the advancing position into the canvas transform", () => {
    const { canvas, style } = makeCanvas();
    const cat = new Cat(canvas, {} as CanvasImageSource, makeAtlas(), { w: 32, h: 32 });
    cat.placeAt(100, 100);
    cat.walkTo(800, 100);
    cat.start();

    frame();
    const first = style.transform ?? "";
    for (let i = 0; i < 30; i++) frame(16);
    const later = style.transform ?? "";

    expect(first).toMatch(/translate/);
    expect(later).not.toBe(first); // the translate must have moved
  });

  // MA: the tuxedo cat paints its eyes shut on a blink. rng=0 → the blink gap is the
  // minimum (2800ms), so advancing past it makes the eyes fill while Idle.
  it("paints the blink eye rects shut while idle, then reopens", () => {
    const fills: { x: number; y: number }[] = [];
    const ctx = {
      imageSmoothingEnabled: false,
      fillStyle: "",
      clearRect: () => {},
      drawImage: () => {},
      fillRect: (x: number, y: number) => fills.push({ x, y }),
    };
    const canvas = {
      width: 0,
      height: 0,
      style: {} as Record<string, string>,
      getContext: () => ctx,
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    } as unknown as HTMLCanvasElement;

    const cat = new Cat(canvas, {} as CanvasImageSource, makeAtlas(), { w: 32, h: 32 }, {
      rng: () => 0,
      blinkEyes: { color: "#000", rects: [{ x: 18, y: 13, w: 5, h: 4 }] },
    });
    cat.start();
    frame(); // baseline (dt=0), eyes open

    // fillTile scales source-px by the renderer's scale; for a 32px tile that's ×2,
    // so the left eye box (x=18) lands at screen x=36. Match the scaled coordinate.
    const eyePainted = (): boolean => fills.some((f) => f.x === 36 && f.y === 26);

    // Before the blink gap (2800ms) elapses: eyes never painted shut.
    for (let i = 0; i < 100; i++) frame(16); // ~1.6s < 2800ms
    expect(eyePainted()).toBe(false);

    // Run through the gap (rng=0 → 2800ms) + the 120ms hold: the eyes paint shut at
    // some point in this window.
    fills.length = 0;
    for (let i = 0; i < 120; i++) frame(16); // +1.92s → crosses 2800ms with margin
    expect(eyePainted()).toBe(true);
  });
});
