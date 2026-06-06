// Floating pixel Pomodoro timer — M4 (KITTO_SPEC §5: "floating pixel timer
// overlay"). A tiny standalone canvas that floats above the cat and shows MM:SS in
// a hand-coded 3×5 pixel font, tinted by phase, on a soft dark pill so it reads on
// any wallpaper. Non-interactive (pointer-events:none in CSS) — purely display.
//
// Kept off the cat's own canvas so the cat's animation/upscale stay untouched and
// the timer can sit wherever we like in the window.

import { formatClock, type PomodoroState, type PomodoroPhase } from "../timers/pomodoro";

/** 3×5 bitmap glyphs. "1" = lit cell. Colon is 1 cell wide; digits are 3. */
const GLYPHS: Record<string, readonly string[]> = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
  ":": ["0", "1", "0", "1", "0"],
};

const CELL = 5; // device px per bitmap cell
const GAP = 1; // cells between glyphs
const PAD = 2; // cells of pill padding around the text
const ROWS = 5;

/** Phase tint. Focus is a warm "work" red; breaks are calm green/blue. */
const PHASE_COLOR: Record<PomodoroPhase, string> = {
  Focus: "#ff7a66",
  ShortBreak: "#63d29a",
  LongBreak: "#6bb6ff",
};

const PILL = "rgba(18, 18, 24, 0.82)";

export class TimerOverlay {
  private readonly ctx: CanvasRenderingContext2D;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable for the timer overlay");
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;
  }

  /** Repaint for the current Pomodoro state, or hide while idle. */
  render(p: PomodoroState): void {
    if (p.status === "idle") {
      this.hide();
      return;
    }
    const text = formatClock(p.remainingMs);
    const cells = textCells(text);
    const w = (cells + PAD * 2) * CELL;
    const h = (ROWS + PAD * 2) * CELL;

    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.clearRect(0, 0, w, h);

    // Soft pill background.
    this.ctx.fillStyle = PILL;
    roundRect(this.ctx, 0, 0, w, h, CELL);
    this.ctx.fill();

    // A paused timer is dimmed; running is full strength.
    this.ctx.globalAlpha = p.status === "paused" ? 0.5 : 1;
    this.drawText(text, PHASE_COLOR[p.phase], PAD * CELL, PAD * CELL);
    this.ctx.globalAlpha = 1;

    this.canvas.hidden = false;
  }

  hide(): void {
    this.canvas.hidden = true;
  }

  private drawText(text: string, color: string, ox: number, oy: number): void {
    this.ctx.fillStyle = color;
    let x = ox;
    for (const ch of text) {
      const glyph = GLYPHS[ch];
      if (!glyph) continue;
      for (let r = 0; r < glyph.length; r++) {
        const row = glyph[r]!;
        for (let c = 0; c < row.length; c++) {
          if (row[c] === "1") {
            this.ctx.fillRect(x + c * CELL, oy + r * CELL, CELL, CELL);
          }
        }
      }
      x += (glyph[0]!.length + GAP) * CELL;
    }
  }
}

/** Total cell-width of a string in the bitmap font (glyph widths + inter-gaps). */
function textCells(text: string): number {
  let cells = 0;
  for (let i = 0; i < text.length; i++) {
    const glyph = GLYPHS[text[i]!];
    cells += glyph ? glyph[0]!.length : 0;
    if (i < text.length - 1) cells += GAP;
  }
  return cells;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
