// AI-agent status IPC binding — M5, the differentiator (KITTO_SPEC §3, §6).
//
// The Rust core watches a small normalized status file (`~/.kitto/agent-status`,
// written by adapters such as the Claude Code hooks — see `agents/watcher.rs`) and
// emits `kitto://agent` whenever the status changes. This module is the thin typed
// bridge; the Cat maps the status to its Think (working) / Jump (done) reactions.
//
// The three statuses are the one normalized enum every adapter writes (KITTO_SPEC
// §6: "one normalized status enum `Working | Done | Idle`"), so any tool — Claude
// Code today, a Codex/Cursor wrapper tomorrow — integrates by writing the file, no
// core change required.

import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** Must match `agents::watcher::AGENT_EVENT` on the Rust side. */
const AGENT_EVENT = "kitto://agent";

/** The normalized agent status (KITTO_SPEC §6). Lowercase to match the file token. */
export type AgentStatus = "working" | "done" | "idle";

/**
 * Subscribe to the AI-agent status stream. Fires once per status *change* (the
 * watcher de-dupes), so a `done` is a single celebratory pulse. Returns a promise
 * resolving to an unlisten function. If no agent is ever present, this simply
 * never fires — the cat behaves exactly as it did before M5 (fail-safe, §5).
 */
export function onAgent(handler: (status: AgentStatus) => void): Promise<UnlistenFn> {
  return listen<{ status: AgentStatus }>(AGENT_EVENT, (event) => handler(event.payload.status));
}
