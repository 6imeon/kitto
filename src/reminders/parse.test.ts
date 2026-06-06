import { describe, it, expect } from "vitest";
import { parseWhen } from "./parse";

const HOUR = 3_600_000;
const MIN = 60_000;
const SEC = 1_000;
const DAY = 86_400_000;

// A fixed reference instant so relative math is exact and TZ-independent.
const NOW = 1_700_000_000_000;

/** The next epoch at-or-after `now` whose local time is h:m — mirrors the parser's
 *  own next-occurrence rule, computed independently so the test isn't TZ-bound. */
function nextClock(now: number, h: number, m: number): number {
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  let t = d.getTime();
  if (t <= now) t += DAY;
  return t;
}

function fireAt(input: string, now = NOW): number {
  const r = parseWhen(input, now);
  if (!r.ok) throw new Error(`expected ok for ${JSON.stringify(input)}, got: ${r.error}`);
  return r.fireAt;
}

describe("parseWhen — relative durations", () => {
  it("parses 'in 25m'", () => expect(fireAt("in 25m")).toBe(NOW + 25 * MIN));
  it("parses a bare '25m'", () => expect(fireAt("25m")).toBe(NOW + 25 * MIN));
  it("parses hours '2h'", () => expect(fireAt("2h")).toBe(NOW + 2 * HOUR));
  it("parses compound '1h30m'", () => expect(fireAt("1h30m")).toBe(NOW + 90 * MIN));
  it("parses seconds '90s'", () => expect(fireAt("90s")).toBe(NOW + 90 * SEC));
  it("parses word units 'in 2 hours'", () => expect(fireAt("in 2 hours")).toBe(NOW + 2 * HOUR));
  it("treats a bare number as minutes", () => expect(fireAt("45")).toBe(NOW + 45 * MIN));

  it("rejects a zero/past duration", () => {
    const r = parseWhen("in 0m", NOW);
    expect(r.ok).toBe(false);
  });
});

describe("parseWhen — absolute clock times", () => {
  it("parses 'at 3pm' to the next 15:00", () => {
    expect(fireAt("at 3pm")).toBe(nextClock(NOW, 15, 0));
  });
  it("parses 24h 'at 15:00' the same as 3pm", () => {
    expect(fireAt("at 15:00")).toBe(fireAt("at 3pm"));
  });
  it("parses 'at 3:30pm'", () => {
    expect(fireAt("at 3:30pm")).toBe(nextClock(NOW, 15, 30));
  });
  it("infers a clock from am/pm without the 'at' prefix", () => {
    expect(fireAt("9am")).toBe(nextClock(NOW, 9, 0));
  });
  it("handles 12am/12pm correctly", () => {
    expect(fireAt("at 12am")).toBe(nextClock(NOW, 0, 0)); // midnight
    expect(fireAt("at 12pm")).toBe(nextClock(NOW, 12, 0)); // noon
  });
  it("always resolves to a future instant (rolls a passed time to tomorrow)", () => {
    expect(fireAt("at 3pm")).toBeGreaterThan(NOW);
    // From a 'now' fixed at 16:00 local, 3pm has passed → it must roll forward a day.
    const fourPm = nextClock(NOW, 16, 0) - DAY; // today's 16:00 (≤ NOW or just after)
    expect(fireAt("at 3pm", fourPm + 60_000)).toBeGreaterThan(fourPm + 60_000);
  });

  it("rejects an out-of-range hour/minute", () => {
    expect(parseWhen("at 25:00", NOW).ok).toBe(false);
    expect(parseWhen("at 3:70pm", NOW).ok).toBe(false);
  });
});

describe("parseWhen — junk", () => {
  it("rejects empty input", () => expect(parseWhen("   ", NOW).ok).toBe(false));
  it("rejects unparseable text", () => expect(parseWhen("whenever", NOW).ok).toBe(false));
  it("rejects mixed junk", () => expect(parseWhen("3 bananas", NOW).ok).toBe(false));
});
