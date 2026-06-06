import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ReminderManager } from "./manager";
import type { Reminder } from "./model";

// The manager runs a real setInterval, so drive it with vitest fake timers and an
// injected wall clock we advance by hand — exercising the same sleep/wake-resilient
// "absolute fireAt vs now" path without waiting on real time.

describe("ReminderManager", () => {
  let now = 1000;
  let ids = 0;
  let delivered: Reminder[];
  let changes: Reminder[][];

  function make(initial: Reminder[] = []): ReminderManager {
    return new ReminderManager(
      initial,
      {
        onDeliver: (r) => delivered.push(r),
        onChange: (l) => changes.push(l),
      },
      { now: () => now, genId: () => `id${ids++}`, tickMs: 100 },
    );
  }

  beforeEach(() => {
    vi.useFakeTimers();
    now = 1000;
    ids = 0;
    delivered = [];
    changes = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires a reminder once its time arrives", () => {
    const mgr = make();
    mgr.add("ping", 2000);
    mgr.start();
    expect(delivered).toHaveLength(0); // now=1000, not due yet

    now = 2000;
    vi.advanceTimersByTime(100);
    expect(delivered.map((r) => r.message)).toEqual(["ping"]);
    expect(mgr.active?.message).toBe("ping");
    mgr.stop();
  });

  it("fires past-due reminders immediately on start (launch behaviour)", () => {
    const mgr = make([{ id: "old", message: "missed-you", fireAt: 500, createdAt: 0 }]);
    mgr.start();
    expect(delivered.map((r) => r.message)).toEqual(["missed-you"]); // 500 < now 1000
    mgr.stop();
  });

  it("delivers sequentially — one active at a time", () => {
    const mgr = make([
      { id: "a", message: "first", fireAt: 500, createdAt: 0 },
      { id: "b", message: "second", fireAt: 600, createdAt: 0 },
    ]);
    mgr.start();
    expect(delivered.map((r) => r.message)).toEqual(["first"]); // only the earliest

    now = 3000;
    vi.advanceTimersByTime(100);
    expect(delivered.map((r) => r.message)).toEqual(["first"]); // still blocked by active

    mgr.remove("a"); // dismiss the first → queue frees up
    vi.advanceTimersByTime(100);
    expect(delivered.map((r) => r.message)).toEqual(["first", "second"]);
    mgr.stop();
  });

  it("snooze reschedules and re-fires after the delay", () => {
    const mgr = make([{ id: "a", message: "stretch", fireAt: 500, createdAt: 0 }]);
    mgr.start();
    expect(delivered).toHaveLength(1);

    now = 1000;
    mgr.snooze("a", 60_000); // → fireAt 61_000, active slot freed
    expect(mgr.active).toBeNull();

    now = 61_000;
    vi.advanceTimersByTime(100);
    expect(delivered).toHaveLength(2); // fired again after the snooze
    mgr.stop();
  });

  it("add/remove/snooze each emit onChange (for persistence)", () => {
    const mgr = make();
    mgr.add("x", 5000);
    mgr.snooze(mgr.list()[0]!.id, 1000);
    mgr.remove(mgr.list()[0]!.id);
    expect(changes).toHaveLength(3);
    expect(mgr.list()).toHaveLength(0);
  });

  it("reload replaces the list without re-emitting onChange", () => {
    const mgr = make();
    mgr.reload([{ id: "z", message: "synced", fireAt: 9000, createdAt: 0 }]);
    expect(changes).toHaveLength(0); // external edit — already persisted elsewhere
    expect(mgr.list().map((r) => r.id)).toEqual(["z"]);
  });

  it("does not re-deliver the active reminder after a reload that keeps it", () => {
    const mgr = make([{ id: "a", message: "hi", fireAt: 500, createdAt: 0 }]);
    mgr.start();
    expect(delivered).toHaveLength(1);
    mgr.reload([{ id: "a", message: "hi", fireAt: 500, createdAt: 0 }]); // still present
    vi.advanceTimersByTime(100);
    expect(delivered).toHaveLength(1); // active preserved, not fired twice
    mgr.stop();
  });
});
