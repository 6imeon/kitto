//! Global keyboard hook — M3, "the permissions gauntlet" (KITTO_SPEC §5).
//!
//! Emits `kitto://key` — one per key-down edge; the webview derives the typing
//! *rate* (Rust stays a dumb sensor, §3) and turns it into `Type` / `Overheat`.
//!
//! **macOS:** a `KeyDown`-only, listen-only `CGEventTap` that **counts** key-downs
//! and **never decodes** them. The decode is exactly what crashed `rdev` — its
//! off-thread `UCKeyTranslate` (a main-thread-only keyboard-layout call) aborted
//! the whole process on the first keystroke. We only need the rate, so we never
//! translate. A tap also sidesteps `device_query`, whose macOS backend gates on
//! *Accessibility* — a grant a dev build (a child of an IDE/terminal) does **not**
//! inherit even after the parent restarts. A tap instead needs *Input Monitoring*,
//! which macOS attributes to the launching app, so the dev build works once that
//! app is granted. Kept separate from the scroll tap so a missing grant on one
//! can't disable the other.
//!
//! **Other platforms:** `device_query` polling (Windows needs no grant).
//!
//! See `scroll.rs` for the sibling scroll tap.

use tauri::AppHandle;

pub const KEY_EVENT: &str = "kitto://key";
pub const PERMISSION_EVENT: &str = "kitto://input-permission";

#[cfg(target_os = "macos")]
pub fn spawn(app: &AppHandle) {
    use std::thread;

    use core_foundation::runloop::CFRunLoop;
    use core_graphics::event::{
        CGEventTap, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement, CGEventType,
        CallbackResult, EventField,
    };
    use serde::Serialize;
    use tauri::Emitter;

    #[derive(Clone, Copy, Serialize)]
    struct Permission {
        granted: bool,
    }

    let handle = app.clone();
    thread::spawn(move || {
        let installed = CGEventTap::with_enabled(
            CGEventTapLocation::Session,
            CGEventTapPlacement::HeadInsertEventTap,
            CGEventTapOptions::ListenOnly,
            vec![CGEventType::KeyDown],
            |_proxy, event_type, event| {
                if matches!(event_type, CGEventType::KeyDown) {
                    // Skip auto-repeat (held key) so it doesn't inflate the rate.
                    // We read ONLY the repeat flag — never translate the key — so
                    // there is no keyboard-layout call to crash on.
                    let repeat =
                        event.get_integer_value_field(EventField::KEYBOARD_EVENT_AUTOREPEAT);
                    if repeat == 0 {
                        let _ = handle.emit(KEY_EVENT, ());
                    }
                }
                CallbackResult::Keep
            },
            CFRunLoop::run_current,
        );
        if installed.is_err() {
            eprintln!(
                "[kitto] keyboard tap not installed — grant Input Monitoring (for a dev build, \
                 to the app that launched Kitto, e.g. your IDE/terminal) in System Settings → \
                 Privacy & Security, then relaunch. Typing reactions are off until then."
            );
            let _ = handle.emit(PERMISSION_EVENT, Permission { granted: false });
        }
    });
}

#[cfg(not(target_os = "macos"))]
pub fn spawn(app: &AppHandle) {
    use std::collections::HashSet;
    use std::thread;
    use std::time::Duration;

    use device_query::{DeviceQuery, DeviceState, Keycode};
    use tauri::Emitter;

    /// ~60Hz poll — fast enough to catch every keystroke of even very fast typing.
    const POLL_INTERVAL: Duration = Duration::from_millis(16);

    let handle = app.clone();
    thread::spawn(move || {
        let device = DeviceState::new();
        let mut prev: HashSet<Keycode> = HashSet::new();
        loop {
            thread::sleep(POLL_INTERVAL);
            let keys: HashSet<Keycode> = device.get_keys().into_iter().collect();
            // Emit only on the key-down edge (newly pressed since last poll).
            let new_presses = keys.difference(&prev).count();
            for _ in 0..new_presses {
                let _ = handle.emit(KEY_EVENT, ());
            }
            prev = keys;
        }
    });
}
