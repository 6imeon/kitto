//! Window management: always-on-top overlay, click-through toggle, drag.
//!
//! Most static window properties (transparent, no decorations, always-on-top,
//! skip-taskbar) are declared in `tauri.conf.json`. This module owns the
//! behaviour that must be set or toggled at runtime. M0 re-asserts always-on-top;
//! M2 starts the window click-through so clicks pass to the apps underneath —
//! the webview flips it back interactive (via `set_ignore_cursor_events`) only
//! while the cursor is actually over the cat, using the cursor-stream hit-test.
//!
//! MA-0 (ambient layer): the overlay is no longer a small centred box. To let the
//! cat roam — walk the edges, nap in a corner, trot to centre for a reminder — the
//! window is resized at startup to **fill the primary monitor** (Option B in
//! KITTO_AMBIENT.md §1). The cat is a sprite positioned *within* this fullscreen
//! transparent layer; click-through stays the default and the webview makes only
//! the cat's live bounds interactive. Primary display only for v1.

use tauri::{App, AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// Open (or focus, if already open) the settings window — M6 (KITTO_SPEC §5: the
/// full "Settings window"). It is a normal, decorated, resizable window (the
/// opposite of the frameless overlay): the always-on-top cat floats above it, so
/// fur/reaction edits preview live on the real cat while you change them. Created
/// lazily from Rust so the webview needs no window-creation capability.
#[tauri::command]
pub fn open_settings(app: AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window("settings") {
        existing.show().map_err(|e| e.to_string())?;
        existing.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    WebviewWindowBuilder::new(&app, "settings", WebviewUrl::App("settings.html".into()))
        .title("Kitto Settings")
        .inner_size(420.0, 560.0)
        .min_inner_size(380.0, 420.0)
        .resizable(true)
        .center()
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Configure the main overlay window at startup.
pub fn configure(app: &App) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        // MA-0: grow the overlay to cover the whole primary monitor so the cat can
        // be positioned anywhere on screen. Both values are physical pixels; the
        // monitor's origin handles a non-(0,0) primary display. If the monitor
        // can't be read (rare, early startup), we leave the config-declared size —
        // the cat still works, just confined to that box.
        if let Some(monitor) = window.primary_monitor()? {
            window.set_position(*monitor.position())?;
            window.set_size(*monitor.size())?;
        }
        // Re-assert always-on-top in code so it survives focus changes on all
        // platforms, not just the initial config value.
        window.set_always_on_top(true)?;
        // Begin click-through: a fullscreen transparent overlay must stay
        // pass-through everywhere by default, or the desktop becomes unclickable.
        // The webview re-enables cursor events only while the cursor is over the
        // cat's live (moving) bounds — the M2 hit-test, now driven by a moving box.
        window.set_ignore_cursor_events(true)?;
        // Declared hidden in tauri.conf.json to avoid a visible resize flash; reveal
        // it now that it's sized and positioned to fill the screen.
        window.show()?;
    }
    Ok(())
}
