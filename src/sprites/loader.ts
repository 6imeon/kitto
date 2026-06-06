// Sprite atlas types + loaders.
// In M0 there is one atlas with a single static Idle frame; the shapes here already
// match the richer multi-frame, multi-state manifest described in KITTO_SPEC §7.

export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Display time in milliseconds (unused for a static M0 frame). */
  duration: number;
}

export interface AtlasState {
  frames: Frame[];
}

export interface Atlas {
  /** Filename of the atlas image, relative to assets/. */
  image: string;
  /**
   * Per-atlas source tile size. Optional: when absent the atlas uses the
   * manifest-wide {@link Manifest.sprite} size. The tuxedo cat ships 48px tiles
   * (sharper face) while the original gray cat stays 32px — both are scaled to the
   * same 64px on-screen footprint by the renderer.
   */
  tile?: { tileWidth: number; tileHeight: number };
  states: Record<string, AtlasState>;
}

export interface Manifest {
  version: number;
  sprite: { tileWidth: number; tileHeight: number };
  atlases: Record<string, Atlas>;
}

/** Decode an image URL into an HTMLImageElement, rejecting on load failure. */
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`sprite image failed to load: ${url}`));
    img.src = url;
  });
}
