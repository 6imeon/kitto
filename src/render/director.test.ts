import { describe, it, expect } from "vitest";
import { AmbientDirector, DEFAULT_DIRECTOR_CONFIG, type DirectorInput } from "./director";

const BOUNDS = { w: 1000, h: 600 };
const HALF = { x: 32, y: 32 };
const CFG = { enabled: true, wanderAfterMs: 10_000, cornerMargin: 8 };

/** A deterministic rng that replays a fixed queue of values (then holds the last). */
function seq(...values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)]!;
}

function input(over: Partial<DirectorInput> = {}): DirectorInput {
  return {
    idleMs: 0,
    position: { x: 500, y: 300 },
    bounds: BOUNDS,
    half: HALF,
    arrived: false,
    ...over,
  };
}

describe("AmbientDirector", () => {
  it("dwells (does nothing) while idle is below the wander threshold", () => {
    const d = new AmbientDirector(CFG, seq(0, 0));
    expect(d.update(input({ idleMs: 0 }))).toEqual({ kind: "none" });
    expect(d.update(input({ idleMs: 9_999 }))).toEqual({ kind: "none" });
    expect(d.currentPhase).toBe("dwell");
  });

  it("at the threshold, sets off toward a nap corner (rng picks the corner)", () => {
    // rng < 0.5 twice → top-left corner: x = half+margin = 40, y = 40.
    const d = new AmbientDirector(CFG, seq(0.1, 0.2));
    const intent = d.update(input({ idleMs: 10_000, position: { x: 500, y: 300 } }));
    // First leg hugs the wall: slide to the corner's x at the current height.
    expect(intent).toEqual({ kind: "walkTo", target: { x: 40, y: 300 } });
    expect(d.currentPhase).toBe("travel");
  });

  it("pickWanderSpot returns a random on-screen point inside the safe margins", () => {
    // rng 0.5 on each axis → the midpoint of the safe range.
    const d = new AmbientDirector(CFG, seq(0.5, 0.5));
    const spot = d.pickWanderSpot({ bounds: BOUNDS, half: HALF });
    // x range [40, 960] → mid 500; y range [40, 560] → mid 300.
    expect(spot.x).toBeCloseTo(500);
    expect(spot.y).toBeCloseTo(300);
  });

  it("pickWanderSpot stays within margins at the rng extremes", () => {
    const lo = new AmbientDirector(CFG, seq(0, 0)).pickWanderSpot({ bounds: BOUNDS, half: HALF });
    const hi = new AmbientDirector(CFG, seq(1, 1)).pickWanderSpot({ bounds: BOUNDS, half: HALF });
    expect(lo).toEqual({ x: 40, y: 40 });
    expect(hi).toEqual({ x: 960, y: 560 });
  });

  it("pickWanderSpot leaves the Director's phase untouched (caller drives the trip)", () => {
    const d = new AmbientDirector(CFG, seq(0.3, 0.7));
    d.pickWanderSpot({ bounds: BOUNDS, half: HALF });
    expect(d.currentPhase).toBe("dwell");
  });

  it("rng selects which of the four corners (high values → bottom-right)", () => {
    const d = new AmbientDirector(CFG, seq(0.9, 0.9));
    const intent = d.update(input({ idleMs: 10_000 }));
    // x = w - half - margin = 1000-40 = 960; the corner y = h - 40 = 560.
    expect(intent).toEqual({ kind: "walkTo", target: { x: 960, y: 300 } });
  });

  it("walks the route leg by leg, then lies down at the corner", () => {
    const d = new AmbientDirector(CFG, seq(0.1, 0.1)); // top-left → (40, 40)
    d.update(input({ idleMs: 10_000, position: { x: 500, y: 300 } })); // → walkTo edge (40,300)

    // Still en route to the first leg: nothing new.
    expect(d.update(input({ idleMs: 10_020 }))).toEqual({ kind: "none" });

    // Reached the wall → head along it into the corner.
    expect(d.update(input({ idleMs: 10_040, arrived: true }))).toEqual({
      kind: "walkTo",
      target: { x: 40, y: 40 },
    });

    // Reached the corner → nap.
    expect(d.update(input({ idleMs: 10_060, arrived: true }))).toEqual({ kind: "sleep" });
    expect(d.currentPhase).toBe("nap");
  });

  it("naps until a real cue resets the idle clock, then wakes", () => {
    const d = new AmbientDirector(CFG, seq(0.1, 0.1));
    d.update(input({ idleMs: 10_000 }));
    d.update(input({ idleMs: 10_020, arrived: true })); // edge → corner
    d.update(input({ idleMs: 10_040, arrived: true })); // → sleep
    expect(d.currentPhase).toBe("nap");

    // Idle keeps growing while asleep: stays put.
    expect(d.update(input({ idleMs: 12_000 }))).toEqual({ kind: "none" });

    // A cue resets the machine's idle clock (drop) → wake.
    expect(d.update(input({ idleMs: 0 }))).toEqual({ kind: "wake" });
    expect(d.currentPhase).toBe("dwell");
  });

  it("a cue mid-trip cancels the route and returns to dwell", () => {
    const d = new AmbientDirector(CFG, seq(0.1, 0.1));
    d.update(input({ idleMs: 10_000 })); // travelling
    expect(d.currentPhase).toBe("travel");
    expect(d.update(input({ idleMs: 50 }))).toEqual({ kind: "cancel" }); // idle reset
    expect(d.currentPhase).toBe("dwell");
  });

  it("after waking, needs another full idle delay before wandering again", () => {
    const d = new AmbientDirector(CFG, seq(0.1, 0.1, 0.1, 0.1));
    d.update(input({ idleMs: 10_000 }));
    d.update(input({ idleMs: 10_020, arrived: true }));
    d.update(input({ idleMs: 10_040, arrived: true })); // napping
    d.update(input({ idleMs: 0 })); // wake → dwell
    expect(d.update(input({ idleMs: 9_999 }))).toEqual({ kind: "none" }); // not yet
    expect(d.update(input({ idleMs: 10_000 })).kind).toBe("walkTo"); // off again
  });

  it("does nothing at all when disabled", () => {
    const d = new AmbientDirector({ ...CFG, enabled: false }, seq(0.1, 0.1));
    expect(d.update(input({ idleMs: 999_999 }))).toEqual({ kind: "none" });
    expect(d.currentPhase).toBe("dwell");
  });

  it("disabling mid-nap stands the cat down to dwell", () => {
    const d = new AmbientDirector(CFG, seq(0.1, 0.1));
    d.update(input({ idleMs: 10_000 }));
    d.update(input({ idleMs: 10_020, arrived: true }));
    d.update(input({ idleMs: 10_040, arrived: true })); // napping
    d.configure({ ...CFG, enabled: false });
    expect(d.currentPhase).toBe("dwell");
    expect(d.update(input({ idleMs: 999_999 }))).toEqual({ kind: "none" });
  });

  it("ships an observable spike default and a sane corner margin", () => {
    expect(DEFAULT_DIRECTOR_CONFIG.enabled).toBe(true);
    expect(DEFAULT_DIRECTOR_CONFIG.wanderAfterMs).toBeGreaterThan(0);
    expect(DEFAULT_DIRECTOR_CONFIG.cornerMargin).toBeGreaterThanOrEqual(0);
  });

  // --- Favourite-corner memory (MA-4 / A4) ---------------------------------------
  describe("favourite-corner memory", () => {
    /** Drive a full nap (dwell→travel→nap) and report the corner it slept in. */
    function napAndReadCorner(d: AmbientDirector): { x: number; y: number } {
      const first = d.update(input({ idleMs: 10_000 })); // → walkTo edge
      expect(first.kind).toBe("walkTo");
      const leg2 = d.update(input({ idleMs: 10_020, arrived: true })); // → walkTo corner
      expect(leg2.kind).toBe("walkTo");
      const corner = (leg2 as { target: { x: number; y: number } }).target;
      expect(d.update(input({ idleMs: 10_040, arrived: true }))).toEqual({ kind: "sleep" });
      return corner;
    }

    it("records the corner it napped in", () => {
      const d = new AmbientDirector(CFG, seq(0.1, 0.1)); // left/top corner
      napAndReadCorner(d);
      expect(d.favouriteCorner).toEqual({ sx: -1, sy: -1 });
    });

    it("biases back toward the favourite on the next nap", () => {
      // First nap goes to the bottom-right corner (rng 0.9, 0.9).
      const d = new AmbientDirector(CFG, seq(0.9, 0.9));
      const first = napAndReadCorner(d);
      expect(d.favouriteCorner).toEqual({ sx: 1, sy: 1 });

      // Wake, then nap again. Now favourite is set, so the bias draw decides: a low
      // draw (< 0.7) takes the favourite and consumes NO corner draws.
      d.update(input({ idleMs: 0 })); // wake → dwell
      // Re-seed the rng for the second trip: bias-draw 0.0 (< 0.7 → take favourite).
      (d as unknown as { rng: () => number }).rng = () => 0.0;
      const second = napAndReadCorner(d);
      expect(second).toEqual(first); // same corner as last time
    });

    it("can be seeded and read back (restore across restart)", () => {
      const d = new AmbientDirector(CFG, seq(0.5));
      d.setFavouriteCorner({ sx: 1, sy: -1 });
      expect(d.favouriteCorner).toEqual({ sx: 1, sy: -1 });
      d.setFavouriteCorner(null);
      expect(d.favouriteCorner).toBeNull();
    });
  });

  // --- Drag-to-bed helpers (MA-4 / A4) -------------------------------------------
  describe("drag-to-bed", () => {
    it("cornerNear snaps to the nearest corner and remembers it", () => {
      const d = new AmbientDirector(CFG);
      // Dropped near the bottom-right of a 1000×600 screen.
      const pt = d.cornerNear({ bounds: BOUNDS, half: HALF, position: { x: 900, y: 550 } });
      expect(pt.x).toBeGreaterThan(BOUNDS.w / 2);
      expect(pt.y).toBeGreaterThan(BOUNDS.h / 2);
      expect(d.favouriteCorner).toEqual({ sx: 1, sy: 1 });

      // Top-left drop → top-left corner.
      d.cornerNear({ bounds: BOUNDS, half: HALF, position: { x: 20, y: 20 } });
      expect(d.favouriteCorner).toEqual({ sx: -1, sy: -1 });
    });

    it("napInPlace puts the cat straight into the nap phase", () => {
      const d = new AmbientDirector(CFG);
      expect(d.napInPlace(5_000)).toEqual({ kind: "sleep" });
      expect(d.currentPhase).toBe("nap");
      // A later interaction (idle clock drops) wakes it via the normal nap logic.
      expect(d.update(input({ idleMs: 0 }))).toEqual({ kind: "wake" });
      expect(d.currentPhase).toBe("dwell");
    });
  });
});
