//! Global scroll hook — M3 (macOS).
//!
//! Keyboard moved to `device_query` because `rdev` crashed decoding keys off the
//! main thread (see `input.rs`). Scroll never touches the keyboard-layout API, so
//! a dedicated *scroll-only* `CGEventTap` is crash-safe: its event mask admits
//! only `ScrollWheel` events, so the listener never decodes a keystroke. We run it
//! on its own thread with its own `CFRunLoop` and emit `kitto://scroll { dx, dy }`
//! (throttled to ~60Hz; the webview coalesces further via its scroll window).
//!
//! Needs the same Accessibility / Input Monitoring grant as the keyboard hook; if
//! it's absent, `CGEventTapCreate` returns null, tap installation fails, and we
//! degrade silently — the keyboard hook already prompts the user. Global scroll on
//! Windows (`WH_MOUSE_LL`) is a later addition; this is a no-op there.

use tauri::AppHandle;

pub const SCROLL_EVENT: &str = "kitto://scroll";

#[cfg(target_os = "macos")]
pub fn spawn(app: &AppHandle) {
    use std::sync::Mutex;
    use std::thread;
    use std::time::{Duration, Instant};

    use core_foundation::runloop::CFRunLoop;
    use core_graphics::event::{
        CGEventTap, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement, CGEventType,
        CallbackResult, EventField,
    };
    use serde::Serialize;
    use tauri::Emitter;

    /// Coalesce wheel bursts (trackpad inertia) down to ~one emit per frame.
    const THROTTLE: Duration = Duration::from_millis(16);

    #[derive(Clone, Copy, Serialize)]
    struct ScrollSample {
        dx: i64,
        dy: i64,
    }

    let handle = app.clone();
    thread::spawn(move || {
        let last = Mutex::new(Instant::now());
        let installed = CGEventTap::with_enabled(
            // Session-level, listen-only: observe the user's scroll without
            // altering the event stream (passive taps aren't disabled on timeout).
            CGEventTapLocation::Session,
            CGEventTapPlacement::HeadInsertEventTap,
            CGEventTapOptions::ListenOnly,
            vec![CGEventType::ScrollWheel],
            |_proxy, event_type, event| {
                if matches!(event_type, CGEventType::ScrollWheel) {
                    let now = Instant::now();
                    let due = match last.lock() {
                        Ok(mut t) => {
                            let elapsed = now.duration_since(*t) >= THROTTLE;
                            if elapsed {
                                *t = now;
                            }
                            elapsed
                        }
                        Err(_) => true,
                    };
                    if due {
                        let dy = event
                            .get_integer_value_field(EventField::SCROLL_WHEEL_EVENT_DELTA_AXIS_1);
                        let dx = event
                            .get_integer_value_field(EventField::SCROLL_WHEEL_EVENT_DELTA_AXIS_2);
                        let _ = handle.emit(SCROLL_EVENT, ScrollSample { dx, dy });
                    }
                }
                CallbackResult::Keep
            },
            // Run this thread's loop forever so the tap keeps delivering events.
            CFRunLoop::run_current,
        );
        if installed.is_err() {
            eprintln!("[kitto] scroll tap not installed (input access?) — scroll reactions off.");
        }
    });
}

#[cfg(not(target_os = "macos"))]
pub fn spawn(_app: &AppHandle) {
    // Windows global scroll (WH_MOUSE_LL) is a later addition; no-op for now.
}
