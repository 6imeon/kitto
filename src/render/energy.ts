// Energy & rhythm (KITTO_AMBIENT.md §3 A4 — MA-4).
//
// The "one knob" the spec asks for: a Calm↔Playful energy level that scales how
// often the cat wanders off to nap, grooms/yawns, zooms, and plays. This module is
// the single place that turns that knob — plus an optional time-of-day rhythm — into
// the concrete tuning the Director (DirectorConfig) and the idle-filler scheduler
// (FillerConfig + per-filler weights) consume.
//
// PURE: no Date.now()/Math.random()/DOM. Time-of-day enters as an injected `hour`
// (0–23, the caller reads the system clock — system only, no network, per A4), so the
// whole mapping is a deterministic function of (level, dayNight, hour) and is
// unit-tested. The Cat owns the clock and feeds the result in via setEnergy.

import type { DirectorConfig } from "./director";
import type { FillerConfig } from "./idle-fillers";

/**
 * The energy knob. `off` stands the ambient layer fully down (the cat only reacts —
 * no autonomous wander, nap, groom, yawn, zoomies or play); the rest run Calm→Playful
 * from sleepy-and-still to busy-and-bouncy. `mid` is the default.
 */
export type EnergyLevel = "off" | "calm" | "low" | "mid" | "high" | "playful";

/** Ordered Calm→Playful (excludes `off`); index used for UI sliders and clamping. */
export const ENERGY_LEVELS: readonly EnergyLevel[] = [
  "off",
  "calm",
  "low",
  "mid",
  "high",
  "playful",
] as const;

export const DEFAULT_ENERGY: EnergyLevel = "mid";

/** Per-filler probability weights (sum need not be 1 — `pickFiller` normalizes). A
 *  zero weight means that filler never fires at this energy (e.g. zoomies when calm). */
export interface FillerWeights {
  readonly groom: number;
  readonly yawn: number;
  readonly zoomies: number;
  readonly play: number;
}

/** Everything the energy knob (+ rhythm) resolves to for one moment. The Cat applies
 *  `director`/`fillers` to its sub-modules and reads `fillerWeights` when a filler fires. */
export interface EnergyTuning {
  /** Ambient wander/nap config for the Director. `enabled:false` when energy is off. */
  readonly director: DirectorConfig;
  /** Idle-filler scheduler config. `enabled:false` when energy is off. */
  readonly fillers: FillerConfig;
  /** Which fillers may fire, and how often relative to each other. */
  readonly fillerWeights: FillerWeights;
}

/** Tuning settings the Cat persists/live-applies (KITTO_AMBIENT §5 settings list). */
export interface EnergyConfig {
  /** The Calm↔Playful knob (or off). */
  readonly level: EnergyLevel;
  /** Bias idle-delay / zoomies by time of day (naps more after dark, zooms in the
   *  morning) — A4's optional rhythm. Default on; system clock only. */
  readonly dayNight: boolean;
  /** Master switch for wool-ball play specifically (KITTO_AMBIENT §5 "play on/off").
   *  Independent of the filler master switch so you can keep groom/yawn but drop play. */
  readonly play: boolean;
  /** Optional override of the wander idle-delay (ms). When set (>0) it replaces the
   *  energy level's default delay — the power-user "idle delay" field (§5). 0 ⇒ use
   *  the level default. */
  readonly idleDelayMsOverride: number;
}

export const DEFAULT_ENERGY_CONFIG: EnergyConfig = {
  level: DEFAULT_ENERGY,
  dayNight: true,
  play: true,
  idleDelayMsOverride: 0,
};

/** Inset from each screen edge for the nap corner (logical px). Constant across
 *  energy — only cadence/frequency scales, not geometry. */
const CORNER_MARGIN = 8;

/**
 * The base table: each level's idle-delay (ms before wandering off to nap), the
 * filler gap window (ms of eligible dwelling between fillers), and the per-filler
 * weights. Calm = long delays, sparse fillers, no zoomies; Playful = short delays,
 * frequent fillers, lots of zoomies + play. `mid` is the default and — per the
 * resolved §7 question — has zoomies ON.
 */
interface LevelRow {
  readonly idleDelayMs: number;
  readonly minGapMs: number;
  readonly maxGapMs: number;
  readonly weights: FillerWeights;
}

// Idle delays tuned for a lively-but-not-frantic cadence: the cat heads to a corner /
// wanders during ordinary use (default ~40s) rather than after minutes of stillness,
// without the twitchy ~8s of the bare Director default. Calm is still the slowest and
// Playful the fastest; the ordering is preserved.
const TABLE: Record<Exclude<EnergyLevel, "off">, LevelRow> = {
  // Sleepy: wanders to nap unhurriedly and barely fidgets between beats; no zoomies.
  calm: {
    idleDelayMs: 90_000,
    minGapMs: 8_000,
    maxGapMs: 16_000,
    weights: { groom: 0.6, yawn: 0.4, zoomies: 0, play: 0.05 },
  },
  low: {
    idleDelayMs: 60_000,
    minGapMs: 6_000,
    maxGapMs: 12_000,
    weights: { groom: 0.5, yawn: 0.3, zoomies: 0.05, play: 0.12 },
  },
  // Default. ~40s idle delay (lively but not frantic), zoomies on, balanced play.
  mid: {
    idleDelayMs: 40_000,
    minGapMs: 4_000,
    maxGapMs: 9_000,
    weights: { groom: 0.4, yawn: 0.24, zoomies: 0.18, play: 0.18 },
  },
  high: {
    idleDelayMs: 25_000,
    minGapMs: 3_000,
    maxGapMs: 6_500,
    weights: { groom: 0.3, yawn: 0.16, zoomies: 0.27, play: 0.27 },
  },
  // Busy and bouncy: wanders/naps often, fidgets constantly, lots of zoomies + ball play.
  playful: {
    idleDelayMs: 15_000,
    minGapMs: 2_000,
    maxGapMs: 5_000,
    weights: { groom: 0.24, yawn: 0.12, zoomies: 0.32, play: 0.32 },
  },
};

const OFF_TUNING: EnergyTuning = {
  director: { enabled: false, wanderAfterMs: 3 * 60_000, cornerMargin: CORNER_MARGIN },
  fillers: { enabled: false, minGapMs: 4_000, maxGapMs: 9_000 },
  fillerWeights: { groom: 0, yawn: 0, zoomies: 0, play: 0 },
};

/** Is it "after dark"? Night biases toward more napping (shorter idle-delay) and
 *  damps zoomies; the "morning" window biases the other way. Hour is 0–23 local. */
function isNight(hour: number): boolean {
  return hour >= 21 || hour < 7;
}
function isMorning(hour: number): boolean {
  return hour >= 7 && hour < 11;
}

/**
 * Resolve the energy knob (+ optional day/night rhythm) into concrete tuning.
 *
 * @param cfg   The persisted energy settings.
 * @param hour  Local hour 0–23 (injected — the system clock; only consulted when
 *              `cfg.dayNight` is on). Defaults to a neutral mid-day so callers that
 *              don't care about rhythm get the level's plain mapping.
 */
export function resolveEnergy(cfg: EnergyConfig, hour = 12): EnergyTuning {
  if (cfg.level === "off") return OFF_TUNING;
  const row = TABLE[cfg.level];

  // Day/night rhythm (A4, optional): nudge idle-delay and zoomies by time of day.
  // Subtle multipliers, not a different table — it layers on top of the level.
  let delayScale = 1;
  let zoomScale = 1;
  if (cfg.dayNight) {
    if (isNight(hour)) {
      delayScale = 0.6; // naps sooner after dark
      zoomScale = 0.4; // and tears around less
    } else if (isMorning(hour)) {
      delayScale = 1.25; // dawdles a bit before the morning nap
      zoomScale = 1.6; // morning zoomies
    }
  }

  const idleDelayMs =
    cfg.idleDelayMsOverride > 0 ? cfg.idleDelayMsOverride : Math.round(row.idleDelayMs * delayScale);

  const weights: FillerWeights = {
    groom: row.weights.groom,
    yawn: row.weights.yawn,
    zoomies: row.weights.zoomies * zoomScale,
    // Play obeys its own master switch (§5 "play on/off") on top of the energy weight.
    play: cfg.play ? row.weights.play : 0,
  };

  return {
    director: { enabled: true, wanderAfterMs: idleDelayMs, cornerMargin: CORNER_MARGIN },
    // Fillers stay enabled as long as *some* filler can fire. groom/yawn are always
    // > 0 for a non-off level, so this is effectively "on unless off".
    fillers: { enabled: true, minGapMs: row.minGapMs, maxGapMs: row.maxGapMs },
    fillerWeights: weights,
  };
}

/**
 * Pick a filler from the resolved weights, using one rng draw in [0,1). Weights need
 * not sum to 1 (they're normalized here); an all-zero set returns "none". This is the
 * energy-aware replacement for IdleFillers' built-in fixed weighting — the Cat passes
 * it as the weighting when a filler fires so the cadence respects the energy knob.
 */
export function pickFiller(weights: FillerWeights, r: number): "none" | "groom" | "yawn" | "zoomies" | "play" {
  const total = weights.groom + weights.yawn + weights.zoomies + weights.play;
  if (total <= 0) return "none";
  let t = r * total;
  if ((t -= weights.groom) < 0) return "groom";
  if ((t -= weights.yawn) < 0) return "yawn";
  if ((t -= weights.zoomies) < 0) return "zoomies";
  return "play";
}

/** Clamp/coerce an untrusted value to a known energy level (settings load). */
export function normalizeEnergyLevel(value: unknown): EnergyLevel {
  return ENERGY_LEVELS.includes(value as EnergyLevel) ? (value as EnergyLevel) : DEFAULT_ENERGY;
}
