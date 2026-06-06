// Keyboard + scroll IPC bindings (KITTO_SPEC §3 — Rust sensors → webview brain).
//
// The Rust core taps global input (every app) via `rdev` and emits three events.
// This module is the thin typed bridge; the Cat derives typing *rate* and scroll
// activity from the raw stream (Rust stays a dumb sensor). See sensors/input.rs.

import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** Must match the `*_EVENT` constants in `sensors::input` on the Rust side. */
const KEY_EVENT = "kitto://key";
const SCROLL_EVENT = "kitto://scroll";
const PERMISSION_EVENT = "kitto://input-permission";

/** Coalesced wheel delta since the last emit (window-agnostic; sign = direction). */
export interface ScrollSample {
  dx: number;
  dy: number;
}

/** Subscribe to global key presses (one callback per keystroke, any app). */
export function onKey(handler: () => void): Promise<UnlistenFn> {
  return listen<null>(KEY_EVENT, () => handler());
}

/** Subscribe to global scroll deltas (already throttled to ~60Hz in Rust). */
export function onScroll(
  handler: (sample: ScrollSample) => void,
): Promise<UnlistenFn> {
  return listen<ScrollSample>(SCROLL_EVENT, (event) => handler(event.payload));
}

/**
 * Subscribe to input-permission status. Rust emits `{ granted: false }` when the
 * global hook could not be installed (on macOS, Accessibility / Input Monitoring
 * not granted) so the webview can prompt the user. The cat keeps working without
 * keyboard/scroll reactions until it is enabled.
 */
export function onInputPermission(
  handler: (granted: boolean) => void,
): Promise<UnlistenFn> {
  return listen<{ granted: boolean }>(PERMISSION_EVENT, (event) =>
    handler(event.payload.granted),
  );
}
