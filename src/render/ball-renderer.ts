// Wool-ball renderer — MA-3 / A2 (KITTO_AMBIENT.md §3). A tiny standalone canvas the
// cat plays with: a little yarn ball drawn procedurally and moved to the ball's
// position each frame. Non-interactive (pointer-events:none in CSS) — purely display,
// so it doesn't need its own click-through region (the ambient ball isn't grabbable in
// MA-3; drag-throw is a deferred optional, KITTO_AMBIENT A2).
//
// Kept off the cat's canvas (like the timer overlay) so it can sit anywhere in the
// window independently of the cat sprite.

export interface BallView {
  /** Ball centre in logical px (overlay/DOM space). */
  readonly x: number;
  readonly y: number;
  /** Ball radius in logical px. */
  readonly r: number;
}

/** Device-pixel upscale so the procedural pixels stay crisp on HiDPI. */
const SCALE = 2;
/** A soft, yarny pink-red and a darker line colour for the wound-yarn cross-hatch. */
const YARN = "#d2738a";
const YARN_DARK = "#a8475f";

export class BallRenderer {
  private readonly ctx: CanvasRenderingContext2D;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable for the ball renderer");
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;
  }

  /** Show the ball at `view`, or hide it when play ends (`null`). */
  render(view: BallView | null): void {
    if (!view) {
      this.hide();
      return;
    }
    const r = Math.max(2, Math.round(view.r));
    const logical = r * 2; // on-screen size (logical px)
    const size = logical * SCALE; // device px (crisp pixel upscale)
    if (this.canvas.width !== size) {
      this.canvas.width = size;
      this.canvas.height = size;
      this.canvas.style.width = `${logical}px`;
      this.canvas.style.height = `${logical}px`;
    }

    // Position the canvas so its centre sits on the ball's centre (logical px).
    this.canvas.style.transform = `translate(${view.x - r}px, ${view.y - r}px)`;

    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, size, size);

    const c = r * SCALE; // centre in device px
    const rad = r * SCALE;

    // Body.
    ctx.fillStyle = YARN;
    ctx.beginPath();
    ctx.arc(c, c, rad - 1, 0, Math.PI * 2);
    ctx.fill();

    // A few wound-yarn strands (diagonal cross-hatch) for the "ball of wool" read.
    ctx.strokeStyle = YARN_DARK;
    ctx.lineWidth = SCALE;
    for (const off of [-rad * 0.5, 0, rad * 0.5]) {
      ctx.beginPath();
      ctx.moveTo(c - rad + 1, c + off);
      ctx.lineTo(c + rad - 1, c + off * 0.4 - rad * 0.4);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(c + off, c - rad + 1);
      ctx.lineTo(c + off * 0.4 - rad * 0.4, c + rad - 1);
      ctx.stroke();
    }

    this.canvas.hidden = false;
  }

  hide(): void {
    this.canvas.hidden = true;
  }
}
