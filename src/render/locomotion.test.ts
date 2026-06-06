import { describe, it, expect } from "vitest";
import { Locomotion } from "./locomotion";

describe("Locomotion", () => {
  it("starts at its initial position, not moving", () => {
    const loco = new Locomotion({ x: 100, y: 50 });
    expect(loco.position).toEqual({ x: 100, y: 50 });
    expect(loco.moving).toBe(false);
    expect(loco.facing).toBe(1);
  });

  it("walks toward a target at the configured speed", () => {
    const loco = new Locomotion({ x: 0, y: 0 }, 100); // 100 px/sec
    loco.walkTo(100, 0);
    expect(loco.moving).toBe(true);

    // 1000ms at 100px/s = 100px, exactly the distance → reached this frame.
    const reached = loco.update(1000);
    expect(reached).toBe(true);
    expect(loco.position).toEqual({ x: 100, y: 0 });
    expect(loco.moving).toBe(false);
  });

  it("advances proportionally over multiple frames", () => {
    const loco = new Locomotion({ x: 0, y: 0 }, 100);
    loco.walkTo(0, 200);

    expect(loco.update(500)).toBe(false); // 50px of 200
    expect(loco.position).toEqual({ x: 0, y: 50 });
    expect(loco.update(500)).toBe(false); // 100px
    expect(loco.position).toEqual({ x: 0, y: 100 });
  });

  it("snaps to the target instead of overshooting", () => {
    const loco = new Locomotion({ x: 0, y: 0 }, 1000);
    loco.walkTo(10, 0);
    // 1000ms at 1000px/s = 1000px, far past the 10px target.
    const reached = loco.update(1000);
    expect(reached).toBe(true);
    expect(loco.position).toEqual({ x: 10, y: 0 });
  });

  it("moves along a diagonal at constant speed (no axis bias)", () => {
    const loco = new Locomotion({ x: 0, y: 0 }, 100);
    loco.walkTo(30, 40); // distance 50
    loco.update(250); // 25px of 50 → halfway
    expect(loco.position.x).toBeCloseTo(15, 6);
    expect(loco.position.y).toBeCloseTo(20, 6);
  });

  it("faces the direction of travel", () => {
    const loco = new Locomotion({ x: 0, y: 0 }, 100);
    loco.walkTo(-50, 0);
    loco.update(100);
    expect(loco.facing).toBe(-1);

    loco.walkTo(50, 0);
    loco.update(100);
    expect(loco.facing).toBe(1);
  });

  it("stop() abandons the target where it stands", () => {
    const loco = new Locomotion({ x: 0, y: 0 }, 100);
    loco.walkTo(100, 0);
    loco.update(100); // at x=10
    loco.stop();
    expect(loco.moving).toBe(false);
    expect(loco.position.x).toBeCloseTo(10, 6);
    expect(loco.update(1000)).toBe(false); // no target → no movement
    expect(loco.position.x).toBeCloseTo(10, 6);
  });

  it("placeAt() teleports and clears any target", () => {
    const loco = new Locomotion({ x: 0, y: 0 }, 100);
    loco.walkTo(500, 500);
    loco.placeAt(200, 300);
    expect(loco.position).toEqual({ x: 200, y: 300 });
    expect(loco.moving).toBe(false);
  });

  it("treats non-positive dt as a no-op step (no rewind)", () => {
    const loco = new Locomotion({ x: 0, y: 0 }, 100);
    loco.walkTo(100, 0);
    expect(loco.update(0)).toBe(false);
    expect(loco.update(-50)).toBe(false);
    expect(loco.position).toEqual({ x: 0, y: 0 });
    expect(loco.moving).toBe(true);
  });

  it("honors a per-trip speed override (zoomies dash), then resets to the stroll", () => {
    const loco = new Locomotion({ x: 0, y: 0 }, 100); // base 100 px/s
    loco.walkTo(1000, 0, 400); // dash at 400 px/s
    loco.update(1000); // 1s → 400px at the override speed
    expect(loco.position.x).toBeCloseTo(400);

    // A subsequent ordinary trip falls back to the leisurely base speed.
    loco.placeAt(0, 0);
    loco.walkTo(1000, 0);
    loco.update(1000);
    expect(loco.position.x).toBeCloseTo(100);
  });

  it("resets the override speed after arrival", () => {
    const loco = new Locomotion({ x: 0, y: 0 }, 100);
    loco.walkTo(50, 0, 400); // fast, short — arrives within the frame
    expect(loco.update(1000)).toBe(true);
    loco.walkTo(1000, 0); // next trip: base speed again (from x=50)
    loco.update(1000);
    expect(loco.position.x).toBeCloseTo(150); // 50 + 100px at base speed, not 400
  });
});
