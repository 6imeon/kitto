# Kitto — Build Specification

> A desktop pet: a tiny animated pixel cat that lives in an always-on-top overlay, follows the cursor, reacts to typing/scrolling, runs stretch + Pomodoro timers, and — the differentiator — reacts to the working state of local AI coding agents (Claude Code, Codex, Cursor, etc.).
>
> This document is the source of truth. Build it in the milestone order below. Do not skip ahead — each milestone has acceptance criteria that must pass before moving on. Ask me before introducing a dependency not listed here or making an architectural change that contradicts this doc.

---

## 1. Product summary

Kitto is a cross-platform (macOS + Windows) desktop mascot. It renders a small pixel cat in a frameless, transparent, always-on-top window that is click-through when idle and interactive on hover/drag. The cat is driven by a sprite-animation state machine fed by global input streams (mouse, keyboard, scroll), timers, and an AI-agent status watcher.

Inspirations / prior art to study but not copy: `oneko`/Neko, Shimeji, eSheep, Desktop Goose. The defensible novelty is the AI-agent reactions, so that subsystem deserves the most care.

Non-goals (for v1): mobile, Linux, multiplayer, cloud sync, telemetry of any kind.

---

## 2. Tech stack (decided)

- **Framework:** Tauri 2.x (Rust core + system webview frontend). Chosen for tiny footprint — a mascot must not idle at 150MB RAM.
- **Frontend:** TypeScript + Vite. Rendering via HTML5 `<canvas>` (2D context is sufficient for pixel sprites; reach for WebGL only if perf demands it).
- **Rust crates:**
  - `rdev` (or `device_query` if `rdev` proves flaky on a target OS) for global mouse/keyboard/scroll hooks.
  - `tauri` + `tauri-plugin-positioner` for window placement.
  - `notify` for file-watching (used by the AI-agent watcher).
  - `serde` / `serde_json` for IPC payloads and config.
- **State/IPC:** Rust owns global input + AI status; emits Tauri events to the webview. The webview owns the animation state machine and rendering. Keep the boundary clean: Rust = sensors, webview = brain + display.

If you believe a different stack materially beats this for a specific milestone, stop and propose it with reasoning before building.

---

## 3. Architecture

```
┌─────────────────────────── Rust core (sensors) ───────────────────────────┐
│  global mouse hook ─┐                                                       │
│  global kbd hook ───┤── normalize ──► event bus ──► emit Tauri events ──────┼──┐
│  global scroll hook ┘                                                       │  │
│  timers (stretch / pomodoro)                                                │  │
│  AI-agent watcher (hooks socket + file/process watch)                       │  │
│  window mgr (always-on-top, click-through toggle, drag)                     │  │
└─────────────────────────────────────────────────────────────────────────────┘  │
                                                                                   │ Tauri events
┌─────────────────────────── Webview (brain + display) ──────────────────────────┘
│  input reducer ──► CatStateMachine ──► AnimationController ──► canvas renderer    │
│  sprite atlas + recolor layer (custom fur)                                        │
│  config store (JSON on disk via Tauri fs)                                         │
└───────────────────────────────────────────────────────────────────────────────┘
```

**CatStateMachine** is the heart. States (non-exhaustive): `Idle`, `Sleep`, `Walk`, `FollowEyes`, `Hunt`, `Pet`, `Type`, `Overheat`, `Scroll`, `Drag`, `Stretch`, `Think`, `Jump`, `Pomodoro`. Transitions are driven by incoming events with priorities (e.g. `Drag` overrides everything; `Overheat` overrides `Type`; AI `Think`/`Jump` interrupt idle states). Define transitions declaratively in one place.

---

## 4. Features → mechanisms

| Feature | Driven by | Notes |
|---|---|---|
| Eye follow | global cursor position | poll/throttle ~60Hz, cap |
| Mouse hunt | cursor velocity over threshold | cat chases cursor |
| Purring pet | cursor hovering over cat sprite | needs hit-test in window |
| Mochi drag / shake | window drag + drag velocity | squash-stretch + wiggle |
| Keyboard kneading | global keydown rate | paws tap |
| Overheat mode | keydown rate over threshold | turns red + steam |
| Paper unroll | global scroll events | |
| Stretch reminder | interval timer | cat grows + stretches |
| Pomodoro | focus/break state machine | floating pixel timer |
| Custom fur | recolor layer over sprite atlas | palette-swap, see §7 |
| Think-along | AI agent = working | thinking face |
| Agent-done jump | AI agent = finished | happy hop + optional sound |

---

## 5. Milestones (build in this order)

### M0 — Skeleton
- Tauri 2 app scaffolded, runs on macOS and Windows.
- Frameless, transparent, always-on-top window showing a single static sprite at fixed size.
- Repo conventions in place (§8), `README.md`, basic CI that builds both targets.
- **Acceptance:** window floats above all apps, transparent background, no chrome, draggable.

### M1 — Animation engine
- Sprite atlas loader + frame-based `AnimationController` on canvas.
- `CatStateMachine` with `Idle`, `Sleep`, `Walk` and clean transitions.
- Idle → Sleep after inactivity; Sleep → Idle on activity.
- **Acceptance:** smooth looping animations, no frame tearing, deterministic transitions covered by unit tests on the state machine.

### M2 — Cursor reactions
- Rust global cursor position stream → webview.
- `FollowEyes`, `Hunt`, `Pet` states wired up with hit-testing on the cat.
- **Acceptance:** eyes track cursor; fast movement triggers hunt; hovering cat triggers pet.

### M3 — Keyboard + scroll (the permissions gauntlet)
- Rust global keyboard + scroll hooks via `rdev`.
- `Type`, `Overheat` (rate threshold), `Scroll` states.
- **macOS:** request Accessibility / Input Monitoring; app must be code-signed + notarized or the OS silently drops events. Document the exact Info.plist keys and the user-facing permission flow.
- **Windows:** `WH_KEYBOARD_LL` / `WH_MOUSE_LL` behavior verified; confirm no AV false-positive on an unsigned dev build and note the signing requirement.
- **Acceptance:** typing in *other* apps animates the cat; sustained fast typing triggers overheat; scrolling triggers paper unroll. Permission denial degrades gracefully (cat still works, just without these reactions) with a clear prompt to enable.

### M4 — Timers
- Stretch reminder (configurable interval) → `Stretch` state.
- Pomodoro focus/break loop with floating pixel timer overlay.
- **Acceptance:** timers fire reliably across sleep/wake; UI to set intervals.

### M5 — AI-agent watcher (the differentiator — see §6)
- Local listener (socket or watched file) that accepts agent status signals: `working` / `done` / `idle`.
- Claude Code integration via its hooks system first; then a generic process/output watcher for tools without hooks.
- `Think` and `Jump` states.
- **Acceptance:** running a Claude Code task flips the cat to thinking; task completion triggers the jump. Watcher fails safe (no crash) when no agent is present.

### M6 — Customization
- Custom fur color + pattern via palette-swap recolor layer.
- Settings window: timers, reaction toggles, fur, autostart-on-login.
- Config persisted as JSON on disk.
- **Acceptance:** changes apply live and survive restart.

### M7 — Packaging & licensing (do last)
- macOS: code-sign + notarize + DMG. Windows: code-sign + installer.
- Licensing via Lemon Squeezy (merchant-of-record, handles UK VAT): paid key → in-app validation against their license API → unlock. Keep a clean "enter license key" gate; cache validation offline with periodic re-check.
- **Acceptance:** clean install on a fresh machine of each OS launches without Gatekeeper/SmartScreen blocking; license gate works.

---

## 6. AI-agent watcher — detail

There is no single cross-tool API. Build it as a small set of adapters behind one normalized status enum (`Working | Done | Idle`):

1. **Claude Code (do first, cleanest):** Claude Code supports hooks (`PreToolUse`, `PostToolUse`, `Stop`, `Notification`, etc.). Ship a tiny shell snippet the user adds to their Claude Code settings that POSTs the event to Kitto's local listener (a localhost socket or by touching a watched status file). This gives precise, reliable `working`/`done` signals with no scraping.
2. **Generic adapter (for Codex / Cursor / Antigravity / Kiro):** fall back to watching process state and/or tailing known output for working/done patterns. Treat each tool's patterns as config so they can be updated without a rebuild. Expect to maintain these — output formats drift.

Design the listener so third parties (or future me) can add adapters by dropping in a config entry, not editing core code.

---

## 7. Sprite + recolor pipeline

- Author states as sprite-sheet atlases (PNG) with a JSON frame map (frame rects + durations per state).
- Custom fur = palette swap: author the base cat with a small indexed palette; recolor by remapping palette indices to user-chosen colors at load time onto an offscreen canvas. Keep "pattern" as a separate overlay mask layer.
- Keep a single `assets/manifest.json` describing all atlases so adding a state is data, not code.
- Placeholder art is fine for M1–M5; real pixel art can land before M6.

---

## 8. Conventions

- **Structure:**
  ```
  /src-tauri        Rust core (sensors, window mgr, AI watcher, IPC)
    /src
      /sensors      input hooks, timers
      /agents       AI-agent adapters
      /window       always-on-top / click-through / drag
  /src              TypeScript frontend
    /state          CatStateMachine + transitions (pure, testable)
    /render         canvas renderer + AnimationController
    /sprites        atlas loader + recolor
    /config         persisted settings
    /ipc            Tauri event bindings
  /assets           sprite atlases + manifest.json
  ```
- **State machine is pure and unit-tested** — no rendering or IO inside it; it takes events, returns state. This is the most important testability rule.
- TypeScript strict mode on. Rust: `clippy` clean, no `unwrap()` in non-test code.
- Conventional Commits. Small PRs per milestone.
- No telemetry, ever. No network calls except the Lemon Squeezy license check in M7.
- Throttle all global-input handlers; never block the input thread.

---

## 9. Open questions to raise with me before/while building

- Confirm minimum supported OS versions (macOS / Windows).
- Sound effects in v1, or silent?
- Sprite art: am I supplying it, or do you generate placeholder pixel art?
- Single cat in v1 (the site sells "one cat") — confirm no multi-cat scope creep.

---

## 10. First task for the agent

Start **M0** only. Scaffold the Tauri 2 app, get the transparent always-on-top draggable window with a static placeholder sprite running on this machine, set up the repo structure in §8, and report back with how to run it before touching M1.
