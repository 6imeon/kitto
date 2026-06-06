// Right-click-the-cat quick panel — M4, slimmed in M6 (KITTO_SPEC §5).
//
// The overlay is tiny and click-through, so right-click opens a compact panel with
// the *quick* Pomodoro actions (start/pause, skip, reset, stretch-now) — the things
// you want one click away. Everything configurable (timers, reactions, fur,
// autostart) now lives in the full settings window (M6); the panel just has a
// button that opens it. While the panel is open the window is interactive (not
// click-through); the owner is told via `onOpenChange`.

import { invoke } from "@tauri-apps/api/core";
import type { TimerManager } from "../timers/manager";
import { phaseLabel, formatClock, type PomodoroState } from "../timers/pomodoro";

export interface ControlsHooks {
  /** Called when the panel opens (true) / closes (false). */
  readonly onOpenChange: (open: boolean) => void;
  /** Quick-add a reminder (MA-2): parse + schedule message at `when`. Returns a
   *  status line to show — `ok:false` on a parse error, leaving the form filled. */
  readonly onAddReminder: (message: string, when: string) => { ok: boolean; message: string };
}

/** Look up a required element, asserting its presence (the panel ships in index.html). */
function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`controls: missing #${id}`);
  return node as T;
}

export class Controls {
  private readonly root = el<HTMLDivElement>("controls");
  private readonly toggleBtn = el<HTMLButtonElement>("pomo-toggle");
  private readonly phaseEl = el<HTMLSpanElement>("pomo-phase");
  private readonly timeEl = el<HTMLSpanElement>("pomo-time");
  private isOpen = false;

  constructor(
    private readonly timers: TimerManager,
    private readonly hooks: ControlsHooks,
  ) {
    // Quick Pomodoro actions. After each, the manager's onChange refreshes the panel.
    this.toggleBtn.addEventListener("click", () => this.timers.toggle());
    el("pomo-skip").addEventListener("click", () => this.timers.skip());
    el("pomo-reset").addEventListener("click", () => this.timers.reset());
    el("stretch-now").addEventListener("click", () => this.timers.stretchNow());

    // Quick-add a reminder (MA-2). Submit parses the "when"; on success we clear the
    // form and confirm, on a parse error we keep the text and show why.
    el<HTMLFormElement>("reminder-quick").addEventListener("submit", (e) => {
      e.preventDefault();
      this.addReminder();
    });

    // Open the full settings window (M6) — lives in the Rust core (window::open_settings).
    el("open-settings").addEventListener("click", () => {
      void invoke("open_settings").catch((err) =>
        console.error("[kitto] could not open settings", err),
      );
      this.close();
    });

    // Dismissal: backdrop, close button, Escape.
    el("controls-backdrop").addEventListener("click", () => this.close());
    el("controls-close").addEventListener("click", () => this.close());
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.isOpen) this.close();
    });
  }

  open(): void {
    if (this.isOpen) return;
    this.isOpen = true;
    this.update(this.timers.pomodoro);
    this.root.hidden = false;
    this.hooks.onOpenChange(true);
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.hidden = true;
    this.hooks.onOpenChange(false);
  }

  toggle(): void {
    this.isOpen ? this.close() : this.open();
  }

  /** Read the quick-add form, ask the app to schedule it, and reflect the result. */
  private addReminder(): void {
    const message = el<HTMLInputElement>("rq-message").value.trim();
    const when = el<HTMLInputElement>("rq-when").value.trim();
    const status = el<HTMLSpanElement>("rq-status");
    if (!message) {
      status.textContent = "Add a message first.";
      return;
    }
    const res = this.hooks.onAddReminder(message, when);
    status.textContent = res.message;
    if (res.ok) {
      el<HTMLInputElement>("rq-message").value = "";
      el<HTMLInputElement>("rq-when").value = "";
    }
  }

  /** Refresh the live Pomodoro readout. Called from the manager's onChange tick. */
  update(p: PomodoroState): void {
    if (!this.isOpen) return; // nothing visible to update while closed
    this.phaseEl.textContent = phaseLabel(p.phase);
    this.timeEl.textContent = formatClock(p.remainingMs);
    this.toggleBtn.textContent =
      p.status === "running" ? "Pause" : p.status === "paused" ? "Resume" : "Start";
  }
}
