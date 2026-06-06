# Changelog

All notable changes to Kitto are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Versions track the [milestone plan](docs/KITTO_SPEC.md#5-milestones-build-in-this-order).

## [Unreleased]

## [0.1.0] - 2026-06-06

First public release. macOS (Apple Silicon), distributed as an unsigned `.dmg`.

### Added — Ginger cat (vector pixel tabby)

- **Third cat (“Ginger”).** A crisp vector-style ginger tabby with its own 88px sprite
  atlas (same 64px on-screen footprint as the others). Pick it under settings → **Cat**;
  switching reloads the overlay. Like the tuxedo it’s a fixed-palette preset (fur
  colour/pattern don’t apply); the gray cat stays recolorable. Every mood reads at a
  glance — focused half-lids + a keyboard for Type, angry brows + steam + sweat for
  Overheat, a sparkly hop for agent-done, a thought bubble while an agent works — plus
  the full ambient set (sleep/zZ, walk, groom, yawn, stretch, scroll, pet).
- **Authored as deterministic pixel-art.** A new `scripts/bake-vector-cat.py` draws each
  pose as integer-grid rectangles straight to the atlas PNG with PIL — perfectly crisp,
  no SVG engine in the loop. Re-run it to tweak the art.
- **Per-cat eye geometry.** The cursor-tracking pupils (FollowEyes/Hunt) and blink now
  take per-cat coordinates, so the ginger’s larger tile gets correctly-placed,
  larger-travel pupils. The gray/tuxedo cats keep their existing behaviour.

### Added — Tuxedo cat + live idle animation

- **Second cat (“Tuxedo”).** A selectable black-tuxedo cat with its own 48px sprite
  atlas (rendered to the same 64px on-screen footprint as the original gray cat).
  Pick it under settings → **Cat**; switching reloads the overlay. It’s a fixed-palette
  preset, so fur colour/pattern don’t apply to it. The gray cat stays recolorable.
- **Per-atlas tile size.** Atlases may now carry their own `tile` size (the tuxedo is
  48px, gray stays 32px); the renderer derives its scale so both share a footprint.
- **Live idle animation (hybrid model).** Resting poses now *breathe* (a subtle
  volume-preserving vertical squash) and *blink* (eyes painted shut on a random
  interval) via a new pure `src/render/idle-anim.ts` driver + a draw-override in the
  animation controller — while walk/pounce/sleep cycles stay baked frames in the atlas.

### Changed — deep sleep (naps that stick)

- **A sleeping cat now stays asleep.** Once the cat lies down to nap (after walking to
  a corner, or dropped there), it enters *deep sleep* and sleeps through ordinary input
  — keystrokes, scrolling, cursor movement and hover no longer wake it. This fixes naps
  being cut to a fraction of a second by the next keypress, and lets it actually reach
  and settle in a corner. **Only a triple-click directly on the cat wakes it** (a stray
  single click is ignored); a drag still rouses it immediately (you grabbed it). Applies
  to both cats.

### Changed — idle CPU: throttled the render loop

- **The render loop no longer repaints at 60fps while the cat is at rest.** It still wakes
  on rAF to advance time, but only repaints when something *visibly* changed (a baked
  frame advance, a breathing step crossing a perceptible quantum, a blink toggle, or
  cursor-tracking pupils moving) — otherwise it coasts at a ~12fps idle floor. Motion
  (walk/jump/hunt) stays full-rate. Measured ~70% fewer canvas redraws on a resting cat
  (88 vs. 300 over 5s), cutting the idle GPU/CPU the WebView was spending on a still cat.
- **Adaptive cursor polling (Rust).** The global cursor sensor backs off from ~60Hz to
  ~10Hz after ~0.5s of a parked cursor and snaps straight back to 60Hz on the first
  movement — fewer native wake-ups when nothing's moving, no felt eye-follow latency.

### Changed — livelier ambient cadence

- **Idle delays shortened** across the energy table so the cat wanders to a corner /
  naps during ordinary use (lively but not frantic) instead of only after minutes of
  total stillness. Default **Balanced** now wanders after ~40s (was 3 min); Calm 90s,
  Low 60s, High 25s, Playful 15s. (The corner-nap path was verified correct — the long
  wait was the only reason it read as “never goes to corners”.)

### Added — MA-4: Ambient polish (cozy spots & rhythm, KITTO_AMBIENT §3 A4)

- **Energy knob (Calm ↔ Playful).** One setting — `Off · Calm · Low · Balanced ·
  High · Playful` — scales the whole ambient layer: how soon the cat wanders off to
  nap, how often it grooms/yawns/zooms, and how much it plays. A pure mapping
  (`src/render/energy.ts`) turns the level into concrete Director + idle-filler
  tuning and per-filler weights; **Off** stands the ambient layer fully down (the
  cat only reacts). Default **Balanced** keeps the ~3-min idle delay and has zoomies
  **on** (resolving the §7 open question). Live-applied + persisted (`settings.ambient`).
- **Favourite-corner memory.** The Director remembers the corner it last napped in
  and biases toward it (~70%) on the next wander, so the cat develops a habitual
  spot while still roaming occasionally.
- **Day/night rhythm.** A subtle, system-clock-only bias (injected for tests): naps
  sooner and tears around less after dark, more morning zoomies. Toggle in settings,
  default on; re-resolved on a slow cadence so it tracks the clock over a long session.
- **Drag-to-bed.** Drag the cat into a corner and drop it there — it settles, walks
  the last little way in, and naps (and remembers that corner as its new favourite).
  Dropped anywhere else it just repositions, as before.
- **Settings — “Ambient life” section**: energy level, wool-ball play on/off,
  day/night rhythm, and a power-user “wander after (minutes, 0 = auto)” idle-delay
  override. All live-applied to the running overlay and persisted to disk; an older
  settings file without the section upgrades cleanly to the defaults.

### Added — M6: Customization

- **Custom fur — live palette-swap recolor.** Pick any fur color (presets + a full
  color picker); the placeholder atlas is recolored onto an offscreen canvas at
  load time and swapped into the running animation with no restart and no frame
  tearing (`src/sprites/recolor.ts`, KITTO_SPEC §7). The default color is the
  original grey, so an untouched install looks identical. The recolor also derives
  the Overheat flush from the chosen fur, so a red-hot cat still reads as *that*
  cat.
- **Fur patterns as a separate overlay-mask layer** (§7): None / Tabby / Tuxedo /
  Calico. Each pattern ships as a same-geometry mask atlas (generated by
  `pnpm art`) whose marker pixels encode a *role*; the recolor resolves roles to
  final colors — the `dark` role derives from the chosen fur, so **tabby stripes
  track whatever color you pick**, while tuxedo/calico patches are fixed.
- **Settings window** — a real second, decorated, resizable Tauri window
  (`settings.html` + `src/settings/`), opened from the right-click panel's
  **⚙ Settings…** button (`window::open_settings`). The always-on-top cat floats
  above it, so fur and reaction edits **preview live on the real cat** as you make
  them. The right-click panel is slimmed to the one-click Pomodoro actions.
- **Reaction toggles** — enable/disable Hunt, Pet, typing (Type/Overheat),
  scrolling (Scroll), and AI-agent (Think/Jump) reactions independently. Gating
  happens by neutralizing the sensor before the (still pure) state machine, so a
  disabled reaction never fires that pose — while the baseline Idle/Sleep/Follow
  life and the hover hit-test (drag / click-through) are untouched. Hunt-off keeps
  eye-tracking; Pet-off keeps the cat draggable.
- **Autostart-on-login** via `tauri-plugin-autostart` (macOS LaunchAgent / Windows
  registry Run key), wrapped in thin `set_autostart` / `get_autostart` commands.
  The toggle reflects the real OS state, not just a stored flag.
- **Config persisted as JSON on disk** (§3, §5): settings graduate from the
  webview's `localStorage` to `~/.kitto/settings.json`, read/written by the Rust
  core (`config::load_config` / `save_config`, `std::fs` — no new crate) and shared
  as the single source of truth between the overlay and the settings window. A
  pre-M6 file upgrades cleanly: `normalize()` fills in the new appearance/reaction/
  autostart defaults and clamps every value.
- **Changes apply live and survive restart** (acceptance §5): the settings window
  persists each edit and broadcasts `kitto://settings-changed`; the overlay applies
  it in place (recolor, reaction gating, timer intervals).
- 7 new settings tests (validation/upgrade) + 5 recolor tests (the pure pixel
  transform): **82 TypeScript + 3 Rust = 85 total**.

### Tooling

- `tauri-plugin-autostart` `=2.5.1` (new dependency beyond KITTO_SPEC §2, approved
  for M6's autostart-on-login; pinned per the 7-day version-gap rule — 2.5.1 was
  released 2025-10-27, well past the cutoff).
- Vite is now **multi-page** (`index.html` overlay + `settings.html` window).
- `pnpm art` also emits the three pattern mask atlases
  (`assets/pattern-{tabby,tuxedo,calico}.png`).

### Added — M5: AI-agent watcher (the differentiator)

- **The cat reacts to your local AI coding agent.** A working agent makes the cat
  **think along** (a new `Think` pose — calm face + a thought bubble); finishing a
  task makes it **hop for joy** (a new `Jump` pose) with an optional chime. This is
  Kitto's defensible novelty (KITTO_SPEC §6).
- **Normalized status file + watcher.** Adapters write one bare status token
  (`working` / `done` / `idle`) to `~/.kitto/agent-status`; the Rust core watches
  it with `notify` (KITTO_SPEC §2) and emits `kitto://agent` to the webview
  (`src-tauri/src/agents/watcher.rs`). We chose a **watched file over a localhost
  socket** (both are offered in §6): it needs no port, no HTTP server crate, and —
  unlike a socket — triggers **no firewall/AV prompt**, keeping with Kitto's
  no-permission-creep stance. We watch the *directory* (robust to atomic-replace
  writes) and emit only on a real status *change*, so a `done` is a single
  celebratory pulse. **Fails safe** (acceptance §5): if the home dir can't be
  resolved or the watcher can't install, it logs and returns — the cat is
  unaffected; nothing here can panic the app.
- **The file is the adapter seam.** Any tool integrates by writing that token — no
  core change — which is the "drop in an adapter, don't edit core" design §6 asks
  for. Claude Code is wired today; a Codex/Cursor wrapper is just another writer.
- **Claude Code integration (first, cleanest — §6).** `pnpm hook:install` patches
  `~/.claude/settings.json` to map Claude Code's lifecycle hooks to the status file
  (`UserPromptSubmit`/`PreToolUse`/`PostToolUse` → working, `Stop` → done,
  `Notification` → idle) via a tiny writer helper in `~/.kitto`. The installer
  (`scripts/install-claude-hook.mjs`, pure Node, no deps) is **idempotent**, backs
  up your settings, **merges** with existing hooks rather than clobbering them, and
  `pnpm hook:uninstall` cleanly removes only Kitto's entries.
- **`Think` / `Jump` states** added to the `CatStateMachine`. `Think` rides in the
  per-frame `sense` snapshot (a new `agentWorking` flag) and slots into the one
  priority ladder just above the ambient `FollowEyes`: **Overheat > Type > Scroll >
  Pet > Hunt > Think > FollowEyes** — direct interaction still wins, but an untended
  cat thinks along instead of idling, and (since working counts as activity) won't
  doze off mid-task. `Jump` is a one-shot pulse held by the Cat for ~2s like the
  M4 stretch, so it overrides the ambient ladder then relaxes.
- **Optional chime** on agent-done — a short synthesized Web Audio arpeggio
  (`src/audio/chime.ts`, no asset to ship), toggleable in the controls panel and
  persisted in settings (`soundOnDone`, default on). Honors v1's "sound effects in
  scope" and §M5's "happy hop + optional sound". The AudioContext is **unlocked on
  the first user gesture** (`unlockAudioOnFirstGesture`) so the very first — and
  most-wanted — chime isn't swallowed by the browser's autoplay policy.
- **Prominent reactions** (the differentiator deserves the care, §1): `Think` shows
  a brighter thought bubble that **grows over three frames** into a full corner
  cloud, and `Jump` is a **taller, ~2s multi-bounce** (landed → hop → peak → hop)
  rather than a single brief hop — so an agent finishing is unmissable.
- New `Think` / `Jump` sprite frames; manifest **v8** (28 frames).
- 13 new tests (71 total: 68 TypeScript + 3 Rust): 10 for the `Think`/`Jump`
  machine transitions (ladder position, stays-awake-while-working, relax-on-stop,
  the one-shot Jump hold) and 3 Rust unit tests for the status-token parser.

### Added — M4: Timers

- **Stretch reminder:** a configurable-interval reminder that strikes a new
  **`Stretch`** pose (a yawning, paws-up stretch). The interval is user-set; the
  pose holds for a short duration then relaxes.
- **Pomodoro:** a focus/break loop (default 25 / 5 / long 15 every 4 focuses) with
  a **floating pixel timer** (`src/render/timer-overlay.ts`) — a hand-coded 3×5
  pixel-font `MM:SS` that floats above the cat, tinted by phase (focus red, breaks
  green/blue) and dimmed while paused. Finishing a focus/break also triggers a
  little celebratory stretch.
- **Timer logic is pure & unit-tested**, mirroring the state machine: `src/timers/
  stretch.ts` and `src/timers/pomodoro.ts` are plain functions of
  `(state, elapsedMs, config)` with **no clock of their own**. The runtime glue
  (`src/timers/manager.ts`) ticks them from a `setInterval` driven by **`Date.now()`
  deltas** — deliberately *not* the cat's `requestAnimationFrame` clock (which is
  clamped and pauses while the display sleeps). Real wall-clock deltas are what make
  timers "fire reliably across sleep/wake" (acceptance): after a long sleep the next
  tick sees the full gap and the pure clocks reconcile it — a fired stretch, and the
  Pomodoro phase you'd *actually* be in (the tick walks forward phase-by-phase,
  consuming the overflow), not merely one boundary late.
  - The §3 architecture diagram sketches timers in the Rust core; we keep them in
    the webview "brain" instead, because the overlay is permanently visible (so the
    webview is never App-Napped/throttled), wall-clock deltas give the same
    sleep/wake robustness there, and it keeps the logic inside the pure, tested TS
    suite with **no new Rust IPC, threads, or crates**.
- **`Stretch` state** added to the `CatStateMachine` via a `stretch` event (a timed
  pose the Cat re-asserts each frame for the reminder's duration; it interrupts
  ambient reactions, counts as activity, and relaxes to `FollowEyes` when released).
- **UI to set intervals:** right-clicking the cat opens a compact inline controls
  panel (`src/ui/controls.ts`): Pomodoro start/pause/skip/reset + the live readout,
  and editable Pomodoro and stretch intervals. The window grows to a (transparent,
  still click-through) 300×360 to host it, and becomes interactive only while the
  panel is open; the backdrop / ✕ / Esc dismiss it. M6 graduates this to the full
  Settings window.
- **Settings persistence:** intervals are stored (and range-clamped on load) in
  `src/config/settings.ts` via the webview's `localStorage` — a no-dependency M4
  stopgap that M6 graduates to JSON-on-disk via Tauri fs.
- New `Stretch` sprite frames; manifest **v6** (22 frames).
- 25 new tests (58 total): 7 for the `Stretch` machine state, and the pure
  stretch/pomodoro clocks (phase cycle, long/short-break cadence, pause/skip/reset,
  big-dt sleep/wake reconciliation, `MM:SS` formatting).

### Added — M3: Keyboard + scroll (the permissions gauntlet)

- Global keyboard + scroll hooks in the Rust core, emitting `kitto://key` (one per
  key-down edge; payload-less — the webview derives the rate) and `kitto://scroll`
  (`{ dx, dy }`, coalesced to ~60Hz).
  - On **macOS**, both keyboard (`sensors/input.rs`) and scroll (`sensors/scroll.rs`)
    use listen-only **`CGEventTap`s** (`core-graphics`), each on its own thread +
    `CFRunLoop`. `rdev` was the spec's first choice but crashes on macOS — its global
    key listener decodes events with a main-thread-only keyboard-layout API and, run
    off the main thread (where Tauri forces a blocking listener), panics across its C
    callback and **aborts the whole process on the first keystroke**. The keyboard tap
    instead **only counts key-downs** (never decodes the key — no keyboard-layout call
    to crash on); the scroll tap uses a wheel-only mask. Taps gate on **Input
    Monitoring**, which macOS attributes to the launching app, so a dev build inherits
    the grant from its IDE/terminal — unlike `device_query`, whose Accessibility gate
    is tied to the binary's own identity and isn't inherited by a dev child. If a tap
    can't install (no grant), it emits `kitto://input-permission { granted: false }`.
  - Off macOS, keyboard falls back to **`device_query`** (`=4.0.1`) polling — the §2
    fallback for "if rdev proves flaky" — which needs no grant on Windows. Global
    scroll there (`WH_MOUSE_LL`) is a later addition.
- Three input-driven states in the `CatStateMachine`: **Type** (sustained typing),
  **Overheat** (furious sustained typing — body flushes red + steam), **Scroll**
  (paper-unroll). The machine's per-frame reactive input was generalized from M2's
  `cursor` event into one `sense` snapshot carrying every sensor (cursor hit-test +
  speed, key rate, scroll activity); a single priority ladder resolves the winner:
  **Overheat > Type > Scroll > Pet > Hunt > FollowEyes**. The Cat computes the
  typing rate (keys/sec over a 1s window) and scroll window outside the pure machine.
- **Permission flow:** on macOS the global tap needs Accessibility / Input
  Monitoring; when denied, Rust emits `kitto://input-permission { granted: false }`
  and the webview shows a non-interactive hint banner (`src/ui/permission-hint.ts`)
  plus a console message with the exact enable path. The cat keeps working without
  the reactions (graceful degradation). macOS permission flow, the (absence of an)
  Info.plist key, and the Windows `WH_KEYBOARD_LL`/`WH_MOUSE_LL` notes are documented
  in the README.
- New Type / Overheat / Scroll sprite frames; manifest v5 (20 frames).
- **Reworked the placeholder cat art** so it reads as a *cat*, not a mouse: taller,
  pointier, more central triangular ears + whiskers (and deliberately no long thin
  tail). Real pixel art still lands before M6.
- 10 new state-machine tests (33 total) covering the keyboard/scroll states, the
  full priority ladder, waking from Sleep on typing/scroll, and relax-on-stop.

### Added — M2: Cursor reactions

- Global cursor-position stream in the Rust core (`src-tauri/src/sensors/cursor.rs`):
  a ~60Hz polling thread reads the desktop-global cursor via Tauri's built-in
  `cursor_position`, converts it to **window-local logical pixels**, and emits it
  as the `kitto://cursor` event (only when it moves). No new crate, no Accessibility
  permission — that's M3's gauntlet. `serde` added as a direct dep (pinned to the
  version already resolved transitively) for the IPC payload.
- Three cursor-driven states in the `CatStateMachine`, resolved by priority from a
  single `cursor` event carrying `{ overCat, speed }`: **Pet** (cursor over the cat)
  > **Hunt** (fast flick) > **FollowEyes** (gentle move). A still cursor relaxes a
  transient Hunt/Pet back to FollowEyes, which — like Idle — drifts to Sleep.
- **Eyes that track the cursor:** FollowEyes/Hunt sprite frames have blank "sclera"
  eyes, and the renderer overlays a live 2×2 pupil that slides toward the pointer
  (`CanvasRenderer.fillTile` + an `AnimationController` post-draw hook). New Hunt
  (tense mouth + paw wiggle) and Pet (happy eyes + pink blush) frames; manifest v4.
- **Click-through overlay:** the window starts click-through (`set_ignore_cursor_events`)
  so the desktop beneath stays usable; the webview re-enables cursor events only
  while the cursor is over the cat (hit-test), so you can still pet and drag it.
- 10 new state-machine tests (23 total) covering cursor priority, relax-on-still,
  the idle clock under a motionless cursor, and waking from Sleep on cursor move.

### Added — M1: Animation engine

- Frame-based `AnimationController` (`src/render/animation.ts`) driving sprite
  animation on the canvas via `requestAnimationFrame`, honoring per-frame
  durations and looping cleanly (delta-time clamped so a stalled tab can't
  fast-forward).
- Pure, unit-tested `CatStateMachine` (`src/state/machine.ts`) with `Idle`,
  `Sleep`, `Walk` states and a single declarative `reduce` transition function:
  Idle → Sleep on inactivity (default 8s), Sleep → Idle on activity,
  Idle ↔ Walk via walk/rest. No rendering or IO inside it (KITTO_SPEC §8).
- Instance-based `Cat` orchestrator (`src/cat.ts`) — one state machine + one
  animation loop per canvas — so multiple cats can be spawned (see scope below).
- Multi-frame placeholder atlas (`assets/cat-atlas.png`, generated) with clearly
  distinct, visibly-animated states: Idle (breathing bob + blink), Sleep (shut eyes +
  rising Z), Walk (4-frame paw cycle + bob); `assets/manifest.json` at v3.
- Temporary M1 preview hotkeys (1 = Idle, 2 = Walk, 3 = Sleep) so all states can be
  seen before M2 drives them from input; removed in M2.
- `vitest` test suite (13 tests) covering the state machine's transitions,
  boundaries, and determinism. Run with `pnpm test`.

### Decisions — v1 scope (resolves KITTO_SPEC §9 open questions)

- **Target latest macOS / Windows.**
- **Sound effects are in scope** for v1 (e.g. the M5 agent-done jump).
- **Multi-cat is in scope** — overrides the spec's "single cat in v1" non-goal;
  architecture is instance-based from M1 onward.

### Added — M0: Skeleton

- Tauri 2 application scaffold (Rust core + TypeScript/Vite frontend).
- Frameless, transparent, always-on-top overlay window showing a single static
  placeholder cat sprite, draggable anywhere via `data-tauri-drag-region`.
- Repository structure per [KITTO_SPEC §8](docs/KITTO_SPEC.md#8-conventions): `src/`
  (render, sprites, state, config, ipc) and `src-tauri/src/` (window, sensors, agents).
- HTML5 canvas renderer with nearest-neighbour upscaling and a forward-compatible
  sprite manifest (`assets/manifest.json`).
- Placeholder pixel-art generator (`scripts/gen-placeholder-art.mjs`, `pnpm art`) — pure
  Node, no dependencies — producing the cat sprite and app icons.
- `README.md`, `CHANGELOG.md`.

### Tooling / conventions

- Package manager standardized on **pnpm** (pinned `pnpm@10.34.1`); npm is not used.
- **7-day dependency-version gap** adopted as a rule: dependencies are pinned to the
  newest version that is at least 7 days old (supply-chain safety). Initial pins
  (newest stable on/before 2026-05-28): `vite@8.0.14`, `typescript@6.0.3`,
  `@tauri-apps/cli@2.11.2`, `@tauri-apps/api@2.11.0`, `tauri@2.11.2`, `tauri-build@2.6.2`.
  M1 adds `vitest@4.1.7` (held back from 4.1.8, which released after the cutoff).
  M2 adds `serde@1.0.228` (Rust; reuses the version already locked transitively, so
  no version bump and well past the cutoff). M3 (macOS): the keyboard + scroll taps
  use `core-graphics@0.25.0` (2025-05-27) + `core-foundation@0.10.1`, both already
  resolved transitively (no new download). M3 (non-macOS): `device_query@4.0.1`
  (2025-07-21) for keyboard. All past the cutoff. (`rdev` was trialled then dropped —
  see M3 above.) M4 adds **no new dependencies** (npm or Rust): timers, the timer
  overlay and the controls panel are all webview-side, and settings persist via the
  built-in `localStorage`. M5 adds **one** dependency — `notify@8.2.0` (Rust;
  2025-08-03), the exact crate KITTO_SPEC §2 names for the AI-agent file-watcher,
  pinned to the newest stable on/before the 2026-05-28 cutoff (9.0.0 is only RC
  builds). The chime, the Claude Code hook installer and its writer helper add no
  dependencies (Web Audio + pure Node, like the art generator).
- TypeScript strict mode; slim Rust release profile (LTO, `panic = "abort"`, strip).

[Unreleased]: https://example.com/kitto/tree/main
