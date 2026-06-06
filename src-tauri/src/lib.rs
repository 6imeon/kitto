//! Kitto Rust core — the "sensors" half of the architecture (KITTO_SPEC §2, §3).
//! M0 set up the frameless, transparent, always-on-top overlay window; M2 added
//! the global cursor-position stream; M3 added the global keyboard hook
//! (`device_query`) and a macOS scroll-only event tap feeding the webview's
//! Type/Overheat/Scroll reactions; M5 adds the AI-agent watcher (the
//! differentiator) — a `notify` file-watch on `~/.kitto/agent-status` feeding the
//! webview's Think/Jump reactions.

mod agents;
mod autostart;
mod config;
mod reminders;
mod sensors;
mod window;

/// Application entry point, shared by the desktop binary and (future) mobile.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Autostart-on-login (M6). The macOS launcher uses a LaunchAgent; no extra
        // launch args. The settings window toggles it via the wrapper commands.
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .invoke_handler(tauri::generate_handler![
            config::load_config,
            config::save_config,
            reminders::load_reminders,
            reminders::save_reminders,
            autostart::set_autostart,
            autostart::get_autostart,
            window::open_settings,
        ])
        .setup(|app| {
            window::configure(app)?;
            sensors::cursor::spawn(app.handle());
            sensors::input::spawn(app.handle());
            sensors::scroll::spawn(app.handle());
            agents::watcher::spawn(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Kitto");
}
