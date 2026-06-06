// Cursor-stream IPC binding (KITTO_SPEC §3 — Rust sensors → webview brain).
//
// The Rust core polls the global cursor and emits `kitto://cursor` with the
// position already converted to window-local logical pixels (the webview's DOM
// coordinate space). This module is the thin typed bridge; the Cat does the rest.

import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** Must match `sensors::cursor::CURSOR_EVENT` on the Rust side. */
const CURSOR_EVENT = "kitto://cursor";

/** Window-local cursor position in logical (CSS) pixels. */
export interface CursorSample {
  x: number;
  y: number;
}

/**
 * Subscribe to the cursor stream. Returns a promise resolving to an unlisten
 * function. Each sample is window-local logical px; values may be negative or
 * exceed the window bounds when the cursor is off the cat (so the eyes can still
 * track it across the whole screen).
 */
export function onCursor(
  handler: (sample: CursorSample) => void,
): Promise<UnlistenFn> {
  return listen<CursorSample>(CURSOR_EVENT, (event) => handler(event.payload));
}
