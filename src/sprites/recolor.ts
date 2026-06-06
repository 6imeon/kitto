// Custom-fur recolor pipeline — M6 (KITTO_SPEC §7).
//
// "Palette swap": the placeholder art is authored with a small flat palette, so a
// fur recolor is an exact-match remap of the two fur indices onto a user-chosen
// color, painted onto an offscreen canvas at load time. The renderer then blits
// frames from that canvas instead of the raw atlas — same frame rects, recolored
// pixels. Pattern is a *separate overlay mask layer*: a same-geometry mask atlas
// whose marker pixels encode a role; we resolve each role to a final color (the
// `dark` role derives from the chosen fur, so tabby stripes track it) and
// composite it only over fur pixels.
//
// The constants below MUST match the art generator (scripts/gen-placeholder-art.mjs):
// PAL.B / PAL.R for the fur indices, and the MARK marker colors for the roles.

import type { PatternId } from "../config/settings";

type RGB = readonly [number, number, number];

/** Source fur indices in the atlas (PAL.B = base fur, PAL.R = overheat flush). */
const FUR_BASE: RGB = [120, 120, 130];
const FUR_FLUSH: RGB = [200, 90, 80];

/** Mask marker colors → roles (must match MARK in the art generator). */
const ROLE_DARK: RGB = [255, 0, 255]; // tabby stripes / calico dark patch
const ROLE_WHITE: RGB = [0, 255, 255]; // tuxedo chest/paws
const ROLE_GINGER: RGB = [255, 255, 0]; // calico ginger patch

/** Fixed patch colors for the non-derived roles. */
const WHITE_PATCH: RGB = [245, 245, 248];
const GINGER_PATCH: RGB = [222, 140, 74];

/** Parse `#rrggbb` → [r,g,b]. Assumes a validated hex (see settings.normalize). */
export function parseHex(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** Scale each channel toward black by `f` ∈ [0,1] (0 = unchanged, 1 = black). */
export function darken([r, g, b]: RGB, f: number): RGB {
  const k = 1 - f;
  return [Math.round(r * k), Math.round(g * k), Math.round(b * k)];
}

function eq(px: Uint8ClampedArray, o: number, [r, g, b]: RGB): boolean {
  return px[o] === r && px[o + 1] === g && px[o + 2] === b;
}

/** Map a mask marker pixel to its [color, alpha] overlay, or null if not a marker. */
function resolveRole(m: Uint8ClampedArray, o: number, fur: RGB): [RGB, number] | null {
  if (m[o + 3] === 0) return null; // transparent → no pattern here
  if (eq(m, o, ROLE_DARK)) return [darken(fur, 0.45), 0.55]; // translucent: fur shows through
  if (eq(m, o, ROLE_WHITE)) return [WHITE_PATCH, 1];
  if (eq(m, o, ROLE_GINGER)) return [GINGER_PATCH, 1];
  return null;
}

/**
 * Pure pixel transform (no DOM) so it is unit-testable: remaps the fur indices in
 * `px` to `furColor`, then composites the optional pattern `mask` over fur pixels.
 * Mutates `px` in place. `mask`, when present, is the same-length RGBA buffer of
 * the matching pattern atlas.
 */
export function applyRecolor(
  px: Uint8ClampedArray,
  mask: Uint8ClampedArray | null,
  furColor: string,
): void {
  const fur = parseHex(furColor);
  const flush = blend(fur, [205, 70, 60], 0.5); // overheat: chosen fur pushed toward hot red
  for (let o = 0; o < px.length; o += 4) {
    if (px[o + 3] === 0) continue; // transparent
    if (eq(px, o, FUR_BASE)) writeRgb(px, o, fur);
    else if (eq(px, o, FUR_FLUSH)) writeRgb(px, o, flush);
    if (mask) {
      const role = resolveRole(mask, o, fur);
      if (role) writeRgb(px, o, blend(rgbAt(px, o), role[0], role[1]));
    }
  }
}

function rgbAt(px: Uint8ClampedArray, o: number): RGB {
  return [px[o]!, px[o + 1]!, px[o + 2]!];
}

function writeRgb(px: Uint8ClampedArray, o: number, [r, g, b]: RGB): void {
  px[o] = r;
  px[o + 1] = g;
  px[o + 2] = b;
}

/** Linear per-channel blend: a*(1-t) + b*t. */
export function blend([ar, ag, ab]: RGB, [br, bg, bb]: RGB, t: number): RGB {
  const k = 1 - t;
  return [Math.round(ar * k + br * t), Math.round(ag * k + bg * t), Math.round(ab * k + bb * t)];
}

/**
 * Build the recolored (and optionally patterned) atlas as an offscreen canvas the
 * renderer can blit from. DOM-dependent; the pixel work is delegated to the pure
 * {@link applyRecolor}. If the base color is the default and there is no pattern,
 * the result is pixel-identical to the source atlas.
 */
export function buildCatCanvas(
  base: HTMLImageElement,
  furColor: string,
  mask: HTMLImageElement | null,
): HTMLCanvasElement {
  const w = base.naturalWidth;
  const h = base.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("recolor: 2D context unavailable");
  ctx.imageSmoothingEnabled = false;

  ctx.drawImage(base, 0, 0);
  const img = ctx.getImageData(0, 0, w, h);

  let maskData: Uint8ClampedArray | null = null;
  if (mask) {
    const mc = document.createElement("canvas");
    mc.width = w;
    mc.height = h;
    const mctx = mc.getContext("2d", { willReadFrequently: true });
    if (mctx) {
      mctx.imageSmoothingEnabled = false;
      mctx.drawImage(mask, 0, 0);
      maskData = mctx.getImageData(0, 0, w, h).data;
    }
  }

  applyRecolor(img.data, maskData, furColor);
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** The asset filename of a pattern's mask atlas, or null for "none". */
export function patternMaskFile(pattern: PatternId): string | null {
  return pattern === "none" ? null : `pattern-${pattern}.png`;
}
