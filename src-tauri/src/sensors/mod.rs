//! Global input sensors (mouse / keyboard / scroll) and timers.
//!
//! These normalize OS-level input into Tauri events for the webview brain.
//! M2 added the cursor-position stream (`cursor`); M3 adds the global keyboard
//! hook (`input`, via `device_query` — `rdev` crashed on macOS, see that module)
//! and the global scroll hook (`scroll`, a macOS scroll-only `CGEventTap`); timers
//! land in M4. Rust = sensors, webview = brain + display.

pub mod cursor;
pub mod input;
pub mod scroll;
