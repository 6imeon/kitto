// Reminder persistence — MA-2 (KITTO_AMBIENT B2: "Persisted to ~/.kitto/ … so they
// survive restart").
//
// Mirrors config/settings.ts exactly: the Rust core owns the bytes
// (`load_reminders` / `save_reminders` over `~/.kitto/reminders.json`, a separate
// file from settings.json) and the frontend owns the schema + validation
// (model.ts `normalizeReminders`). Both ends are fail-safe — a missing file, corrupt
// JSON, or no Tauri host (tests) falls back to an empty list and a save that fails is
// swallowed, so reminders persistence can never crash the overlay.

import { invoke } from "@tauri-apps/api/core";
import { normalizeReminders, type Reminder } from "./model";

/** Load + normalize the reminder list from disk. Never throws. */
export async function loadReminders(): Promise<Reminder[]> {
  try {
    const raw = await invoke<string>("load_reminders");
    if (!raw) return [];
    return normalizeReminders(JSON.parse(raw));
  } catch {
    return [];
  }
}

/** Persist the reminder list to disk. Best-effort; a write failure is swallowed. */
export async function saveReminders(list: readonly Reminder[]): Promise<void> {
  try {
    await invoke("save_reminders", { json: JSON.stringify(list) });
  } catch {
    // Disk/host unavailable — reminders simply won't persist this session.
  }
}
