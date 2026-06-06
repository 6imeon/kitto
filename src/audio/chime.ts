// A tiny synthesized "agent finished" chime — M5 (KITTO_SPEC §M5: "happy hop +
// optional sound"; v1 scope: sound effects are in). Generated with the Web Audio
// API so there is no asset to ship, decode, or cache — just a short, bright major
// arpeggio under a quick decay envelope. Toggleable via settings (`soundOnDone`).
//
// The AudioContext is created lazily and shared: building one per play leaks
// contexts, and browsers cap how many you can open. Autoplay policy may keep a
// fresh context "suspended" until the first user gesture — the cat gets clicked
// and dragged constantly, so by the time an agent finishes it is almost always
// unlocked; we still call resume() defensively. Every call is best-effort and
// swallows errors (no audio device, policy block) — sound must never break the cat.

let ctx: AudioContext | null = null;

/** Notes of the chime (Hz): a C-major triad up to the octave — a cheerful "ta-da". */
const NOTES = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
const NOTE_MS = 90; // stagger between note onsets
const TONE_MS = 320; // each note's full ring-out

function audioContext(): AudioContext | null {
  if (ctx) return ctx;
  // Safari historically only exposed the prefixed constructor.
  const Ctor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  return ctx;
}

let unlockBound = false;

/**
 * Unlock audio on the first user gesture. Browsers create an AudioContext in a
 * "suspended" state and only let `resume()` take effect from within a user-gesture
 * handler — so without this the *first* agent-done chime would be silent (the very
 * moment we most want a sound). Clicking/dragging the cat or opening the controls
 * panel are DOM gestures in the webview; the first one resumes the context, then we
 * unbind. Call once at startup. No-op (and harmless) if Web Audio is unavailable.
 */
export function unlockAudioOnFirstGesture(): void {
  if (unlockBound) return;
  unlockBound = true;
  const unlock = (): void => {
    const ac = audioContext();
    if (ac && ac.state === "suspended") void ac.resume().catch(() => {});
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}

/** Play the agent-done chime. Best-effort and silent on failure. */
export function playDoneChime(): void {
  const ac = audioContext();
  if (!ac) return;
  // A suspended context (autoplay policy) produces nothing until resumed.
  void ac.resume().catch(() => {});

  const now = ac.currentTime;
  NOTES.forEach((freq, i) => {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "triangle"; // soft, slightly hollow — reads as "chiptune", fits the pixel cat
    osc.frequency.value = freq;

    const start = now + (i * NOTE_MS) / 1000;
    const end = start + TONE_MS / 1000;
    // Pluck envelope: near-instant attack, exponential decay to (near) silence.
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.18, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    osc.connect(gain).connect(ac.destination);
    osc.start(start);
    osc.stop(end + 0.02);
  });
}
