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
//!
//! Fitting the overlay *once* at startup isn't enough: changing the display
//! resolution (macOS "More Space" / "Larger Text") while Kitto runs resizes the
//! desktop but not our window, so the overlay stops covering the screen and the
//! cat's corners — computed from `window.innerWidth/innerHeight` — land mid-screen.
//! `spawn` runs a tiny watcher that re-fits the window whenever the primary
//! monitor's geometry changes, keeping the cat's edges glued to the real screen
//! edges at any resolution. The re-fit fires the webview's `resize`, so the
//! Director recomputes corners with no frontend involvement.

use std::thread;
use std::time::Duration;

use tauri::{
    App, AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

/// Primary-monitor geometry in physical pixels: `(x, y, width, height)`. The
/// origin (x, y) handles a non-(0,0) primary display; size drives the overlay fit.
type Geometry = (i32, i32, u32, u32);

/// How often the re-fit watcher re-checks the primary monitor. Display changes are
/// rare and user-initiated, so a 1s cadence snaps the overlay back imperceptibly
/// fast while costing one cheap monitor query per second.
const REFIT_POLL: Duration = Duration::from_secs(1);

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
        // be positioned anywhere on screen. If the monitor can't be read (rare,
        // early startup), we leave the config-declared size — the cat still works,
        // just confined to that box, and `spawn`'s watcher fits it on its first tick.
        if let Some(geom) = primary_geometry(&window)? {
            fit_to_geometry(&window, geom)?;
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

/// Spawn the re-fit watcher: a background thread that keeps the overlay glued to the
/// primary monitor across resolution / scale / display-arrangement changes. Mirrors
/// the sensor threads (e.g. `sensors::cursor::spawn`) — returns immediately and lives
/// for the app's lifetime. It re-fits *only* when the monitor's reported geometry
/// actually changes, so a stable display costs nothing past the first read.
pub fn spawn(app: &AppHandle) {
    let handle = app.clone();
    thread::spawn(move || {
        // Last geometry we applied. `None` until the first read, so we fit once on the
        // first tick (idempotent with `configure`, and a safety net if `configure`
        // couldn't read the monitor at early startup).
        let mut applied: Option<Geometry> = None;
        loop {
            thread::sleep(REFIT_POLL);

            // Window may not exist yet (early startup) or may have gone (shutdown);
            // either way, just skip this tick.
            let Some(window) = handle.get_webview_window("main") else {
                continue;
            };
            let Ok(Some(geom)) = primary_geometry(&window) else {
                continue;
            };
            // Monitor unchanged since our last fit — nothing to do. Comparing against
            // the monitor (not the window) avoids thrash from any OS-side rounding of
            // the window frame (e.g. the menu bar / notch inset).
            if applied == Some(geom) {
                continue;
            }
            let _ = fit_to_geometry(&window, geom);
            applied = Some(geom);
        }
    });
}

/// Read the primary monitor's geometry in physical pixels, or `None` if it can't be
/// determined (no monitor reported — rare, early startup).
fn primary_geometry(window: &WebviewWindow) -> tauri::Result<Option<Geometry>> {
    Ok(window.primary_monitor()?.map(|m| {
        let pos = m.position();
        let size = m.size();
        (pos.x, pos.y, size.width, size.height)
    }))
}

/// Position and size the overlay to the given physical-pixel geometry.
fn fit_to_geometry(window: &WebviewWindow, geom: Geometry) -> tauri::Result<()> {
    let (x, y, w, h) = geom;
    window.set_position(PhysicalPosition::new(x, y))?;
    window.set_size(PhysicalSize::new(w, h))?;
    Ok(())
}
