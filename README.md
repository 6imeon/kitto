# Kitto 🐈

A tiny animated pixel cat that lives in an always-on-top desktop overlay — it follows
your cursor, reacts to typing and scrolling, runs stretch + Pomodoro timers, and (the
differentiator) **reacts to the working state of your local AI coding agents** (Claude
Code today; Codex, Cursor, … by writing the same status file).

Cross-platform: macOS + Windows. Built with [Tauri 2](https://tauri.app) (tiny Rust core)
+ TypeScript/Vite, rendering pixel sprites to an HTML5 canvas.

> Full product spec and milestone plan live in [KITTO_SPEC.md](KITTO_SPEC.md) — the source of truth.

## Status

**M6 — Customization** ✅ (current)

A frameless, transparent, always-on-top, draggable window shows an **animated** pixel
cat that **reacts to your whole desktop**. From M2 it **tracks the cursor** with its eyes
(FollowEyes), **hunts** a fast flick, and **purrs** when hovered (Pet). M3 added global
keyboard + scroll reactions: **typing in any app** makes it tap along (Type), **furious
sustained typing** turns it red and steaming (Overheat), and **scrolling** triggers a
paper-unroll (Scroll). M4 added **timers**: a configurable **stretch reminder** (the cat
strikes a yawning Stretch), and a **Pomodoro** focus/break loop with a **floating pixel
timer** above the cat. M5 adds **the differentiator — it reacts to your local AI coding
agent**: while Claude Code is working the cat **thinks along** (Think — a thought bubble),
and when a task finishes it **hops for joy** (Jump) with an optional chime. M6 adds
**customization**: a **custom fur color** (live palette-swap recolor) + **patterns**
(tabby / tuxedo / calico), **per-reaction toggles**, and **autostart-on-login**, all in a
proper **settings window** (right-click the cat → **⚙ Settings…**) whose edits apply live
and persist to `~/.kitto/settings.json`. **Right-click the cat** also gives a small panel
with the one-click Pomodoro actions. Left alone it blinks, drifts to **sleep** after ~6s,
and **wakes** on any input. The Rust core streams the global cursor (M2), on macOS taps the
global keyboard and scroll (M3, count-only `CGEventTap`s), watches a normalized AI-agent
status file (M5, via `notify`), and owns the on-disk config + autostart (M6); the pure,
unit-tested state machine resolves every reaction from one priority ladder, and the timers
(also pure + tested) run on a wall-clock loop so they survive system sleep/wake. The overlay
is **click-through** except over the cat (or while a panel is open). Built instance-based so
multiple cats can be spawned (multi-cat is in v1 scope).

> **macOS:** the keyboard/scroll reactions need an OS permission — see
> [Permissions](#permissions-macos) below. The cat still runs without it; it just
> won't react to typing/scrolling until you enable it.

See the [milestone plan](KITTO_SPEC.md#5-milestones-build-in-this-order) for what comes
next (packaging & licensing).

## Download & install (macOS)

> **Apple Silicon (M1/M2/M3/M4) only.** Intel Macs are not supported by the current build.

1. Grab the latest **`Kitto_x.y.z_aarch64.dmg`** from the
   [**Releases**](../../releases/latest) page.
2. Open the `.dmg` and drag **Kitto** into **Applications**.
3. **First launch — clear the quarantine flag.** Kitto is *not* code-signed or notarized
   (no paid Apple Developer account), so macOS Gatekeeper will otherwise refuse to open it
   with *"Kitto is damaged and can't be opened."* That message is **not** a real problem —
   it just means the app is unsigned. Clear the flag once in Terminal:

   ```sh
   xattr -dr com.apple.quarantine /Applications/Kitto.app
   ```

   Then open Kitto normally from Applications. You only need to do this once per install.

4. (Optional) Enable **typing/scroll reactions**: System Settings → Privacy & Security →
   **Input Monitoring** → turn **Kitto** on, then relaunch. See [Permissions](#permissions-macos).

The cat then floats above your other windows. Right-click it for **⚙ Settings…** (cat
breed, fur, reactions, Pomodoro, autostart) and the Pomodoro controls.

## Prerequisites

- **[Rust](https://rustup.rs)** (stable) + the platform toolchain Tauri needs
  ([macOS](https://tauri.app/start/prerequisites/#macos): Xcode Command Line Tools;
  [Windows](https://tauri.app/start/prerequisites/#windows): MSVC + WebView2).
- **[Node.js](https://nodejs.org)** 20+.
- **[pnpm](https://pnpm.io)** — this project uses pnpm, **not npm** (a `pnpm-lock.yaml`
  is committed). The easiest way is Corepack, which respects the pinned version:
  ```sh
  corepack enable pnpm
  ```

## Run it (development)

```sh
pnpm install      # install JS deps
pnpm tauri:dev    # compile the Rust core + launch the overlay
```

`pnpm tauri:dev` runs `pnpm dev` (the Vite dev server on port 1420) and opens the native
window. The first Rust build downloads and compiles Tauri, so it takes a few minutes;
later runs are fast.

You should see a small grey pixel cat floating above all other windows with a transparent
background and no title bar. **Move your mouse** and its eyes follow the cursor; **flick the
cursor past it quickly** and it perks up to hunt; **hover over it** and it purrs with a happy,
blushing face. **Type in any other app** and it taps along; **type fast and sustained** and it
flushes red and steams (overheat); **scroll** and it shows a paper-unroll. Leave it be and it
breathes, blinks, and after ~6 seconds curls up to **sleep** (Z's rise above its head); any
input wakes it. **Drag it anywhere** by clicking and holding the cat — it stays on top. Clicks
land on the apps underneath *except* when the cursor is over the cat, so the rest of your
desktop keeps working normally.

**Right-click the cat** to open the controls panel: start/pause/skip/reset the **Pomodoro**
(a floating pixel `MM:SS` timer appears above the cat, tinted by phase), set the Pomodoro
and **stretch-reminder** intervals, and toggle the **agent-done chime**. When a stretch
reminder fires — or a Pomodoro phase ends — the cat strikes a yawning **stretch**. The timers
run on a wall-clock loop, so they stay correct across system sleep/wake. Dismiss the panel
with the ✕, Esc, or by clicking outside it.

The keyboard/scroll reactions need an OS permission on macOS — see below. Timers, the
controls panel, and the AI-agent reactions need no permission.

## AI-agent reactions (Claude Code)

The differentiator: the cat reacts to your local AI coding agent. Connect **Claude Code**
in one step:

```sh
pnpm hook:install      # patch ~/.claude/settings.json + drop a tiny writer helper
pnpm hook:uninstall    # remove only Kitto's hooks (your other hooks are left intact)
```

Then start a task: while Claude Code is working the cat **thinks along** (a `Think` pose
with a thought bubble), and when it finishes the cat **hops** (`Jump`) with an optional
chime. The reactions yield to direct interaction — if you're petting, typing or scrolling,
that still wins — but an untended cat thinks along instead of idling (and won't doze off
mid-task).

**How it works (and how to add other tools).** There is no cross-tool API, so Kitto
normalizes everything onto one status file: adapters write a single token —
`working` / `done` / `idle` — to `~/.kitto/agent-status`, and the Rust core watches it
(via [`notify`](https://crates.io/crates/notify)) and drives the cat. The Claude Code
installer just maps its lifecycle hooks (`UserPromptSubmit`/`PreToolUse`/`PostToolUse` →
working, `Stop` → done, `Notification` → idle) to that file through a small writer script.
**Any other tool** (Codex, Cursor, a wrapper script, your own CI) integrates the same way —
write the token, no Kitto change required (KITTO_SPEC §6). Preview the exact hooks without
writing anything: `node scripts/install-claude-hook.mjs --print`. No socket, no port, no
firewall prompt; if no agent is ever present the cat behaves exactly as before (fail-safe).

## Customization (settings window)

Right-click the cat and choose **⚙ Settings…** to open the settings window:

- **Fur** — pick a color (presets or a full color picker) and a **pattern**
  (None / Tabby / Tuxedo / Calico). The recolor is a load-time palette swap onto an
  offscreen canvas (KITTO_SPEC §7); the pattern is a separate overlay-mask layer, and
  tabby stripes are derived from your chosen color so they always match.
- **Reactions** — turn Hunt, Pet, typing, scrolling, and AI-agent reactions on/off
  independently. Disabling one only suppresses that pose; the cat still idles, sleeps,
  tracks the cursor, and stays draggable.
- **Pomodoro / Stretch / Chime** — the same timer and sound settings as before.
- **Startup** — **Launch Kitto at login** (autostart), via the OS login-item mechanism.

Edits **apply live** (the always-on-top cat previews above the window) and persist to
`~/.kitto/settings.json` — the single source of truth the Rust core reads/writes, shared
with the overlay. A settings file from an older build upgrades cleanly.

## Permissions (macOS)

Watching the keyboard/scroll *of other apps* requires the OS to trust Kitto. This is the
"permissions gauntlet" ([KITTO_SPEC §M3](KITTO_SPEC.md#5-milestones-build-in-this-order)):

- **What to enable:** **System Settings → Privacy & Security → Input Monitoring** → toggle the
  app **on**, then relaunch. macOS prompts the first time the tap is installed; if you miss the
  prompt, add it manually there.
  - **Dev builds:** Kitto runs as a *child* of whatever launched it (your IDE/terminal), and
    macOS attributes the grant to that **launching app** — so enable **VS Code / Terminal**,
    not "Kitto", and fully **quit + reopen** it for the grant to reach the child. Once packaged
    and code-signed (M7) it runs standalone and prompts as **Kitto** itself.
- **If denied:** the app emits an `input-permission` signal; Kitto shows a small hint banner on
  the cat and logs the exact steps. The cat keeps working — cursor reactions, timers and
  everything else are unaffected; only typing/scroll reactions are off (graceful degradation).
- **Info.plist:** unlike camera/mic, CGEventTap-based input monitoring has **no usage-string
  Info.plist key** that pre-authorizes or pre-prompts it — the grant lives entirely in the
  Privacy list above. So there is nothing to add to `Info.plist`; the requirement is
  **code-signing + notarization** (M7): on an *unsigned dev build* macOS still lets you grant
  access, but the grant is tied to the launching app and may need re-adding after changes.
- **Windows:** keyboard reactions work via `device_query` polling with no special permission;
  global scroll (a `WH_MOUSE_LL` hook) is not wired up yet. An unsigned dev build can
  occasionally trip an antivirus heuristic; production builds must be code-signed (M7).

> **Why this design?** `rdev` (the spec's first choice) decodes global key events with a
> main-thread-only macOS keyboard API and **aborts the whole process on the first keystroke**
> when run off the main thread (where a blocking listener must live). So on macOS both keyboard
> and scroll go through **listen-only `CGEventTap`s** that never decode the key — the keyboard
> tap only *counts* key-downs (the webview derives the rate), so there's no keyboard-layout
> call to crash on. Taps also gate on **Input Monitoring**, which macOS attributes to the
> launching app, so a dev build inherits the grant — whereas `device_query`'s macOS backend
> gates on **Accessibility** tied to the binary's own identity, which a dev child does not
> inherit. `device_query` (the spec's named `rdev` fallback) is therefore used only off macOS
> (Windows keyboard). The taps reuse `core-graphics`, already in the dependency tree.

## Test

```sh
pnpm test         # run the state-machine unit tests (vitest)
pnpm test:watch   # watch mode
```

The `CatStateMachine` is pure (no rendering or IO), so its transitions are covered by fast,
deterministic unit tests — see [src/state/machine.test.ts](src/state/machine.test.ts).

## Build

```sh
pnpm build        # type-check + build the frontend (dist/)
pnpm tauri:build  # produce a native app bundle (.app + .dmg, unsigned)
```

On Apple Silicon this writes the artifacts to
`src-tauri/target/release/bundle/` — the installer is
`bundle/dmg/Kitto_<version>_aarch64.dmg` and the app is `bundle/macos/Kitto.app`.
The build is **unsigned** (no Apple Developer account), so anyone who downloads the
DMG must clear the quarantine flag once — see [Download & install](#download--install-macos).

## Project layout

See [KITTO_SPEC.md §8](KITTO_SPEC.md#8-conventions) for the canonical structure. In short:

```
src/              TypeScript frontend (brain + display)
  render/         canvas renderer + AnimationController + timer overlay
  sprites/        atlas loader + palette-swap recolor (custom fur)      [M6]
  state/          CatStateMachine + transitions (pure, unit-tested)
  timers/         stretch + Pomodoro clocks (pure, tested) + manager   [M4]
  config/         persisted settings (JSON on disk via Rust core)      [M6]
  audio/          synthesized agent-done chime (Web Audio, no asset)   [M5]
  settings/       the settings window (entry + styles)                 [M6]
  ipc/            Tauri event bindings (cursor, keyboard/scroll, agent)
  ui/             small DOM overlays (input-permission hint, controls)
  cat.ts          per-cat orchestrator (machine + animation + input)
src-tauri/        Rust core (sensors, window mgr, AI watcher, IPC)
  src/window/     always-on-top / click-through / drag + open_settings  [M6]
  src/sensors/    global cursor stream + keyboard/scroll hooks         [M2/M3]
  src/agents/     AI-agent status-file watcher (notify → kitto://agent) [M5]
  src/config/     on-disk settings store (load_config / save_config)   [M6]
  src/autostart.rs  autostart-on-login commands (plugin wrapper)        [M6]
index.html        the overlay window     settings.html  the settings window
assets/           sprite atlases + pattern masks + manifest.json
scripts/          placeholder-art generator + Claude Code hook installer
```

Placeholder pixel art (cat atlas + pattern masks) is generated with `pnpm art` (pure Node,
no dependencies).

## Contributing conventions

- **TypeScript strict mode**; Rust must be `clippy`-clean with no `unwrap()` in non-test code.
- **State machine is pure and unit-tested** — no rendering or IO inside it.
- **Conventional Commits**, small PRs per milestone.
- **No telemetry, ever.** No network calls except the license check (M7).
- **Package manager: pnpm only** (never npm).
- **Dependency 7-day gap:** never pin a dependency (npm/pnpm or Rust crate) released
  within the last 7 days. Pick the newest version that is at least 7 days old — a
  quarantine window against freshly-published compromised or broken releases.

## License

© 2026. **Free to download and use personally.** The source is published so you can build
and audit it, but it is **not** released under an open-source license — please don't
redistribute the binaries or art as your own. See [LICENSE](LICENSE).

The pixel-cat artwork is original work created for Kitto. The Ginger cat's design was
informed by a personal-use reference; if you reuse the art, redraw it.
