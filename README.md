<div align="center">

# Kitto 🐈

**A tiny animated pixel cat that lives on your desktop — and reacts to your AI coding agents.**

![platform](https://img.shields.io/badge/platform-macOS%20(Apple%20Silicon)-black)
![version](https://img.shields.io/badge/version-0.1.1-blue)
![license](https://img.shields.io/badge/license-personal--use-lightgrey)

</div>

Kitto floats in an always-on-top, click-through overlay. It follows your cursor, reacts to
typing and scrolling, runs stretch and Pomodoro timers, and — the part that makes it
different — **reacts to the working state of your local AI coding agents** (Claude Code
today; any other tool by writing a one-line status file).

Built with [Tauri 2](https://tauri.app) (a tiny Rust core) and TypeScript/Vite, rendering
pixel sprites to an HTML5 canvas. No telemetry, no network calls.

## Features

- 🐈 **Three cats** — a recolorable gray cat (custom fur color + tabby/tuxedo/calico
  patterns), plus fixed-design tuxedo and ginger tabby presets.
- 👀 **Reacts to your desktop** — follows the cursor, hunts a fast flick, purrs when
  hovered, taps along while you type (and overheats during furious typing), and reacts to
  scrolling.
- 🤖 **Reacts to your AI agent** — thinks along while Claude Code works, and hops for joy
  (with an optional chime) when a task finishes.
- ⏱️ **Built-in timers** — a configurable stretch reminder and a Pomodoro focus/break loop
  with a floating pixel timer, both resilient across system sleep/wake.
- 🌙 **Ambient life** — wanders, naps, grooms, and plays on its own, with an adjustable
  energy level and optional day/night rhythm.
- ⚙️ **Customizable** — a proper settings window with live preview, per-reaction toggles,
  and launch-at-login.

## Download & install (macOS)

> **Apple Silicon (M1/M2/M3/M4) only.** Intel Macs are not supported by the current build.

1. Download the latest **`Kitto_x.y.z_aarch64.dmg`** from the
   [**Releases**](../../releases/latest) page.
2. Open the `.dmg` and drag **Kitto** into **Applications**.
3. **First launch — clear the quarantine flag.** Kitto is not code-signed or notarized, so
   macOS Gatekeeper will otherwise refuse to open it with *"Kitto is damaged and can't be
   opened."* That message just means the app is unsigned — it isn't actually broken. Clear
   the flag once in Terminal:

   ```sh
   xattr -dr com.apple.quarantine /Applications/Kitto.app
   ```

   Then open Kitto from Applications as normal. You only need to do this once per install.

4. *(Optional)* To enable typing/scroll reactions, grant **Input Monitoring** — see
   [Permissions](#permissions-macos).

Right-click the cat any time for **⚙ Settings…** and the Pomodoro controls.

## Usage

Once running, a small pixel cat floats above your other windows:

- **Move your mouse** — its eyes follow the cursor; **flick past it quickly** and it perks
  up to hunt; **hover over it** and it purrs.
- **Type or scroll in any app** — it taps along, and flushes red with steam during
  sustained fast typing.
- **Leave it alone** — it breathes, blinks, wanders, and curls up to sleep; any input
  wakes it.
- **Drag it** anywhere by clicking and holding. Clicks pass through to the apps underneath
  everywhere except over the cat.
- **Right-click it** for the controls panel (Pomodoro start/pause/skip/reset, intervals)
  and **⚙ Settings…**.

## AI-agent reactions (Claude Code)

The differentiator. Connect Claude Code in one step:

```sh
pnpm hook:install      # adds Kitto's hooks to ~/.claude/settings.json
pnpm hook:uninstall    # removes only Kitto's hooks (others left intact)
```

While Claude Code works, the cat thinks along (a thought bubble); when a task finishes, it
hops with an optional chime. Direct interaction always wins — if you're petting, typing, or
scrolling, that takes priority.

**Other tools** integrate the same way: there is no cross-tool API, so Kitto normalizes
everything onto one status file. An adapter writes a single token — `working` / `done` /
`idle` — to `~/.kitto/agent-status`, and the Rust core watches it. No socket, no port, no
firewall prompt; if no agent is present the cat behaves normally. Preview the exact hooks
without writing anything: `node scripts/install-claude-hook.mjs --print`.

## Permissions (macOS)

Reacting to the keyboard/scroll **of other apps** requires macOS to trust Kitto:

- **Enable it:** System Settings → Privacy & Security → **Input Monitoring** → turn
  **Kitto** on, then relaunch. macOS prompts the first time; if you miss it, add it
  manually there.
- **If denied:** Kitto shows a small hint and keeps working — cursor reactions, timers, and
  AI-agent reactions are unaffected; only typing/scroll reactions are off.
- **Dev builds** run as a child of your terminal/IDE, so macOS attributes the grant to the
  *launching app* — enable VS Code / Terminal (not "Kitto") and fully quit + reopen it.

Cursor reactions, timers, the controls panel, and AI-agent reactions need no permission.

## Build from source

**Prerequisites:** [Rust](https://rustup.rs) (stable) with the
[macOS toolchain](https://tauri.app/start/prerequisites/#macos) (Xcode Command Line Tools),
[Node.js](https://nodejs.org) 20+, and [pnpm](https://pnpm.io) (`corepack enable pnpm`).

```sh
pnpm install      # install JS deps
pnpm tauri:dev    # compile the Rust core + launch the overlay (dev)
pnpm tauri:build  # produce a native bundle (.app + .dmg, unsigned)
pnpm test         # run the unit tests
```

`pnpm tauri:build` writes artifacts to `src-tauri/target/release/bundle/` — the DMG is
`bundle/dmg/Kitto_<version>_aarch64.dmg`. The build is unsigned, so downloaders must clear
the quarantine flag (see [Download & install](#download--install-macos)).

## Project structure

```
src/              TypeScript frontend (the cat's brain + display)
  render/         canvas renderer, animation, timer overlay, ambient life
  sprites/        atlas loader + palette-swap recolor
  state/          CatStateMachine — pure, unit-tested
  timers/         stretch + Pomodoro clocks (pure, tested)
  config/         persisted settings (JSON on disk via the Rust core)
  ipc/            Tauri event bindings (cursor, keyboard/scroll, agent)
  cat.ts          per-cat orchestrator
src-tauri/        Rust core (sensors, window mgmt, AI watcher, config)
assets/           sprite atlases + pattern masks + manifest.json
docs/             product spec + design notes
scripts/          art generator + Claude Code hook installer
```

Full conventions and the milestone plan live in
[`docs/KITTO_SPEC.md`](docs/KITTO_SPEC.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Kitto is source-available under a personal-use
license — please open an issue before any substantial change.

## License

© 2026. **Free to download and use personally.** The source is published so you can build
and audit it, but it is **not** released under an open-source license — please don't
redistribute the binaries or art. See [LICENSE](LICENSE).

The pixel-cat artwork is original work created for Kitto.
