// Persisted settings (KITTO_SPEC §3, §8).
//
// M6 graduates persistence from the webview's localStorage to a real JSON file on
// disk at `~/.kitto/settings.json`, written/read by the Rust core (the `save_config`
// / `load_config` commands). That file is the single source of truth shared by the
// overlay and the separate settings window, so a change in one is reloaded by the
// other. No new crate: the Rust side uses `std::fs` over the `~/.kitto` dir the
// agent watcher already owns.
//
// Values are validated/clamped on load so a hand-edited or stale store can never
// feed a degenerate (0-length, NaN) interval into the pure timer clocks — and so
// an older settings file (pre-M6, without appearance/reactions) upgrades cleanly.

import { invoke } from "@tauri-apps/api/core";
import { DEFAULT_STRETCH, type StretchConfig } from "../timers/stretch";
import { DEFAULT_POMODORO, type PomodoroConfig } from "../timers/pomodoro";
import {
  DEFAULT_ENERGY_CONFIG,
  normalizeEnergyLevel,
  type EnergyConfig,
} from "../render/energy";

/** A fur pattern overlay (M6, KITTO_SPEC §7 — a separate mask layer over the fur). */
export type PatternId = "none" | "tabby" | "tuxedo" | "calico";

export const PATTERN_IDS: readonly PatternId[] = ["none", "tabby", "tuxedo", "calico"];

/** Which cat artwork to use. "gray" is the original recolorable pixel cat; "tuxedo"
 *  is the fixed-palette black tuxedo (its own 48px atlas); "ginger" is the crisp
 *  vector-style ginger tabby (its own 88px atlas). Recolor/pattern apply only to gray —
 *  tuxedo and ginger are fixed presets. */
export type CatBreed = "gray" | "tuxedo" | "ginger";

export const CAT_BREEDS: readonly CatBreed[] = ["gray", "tuxedo", "ginger"];

/** Custom fur: a base color (hex) plus an optional pattern overlay (M6), and which
 *  cat artwork to wear (the tuxedo cat ignores furColor/pattern — it's a preset). */
export interface Appearance {
  /** Which cat sprite set to use. */
  readonly cat: CatBreed;
  /** Base fur color as `#rrggbb`. Default = the placeholder grey, so no visual change. */
  readonly furColor: string;
  readonly pattern: PatternId;
}

/**
 * Per-reaction enable toggles (M6). These gate *reactions*, not the baseline
 * Idle/Sleep/Walk/FollowEyes life — turning one off simply means that sensor never
 * pushes the cat into that pose (the hit-test still runs so the window stays
 * draggable/click-through). Stretch has its own toggle on `stretch.enabled`; the
 * agent chime has `soundOnDone`.
 */
export interface Reactions {
  /** Chase a fast cursor flick (Hunt). */
  readonly hunt: boolean;
  /** Purr when the cursor hovers the cat (Pet). */
  readonly pet: boolean;
  /** React to typing (Type / Overheat). */
  readonly keyboard: boolean;
  /** React to scrolling (Scroll). */
  readonly scroll: boolean;
  /** React to a watched AI agent (Think / Jump). */
  readonly agent: boolean;
}

export interface Settings {
  readonly stretch: StretchConfig;
  readonly pomodoro: PomodoroConfig;
  /** Play the celebratory chime when a watched AI agent finishes (M5). */
  readonly soundOnDone: boolean;
  /** Custom fur color + pattern (M6). */
  readonly appearance: Appearance;
  /** Per-reaction enable toggles (M6). */
  readonly reactions: Reactions;
  /** Launch Kitto automatically on login (M6). Applied via the Rust autostart plugin. */
  readonly autostart: boolean;
  /** Ambient-life tuning (MA-4 / A4): the Calm↔Playful energy knob, day/night rhythm,
   *  play on/off, and an optional idle-delay override. */
  readonly ambient: EnergyConfig;
}

/** The placeholder fur grey (`PAL.B` in the art generator), as hex. */
export const DEFAULT_FUR = "#787882";

export const DEFAULT_APPEARANCE: Appearance = {
  cat: "gray",
  furColor: DEFAULT_FUR,
  pattern: "none",
};

export const DEFAULT_REACTIONS: Reactions = {
  hunt: true,
  pet: true,
  keyboard: true,
  scroll: true,
  agent: true,
};

export const DEFAULT_SETTINGS: Settings = {
  stretch: DEFAULT_STRETCH,
  pomodoro: DEFAULT_POMODORO,
  soundOnDone: true,
  appearance: DEFAULT_APPEARANCE,
  reactions: DEFAULT_REACTIONS,
  autostart: false,
  ambient: DEFAULT_ENERGY_CONFIG,
};

/** Idle-delay override bounds (ms): 0 = "use the energy level default", else clamp to
 *  a sane 30 s … 30 min window so a hand-edited store can't strand the cat. */
const IDLE_OVERRIDE_MAX = 30 * 60_000;

const MIN = 60_000; // never let any interval fall below 1 minute
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** Coerce to a finite number within [lo, hi], falling back to `dflt`. */
function clampMs(value: unknown, lo: number, hi: number, dflt: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : dflt;
  return Math.min(hi, Math.max(lo, n));
}

function clampInt(value: unknown, lo: number, hi: number, dflt: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : dflt;
  return Math.min(hi, Math.max(lo, n));
}

/** Coerce to a boolean, falling back to `dflt` for anything non-boolean. */
function bool(value: unknown, dflt: boolean): boolean {
  return typeof value === "boolean" ? value : dflt;
}

/** Validate a `#rrggbb` hex string, falling back to the default fur color. */
function furColor(value: unknown): string {
  return typeof value === "string" && HEX_COLOR.test(value) ? value.toLowerCase() : DEFAULT_FUR;
}

/** Coerce to a known pattern id, falling back to "none". */
function pattern(value: unknown): PatternId {
  return PATTERN_IDS.includes(value as PatternId) ? (value as PatternId) : "none";
}

/** Coerce to a known cat breed, falling back to the default ("gray"). */
function catBreed(value: unknown): CatBreed {
  return CAT_BREEDS.includes(value as CatBreed) ? (value as CatBreed) : DEFAULT_APPEARANCE.cat;
}

/** Merge an untrusted partial (parsed JSON) onto the defaults, clamping ranges. */
export function normalize(raw: unknown): Settings {
  const r = (raw ?? {}) as {
    stretch?: unknown;
    pomodoro?: unknown;
    soundOnDone?: unknown;
    appearance?: unknown;
    reactions?: unknown;
    autostart?: unknown;
    ambient?: unknown;
  };
  const s = (r.stretch ?? {}) as Partial<StretchConfig>;
  const p = (r.pomodoro ?? {}) as Partial<PomodoroConfig>;
  const a = (r.appearance ?? {}) as Partial<Appearance>;
  const x = (r.reactions ?? {}) as Partial<Reactions>;
  const m = (r.ambient ?? {}) as Partial<EnergyConfig>;
  return {
    soundOnDone: bool(r.soundOnDone, DEFAULT_SETTINGS.soundOnDone),
    autostart: bool(r.autostart, DEFAULT_SETTINGS.autostart),
    ambient: {
      level: normalizeEnergyLevel(m.level),
      dayNight: bool(m.dayNight, DEFAULT_ENERGY_CONFIG.dayNight),
      play: bool(m.play, DEFAULT_ENERGY_CONFIG.play),
      idleDelayMsOverride: clampMs(m.idleDelayMsOverride, 0, IDLE_OVERRIDE_MAX, 0),
    },
    appearance: {
      cat: catBreed(a.cat),
      furColor: furColor(a.furColor),
      pattern: pattern(a.pattern),
    },
    reactions: {
      hunt: bool(x.hunt, DEFAULT_REACTIONS.hunt),
      pet: bool(x.pet, DEFAULT_REACTIONS.pet),
      keyboard: bool(x.keyboard, DEFAULT_REACTIONS.keyboard),
      scroll: bool(x.scroll, DEFAULT_REACTIONS.scroll),
      agent: bool(x.agent, DEFAULT_REACTIONS.agent),
    },
    stretch: {
      enabled: typeof s.enabled === "boolean" ? s.enabled : DEFAULT_STRETCH.enabled,
      intervalMs: clampMs(s.intervalMs, MIN, 240 * 60_000, DEFAULT_STRETCH.intervalMs),
      // Duration isn't user-facing; keep the default unless a sane value is stored.
      durationMs: clampMs(s.durationMs, 1_000, 10_000, DEFAULT_STRETCH.durationMs),
    },
    pomodoro: {
      focusMs: clampMs(p.focusMs, MIN, 180 * 60_000, DEFAULT_POMODORO.focusMs),
      shortBreakMs: clampMs(p.shortBreakMs, MIN, 60 * 60_000, DEFAULT_POMODORO.shortBreakMs),
      longBreakMs: clampMs(p.longBreakMs, MIN, 120 * 60_000, DEFAULT_POMODORO.longBreakMs),
      sessionsBeforeLongBreak: clampInt(
        p.sessionsBeforeLongBreak,
        1,
        12,
        DEFAULT_POMODORO.sessionsBeforeLongBreak,
      ),
    },
  };
}

/**
 * Load + normalize the settings from disk (the Rust `load_config` command). A
 * missing file, a corrupt JSON, or running outside Tauri (e.g. tests) all fall
 * back cleanly to the defaults — settings loading can never throw.
 */
export async function loadSettings(): Promise<Settings> {
  try {
    const raw = await invoke<string>("load_config");
    if (!raw) return DEFAULT_SETTINGS;
    return normalize(JSON.parse(raw));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/**
 * Persist the settings to disk (the Rust `save_config` command). Best-effort: a
 * write failure (or no Tauri host) is swallowed so a save can never crash a caller.
 */
export async function saveSettings(settings: Settings): Promise<void> {
  try {
    await invoke("save_config", { json: JSON.stringify(settings) });
  } catch {
    // Disk/host unavailable — settings simply won't persist this session.
  }
}
