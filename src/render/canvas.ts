import type { Frame } from "../sprites/loader";

/** On-screen sprite size in px. Every cat renders to this footprint regardless of its
 *  source tile size: the 32px gray cat upscales ×2, the 48px tuxedo cat ×1.333. */
const ON_SCREEN = 64;

/**
 * Minimal canvas renderer. M0 only draws a single static frame; the
 * AnimationController (M1) will drive frame timing on top of this.
 */
export class CanvasRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  /** Source→screen scale, derived from this atlas's tile size so all cats share a footprint. */
  private readonly scale: number;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    tileW: number,
    tileH: number,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
    this.scale = ON_SCREEN / Math.max(tileW, tileH);
    this.canvas.width = tileW * this.scale;
    this.canvas.height = tileH * this.scale;
    // Keep pixels crisp on upscale.
    this.ctx.imageSmoothingEnabled = false;
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /** Blit one atlas frame to the canvas, scaled. The source may be the raw atlas
   *  image or a recolored offscreen canvas (custom fur, M6) — both are valid
   *  CanvasImageSources with the same frame geometry. */
  drawFrame(img: CanvasImageSource, f: Frame): void {
    this.clear();
    this.ctx.drawImage(img, f.x, f.y, f.w, f.h, 0, 0, f.w * this.scale, f.h * this.scale);
  }

  /**
   * Draw a frame with a live vertical squash + vertical offset, anchored at the feet
   * (bottom of the tile stays planted). Drives the MA "breathing" idle: a subtle
   * volume-preserving squash makes a static sit feel alive. `squashY` 1 = none,
   * <1 = compressed; `offsetY` shifts the whole sprite up by N source-px.
   */
  drawFrameSquashed(img: CanvasImageSource, f: Frame, squashY: number, offsetY: number): void {
    this.clear();
    const s = this.scale;
    const drawH = f.h * s * squashY;
    // Volume-preserving: narrow a touch as it squats.
    const drawW = f.w * s * (1 / squashY) ** 0.5;
    const x = (this.canvas.width - drawW) / 2;
    // Bottom-anchored: feet line stays put, top moves.
    const y = this.canvas.height - drawH - offsetY * s;
    this.ctx.drawImage(img, f.x, f.y, f.w, f.h, x, y, drawW, drawH);
  }

  /**
   * Fill a rectangle given in *source tile* coordinates (pre-upscale), scaled to
   * match {@link drawFrame}. Used to overlay live, cursor-tracking pupils on top
   * of the blank-eyed FollowEyes/Hunt frames (M2) — a pixel here is `SCALE` px wide.
   */
  fillTile(tx: number, ty: number, tw: number, th: number, color: string): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(tx * this.scale, ty * this.scale, tw * this.scale, th * this.scale);
  }
}
