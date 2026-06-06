//! AI-agent watcher — the differentiator (KITTO_SPEC §6).
//!
//! A small set of adapters behind one normalized status enum (`Working | Done | Idle`):
//! Claude Code hooks first (the cleanest, precise signals via its hooks system), then
//! any other tool by writing the same normalized status file. New adapters are added
//! by dropping in a writer (config/script), not by editing core code.
//!
//! M5 implements the listener: `watcher` watches `~/.kitto/agent-status` and emits
//! `kitto://agent` to the webview, which maps `working → Think` and `done → Jump`.

pub mod watcher;
