import { describe, it, expect } from "vitest";
import { Ball } from "./ball";

const BOUNDS = { w: 1000, h: 600 };

describe("Ball physics", () => {
  it("starts at rest where it is placed", () => {
    const b = new Ball({ x: 100, y: 100 });
    expect(b.position).toEqual({ x: 100, y: 100 });
    expect(b.speed).toBe(0);
    expect(b.atRest).toBe(true);
  });

  it("rolls in the batted direction", () => {
    const b = new Ball({ x: 100, y: 100 }, { decelPxPerSec2: 0 });
    b.bat(200, 0); // 200 px/s, frictionless for this assertion
    b.update(1000, BOUNDS);
    expect(b.position.x).toBeCloseTo(300);
    expect(b.position.y).toBeCloseTo(100);
  });

  it("slows under friction and eventually comes to rest", () => {
    const b = new Ball({ x: 200, y: 200 }, { decelPxPerSec2: 300, restSpeed: 6 });
    b.bat(120, 0); // 120 px/s; friction 300/s → stops well within a second
    let frames = 0;
    while (!b.atRest && frames < 1000) {
      b.update(16, BOUNDS);
      frames++;
    }
    expect(b.atRest).toBe(true);
    expect(b.speed).toBe(0);
  });

  it("bounces off a wall, losing energy to restitution", () => {
    const b = new Ball({ x: 980, y: 300 }, { radius: 10, decelPxPerSec2: 0, restitution: 0.5 });
    b.bat(200, 0); // heading into the right wall (hiX = 1000 - 10 = 990)
    b.update(100, BOUNDS); // 200 * 0.1 = 20px → crosses 990, reflects
    expect(b.position.x).toBeLessThanOrEqual(990);
    expect(b.velocity.x).toBeLessThan(0); // now travelling back left
    expect(Math.abs(b.velocity.x)).toBeCloseTo(100); // 200 * 0.5 restitution
  });

  it("stays within bounds by its radius on every wall", () => {
    const b = new Ball({ x: 500, y: 300 }, { radius: 12, decelPxPerSec2: 0, restitution: 1 });
    b.bat(-9999, -9999); // hurl it at the top-left corner
    for (let i = 0; i < 20; i++) b.update(16, BOUNDS);
    expect(b.position.x).toBeGreaterThanOrEqual(12);
    expect(b.position.y).toBeGreaterThanOrEqual(12);
  });

  it("treats a zero-dt frame as a no-op", () => {
    const b = new Ball({ x: 100, y: 100 });
    b.bat(200, 0);
    b.update(0, BOUNDS);
    expect(b.position).toEqual({ x: 100, y: 100 });
  });
});
