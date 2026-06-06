//! On-disk config store — M6 (KITTO_SPEC §3: "config store (JSON on disk via
//! Tauri fs)"; §5 M6: "Config persisted as JSON on disk").
//!
//! This is the single source of truth for settings, shared by the overlay window
//! and the separate settings window. It lives at `~/.kitto/settings.json` — the
//! same `~/.kitto` directory the agent watcher already owns — so no new crate is
//! needed: `std::fs` over a path we resolve from the home dir.
//!
//! Validation/clamping deliberately stays in the frontend (`config/settings.ts`,
//! `normalize()`) so there is exactly one place that knows the schema and ranges.
//! These commands just move bytes: `load_config` returns the raw JSON string (an
//! empty string when the file is absent — the frontend then falls back to
//! defaults), `save_config` writes the string the frontend serialized.
//!
//! Fail-safe: a missing file is not an error (returns ""); any real IO error is
//! surfaced to the caller as a string so the webview can log it without crashing.

use std::path::PathBuf;

use tauri::{AppHandle, Manager};

const DIR: &str = ".kitto";
const FILE: &str = "settings.json";

/// Resolve `~/.kitto/settings.json` (home dir is the only thing that can fail).
fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let home = app
        .path()
        .home_dir()
        .map_err(|e| format!("could not resolve home dir: {e}"))?;
    Ok(home.join(DIR).join(FILE))
}

/// Read the persisted settings JSON. A missing file yields `""` (not an error) so
/// a first run cleanly falls back to the frontend defaults.
#[tauri::command]
pub fn load_config(app: AppHandle) -> Result<String, String> {
    let path = config_path(&app)?;
    match std::fs::read_to_string(&path) {
        Ok(contents) => Ok(contents),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(format!("could not read {path:?}: {e}")),
    }
}

/// Persist the settings JSON (creating `~/.kitto` if needed). The frontend has
/// already validated + serialized it; we only write bytes.
#[tauri::command]
pub fn save_config(app: AppHandle, json: String) -> Result<(), String> {
    let path = config_path(&app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("could not create {dir:?}: {e}"))?;
    }
    std::fs::write(&path, json).map_err(|e| format!("could not write {path:?}: {e}"))
}
