import { describe, it, expect } from "vitest";
import {
  addReminder,
  dueReminders,
  nextDue,
  normalizeReminders,
  removeReminder,
  snoozeReminder,
  MAX_MESSAGE_LEN,
  type Reminder,
} from "./model";

function r(id: string, fireAt: number, message = "msg", createdAt = 0): Reminder {
  return { id, message, fireAt, createdAt };
}

describe("normalizeReminders", () => {
  it("drops malformed entries and sorts by fire time", () => {
    const list = normalizeReminders([
      r("b", 2000),
      { id: "x" }, // no message/fireAt
      r("a", 1000),
      "junk",
      { id: "c", message: "", fireAt: 500 }, // empty message → dropped
      { id: "d", message: "ok", fireAt: Number.NaN }, // NaN fireAt → dropped
    ]);
    expect(list.map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("returns [] for non-arrays", () => {
    expect(normalizeReminders(null)).toEqual([]);
    expect(normalizeReminders({})).toEqual([]);
  });

  it("trims and length-caps the message", () => {
    const long = "x".repeat(MAX_MESSAGE_LEN + 50);
    const [out] = normalizeReminders([{ id: "a", message: `  ${long}  `, fireAt: 1 }]);
    expect(out!.message.length).toBe(MAX_MESSAGE_LEN);
  });

  it("defaults createdAt to fireAt when absent", () => {
    const [out] = normalizeReminders([{ id: "a", message: "m", fireAt: 1234 }]);
    expect(out!.createdAt).toBe(1234);
  });
});

describe("due / next", () => {
  const list = [r("a", 1000), r("b", 2000), r("c", 3000)];

  it("dueReminders returns those at-or-before now, earliest first", () => {
    expect(dueReminders(list, 2000).map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("nextDue returns the single earliest due, or null", () => {
    expect(nextDue(list, 2500)?.id).toBe("a");
    expect(nextDue(list, 999)).toBeNull();
  });

  it("breaks fire-time ties by creation order", () => {
    const tied = [r("late", 1000, "m", 50), r("early", 1000, "m", 10)];
    expect(nextDue(tied, 1000)?.id).toBe("early");
  });
});

describe("mutations are pure + sorted", () => {
  it("addReminder inserts in fire-time order", () => {
    const out = addReminder([r("a", 1000), r("c", 3000)], r("b", 2000));
    expect(out.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("removeReminder drops by id (no-op if absent)", () => {
    const base = [r("a", 1000), r("b", 2000)];
    expect(removeReminder(base, "a").map((x) => x.id)).toEqual(["b"]);
    expect(removeReminder(base, "zzz")).toHaveLength(2);
  });

  it("snoozeReminder reschedules from now and re-sorts", () => {
    const base = [r("a", 1000), r("b", 2000)];
    const out = snoozeReminder(base, "a", 5000, 60_000); // a → 65_000, now last
    expect(out.map((x) => x.id)).toEqual(["b", "a"]);
    expect(out.find((x) => x.id === "a")!.fireAt).toBe(65_000);
  });
});
