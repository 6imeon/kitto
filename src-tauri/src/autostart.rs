//! Autostart-on-login — M6 settings (KITTO_SPEC §5: "autostart-on-login").
//!
//! Thin command wrappers over `tauri-plugin-autostart`, which owns the
//! platform-specific mechanism (macOS LaunchAgent, Windows registry Run key). The
//! plugin itself is registered in `lib.rs`; the settings window calls these app
//! commands rather than the plugin commands directly, so no plugin ACL entry is
//! needed in the capabilities. The OS state is authoritative: the settings UI
//! reads `get_autostart` to show the real toggle, and `set_autostart` to change it.

use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

/// Enable or disable launching Kitto at login.
#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    let manager = app.autolaunch();
    let result = if enabled {
        manager.enable()
    } else {
        manager.disable()
    };
    result.map_err(|e| format!("could not update autostart: {e}"))
}

/// Whether Kitto is currently registered to launch at login (the OS truth).
#[tauri::command]
pub fn get_autostart(app: AppHandle) -> Result<bool, String> {
    app.autolaunch()
        .is_enabled()
        .map_err(|e| format!("could not read autostart state: {e}"))
}
