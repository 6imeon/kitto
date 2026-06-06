// In-app prompt shown when the OS denies Kitto's global input hook (M3).
//
// The overlay is a tiny, click-through window, so this is a small, non-interactive
// banner near the cat plus a clear, actionable console message with the exact
// settings path. It does NOT deep-link into System Settings (that would need an
// extra Tauri plugin outside the approved set); the steps are in the README too.

const HINT_ID = "perm-hint";
const VISIBLE_MS = 12_000;

/** The exact enable path, kept in one place (also logged for copy/paste). */
const MAC_STEPS =
  "macOS → System Settings → Privacy & Security → Input Monitoring (and " +
  "Accessibility) → enable Kitto, then relaunch.";

let hideTimer: number | undefined;

/**
 * Reveal the permission hint. Idempotent and safe to call repeatedly — it just
 * resets the auto-hide timer. Logs the full instructions to the console as well.
 */
export function showInputPermissionHint(): void {
  console.error(
    `[kitto] global keyboard/scroll hook was denied. Typing/scroll reactions ` +
      `are off until you grant input access:\n  ${MAC_STEPS}`,
  );

  const hint = document.getElementById(HINT_ID);
  if (!hint) return; // No DOM (e.g. tests) — the console message still fired.

  hint.textContent = `⚠ Kitto needs Input Monitoring to react to typing & scroll. ${MAC_STEPS}`;
  hint.hidden = false;

  if (hideTimer !== undefined) clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    hint.hidden = true;
  }, VISIBLE_MS);
}
