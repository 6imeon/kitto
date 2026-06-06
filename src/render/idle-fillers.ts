// Idle-filler scheduler (KITTO_AMBIENT.md §3 A3 — MA-3).
//
// "Life between the big beats": while the cat is just hanging out (dwelling, not
// reacting, not yet wandering off to nap) this occasionally fires a short filler so
// it never looks frozen — a paw-licking groom, a sleepy yawn, or a burst of zoomies.
//
// PURE: like the Director, it owns no clock and no DOM. The Cat ticks it once per
// *eligible* (dwelling) frame with the frame's dtMs and acts on the returned filler;
// randomness (the gap between fillers, which filler) takes an injected rng so the
// whole thing is deterministic and unit-tested (spec §8, KITTO_AMBIENT §5).

/** What the scheduler proposes. `none` = keep idling; the rest are idle activities the
 *  Cat plays out (groom/yawn = a held pose; zoomies = a quick dash across and back;
 *  play = chase the wool ball, A2). */
export type FillerKind = "none" | "groom" | "yawn" | "zoomies" | "play";

export interface FillerConfig {
  /** Master switch — off ⇒ the cat just sits calmly between the big beats. */
  readonly enabled: boolean;
  /** Shortest idle gap before the next filler may fire (ms of eligible dwelling). */
  readonly minGapMs: number;
  /** Longest idle gap before the next filler fires (ms). */
  readonly maxGapMs: number;
}

export const DEFAULT_FILLER_CONFIG: FillerConfig = {
  enabled: true,
  // Frequent enough to read in a live demo; MA-4's energy slider scales this.
  minGapMs: 2_500,
  maxGapMs: 6_000,
};

export class IdleFillers {
  /** Eligible-dwelling time accumulated since the last filler (ms). */
  private sinceMs = 0;
  /** The randomly-chosen gap to wait before the next filler (ms). */
  private gapMs: number;

  constructor(
    private cfg: FillerConfig = DEFAULT_FILLER_CONFIG,
    private readonly rng: () => number = Math.random,
  ) {
    this.gapMs = this.rollGap();
  }

  /** Live-swap config (MA-4 energy slider). Re-rolls the pending gap under the new range. */
  configure(cfg: FillerConfig): void {
    this.cfg = cfg;
    this.gapMs = this.rollGap();
  }

  /** The cat left the dwelling state (started reacting/walking/napping). Clear the
   *  accumulated idle time so a fresh full gap is required before the next filler. */
  reset(): void {
    this.sinceMs = 0;
    this.gapMs = this.rollGap();
  }

  /**
   * Advance one *eligible* (dwelling) frame. Returns a filler to play when the gap
   * has elapsed — and re-arms for the next one — otherwise `none`. The Cat must only
   * call this while the cat is genuinely idling; call `reset()` on any other frame.
   *
   * `choose` is an optional energy-aware picker (MA-4): given one rng draw in [0,1) it
   * returns which filler to play, so the energy knob can scale the per-filler weights
   * (and suppress zoomies/play). Omitted ⇒ the built-in fixed weighting is used.
   */
  update(dtMs: number, choose?: (r: number) => FillerKind): FillerKind {
    if (!this.cfg.enabled) return "none";
    this.sinceMs += Math.max(0, dtMs);
    if (this.sinceMs < this.gapMs) return "none";
    this.sinceMs = 0;
    this.gapMs = this.rollGap();
    return choose ? choose(this.rng()) : this.pick();
  }

  private rollGap(): number {
    const span = Math.max(0, this.cfg.maxGapMs - this.cfg.minGapMs);
    return this.cfg.minGapMs + this.rng() * span;
  }

  /** Weighted pick: grooming is the commonest, then yawns, then the rarer big beats —
   *  a zoomies dash or a bout of wool-ball play. */
  private pick(): FillerKind {
    const r = this.rng();
    if (r < 0.38) return "groom";
    if (r < 0.62) return "yawn";
    if (r < 0.82) return "zoomies";
    return "play";
  }
}
