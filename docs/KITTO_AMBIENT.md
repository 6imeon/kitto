# Kitto — Ambient Life & Reminders (feature spec)

> Companion to `KITTO_SPEC.md`. Adds a **life layer** (the cat does its own thing when
> you're not interacting) and an **interactive reminders** feature. Sequenced **after M6,
> before M7 (packaging)**. Same rules apply: pnpm only, 7-day dependency gap, build in
> milestone order, report back between milestones, ask before a new dependency (not in
> spec §2) or an architectural change that contradicts a doc.

---

## 0. Why

The cat today is **reactive** — it answers the cursor, keyboard, timers, and the AI agent.
It has no inner life of its own when ignored. This spec gives it one: when you stop paying
attention, it wanders, finds a cozy corner, naps, and occasionally plays. And it gains a
job — delivering reminders you set in plain language, by trotting to the middle of the
screen and getting your attention.

Two pillars:
- **A. Ambient life** — autonomous idle behavior (wander → nap, play, micro-animations).
- **B. Reminders** — typed message + time/timer → cat walks to center and alerts you.

---

## Decisions (locked 2026-06-04)

- **Window model: Option B — fullscreen transparent overlay** (§1).
- **Monitors: primary display only for v1** (no roaming yet).
- **Reminder entry: both** — a Reminders section in the settings window **and** quick-add
  from the right-click panel (§4 / B1).
- **Extra ideas in scope:** A3 micro-animations + A4 cozy-spot polish.
  **Deferred (out of scope for this layer):** A5 gift drop, A5 affection meter, A5
  follow-active-window.

---

## 1. The one architectural decision (resolve first) — DECIDED: Option B

Every behavior below needs the cat to occupy a position **anywhere on screen**, not just a
fixed centered box. Two ways to get there:

**Option A — Move the small window.** Keep the 300×360 window; physically reposition it
across the desktop (`setPosition`, tween per frame). Cat renders exactly as today.
- Pros: minimal change to rendering/click-through; lowest memory.
- Cons: window-move tweening can look steppy; the OS shadow/compositor may lag; corner
  clamping is fiddly; multi-monitor edges are awkward; center-screen alert means moving a
  300px box, which can feel heavy.

**Option B — One fullscreen transparent overlay.** The window covers the whole display
(or each display); the cat is a sprite positioned *within* it. Click-through becomes
**per-region**: the window is click-through except when the cursor is near the cat
(toggle `setIgnoreCursorEvents` from the cat's live bounds — we already do exactly this
toggle, just driven by a moving hit-box instead of a fixed one).
- Pros: smooth sub-pixel motion; trivial to walk edges, sit in corners, dash to center;
  natural home for reminder banners and play props; the clean long-term architecture.
- Cons: a fullscreen always-on-top transparent layer per monitor; must be rigorous that
  it's click-through everywhere except the cat (a bug = the desktop becomes unclickable);
  slightly more care on multi-monitor.

**Recommendation: Option B.** Every feature here is easier and looks better with it, and it
generalizes to multi-monitor and future props. The cost is disciplined click-through
hit-testing, which we already do — just with a moving box.

---

## 2. Behavior model (how it fits the pure state machine)

Keep `CatStateMachine` **pure** (spec §8). The life layer is a new **Director** that sits
*above* the machine and *below* real input:

- The **Director** decides *intent* over seconds/minutes: "wander to the left edge", "nap
  in the bottom-right corner", "go play", "deliver reminder → walk to center". It outputs a
  **target position** and a **desired ambient pose**.
- The existing **priority ladder still wins on real events.** Any genuine interaction —
  cursor hunt, hover/pet, typing, scroll, drag, AI agent working/done, a firing
  timer/reminder — **interrupts** the Director immediately. The cat snaps back to reactive
  mode; when input goes quiet again, the Director resumes after the idle delay.
- Locomotion (moving from A→B) is a thin motion controller that owns position + facing and
  picks Walk/Run frames; the pure machine still owns *which pose* per frame. The Director
  never reaches into the machine's internals — it only proposes intent, exactly like the
  cursor/timer inputs do today.

New ambient states/poses (placeholder art needed, authored as atlas frames per spec §7):
`WalkL/WalkR` (directional), `Run`/zoomies, `LieDown`, `SleepCurled`, `Wake/Stretch`,
`Play` (wool ball), `Groom` (lick paw), `Alert/Meow` (reminder), `Sit`.

---

## 3. Pillar A — Ambient life

### A1. Idle wander → nap (the core ask)
- After **idle for N minutes** (no cursor-near, no input, no agent, configurable; default
  ~3 min) the cat **leaves its spot** and **walks along the screen edges**.
- It **picks a corner** (weighted toward its last favorite; see A4), **lies down**, and
  **sleeps**. Deeper sleep over time (curls tighter, optional "Z" particles).
- **Wake:** click it, or **pet/rub** it (cursor wiggle over the cat, reusing the Pet
  sensor). On wake it does a **Wake/Stretch** then returns to normal reactive behavior.
- Any real input along the way interrupts and wakes it early (§2).

### A2. Play (wool ball)
- Occasionally during idle (not every time — randomized, low probability) the cat **plays
  with a wool ball**: a small prop sprite it bats, chases, and pounces. Ball has simple
  physics (roll + friction + wall bounce). Ends by losing interest → grooms → settles.
- Optional: bat the ball **toward the cursor**, or let the user fling it (drag-throw).

### A3. Micro-animations (life between the big beats)
Short, cheap idle fillers so it never looks frozen: **groom/lick paw**, **ear twitch**,
**tail flick**, **look around**, **yawn**, occasional **zoomies** (a quick dash across the
screen and back). These make the wander/nap loop feel alive rather than scripted.

### A4. Cozy spots & rhythm (polish)
- **Favorite corner memory:** remembers where it last napped and biases toward it.
- **Day/night rhythm (optional):** naps more after dark, more zoomies in the "morning"
  (system clock only — no network).
- **Drag-to-bed:** drag the cat into a corner and it settles/naps there (respects your
  placement).
- **Energy slider (one knob):** Calm ↔ Playful — scales how often it wanders/plays/zooms,
  so people who find motion distracting can dial it down (or off entirely).

### A5. Optional / flag-as-scope-creep
- **Affection meter:** pet it to keep it content; long neglect → mopey idle. Cute but it's
  a commitment mechanic — **opt-in only**, off by default, decide later.
- **Gift drop:** after a long focus/Pomodoro session it leaves a tiny pixel gift (mouse
  toy / heart) by the cursor as a reward. Nice tie-in to existing timers; low priority.
- **Follow active window / typing spot:** trot toward the app you're using. Potentially
  heavy (needs window-focus info per OS) — **stretch goal**, not v1 of this layer.

---

## 4. Pillar B — Reminders

### B1. The interaction
- You **set a reminder**: type a **message** + **when** (a timer like "in 25m", or a clock
  time like "at 3:00pm"). Entry lives in the **settings window** (new "Reminders" section)
  and/or a quick add from the right-click panel.
- When it fires, the cat **walks to the center of the screen**, faces you, plays an
  **Alert/Meow** (optional sound — reuses the M5 chime infra), and shows the **message** in
  a small speech bubble / banner near the cat.
- **Dismiss:** click it. **Snooze:** pet it (or a snooze button) → re-fires in a few
  minutes. After handling, it returns to whatever it was doing.

### B2. Scheduling & reliability
- Scheduling lives in **Rust**, alongside the existing timer manager, so reminders **fire
  across system sleep/wake** (same guarantee M4 timers have — wall-clock, not setTimeout).
- **Persisted** to `~/.kitto/` (reuse the M6 JSON-on-disk pattern; separate file, e.g.
  `reminders.json`) so they **survive restart**. On launch, past-due reminders fire (or are
  marked missed — decide UX).
- **Queue:** multiple reminders; fire in order; if several are due, deliver sequentially.
- **Recurring (optional):** daily/weekly repeat; start simple (one-shot) and add repeat.

### B3. Parsing the "when"
- Start minimal and predictable: relative (`in 25m`, `in 2h`), absolute (`at 15:00`,
  `at 3pm`), and a plain duration field. Avoid a heavy NLP dependency — a small hand-rolled
  parser covers the common cases (and respects the 7-day / dependency rules). Reconsider a
  library only if the parser gets gnarly, and ask first.

---

## 5. Cross-cutting technical notes

- **Window model** (§1) is the prerequisite — resolve before building either pillar.
- **Multi-monitor:** decide whether the cat is confined to the primary display or roams all
  of them. Roaming = one overlay per monitor (Option B) or careful bounds math (Option A).
- **Click-through discipline (Option B):** the *only* solid region is the cat's current
  bounds (+ any open bubble/banner/ball). Everything else stays click-through. This is the
  highest-risk correctness item — cover it carefully.
- **Performance budget holds:** a mascot must stay light (spec §2 — not 150MB idle). Idle
  wandering should be cheap; cap frame work, pause rendering when fully asleep/off-screen,
  throttle the Director (it thinks on a slow cadence, not per-frame).
- **Determinism for tests:** the pure machine stays pure and unit-tested. The Director's
  *decisions* (when to wander, which corner, when to play) should be a pure function of
  (idle time, energy, rng-seed, clock) so they're testable without real timers — keep
  `Date.now()`/`Math.random()` out of the core, inject them.
- **Settings additions:** wander on/off, idle delay, energy slider, play on/off, sound on
  alert, reminders list. All live-applied + persisted via the existing M6 path.
- **New placeholder art:** directional walk/run, lie-down, curled sleep, wake-stretch,
  play, groom, alert/meow, sit — extend `gen-placeholder-art.mjs` + `manifest.json`.

---

## 6. Proposed milestones (build in order, report between)

- **MA-0 — Window model + locomotion spike.** Resolve §1; get the cat to **walk to an
  arbitrary point** (edges, corners, center) smoothly, with click-through still correct and
  reactive states still interrupting. Acceptance: cat walks A→B on command; desktop stays
  clickable everywhere except the cat; typing/cursor still interrupt.
- **MA-1 — Idle wander → corner nap → wake (A1).** The core ask, end to end.
- **MA-2 — Reminders (B).** Settings entry + Rust scheduling + center-screen alert +
  dismiss/snooze + persistence across restart/sleep.
- **MA-3 — Play + micro-animations (A2, A3).** Wool ball + groom/yawn/zoomies fillers.
- **MA-4 — Polish (A4).** Favorite corner, energy slider, day/night, drag-to-bed.
- **(A5 items deferred / opt-in — revisit after MA-4.)**

---

## 7. Open questions — resolved
See **Decisions (locked 2026-06-04)** at the top. Remaining smaller UX calls to settle
during build (not blocking): past-due reminder behavior on launch (fire vs. mark missed),
deep-sleep "Z" particles yes/no, and whether zoomies are on by default at the mid energy
setting.
