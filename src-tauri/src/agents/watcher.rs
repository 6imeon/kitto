//! AI-agent status watcher — M5, the differentiator (KITTO_SPEC §6).
//!
//! There is no single cross-tool API for "is my coding agent working?", so we
//! normalize every adapter onto one status enum (`Working | Done | Idle`) written
//! to a single file: `~/.kitto/agent-status`. The file holds one bare lowercase
//! token. Any adapter — the Claude Code hooks today (see `scripts/`), a Codex or
//! Cursor wrapper tomorrow — integrates by writing that token; Kitto core never
//! changes. That *is* the "drop in an adapter, don't edit core" seam §6 asks for.
//!
//! We watch with `notify` (KITTO_SPEC §2) and emit `kitto://agent` to the webview,
//! which maps `working → Think` and `done → Jump`. We watch the *directory*, not
//! the file, because editors/atomic writes replace the inode (a file watch would
//! go stale); on any change we re-read the file and emit only when the parsed
//! status actually changes, so a `done` is a single celebratory pulse.
//!
//! Fail-safe (acceptance §5): if the home dir can't be resolved, the directory
//! can't be created, or the watcher can't install, we log and return — the cat
//! keeps working with no agent reactions. Nothing here can panic the app.

use std::path::PathBuf;
use std::sync::mpsc;
use std::thread;

use notify::{RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

/// Event name carrying the latest agent status to the webview.
pub const AGENT_EVENT: &str = "kitto://agent";

/// Directory and file under the user's home that adapters write the status to.
const STATUS_DIR: &str = ".kitto";
const STATUS_FILE: &str = "agent-status";

/// The one normalized agent status (KITTO_SPEC §6). Serializes to the lowercase
/// token the webview expects (`{ "status": "working" }`).
#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
enum Status {
    Working,
    Done,
    Idle,
}

#[derive(Clone, Copy, Serialize)]
struct AgentEvent {
    status: Status,
}

/// Parse the bare token an adapter writes into a status. Tolerant of surrounding
/// whitespace/newlines and case; unknown content yields `None` (ignored). Pure, so
/// it is unit-tested below without touching the filesystem.
fn parse_status(raw: &str) -> Option<Status> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "working" => Some(Status::Working),
        "done" => Some(Status::Done),
        "idle" => Some(Status::Idle),
        _ => None,
    }
}

/// Read + parse the current status file (absent/garbled ⇒ `None`).
fn read_status(file: &PathBuf) -> Option<Status> {
    let raw = std::fs::read_to_string(file).ok()?;
    parse_status(&raw)
}

/// Spawn the background watcher thread. Returns immediately; the thread lives for
/// the duration of the app. Fails safe — any setup error just disables agent
/// reactions (the cat is unaffected).
pub fn spawn(app: &AppHandle) {
    let handle = app.clone();
    thread::spawn(move || {
        let Ok(home) = handle.path().home_dir() else {
            eprintln!("[kitto] agent watcher: could not resolve home dir — agent reactions off.");
            return;
        };
        let dir = home.join(STATUS_DIR);
        let file = dir.join(STATUS_FILE);

        // Create the directory up front so the watch target exists even before any
        // agent has run (and so the first hook's write doesn't race dir creation).
        if let Err(err) = std::fs::create_dir_all(&dir) {
            eprintln!("[kitto] agent watcher: could not create {dir:?} ({err}) — agent reactions off.");
            return;
        }

        // Emit any status already on disk (an agent may already be mid-task at launch).
        let mut last = read_status(&file);
        if let Some(status) = last {
            let _ = handle.emit(AGENT_EVENT, AgentEvent { status });
        }

        let (tx, rx) = mpsc::channel();
        let mut watcher = match notify::recommended_watcher(move |res| {
            // Forward every filesystem event; we re-read + de-dupe below.
            let _ = tx.send(res);
        }) {
            Ok(w) => w,
            Err(err) => {
                eprintln!("[kitto] agent watcher: could not create watcher ({err}) — agent reactions off.");
                return;
            }
        };
        if let Err(err) = watcher.watch(&dir, RecursiveMode::NonRecursive) {
            eprintln!("[kitto] agent watcher: could not watch {dir:?} ({err}) — agent reactions off.");
            return;
        }

        // Block on filesystem events; `watcher` stays alive for the loop's scope.
        // We don't inspect event details — any change re-reads the file and emits
        // only on a real status change, which collapses the burst of events a
        // single write produces into one webview event.
        for res in rx {
            if res.is_err() {
                continue; // a transient watch error shouldn't kill the stream
            }
            let current = read_status(&file);
            if current != last {
                last = current;
                if let Some(status) = current {
                    let _ = handle.emit(AGENT_EVENT, AgentEvent { status });
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_three_normalized_tokens() {
        assert!(matches!(parse_status("working"), Some(Status::Working)));
        assert!(matches!(parse_status("done"), Some(Status::Done)));
        assert!(matches!(parse_status("idle"), Some(Status::Idle)));
    }

    #[test]
    fn tolerates_whitespace_newlines_and_case() {
        assert!(matches!(parse_status("  working\n"), Some(Status::Working)));
        assert!(matches!(parse_status("DONE"), Some(Status::Done)));
        assert!(matches!(parse_status("\tIdle  "), Some(Status::Idle)));
    }

    #[test]
    fn rejects_unknown_or_empty_content() {
        assert!(parse_status("").is_none());
        assert!(parse_status("thinking").is_none());
        assert!(parse_status("{\"status\":\"working\"}").is_none());
    }
}
