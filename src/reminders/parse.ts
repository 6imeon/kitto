// "When" parser for reminders — MA-2 (KITTO_AMBIENT B3).
//
// PURE and deterministic: it takes the typed "when" string plus the current epoch
// (`now`, injected — never Date.now() in here, per KITTO_SPEC §8 / KITTO_AMBIENT §5)
// and returns an absolute fire time in epoch ms. Storing the *absolute* instant is
// what lets a reminder survive a restart and fire correctly across sleep/wake — the
// scheduler just compares it to wall-clock time, no relative bookkeeping to lose.
//
// Deliberately small and predictable (B3: "avoid a heavy NLP dependency — a small
// hand-rolled parser covers the common cases"). Two shapes:
//   • relative / duration:  "in 25m", "in 1h30m", "2h", "90s", "45"  (bare ⇒ minutes)
//   • absolute clock time:   "at 3pm", "at 3:30pm", "15:00", "9am"   (next occurrence)
// The leading "in"/"at" is optional; we sniff the shape from the content.

export type ParseResult =
  | { readonly ok: true; readonly fireAt: number }
  | { readonly ok: false; readonly error: string };

const HOUR_MS = 3_600_000;
const MIN_MS = 60_000;
const SEC_MS = 1_000;
const DAY_MS = 86_400_000;

/** A single duration token: digits then an optional unit word (h/m/s family). */
const DURATION_TOKEN = /(\d+)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)?/iy;

/** A clock time: "3", "3:30", "15:00", optionally suffixed am/pm. */
const CLOCK = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i;

/** Map a duration unit word to its millisecond multiplier (by first letter). */
function unitMs(unit: string | undefined): number | null {
  if (!unit) return null; // unitless — only meaningful as the lone token (⇒ minutes)
  switch (unit[0]!.toLowerCase()) {
    case "h":
      return HOUR_MS;
    case "m":
      return MIN_MS;
    case "s":
      return SEC_MS;
    default:
      return null;
  }
}

/** Parse a duration string ("1h30m", "25m", "90s", bare "45" ⇒ minutes) to ms. */
function parseDuration(s: string): number | null {
  DURATION_TOKEN.lastIndex = 0;
  const tokens: Array<{ value: number; unit: string | undefined }> = [];
  let pos = 0;
  const compact = s.replace(/\s+/g, "");
  while (pos < compact.length) {
    DURATION_TOKEN.lastIndex = pos;
    const m = DURATION_TOKEN.exec(compact);
    if (!m || m.index !== pos || m[0] === "") return null; // a gap ⇒ unparseable junk
    tokens.push({ value: Number(m[1]), unit: m[2] });
    pos = DURATION_TOKEN.lastIndex;
  }
  if (tokens.length === 0) return null;

  // A single unitless number is the "plain duration field" → minutes.
  if (tokens.length === 1 && tokens[0]!.unit === undefined) {
    return tokens[0]!.value * MIN_MS;
  }

  let total = 0;
  for (const t of tokens) {
    const mul = unitMs(t.unit);
    if (mul === null) return null; // a unitless token mixed with others is ambiguous
    total += t.value * mul;
  }
  return total;
}

/** Parse an absolute clock time to the next epoch at-or-after `now`. */
function parseClock(s: string, now: number): number | null {
  const m = CLOCK.exec(s.trim());
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  const ampm = m[3]?.toLowerCase();
  if (minute > 59) return null;

  if (ampm) {
    if (hour < 1 || hour > 12) return null;
    if (ampm === "pm" && hour !== 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;
  } else if (hour > 23) {
    return null;
  }

  const d = new Date(now);
  d.setHours(hour, minute, 0, 0);
  let t = d.getTime();
  if (t <= now) t += DAY_MS; // already passed today → the next occurrence is tomorrow
  return t;
}

/**
 * Parse a "when" string into an absolute fire time (epoch ms) relative to `now`.
 * Returns a friendly error message on anything it can't read.
 */
export function parseWhen(input: string, now: number): ParseResult {
  const raw = input.trim().toLowerCase();
  if (!raw) return { ok: false, error: "Enter a time, e.g. “in 25m” or “at 3pm”." };

  // Explicit prefixes pick the shape; otherwise infer (a ":" or am/pm ⇒ clock).
  if (raw.startsWith("at ")) {
    const t = parseClock(raw.slice(3), now);
    return t === null
      ? { ok: false, error: "Couldn’t read that time. Try “at 3pm” or “at 15:00”." }
      : { ok: true, fireAt: t };
  }

  const body = raw.startsWith("in ") ? raw.slice(3) : raw;

  // Infer absolute when it looks like a clock (has am/pm or a colon) and no prefix.
  if (!raw.startsWith("in ") && /am|pm/.test(body)) {
    const t = parseClock(body, now);
    if (t !== null) return { ok: true, fireAt: t };
  }

  const dur = parseDuration(body);
  if (dur !== null) {
    if (dur <= 0) return { ok: false, error: "Pick a time in the future." };
    return { ok: true, fireAt: now + dur };
  }

  // Last resort: a bare clock like "15:00" with no prefix.
  const clock = parseClock(body, now);
  if (clock !== null) return { ok: true, fireAt: clock };

  return { ok: false, error: "Couldn’t read that. Try “in 25m” or “at 3pm”." };
}
