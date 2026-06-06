// Settings window entry (M6, KITTO_SPEC §5). Renders the full settings form,
// persists to disk via config/settings.ts (the shared Rust-backed store), and
// broadcasts `kitto://settings-changed` so the live overlay applies edits
// immediately (fur recolor, reaction toggles, timer intervals). Autostart is a
// real OS toggle, read/written through the Rust autostart commands.

import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  loadSettings,
  saveSettings,
  normalize,
  DEFAULT_FUR,
  type Settings,
  type PatternId,
  type CatBreed,
} from "../config/settings";
import { normalizeEnergyLevel } from "../render/energy";
import { loadReminders, saveReminders } from "../reminders/persist";
import {
  addReminder,
  removeReminder,
  normalizeReminders,
  type Reminder,
} from "../reminders/model";
import { parseWhen } from "../reminders/parse";

const SETTINGS_CHANGED = "kitto://settings-changed";
const REMINDERS_CHANGED = "kitto://reminders-changed";
const MS_PER_MIN = 60_000;

/** A few pleasant preset fur colors; the color input covers anything else. */
const PRESETS: ReadonlyArray<{ name: string; color: string }> = [
  { name: "Grey", color: DEFAULT_FUR },
  { name: "Ginger", color: "#d68a4e" },
  { name: "Cream", color: "#e8d6b0" },
  { name: "Charcoal", color: "#3c3c46" },
  { name: "Blue", color: "#6b86b8" },
  { name: "Snow", color: "#e6e6ee" },
];

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`settings: missing #${id}`);
  return node as T;
}
const check = (id: string): HTMLInputElement => el<HTMLInputElement>(id);
const num = (id: string): number => parseFloat(el<HTMLInputElement>(id).value);

function status(msg: string): void {
  el("settings-status").textContent = msg;
}

/** Read the form into a validated Settings (normalize clamps ranges + fills gaps). */
function readForm(): Settings {
  return normalize({
    soundOnDone: check("set-sound-on").checked,
    autostart: check("set-autostart").checked,
    ambient: {
      level: normalizeEnergyLevel(el<HTMLSelectElement>("set-energy").value),
      play: check("set-ambient-play").checked,
      dayNight: check("set-ambient-daynight").checked,
      // The field is in minutes (0 = auto/level-default); store ms.
      idleDelayMsOverride: Math.max(0, num("set-ambient-idle")) * MS_PER_MIN,
    },
    appearance: {
      cat: el<HTMLSelectElement>("set-cat").value as CatBreed,
      furColor: el<HTMLInputElement>("set-fur-color").value,
      pattern: el<HTMLSelectElement>("set-pattern").value as PatternId,
    },
    reactions: {
      hunt: check("set-react-hunt").checked,
      pet: check("set-react-pet").checked,
      keyboard: check("set-react-keyboard").checked,
      scroll: check("set-react-scroll").checked,
      agent: check("set-react-agent").checked,
    },
    stretch: {
      enabled: check("set-stretch-on").checked,
      intervalMs: num("set-stretch-int") * MS_PER_MIN,
    },
    pomodoro: {
      focusMs: num("set-focus") * MS_PER_MIN,
      shortBreakMs: num("set-short") * MS_PER_MIN,
      longBreakMs: num("set-long") * MS_PER_MIN,
      sessionsBeforeLongBreak: num("set-sessions"),
    },
  });
}

/** Mirror a Settings into every input (used on load + to reflect clamped values). */
function writeForm(s: Settings): void {
  el<HTMLSelectElement>("set-cat").value = s.appearance.cat;
  el<HTMLInputElement>("set-fur-color").value = s.appearance.furColor;
  el<HTMLSelectElement>("set-pattern").value = s.appearance.pattern;
  check("set-react-hunt").checked = s.reactions.hunt;
  check("set-react-pet").checked = s.reactions.pet;
  check("set-react-keyboard").checked = s.reactions.keyboard;
  check("set-react-scroll").checked = s.reactions.scroll;
  check("set-react-agent").checked = s.reactions.agent;
  check("set-sound-on").checked = s.soundOnDone;
  el<HTMLSelectElement>("set-energy").value = s.ambient.level;
  check("set-ambient-play").checked = s.ambient.play;
  check("set-ambient-daynight").checked = s.ambient.dayNight;
  el<HTMLInputElement>("set-ambient-idle").value = String(s.ambient.idleDelayMsOverride / MS_PER_MIN);
  el<HTMLInputElement>("set-focus").value = String(s.pomodoro.focusMs / MS_PER_MIN);
  el<HTMLInputElement>("set-short").value = String(s.pomodoro.shortBreakMs / MS_PER_MIN);
  el<HTMLInputElement>("set-long").value = String(s.pomodoro.longBreakMs / MS_PER_MIN);
  el<HTMLInputElement>("set-sessions").value = String(s.pomodoro.sessionsBeforeLongBreak);
  check("set-stretch-on").checked = s.stretch.enabled;
  el<HTMLInputElement>("set-stretch-int").value = String(s.stretch.intervalMs / MS_PER_MIN);
  markSelectedSwatch(s.appearance.furColor);
}

function markSelectedSwatch(color: string): void {
  for (const btn of el("fur-swatches").querySelectorAll("button")) {
    btn.classList.toggle("selected", btn.dataset.color?.toLowerCase() === color.toLowerCase());
  }
}

/** Persist + broadcast the current form. The overlay listens and applies live. */
async function apply(): Promise<void> {
  const s = readForm();
  writeForm(s); // reflect any clamping back to the user
  await saveSettings(s);
  await emit(SETTINGS_CHANGED, s);
  status("Saved");
}

function buildSwatches(): void {
  const host = el("fur-swatches");
  for (const { name, color } of PRESETS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = name;
    btn.dataset.color = color;
    btn.style.background = color;
    btn.addEventListener("click", () => {
      el<HTMLInputElement>("set-fur-color").value = color;
      void apply();
    });
    host.appendChild(btn);
  }
}

// --- Reminders section (MA-2) ---------------------------------------------------
//
// The settings window has no live ReminderManager — it edits the persisted list
// directly (the pure model.ts transforms) and broadcasts `kitto://reminders-changed`
// so the overlay's manager reloads. It also *listens* for that event so an add/snooze/
// dismiss/fire made in the overlay reflects here. Same shared-file + broadcast pattern
// as settings, just over reminders.json.

let reminders: Reminder[] = [];

function genId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID ? c.randomUUID() : `r-${Date.now()}`;
}

/** A reminder's fire time: just the clock if it's today, else a short date + time. */
function formatWhen(fireAt: number): string {
  const d = new Date(fireAt);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function renderReminders(): void {
  const list = el<HTMLUListElement>("reminders-list");
  list.replaceChildren();
  if (reminders.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "No reminders yet.";
    list.appendChild(empty);
    return;
  }
  for (const r of reminders) {
    const li = document.createElement("li");
    const text = document.createElement("span");
    text.className = "rem-text";
    text.textContent = r.message;
    const when = document.createElement("span");
    when.className = "rem-when";
    when.textContent = formatWhen(r.fireAt);
    const del = document.createElement("button");
    del.type = "button";
    del.className = "rem-del";
    del.setAttribute("aria-label", "Delete reminder");
    del.textContent = "✕";
    del.addEventListener("click", () => void commitReminders(removeReminder(reminders, r.id)));
    li.append(text, when, del);
    list.appendChild(li);
  }
}

/** Replace the list, persist it, and broadcast so the overlay reloads. */
async function commitReminders(next: readonly Reminder[]): Promise<void> {
  reminders = normalizeReminders(next);
  renderReminders();
  await saveReminders(reminders);
  await emit(REMINDERS_CHANGED, reminders);
}

function addReminderFromForm(): void {
  const message = el<HTMLInputElement>("set-rem-message").value.trim();
  const when = el<HTMLInputElement>("set-rem-when").value.trim();
  const statusEl = el<HTMLSpanElement>("set-rem-status");
  if (!message) {
    statusEl.textContent = "Add a message first.";
    return;
  }
  const parsed = parseWhen(when, Date.now());
  if (!parsed.ok) {
    statusEl.textContent = parsed.error;
    return;
  }
  const r: Reminder = { id: genId(), message, fireAt: parsed.fireAt, createdAt: Date.now() };
  void commitReminders(addReminder(reminders, r));
  el<HTMLInputElement>("set-rem-message").value = "";
  el<HTMLInputElement>("set-rem-when").value = "";
  statusEl.textContent = `Set for ${formatWhen(r.fireAt)}.`;
}

async function initReminders(): Promise<void> {
  reminders = await loadReminders();
  renderReminders();
  el<HTMLFormElement>("reminder-form").addEventListener("submit", (e) => {
    e.preventDefault();
    addReminderFromForm();
  });
  // Reflect edits made in the overlay (quick-add, snooze, dismiss, fire). Our own
  // emit echoes back here too, but it only re-renders the same list — no loop.
  listen<Reminder[]>(REMINDERS_CHANGED, (event) => {
    reminders = normalizeReminders(event.payload);
    renderReminders();
  }).catch((err) => console.error("[kitto] reminders sync unavailable", err));
}

async function main(): Promise<void> {
  buildSwatches();
  void initReminders();
  const s = await loadSettings();
  writeForm(s);

  // Autostart reflects the real OS state (the LaunchAgent / registry entry), not
  // just the stored flag — they can drift if the app was moved/reinstalled.
  try {
    check("set-autostart").checked = await invoke<boolean>("get_autostart");
  } catch {
    check("set-autostart").checked = s.autostart;
  }

  // Every input persists + broadcasts on change. Autostart additionally flips the
  // OS login item before saving.
  const live = [
    "set-cat",
    "set-fur-color",
    "set-pattern",
    "set-react-hunt",
    "set-react-pet",
    "set-react-keyboard",
    "set-react-scroll",
    "set-react-agent",
    "set-sound-on",
    "set-energy",
    "set-ambient-play",
    "set-ambient-daynight",
    "set-ambient-idle",
    "set-focus",
    "set-short",
    "set-long",
    "set-sessions",
    "set-stretch-on",
    "set-stretch-int",
  ];
  for (const id of live) el(id).addEventListener("change", () => void apply());

  check("set-autostart").addEventListener("change", async () => {
    const enabled = check("set-autostart").checked;
    try {
      await invoke("set_autostart", { enabled });
    } catch {
      status("Autostart unavailable on this system");
    }
    await apply();
  });

  el("settings-done").addEventListener("click", () => {
    void getCurrentWindow().close();
  });
}

main().catch((err) => {
  console.error("[kitto] settings init failed", err);
});
