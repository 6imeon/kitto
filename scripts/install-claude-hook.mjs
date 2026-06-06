// Install (or remove) the Kitto ↔ Claude Code integration — M5 (KITTO_SPEC §6).
//
// Claude Code has a hooks system; this wires its lifecycle events to Kitto's
// normalized status file so the cat reacts to your agent:
//
//     UserPromptSubmit / PreToolUse / PostToolUse  →  working   (cat = Think)
//     Stop                                          →  done      (cat = Jump)
//     Notification                                  →  idle
//
// Each hook just runs a tiny writer script that drops a bare status token into
// `~/.kitto/agent-status`, which the Kitto Rust core watches (see
// `src-tauri/src/agents/watcher.rs`). No socket, no port, no permission prompt.
//
// Pure Node, no dependencies (like `scripts/gen-placeholder-art.mjs`). Idempotent:
// re-running replaces Kitto's hooks rather than duplicating them, and it backs up
// your existing settings first. Usage:
//
//     pnpm hook:install      # patch ~/.claude/settings.json + write the helper
//     pnpm hook:uninstall    # remove Kitto's hooks + helper
//     node scripts/install-claude-hook.mjs --print   # show what it would add; no writes

import { homedir, platform } from "node:os";
import { join } from "node:path";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  copyFileSync,
  chmodSync,
  rmSync,
} from "node:fs";

const HOME = homedir();
const IS_WIN = platform() === "win32";

const KITTO_DIR = join(HOME, ".kitto");
const HELPER = join(KITTO_DIR, IS_WIN ? "kitto-hook.cmd" : "kitto-hook.sh");
const CLAUDE_DIR = join(HOME, ".claude");
const SETTINGS = join(CLAUDE_DIR, "settings.json");

// Substring that marks a hook command as ours, for idempotent re-install / uninstall.
const MARKER = "kitto-hook";

// Claude hook event → the status token its command writes.
const EVENT_STATUS = {
  UserPromptSubmit: "working",
  PreToolUse: "working",
  PostToolUse: "working",
  Stop: "done",
  Notification: "idle",
};
// These events fan out per tool; Claude wants a matcher. The others are global.
const MATCHED_EVENTS = new Set(["PreToolUse", "PostToolUse"]);

/** The shell command a hook runs: invoke our writer helper with the status token. */
function hookCommand(status) {
  return IS_WIN ? `"${HELPER}" ${status}` : `sh "${HELPER}" ${status}`;
}

/** The writer helper script body — drops a bare token into the status file. */
function helperBody() {
  if (IS_WIN) {
    // `<nul set /p` writes without a trailing newline; the watcher trims anyway.
    return `@echo off\r\n<nul set /p=%~1>"${join(KITTO_DIR, "agent-status")}"\r\n`;
  }
  return `#!/bin/sh\n# ${MARKER}: written by Kitto's installer (KITTO_SPEC §6).\nprintf '%s' "$1" > "${join(KITTO_DIR, "agent-status")}"\n`;
}

/** Is this hook *group* one of ours? (Any command in it carries the marker.) */
function isKittoGroup(group) {
  return Array.isArray(group?.hooks) && group.hooks.some((h) => typeof h?.command === "string" && h.command.includes(MARKER));
}

/** Build the hook group Kitto adds for one event. */
function kittoGroup(event) {
  const group = { hooks: [{ type: "command", command: hookCommand(EVENT_STATUS[event]) }] };
  if (MATCHED_EVENTS.has(event)) group.matcher = "*";
  return group;
}

/** Read settings.json as an object, or {} if absent. Aborts on malformed JSON. */
function readSettings() {
  if (!existsSync(SETTINGS)) return {};
  const text = readFileSync(SETTINGS, "utf8").trim();
  if (text === "") return {};
  try {
    return JSON.parse(text);
  } catch (err) {
    console.error(`✗ ${SETTINGS} is not valid JSON — not touching it.\n  ${err.message}`);
    process.exit(1);
  }
}

/** Strip every Kitto-installed hook group, dropping now-empty event arrays. */
function stripKitto(hooks) {
  const out = {};
  for (const [event, groups] of Object.entries(hooks ?? {})) {
    if (!Array.isArray(groups)) {
      out[event] = groups;
      continue;
    }
    const kept = groups.filter((g) => !isKittoGroup(g));
    if (kept.length > 0) out[event] = kept;
  }
  return out;
}

function writeSettings(settings) {
  mkdirSync(CLAUDE_DIR, { recursive: true });
  if (existsSync(SETTINGS)) copyFileSync(SETTINGS, `${SETTINGS}.bak`);
  writeFileSync(SETTINGS, `${JSON.stringify(settings, null, 2)}\n`);
}

function printPlan() {
  const hooks = {};
  for (const event of Object.keys(EVENT_STATUS)) hooks[event] = [kittoGroup(event)];
  console.log("Hooks Kitto would add to ~/.claude/settings.json:\n");
  console.log(JSON.stringify({ hooks }, null, 2));
  console.log(`\nWriter helper: ${HELPER}`);
}

function install() {
  // 1. The status dir + writer helper.
  mkdirSync(KITTO_DIR, { recursive: true });
  writeFileSync(HELPER, helperBody());
  if (!IS_WIN) chmodSync(HELPER, 0o755);

  // 2. Patch settings.json: drop any prior Kitto hooks, then add fresh ones.
  const settings = readSettings();
  const hooks = stripKitto(settings.hooks);
  for (const event of Object.keys(EVENT_STATUS)) {
    hooks[event] = [...(hooks[event] ?? []), kittoGroup(event)];
  }
  settings.hooks = hooks;
  writeSettings(settings);

  console.log("✓ Kitto ↔ Claude Code hooks installed.");
  console.log(`  • writer helper:  ${HELPER}`);
  console.log(`  • status file:    ${join(KITTO_DIR, "agent-status")}`);
  console.log(`  • patched:        ${SETTINGS} (backup at settings.json.bak)`);
  console.log("\nStart a Claude Code task: the cat thinks while it works and hops when it finishes.");
  console.log("Restart any running Claude Code session to pick up the new hooks.");
}

function uninstall() {
  const settings = readSettings();
  settings.hooks = stripKitto(settings.hooks);
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
  writeSettings(settings);
  if (existsSync(HELPER)) rmSync(HELPER);
  console.log("✓ Kitto's Claude Code hooks + writer helper removed.");
  console.log(`  (Left ${join(KITTO_DIR, "agent-status")} in place; delete ~/.kitto to fully clean up.)`);
}

const arg = process.argv[2];
if (arg === "--print") printPlan();
else if (arg === "--uninstall") uninstall();
else install();
