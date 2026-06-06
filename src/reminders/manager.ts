// ReminderManager — the wall-clock shell around the pure reminder model — MA-2.
//
// Like TimerManager (the M4 stretch/Pomodoro shell it sits alongside), this is an
// adapter, not logic: every list transform lives in the pure, tested model.ts. Its
// jobs are the clock, delivery sequencing, and persistence hand-off.
//
// It ticks on its OWN slow `setInterval` driven by injected wall-clock `now()` (not
// the Cat's requestAnimationFrame loop, whose delta is clamped and pauses with the
// display). Because a reminder stores an *absolute* `fireAt`, firing is a plain
// `fireAt <= now` test each tick — so it Just Works across system sleep/wake and
// across a restart (KITTO_AMBIENT B2), and a long sleep that buries the fire time
// simply means it's due the moment we next tick.
//
// Delivery is **sequential**: one reminder is "active" (the cat is at centre showing
// it) at a time; if several are due, the earliest fires and the rest wait in the
// queue until it's dismissed/snoozed (B2: "if several are due, deliver sequentially").
// `now`/`genId` are injectable so the whole thing is unit-testable without real time.

import {
  addReminder,
  nextDue,
  normalizeReminders,
  removeReminder,
  snoozeReminder,
  type Reminder,
} from "./model";

export interface ReminderCallbacks {
  /** Deliver one reminder now — walk the cat to centre and show the banner. */
  readonly onDeliver: (r: Reminder) => void;
  /** The list changed (add/remove/snooze/reschedule) — persist + refresh any UI. */
  readonly onChange: (list: Reminder[]) => void;
}

export interface ReminderManagerOptions {
  /** Wall clock (epoch ms). Injected so tests can advance time deterministically. */
  readonly now?: () => number;
  /** Unique id generator. Defaults to crypto.randomUUID(); injectable for tests. */
  readonly genId?: () => string;
  /** Tick cadence (ms). 1s is plenty — minute/clock reminders don't need finer. */
  readonly tickMs?: number;
}

const DEFAULT_TICK_MS = 1_000;

function defaultGenId(): string {
  // Webview crypto is always present in Tauri; the fallback keeps tests/SSR happy.
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID ? c.randomUUID() : `r-${defaultNow()}-${idCounter++}`;
}
let idCounter = 0;
function defaultNow(): number {
  return Date.now();
}

export class ReminderManager {
  private reminders: Reminder[];
  private activeId: string | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => number;
  private readonly genId: () => string;
  private readonly tickMs: number;

  constructor(
    initial: readonly Reminder[],
    private readonly cb: ReminderCallbacks,
    opts: ReminderManagerOptions = {},
  ) {
    this.reminders = normalizeReminders(initial);
    this.now = opts.now ?? defaultNow;
    this.genId = opts.genId ?? defaultGenId;
    this.tickMs = opts.tickMs ?? DEFAULT_TICK_MS;
  }

  /** Begin the wall-clock loop. An immediate tick fires anything already past-due —
   *  that is the "fire past-due reminders on launch" behaviour (decided 2026-06-04). */
  start(): void {
    if (this.intervalId !== null) return;
    this.tick();
    this.intervalId = setInterval(() => this.tick(), this.tickMs);
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  list(): Reminder[] {
    return [...this.reminders];
  }

  /** The reminder currently being delivered (cat at centre), or null. */
  get active(): Reminder | null {
    return this.reminders.find((r) => r.id === this.activeId) ?? null;
  }

  /** Schedule a new reminder. Returns it so the caller can echo it in the UI. */
  add(message: string, fireAt: number): Reminder {
    const r: Reminder = { id: this.genId(), message, fireAt, createdAt: this.now() };
    this.reminders = addReminder(this.reminders, r);
    this.cb.onChange(this.list());
    return r;
  }

  /** Cancel/dismiss a reminder. If it was the active delivery, the queue frees up. */
  remove(id: string): void {
    this.reminders = removeReminder(this.reminders, id);
    if (this.activeId === id) this.activeId = null;
    this.cb.onChange(this.list());
  }

  /** Snooze: reschedule `ms` from now and free the active slot so it can re-fire. */
  snooze(id: string, ms: number): void {
    this.reminders = snoozeReminder(this.reminders, id, this.now(), ms);
    if (this.activeId === id) this.activeId = null;
    this.cb.onChange(this.list());
  }

  /**
   * Replace the list from an external edit (the settings window wrote reminders.json
   * and broadcast it). Keeps the current active delivery if it still exists; does NOT
   * re-emit onChange (the edit was already persisted) so there's no feedback loop.
   */
  reload(list: readonly Reminder[]): void {
    this.reminders = normalizeReminders(list);
    if (this.activeId && !this.reminders.some((r) => r.id === this.activeId)) {
      this.activeId = null;
    }
  }

  /** One wall-clock check: if nothing is being delivered, fire the earliest due. */
  private tick(): void {
    if (this.activeId !== null) return; // a delivery is on screen — others wait
    const due = nextDue(this.reminders, this.now());
    if (!due) return;
    this.activeId = due.id;
    this.cb.onDeliver(due);
  }
}
