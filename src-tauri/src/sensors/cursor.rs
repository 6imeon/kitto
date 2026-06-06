//! Global cursor-position stream (KITTO_SPEC §4 "Eye follow", M2).
//!
//! Rust owns the sensor; the webview owns the brain. We poll the desktop-global
//! cursor position at ~60Hz, convert it into coordinates **local to the overlay
//! window** (logical/CSS pixels, the space the webview's DOM uses), and emit it
//! as a `kitto://cursor` Tauri event. The webview then does eye-follow, hunt and
//! pet hit-testing against the cat sprite.
//!
//! Reading the cursor *position* (vs. tapping the input event stream) needs no
//! Accessibility permission on macOS — that gauntlet is M3's keyboard/scroll work.
//! We use only Tauri's built-in `cursor_position` / window geometry: no extra crate.

use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition};

/// Event name carrying the latest cursor sample to the webview.
pub const CURSOR_EVENT: &str = "kitto://cursor";

/// Active poll interval — ~60Hz while the cursor is moving, so eye-follow stays smooth.
const POLL_ACTIVE: Duration = Duration::from_millis(16);
/// Idle poll interval — ~10Hz once the cursor has been parked for a while. A still cursor
/// emits nothing anyway, so polling it 60×/s is pure wasted wake-ups; backing off cuts the
/// native-side idle cost with no felt latency (the first move snaps straight back to 60Hz).
const POLL_IDLE: Duration = Duration::from_millis(100);
/// Consecutive unchanged samples before we drop to the idle interval (~0.5s of stillness).
const IDLE_AFTER_STILL: u32 = 30;

/// Cursor position in window-local **logical** pixels (webview/DOM space).
/// `x`/`y` can be negative or exceed the window size when the cursor is off the
/// cat window — that is expected and lets the cat's eyes track across the screen.
#[derive(Clone, Copy, Serialize)]
struct CursorSample {
    x: f64,
    y: f64,
}

/// Spawn the background polling thread. Returns immediately; the thread lives for
/// the duration of the app. Emits only when the position changes, so a parked
/// cursor costs nothing downstream.
pub fn spawn(app: &AppHandle) {
    let handle = app.clone();
    thread::spawn(move || {
        let mut last: Option<CursorSample> = None;
        // How many consecutive ticks the cursor has held still. Once it crosses
        // IDLE_AFTER_STILL we sleep the longer POLL_IDLE; any movement resets it to 0
        // and we're back at POLL_ACTIVE on the very next tick.
        let mut still_ticks: u32 = 0;
        loop {
            let interval = if still_ticks >= IDLE_AFTER_STILL {
                POLL_IDLE
            } else {
                POLL_ACTIVE
            };
            thread::sleep(interval);

            // Window may not exist yet (early startup) or may have gone away
            // (shutdown). Either way, just skip this tick.
            let Some(window) = handle.get_webview_window("main") else {
                continue;
            };

            let Some(sample) = local_cursor(&handle, &window) else {
                continue;
            };

            // Skip sub-pixel jitter and unchanged samples — the webview derives
            // velocity from successive samples, so a flat line means "still".
            if let Some(prev) = last {
                if (prev.x - sample.x).abs() < 0.5 && (prev.y - sample.y).abs() < 0.5 {
                    still_ticks = still_ticks.saturating_add(1);
                    continue;
                }
            }
            still_ticks = 0; // moved — poll fast again
            last = Some(sample);

            // A failed emit (webview tearing down) is not worth crashing over.
            let _ = handle.emit(CURSOR_EVENT, sample);
        }
    });
}

/// Convert the desktop-global cursor position into window-local logical pixels.
/// Both `cursor_position` and `outer_position` are desktop-global physical
/// coordinates, so the delta divided by the scale factor is local logical space.
fn local_cursor(app: &AppHandle, window: &tauri::WebviewWindow) -> Option<CursorSample> {
    let cursor: PhysicalPosition<f64> = app.cursor_position().ok()?;
    let origin: PhysicalPosition<i32> = window.outer_position().ok()?;
    let scale = window.scale_factor().ok()?;
    if scale <= 0.0 {
        return None;
    }
    Some(CursorSample {
        x: (cursor.x - origin.x as f64) / scale,
        y: (cursor.y - origin.y as f64) / scale,
    })
}
