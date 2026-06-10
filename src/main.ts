import { getCurrentWindow } from "@tauri-apps/api/window";
import manifest from "../assets/manifest.json";
import catAtlasUrl from "../assets/cat-atlas.png";
import catTuxedoAtlasUrl from "../assets/cat-tuxedo-atlas.png";
import catGingerAtlasUrl from "../assets/cat-ginger-atlas.png";
import patternTabbyUrl from "../assets/pattern-tabby.png";
import patternTuxedoUrl from "../assets/pattern-tuxedo.png";
import patternCalicoUrl from "../assets/pattern-calico.png";
import { loadImage } from "./sprites/loader";
import { buildCatCanvas } from "./sprites/recolor";
import { onCursor } from "./ipc/cursor";
import { onKey, onScroll, onInputPermission } from "./ipc/input";
import { onAgent } from "./ipc/agent";
import { showInputPermissionHint } from "./ui/permission-hint";
import { Cat, type BlinkEyes, type EyeConfig } from "./cat";
import { loadSettings, normalize, type Settings, type Appearance, type PatternId } from "./config/settings";
import { listen, emit } from "@tauri-apps/api/event";
import { TimerManager } from "./timers/manager";
import { TimerOverlay } from "./render/timer-overlay";
import { BallRenderer } from "./render/ball-renderer";
import { Controls } from "./ui/controls";
import { playDoneChime, unlockAudioOnFirstGesture } from "./audio/chime";
import { ReminderManager } from "./reminders/manager";
import { loadReminders, saveReminders } from "./reminders/persist";
import { normalizeReminders, type Reminder } from "./reminders/model";
import { parseWhen } from "./reminders/parse";
import { ReminderBanner } from "./render/reminder-banner";
import { StretchBanner } from "./render/stretch-banner";

/** How far ahead the Snooze button pushes a reminder (MA-2 / B1). */
const SNOOZE_MS = 5 * 60_000;

/** Cross-window sync of the reminder list (overlay ⇆ settings window), mirroring
 *  `kitto://settings-changed`. Both windows persist reminders.json and broadcast this. */
const REMINDERS_CHANGED = "kitto://reminders-changed";

/** A short, friendly absolute time for the quick-add confirmation (e.g. "3:00 PM"). */
function formatFireAt(fireAt: number): string {
  return new Date(fireAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// Pattern mask atlases (M6 custom fur). Loaded lazily + cached the first time a
// pattern is selected; "none" needs no mask.
const MASK_URL: Record<Exclude<PatternId, "none">, string> = {
  tabby: patternTabbyUrl,
  tuxedo: patternTuxedoUrl,
  calico: patternCalicoUrl,
};
const maskCache = new Map<string, HTMLImageElement>();

async function maskFor(pattern: PatternId): Promise<HTMLImageElement | null> {
  if (pattern === "none") return null;
  const url = MASK_URL[pattern];
  let img = maskCache.get(url);
  if (!img) {
    img = await loadImage(url);
    maskCache.set(url, img);
  }
  return img;
}

/** Build the recolored (+ optionally patterned) atlas canvas for an appearance. */
async function buildSkin(base: HTMLImageElement, a: Appearance): Promise<HTMLCanvasElement> {
  return buildCatCanvas(base, a.furColor, await maskFor(a.pattern));
}

/**
 * Resolve the sprite assets for the chosen cat breed. The gray cat is recolorable
 * (its skin is built from furColor+pattern); the tuxedo cat is a fixed-palette preset
 * with its own 48px atlas — recolor doesn't apply, so its raw image is used as-is.
 * Returns the image source, the atlas definition, and that atlas's source tile size.
 */
async function buildCatSkin(
  a: Appearance,
): Promise<{
  image: CanvasImageSource;
  atlas: typeof manifest.atlases.cat;
  tile: { w: number; h: number };
  blinkEyes?: BlinkEyes;
  eyes?: EyeConfig;
}> {
  if (a.cat === "ginger") {
    // The portfolio-style vector cat, baked to an 88×92 atlas (scripts/bake-vector-cat.py).
    // Like the tuxedo it's a fixed-palette preset — recolor/pattern don't apply. Its larger
    // tile means its own eye geometry: the blink boxes and the FollowEyes/Hunt pupils are in
    // 88px-tile px (a body-grid cell (gx,gy) lands at ((gx+2)*4, (gy+4)*4); eyes are grid
    // cols 5-6/11-12, rows 5-6 → the 8×8 boxes below).
    const atlas = manifest.atlases.catGinger;
    const image = await loadImage(catGingerAtlasUrl);
    const t = atlas.tile ?? manifest.sprite;
    return {
      image,
      atlas,
      tile: { w: t.tileWidth, h: t.tileHeight },
      blinkEyes: {
        color: "#e3933f", // ginger fur — paints the open eyes shut on a blink
        rects: [
          { x: 28, y: 36, w: 8, h: 8 },
          { x: 52, y: 36, w: 8, h: 8 },
        ],
      },
      // Live cursor-tracking pupils: a 4×4 pupil centred in each 8×8 sclera box, sliding 4px
      // (one grid cell) toward the cursor. The baked FollowEyes/Hunt frames leave the sclera
      // blank for exactly this overlay.
      eyes: {
        left: { x: 30, y: 38 },
        right: { x: 54, y: 38 },
        pupil: 4,
        travel: 4,
        color: "#2c1d0f",
      },
    };
  }
  if (a.cat === "tuxedo") {
    const atlas = manifest.atlases.catTuxedo;
    const image = await loadImage(catTuxedoAtlasUrl);
    const t = atlas.tile ?? manifest.sprite;
    return {
      image,
      atlas,
      tile: { w: t.tileWidth, h: t.tileHeight },
      // Eye boxes measured in the 48px front-sit tile (the resting pose). Painted with
      // the tuxedo's near-black fur to read as shut eyes on a blink.
      blinkEyes: {
        color: "#26242a",
        rects: [
          { x: 18, y: 13, w: 5, h: 4 },
          { x: 29, y: 13, w: 6, h: 4 },
        ],
      },
    };
  }
  const base = await loadImage(catAtlasUrl);
  const image = await buildSkin(base, a);
  return {
    image,
    atlas: manifest.atlases.cat,
    tile: { w: manifest.sprite.tileWidth, h: manifest.sprite.tileHeight },
  };
}

// M2: the Rust core streams the global cursor position (window-local logical px)
// to the webview — the cat follows it with its eyes, hunts a fast flick, and purrs
// when hovered. M3 adds global keyboard + scroll streams — sustained typing makes
// it Type (and overheat when furious), scrolling triggers the paper-unroll Scroll.
// M4 adds timers: a stretch reminder (Stretch pose) and a Pomodoro focus/break loop
// with a floating pixel timer; right-clicking the cat opens a panel to set the
// intervals and drive the Pomodoro. M5 adds the differentiator: the Rust core
// watches a normalized AI-agent status file (written by the Claude Code hooks) and
// streams it here — a working agent makes the cat Think, finishing makes it Jump
// (with an optional chime). While the cursor is off the cat (and no panel is open)
// the overlay stays click-through so the desktop underneath is usable.
async function main(): Promise<void> {
  const canvas = document.getElementById("cat");
  const timerCanvas = document.getElementById("timer");
  const ballCanvas = document.getElementById("ball");
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error("#cat canvas element not found");
  }
  if (!(timerCanvas instanceof HTMLCanvasElement)) {
    throw new Error("#timer canvas element not found");
  }
  if (!(ballCanvas instanceof HTMLCanvasElement)) {
    throw new Error("#ball canvas element not found");
  }
  const ballRenderer = new BallRenderer(ballCanvas);

  const appWindow = getCurrentWindow();

  // Let the agent-done chime play on the first interaction (browsers keep audio
  // suspended until a user gesture — otherwise the first, most-wanted chime is mute).
  unlockAudioOnFirstGesture();

  // The window is click-through except (a) while the cursor is over the cat,
  // (b) while the controls panel is open, or (c) while a drag is in progress (the
  // pointer can briefly outrun the cat's bounds, and we must keep receiving moves).
  // Track all three and reconcile in one place.
  let overCat = false;
  let panelOpen = false;
  let forceInteractive = false;
  let reminderOpen = false; // a reminder banner is up (interactive) — MA-2
  const applyClickThrough = (): void => {
    void appWindow.setIgnoreCursorEvents(
      !(overCat || panelOpen || forceInteractive || reminderOpen),
    );
  };

  // `controls` and `timers` are referenced by closures created before they exist
  // (the timer tick refreshes the panel; the cat's onJump reads the live sound
  // setting the manager owns), so declare them up front and assign below.
  let controls: Controls;
  let timers: TimerManager;
  // Assigned once the reminder manager exists (below); the pointerdown handler above
  // calls it so a click on the cat dismisses an active reminder (MA-2 / B1).
  let dismissActiveReminder: () => void = () => {};

  // Settings are the single source of truth (now JSON on disk via the Rust core).
  // Load once: the fur appearance builds the cat's skin, the rest drives timers.
  const settings = await loadSettings();
  const catSkin = await buildCatSkin(settings.appearance);
  const cat = new Cat(
    canvas,
    catSkin.image,
    catSkin.atlas,
    catSkin.tile,
    {
      // MA-1: the ambient Director now owns napping — an idle cat walks to a corner
      // and lies down there. So disable the old in-place auto-doze (it would sleep
      // mid-overlay and block the wander); the Director is the sole path to Sleep.
      sleepAfterMs: Number.POSITIVE_INFINITY,
      // Per-cat blink eye region (tuxedo/ginger supply it; gray omits → no painted blink).
      blinkEyes: catSkin.blinkEyes,
      // Per-cat pupil-tracking geometry (ginger supplies its 88px-tile eyes; others default).
      eyes: catSkin.eyes,
      // The live overlay size drives the Director's nap corners (and tracks resizes).
      viewport: () => ({ w: window.innerWidth, h: window.innerHeight }),
      // MA-4 / A4: the Calm↔Playful energy knob + day/night rhythm + play toggle now
      // own the wander/nap cadence and filler weights. Persisted in settings.ambient.
      energy: settings.ambient,
      onHover: (over) => {
        overCat = over;
        applyClickThrough();
      },
      // M5: a watched agent finished → celebratory Jump. Chime if the user left it on.
      onJump: () => {
        if (timers.currentSettings.soundOnDone) playDoneChime();
      },
      // MA-3 / A2: render (or hide) the wool ball as the cat plays with it.
      onBall: (view) => ballRenderer.render(view),
    },
  );
  cat.setReactions(settings.reactions);

  // MA-0 (ambient layer): the overlay now fills the screen, so the cat needs a
  // starting position. Centre it until the user (or, later, the Director) sends it
  // somewhere. Re-centre on resize *only* while it hasn't been told to walk yet —
  // a Rust-side resize-to-fullscreen lands shortly after load, and we don't want it
  // to teleport a cat that's mid-stroll.
  let userDirected = false;
  const recenter = (): void => {
    if (userDirected) return;
    // Don't yank a cat that's mid-stroll or napping — the Director owns its position
    // then, and a teleport would clear its walk target and strand it. Recentre only a
    // settled, idle cat (e.g. the startup placeholder→fullscreen resize).
    if (cat.walking || cat.state === "Sleep") return;
    cat.placeAt(window.innerWidth / 2, window.innerHeight / 2);
  };
  recenter();
  window.addEventListener("resize", recenter);

  // Drag the cat to reposition it (the MA-4 "drag-to-bed" interaction, pulled
  // forward — on a fullscreen overlay we move the *sprite*, not the window). A plain
  // tap (press + release without dragging) just wakes/pets: the pointerdown already
  // fires `notifyActivity`, which wakes a napping cat and resets the idle clock so
  // the Director stands down (MA-1). No more MA-0 random-walk spike — ambient
  // locomotion is the Director's job now.
  const DRAG_THRESHOLD = 3; // px of motion before a press counts as a drag, not a tap
  let dragging = false;
  let movedDuringDrag = false; // did this press ever cross the drag threshold? (tap vs drag)
  let grab = { x: 0, y: 0 }; // (cat centre − pointer) at grab time, so it doesn't jump
  let pressClient = { x: 0, y: 0 }; // pointer position at press, for tap-vs-drag distance
  let sleepWoken = false; // did THIS press complete the triple-click that woke a sleeping cat?
  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return; // primary button only — right-click opens the panel
    // Clicking the cat while it's delivering a reminder dismisses it (B1: "click it").
    if (cat.deliveringReminder) {
      dismissActiveReminder();
      return;
    }
    dragging = true;
    movedDuringDrag = false;
    sleepWoken = false;
    userDirected = true;
    grab = { x: cat.position.x - e.clientX, y: cat.position.y - e.clientY };
    pressClient = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
    // A deeply-sleeping cat ignores ordinary input — only a triple-click rouses it.
    // Route the click through the counter instead of the normal grab/wake; a real drag
    // (movedDuringDrag) still wakes it via notifyActivity in pointermove.
    if (cat.sleeping) {
      sleepWoken = cat.handleSleepClick(); // true once the 3rd click lands
    } else {
      cat.notifyActivity(); // grabbing/tapping an awake-but-napping cat wakes it
    }
    forceInteractive = true; // keep the window interactive even if the cursor outruns the cat
    applyClickThrough();
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    // Only start moving the cat once past a small threshold, so a tiny jitter during
    // a tap doesn't nudge it.
    if (Math.hypot(e.clientX - pressClient.x, e.clientY - pressClient.y) <= DRAG_THRESHOLD) {
      return;
    }
    movedDuringDrag = true; // crossed the threshold → a drag, not a tap
    cat.notifyActivity(); // grabbing & dragging always rouses a sleeping cat
    const { w, h } = cat.size;
    const nx = clamp(e.clientX + grab.x, w / 2, window.innerWidth - w / 2);
    const ny = clamp(e.clientY + grab.y, h / 2, window.innerHeight - h / 2);
    cat.placeAt(nx, ny);
  });

  const endDrag = (e: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    forceInteractive = false;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    applyClickThrough();
  };
  // How close to a corner (fraction of the screen's shorter side) a drag must drop
  // for the cat to settle into "bed" there (MA-4 / A4 drag-to-bed). Drop elsewhere and
  // it's just a reposition.
  const BED_ZONE_FRAC = 0.18;
  canvas.addEventListener("pointerup", (e) => {
    // A clean tap (press + release without dragging) sends the cat off on a wander
    // (MA-2 tap-to-wander — the user wanted this alongside the autonomous idle wander).
    // Read the tap *before* endDrag resets the flags. A reminder-dismiss tap returned
    // early in pointerdown (dragging never set), so wasTap is false there.
    const wasTap = dragging && !movedDuringDrag;
    const wasDrag = dragging && movedDuringDrag;
    const wokeIt = sleepWoken;
    endDrag(e);
    // A tap on a sleeping cat is a wake-click (counts toward the triple-click), never a
    // tap-to-wander — even the click that completes the wake just rouses it, no stroll.
    if (wasTap && !wokeIt && !cat.sleeping) {
      cat.wanderNow();
    } else if (wasDrag) {
      // Drag-to-bed (A4): if dropped in a corner, the cat settles & naps there (and
      // remembers it as its favourite). Dropped anywhere else, it stays put.
      const { x, y } = cat.position;
      const zone = Math.min(window.innerWidth, window.innerHeight) * BED_ZONE_FRAC;
      const nearX = x < zone || x > window.innerWidth - zone;
      const nearY = y < zone || y > window.innerHeight - zone;
      if (nearX && nearY) cat.napAt();
    }
  });
  canvas.addEventListener("pointercancel", endDrag);

  cat.start();

  // M4 timers. The manager runs its own wall-clock loop (so it fires across system
  // sleep/wake); it drives the cat's Stretch pose and the floating timer overlay.
  const overlay = new TimerOverlay(timerCanvas);
  const stretchBanner = new StretchBanner();
  timers = new TimerManager(settings, {
    // A stretch reminder: the cat strikes the stretch pose AND a big "STRETCH!" flashes
    // centre-screen to actually prompt the user to stretch (not just the cat).
    onStretchChange: (active) => {
      cat.setStretching(active);
      stretchBanner.setVisible(active);
    },
    onChange: (pomo) => {
      overlay.render(pomo);
      controls.update(pomo);
    },
  });
  // MA-2 reminders. The manager owns its own wall-clock loop (so reminders fire
  // across system sleep/wake and restart, like the timers); when one is due it walks
  // the cat to centre and raises the banner. Persisted to ~/.kitto/reminders.json and
  // kept in sync with the settings window via the `kitto://reminders-changed` event.
  const banner = new ReminderBanner({
    onDismiss: () => dismissActiveReminder(),
    onSnooze: () => {
      const active = reminders.active;
      if (active) reminders.snooze(active.id, SNOOZE_MS);
      cat.endReminder();
      banner.hide();
    },
    onOpenChange: (open) => {
      reminderOpen = open;
      applyClickThrough();
    },
  });
  const initialReminders = await loadReminders();
  const reminders = new ReminderManager(initialReminders, {
    onDeliver: (r) => {
      cat.deliverReminder();
      banner.show(r.message);
      if (timers.currentSettings.soundOnDone) playDoneChime(); // reuse the M5 chime (B1)
    },
    onChange: (list) => {
      void saveReminders(list);
      void emit(REMINDERS_CHANGED, list);
    },
  });
  dismissActiveReminder = (): void => {
    const active = reminders.active;
    if (active) reminders.remove(active.id);
    cat.endReminder();
    banner.hide();
  };

  controls = new Controls(timers, {
    onOpenChange: (open) => {
      panelOpen = open;
      applyClickThrough();
    },
    onAddReminder: (message, when) => {
      const parsed = parseWhen(when, Date.now());
      if (!parsed.ok) return { ok: false, message: parsed.error };
      reminders.add(message, parsed.fireAt);
      return { ok: true, message: `Reminder set for ${formatFireAt(parsed.fireAt)}.` };
    },
  });
  timers.start();
  reminders.start();

  // Keep the overlay's reminder list in sync with edits made in the settings window
  // (it writes reminders.json + broadcasts). reload() doesn't re-persist, so there's
  // no feedback loop with our own onChange emit above.
  listen<Reminder[]>(REMINDERS_CHANGED, (event) => {
    reminders.reload(normalizeReminders(event.payload));
  }).catch((err) => {
    console.error("[kitto] reminders-changed listener unavailable", err);
  });

  // M6: the settings window persists edits and broadcasts this event; apply them
  // to the live overlay so changes take effect without a restart — fur recolor,
  // reaction toggles, and timer intervals all update in place.
  listen<Settings>("kitto://settings-changed", (event) => {
    const s = normalize(event.payload);
    timers.updateSettings(s); // also refreshes the quick panel + soundOnDone for onJump
    cat.setReactions(s.reactions);
    cat.setEnergy(s.ambient); // live-apply the energy knob / day-night / play toggle (MA-4)
    // Breed switches change the source tile size (32px gray vs 48px tuxedo), which the
    // renderer fixes at construction — so a live swap needs a reload. furColor/pattern
    // changes on the gray cat live-apply via setSkin. The tuxedo is a fixed preset.
    if (s.appearance.cat !== settings.appearance.cat) {
      void appWindow.emit("kitto://reload");
      window.location.reload();
    } else if (s.appearance.cat === "gray") {
      void loadImage(catAtlasUrl)
        .then((base) => buildSkin(base, s.appearance))
        .then((next) => cat.setSkin(next));
    }
  }).catch((err) => {
    console.error("[kitto] settings-changed listener unavailable", err);
  });

  // Right-click the cat → open the controls panel. Suppress the native context
  // menu everywhere (a frameless pet shouldn't show a webview menu).
  window.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (e.target === canvas) controls.open();
  });

  // Feed the global input streams into the cat. A failure here just means no
  // reactions of that kind (e.g. running outside Tauri) — the cat still animates.
  onCursor(({ x, y }) => cat.handleCursor(x, y)).catch((err) => {
    console.error("[kitto] cursor stream unavailable", err);
  });
  onKey(() => cat.handleKey()).catch((err) => {
    console.error("[kitto] key stream unavailable", err);
  });
  onScroll(() => cat.handleScroll()).catch((err) => {
    console.error("[kitto] scroll stream unavailable", err);
  });

  // M5: the AI-agent status stream (Rust watches ~/.kitto/agent-status). working →
  // Think, done → Jump. If no agent is ever present this simply never fires.
  onAgent((status) => cat.handleAgent(status)).catch((err) => {
    console.error("[kitto] agent stream unavailable", err);
  });

  // If the OS denied the global input hook (macOS Accessibility / Input
  // Monitoring), guide the user to enable it. The cat keeps working meanwhile —
  // it just won't react to typing/scrolling until the permission is granted.
  onInputPermission((granted) => {
    if (!granted) showInputPermissionHint();
  }).catch((err) => {
    console.error("[kitto] input-permission channel unavailable", err);
  });
}

main().catch((err) => {
  console.error("[kitto] init failed", err);
});
