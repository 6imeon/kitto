//! On-disk reminder store — MA-2 (KITTO_AMBIENT B2: "Persisted to ~/.kitto/ …
//! survive restart"; "separate file, e.g. reminders.json").
//!
//! Deliberately identical in shape to `config` (settings.json): the Rust core only
//! moves bytes to/from `~/.kitto/reminders.json`, and the frontend owns the schema +
//! validation (`reminders/model.ts` `normalizeReminders`). `load_reminders` returns
//! the raw JSON string (empty string when the file is absent — the frontend then
//! starts with no reminders); `save_reminders` writes the string the frontend
//! serialized. A missing file is not an error; any real IO error surfaces as a string.

use std::path::PathBuf;

use tauri::{AppHandle, Manager};

const DIR: &str = ".kitto";
const FILE: &str = "reminders.json";

/// Resolve `~/.kitto/reminders.json` (home dir is the only thing that can fail).
fn reminders_path(app: &AppHandle) -> Result<PathBuf, String> {
    let home = app
        .path()
        .home_dir()
        .map_err(|e| format!("could not resolve home dir: {e}"))?;
    Ok(home.join(DIR).join(FILE))
}

/// Read the persisted reminders JSON. A missing file yields `""` (not an error) so a
/// first run cleanly starts with an empty list.
#[tauri::command]
pub fn load_reminders(app: AppHandle) -> Result<String, String> {
    let path = reminders_path(&app)?;
    match std::fs::read_to_string(&path) {
        Ok(contents) => Ok(contents),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(format!("could not read {path:?}: {e}")),
    }
}

/// Persist the reminders JSON (creating `~/.kitto` if needed). The frontend has
/// already validated + serialized it; we only write bytes.
#[tauri::command]
pub fn save_reminders(app: AppHandle, json: String) -> Result<(), String> {
    let path = reminders_path(&app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("could not create {dir:?}: {e}"))?;
    }
    std::fs::write(&path, json).map_err(|e| format!("could not write {path:?}: {e}"))
}
