// Reminder delivery banner — MA-2 (KITTO_AMBIENT B1: "shows the message in a small
// speech bubble / banner near the cat").
//
// A plain DOM element (not on the cat canvas) anchored near the screen centre, where
// the cat trots to deliver. It carries the message and the two actions — Dismiss
// (B1: "click it") and Snooze (B1: "pet it (or a snooze button)") — as explicit,
// always-reliable buttons; clicking the cat sprite dismisses too (wired in main.ts).
// Unlike the rest of the overlay this region is interactive, so while it's shown the
// window must not be click-through — main.ts reconciles that via `onOpenChange`.

export interface ReminderBannerHooks {
  /** The user dismissed the reminder (Dismiss button). */
  readonly onDismiss: () => void;
  /** The user snoozed the reminder (Snooze button). */
  readonly onSnooze: () => void;
  /** The banner became visible (true) / hidden (false) — drives click-through. */
  readonly onOpenChange: (open: boolean) => void;
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`reminder banner: missing #${id}`);
  return node as T;
}

export class ReminderBanner {
  private readonly root = el<HTMLDivElement>("reminder");
  private readonly messageEl = el<HTMLParagraphElement>("reminder-message");
  private visible = false;

  constructor(private readonly hooks: ReminderBannerHooks) {
    el("reminder-dismiss").addEventListener("click", () => this.hooks.onDismiss());
    el("reminder-snooze").addEventListener("click", () => this.hooks.onSnooze());
  }

  /** Show the banner with `message`. Idempotent text update if already open. */
  show(message: string): void {
    this.messageEl.textContent = message;
    if (this.visible) return;
    this.visible = true;
    this.root.hidden = false;
    this.hooks.onOpenChange(true);
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.root.hidden = true;
    this.hooks.onOpenChange(false);
  }

  get isOpen(): boolean {
    return this.visible;
  }
}
