import { describe, it, expect } from "vitest";
import { PlaySession, DEFAULT_PLAY_CONFIG, type PlayInput } from "./session";

function input(over: Partial<PlayInput> = {}): PlayInput {
  return { cat: { x: 0, y: 0 }, ball: { x: 0, y: 0 }, ballAtRest: true, dtMs: 16, ...over };
}

describe("PlaySession", () => {
  it("chases the ball while it's out of pounce range", () => {
    const s = new PlaySession(DEFAULT_PLAY_CONFIG, () => 0.5);
    const intent = s.update(input({ ball: { x: 200, y: 0 } }));
    expect(intent).toEqual({ kind: "chase", target: { x: 200, y: 0 } });
  });

  it("pounces and swats the ball away once close and the ball is at rest", () => {
    const s = new PlaySession(DEFAULT_PLAY_CONFIG, () => 0.5); // 0.5 → zero angular spread
    const intent = s.update(input({ ball: { x: 20, y: 0 }, ballAtRest: true }));
    expect(intent.kind).toBe("pounce");
    if (intent.kind === "pounce") {
      // Swatted straight along cat→ball (+x) at the configured speed.
      expect(intent.bat.x).toBeCloseTo(DEFAULT_PLAY_CONFIG.batSpeedPxPerSec);
      expect(intent.bat.y).toBeCloseTo(0);
    }
  });

  it("waits (crouch & watch) when close but the ball is still flying", () => {
    const s = new PlaySession(DEFAULT_PLAY_CONFIG, () => 0.5);
    expect(s.update(input({ ball: { x: 20, y: 0 }, ballAtRest: false })).kind).toBe("wait");
  });

  it("waits out the cooldown between pounces (no pounce-spam)", () => {
    const s = new PlaySession(DEFAULT_PLAY_CONFIG, () => 0.5);
    const close = input({ ball: { x: 20, y: 0 }, ballAtRest: true, dtMs: 16 });
    expect(s.update(close).kind).toBe("pounce"); // first swat → starts the cooldown
    expect(s.update(close).kind).toBe("wait"); // still cooling down
  });

  it("loses interest after maxPounces", () => {
    const s = new PlaySession({ ...DEFAULT_PLAY_CONFIG, cooldownMs: 0, maxPounces: 3 }, () => 0.5);
    const close = input({ ball: { x: 20, y: 0 }, ballAtRest: true });
    expect(s.update(close).kind).toBe("pounce");
    expect(s.update(close).kind).toBe("pounce");
    expect(s.update(close).kind).toBe("pounce");
    expect(s.update(close).kind).toBe("done"); // 3 pounces reached
    expect(s.pounceCount).toBe(3);
  });

  it("ends after the max duration even if the ball never settles", () => {
    const s = new PlaySession(DEFAULT_PLAY_CONFIG, () => 0.5);
    expect(s.update(input({ dtMs: DEFAULT_PLAY_CONFIG.maxDurationMs })).kind).toBe("done");
  });
});
