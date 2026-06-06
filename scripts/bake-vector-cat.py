#!/usr/bin/env python3
"""Bake the vector pixel-cat ("ginger") into a PNG sprite atlas + manifest states.

This is the Option-A integration of the portfolio-style vector cat (see
scripts/art-candidates/vector-cat-preview.html): the poses are authored as pure
pixel-art rectangles on the portfolio's 17×17 body grid and rasterized directly
with PIL — every rect lands on integer pixels, so the atlas is perfectly crisp and
the bake is fully deterministic (no SVG engine in the loop). The runtime then treats
it exactly like the gray/tuxedo atlases — the state machine / recolor / breathing /
blink are all unchanged.

Coordinates: a pose is a list of grid rects. Each frame cell pads the body by
(PAD_X, PAD_Y) so props can sit above the head (steam, zZ, sparkle) and below the
feet (keyboard, motion lines). A body-grid cell (gx,gy) lands at source-tile pixel
((gx+PAD_X)*SCALE, (gy+PAD_Y)*SCALE) — that mapping is how the per-cat eye/blink
boxes in src/main.ts were derived.

Output (the atlas PNG is what ships; the states JSON is pasted into the manifest):
  assets/cat-ginger-atlas.png                 horizontal strip of all frames
  scripts/art-candidates/ginger-states.json   catGinger manifest block

Run:  python3 scripts/bake-vector-cat.py
"""

import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("needs Pillow (PIL) to rasterize the atlas. `pip3 install Pillow`")

ROOT = Path(__file__).resolve().parent.parent
OUT_PNG = ROOT / "assets" / "cat-ginger-atlas.png"

# ── Stage geometry ────────────────────────────────────────────────────────────
PAD_X, PAD_Y = 2, 4          # body-grid → cell offset (prop room left/top)
CELL_W, CELL_H = 22, 23      # one frame cell in grid units (17 body + padding)
SCALE = 4                    # px per grid unit → 88×92 px source tile
TILE_W, TILE_H = CELL_W * SCALE, CELL_H * SCALE

# ── Palette · premium warm ginger tabby (cream belly, green eyes) ──────────────
FUR    = "#e3933f"   # warm ginger body
FURHI  = "#efb368"   # lighter ginger (top of head / highlight)
CREAM  = "#f7e7c8"   # cream muzzle + belly
STRIPE = "#bd6a26"   # darker ginger tabby markings
PINK   = "#e89a86"   # nose + inner ear
EYE    = "#79bf61"   # green eyes
DARK   = "#2c1d0f"   # pupils, mouth, accents
RED    = "#e5705a"   # overheat flush / steam
BLUE   = "#7cc1d7"   # sweat drop
WHITE  = "#fbf3e4"   # sparkle / zZ
AMBER  = "#f0b56f"   # motion lines / tap marks (warm accent)


def _rgba(hex_color, opacity):
    h = hex_color.lstrip("#")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return (r, g, b, round(255 * (1.0 if opacity is None else opacity)))


def R(x, y, w, h, fill, opacity=None):
    """One pixel rect in body-grid coords → (x, y, w, h, (r,g,b,a))."""
    return (x, y, w, h, _rgba(fill, opacity))


# ── Body ──────────────────────────────────────────────────────────────────────
def body(dy=0):
    """The shared ginger-tabby body. `dy` shifts the whole cat up (bob/hop)."""
    o = lambda y: y - dy
    p = []
    # fur — ears, head, torso, feet, tail
    p += [
        R(3, o(0), 1, 3, FUR), R(3, o(1), 2, 1, FUR), R(3, o(2), 3, 1, FUR),
        R(14, o(0), 1, 3, FUR), R(13, o(1), 2, 1, FUR), R(12, o(2), 3, 1, FUR),
        R(3, o(3), 12, 6, FUR),
        R(4, o(9), 10, 6, FUR),
        R(5, o(15), 8, 1, FUR), R(5, o(16), 2, 1, FUR), R(11, o(16), 2, 1, FUR),
        R(14, o(10), 2, 1, FUR), R(15, o(11), 2, 2, FUR), R(14, o(13), 2, 1, FUR),
    ]
    # lighter crown highlight
    p += [R(4, o(3), 10, 1, FURHI), R(4, o(4), 1, 4, FURHI), R(13, o(4), 1, 4, FURHI)]
    # cream muzzle + belly
    p += [R(6, o(7), 6, 2, CREAM), R(6, o(12), 6, 3, CREAM)]
    # inner ears + nose (pink)
    p += [R(4, o(1), 1, 1, PINK), R(13, o(1), 1, 1, PINK), R(8, o(7), 2, 1, PINK)]
    # tabby markings — forehead "M", back stripes, tail rings
    p += [
        R(8, o(3), 2, 1, STRIPE), R(6, o(4), 1, 1, STRIPE), R(11, o(4), 1, 1, STRIPE),
        R(6, o(11), 1, 2, STRIPE), R(9, o(11), 1, 2, STRIPE), R(12, o(11), 1, 2, STRIPE),
        R(15, o(11), 2, 1, STRIPE), R(14, o(13), 2, 1, STRIPE),
    ]
    return p


# ── Eyes (each a clearly distinct shape) ───────────────────────────────────────
def eyes_open(dy=0):
    o = lambda y: y - dy
    return [R(5, o(5), 2, 2, EYE), R(11, o(5), 2, 2, EYE),
            R(6, o(5), 1, 2, DARK), R(11, o(5), 1, 2, DARK),      # pupils toward nose
            R(5, o(5), 1, 1, WHITE), R(12, o(5), 1, 1, WHITE)]    # catchlight shine


def eyes_blank(dy=0):    # follow / hunt — live pupil drawn by the engine
    o = lambda y: y - dy
    return [R(5, o(5), 2, 2, EYE), R(11, o(5), 2, 2, EYE)]


def eyes_focus(dy=0):    # type — half-lidded, looking down at the keys
    o = lambda y: y - dy
    return [R(5, o(6), 2, 1, EYE), R(11, o(6), 2, 1, EYE),
            R(5, o(5), 2, 1, DARK), R(11, o(5), 2, 1, DARK)]


def eyes_strain(dy=0):   # overheat — angry slant brows + squint
    o = lambda y: y - dy
    return [R(5, o(6), 2, 1, RED), R(11, o(6), 2, 1, RED),
            R(5, o(4), 1, 1, DARK), R(6, o(5), 1, 1, DARK),
            R(12, o(4), 1, 1, DARK), R(11, o(5), 1, 1, DARK)]


def eyes_happy(dy=0):    # jump / pet — ^ ^ arcs
    o = lambda y: y - dy
    return [R(5, o(6), 1, 1, DARK), R(6, o(5), 1, 1, DARK),
            R(11, o(5), 1, 1, DARK), R(12, o(6), 1, 1, DARK)]


def eyes_closed(dy=0):   # sleep / blink / groom / yawn / stretch
    o = lambda y: y - dy
    return [R(5, o(6), 2, 1, DARK), R(11, o(6), 2, 1, DARK)]


def eyes_down(dy=0):     # scroll — pupils dropped, reading
    o = lambda y: y - dy
    return [R(5, o(5), 2, 2, EYE), R(11, o(5), 2, 2, EYE),
            R(6, o(6), 1, 1, DARK), R(11, o(6), 1, 1, DARK)]


# ── Mouths ─────────────────────────────────────────────────────────────────────
def mouth_neutral(dy=0):
    o = lambda y: y - dy
    return [R(8, o(9), 1, 1, DARK), R(9, o(9), 1, 1, DARK)]


def mouth_pant(dy=0):
    o = lambda y: y - dy
    return [R(7, o(8), 3, 2, DARK), R(8, o(9), 1, 1, PINK)]


def mouth_smile(dy=0):
    o = lambda y: y - dy
    return [R(7, o(9), 1, 1, DARK), R(10, o(9), 1, 1, DARK), R(8, o(10), 2, 1, DARK)]


def mouth_yawn(dy=0):
    o = lambda y: y - dy
    return [R(6, o(8), 4, 2, DARK), R(7, o(9), 2, 1, PINK)]


# ── Props ───────────────────────────────────────────────────────────────────────
def paws_keys():     # type — raised front paws + keyboard bar + tap marks
    return [
        R(4, 14, 2, 2, FUR), R(11, 14, 2, 2, FUR),
        R(2, 17, 13, 2, DARK),
        R(3, 17, 1, 1, STRIPE), R(5, 17, 1, 1, STRIPE), R(7, 17, 1, 1, STRIPE),
        R(9, 17, 1, 1, STRIPE), R(11, 17, 1, 1, STRIPE), R(13, 17, 1, 1, STRIPE),
        R(16, 13, 2, 1, AMBER), R(16, 15, 2, 1, AMBER),
    ]


def steam(phase):    # overheat — red puffs drifting up; phase shifts them higher
    d = 0 if phase else 1
    return [R(6, -3 + d, 2, 2, RED, 0.55), R(9, -4 + d, 2, 2, RED, 0.5),
            R(11, -2 + d, 2, 2, RED, 0.45)]


def flush_sweat():   # overheat — red cheeks + a blue sweat drop
    return [R(4, 7, 1, 1, RED, 0.55), R(13, 7, 1, 1, RED, 0.55),
            R(2, 5, 1, 1, BLUE), R(2, 6, 1, 1, BLUE)]


def sparkle():       # jump/done — a little ✦ up and to the right
    return [R(15, -3, 1, 3, WHITE), R(14, -2, 3, 1, WHITE), R(3, -1, 1, 1, WHITE)]


def motion_lines():  # jump/done — speed marks under a hop
    return [R(4, 17, 1, 2, AMBER, 0.8), R(8, 18, 1, 2, AMBER, 0.8), R(12, 17, 1, 2, AMBER, 0.8)]


def blush():         # pet — pink cheeks
    return [R(3, 7, 1, 1, PINK), R(13, 7, 1, 1, PINK)]


def zzz(phase):      # sleep — a pixel "Z z" rising; phase lifts them a touch
    d = 0 if phase else 1
    return [
        R(14, 0 + d, 3, 1, WHITE), R(15, 1 + d, 1, 1, WHITE), R(14, 2 + d, 3, 1, WHITE),
        R(17, -3 + d, 2, 1, WHITE), R(17, -2 + d, 1, 1, WHITE), R(17, -1 + d, 2, 1, WHITE),
    ]


def thought(phase):  # think — a little bubble forming up-right (agent working)
    p = [R(13, 2, 1, 1, CREAM)]                       # tail dot off the cheek
    if phase == 0:
        p += [R(14, 0, 2, 2, CREAM)]
    else:
        p += [R(14, -1, 2, 2, CREAM), R(15, -3, 2, 2, CREAM), R(13, 0, 1, 1, CREAM)]
    return p


def reach_paws(full): # stretch — front paws reaching up the sides
    if full:
        return [R(3, 3, 1, 2, FUR), R(4, 3, 1, 1, PINK),
                R(14, 3, 1, 2, FUR), R(13, 3, 1, 1, PINK)]
    return [R(3, 5, 1, 1, PINK), R(14, 5, 1, 1, PINK)]


def groom_paw(lick):  # groom — a front paw lifted to the muzzle (+ tongue on lick)
    if lick:
        return [R(8, 8, 2, 1, FUR), R(9, 9, 1, 1, PINK)]
    return [R(8, 10, 2, 1, FUR)]


def walk_legs(phase):  # 4-phase leg shuffle along the feet row
    legs = {
        0: [R(5, 16, 2, 1, FUR)],                       # left lead
        1: [R(6, 16, 2, 1, FUR), R(11, 16, 1, 1, FUR)], # mid
        2: [R(11, 16, 2, 1, FUR)],                      # right lead
        3: [R(6, 16, 1, 1, FUR), R(10, 16, 2, 1, FUR)], # mid
    }
    return legs[phase]


# ── Frame list (state, parts) — order is the atlas order ───────────────────────
def frame_idle():     return body() + eyes_open() + mouth_neutral()
def frame_follow():   return body() + eyes_blank() + mouth_neutral()
def frame_sleep(ph):  return body() + eyes_closed() + zzz(ph)
def frame_walk(ph):
    bob = 1 if ph in (1, 3) else 0
    return body(bob) + eyes_open(bob) + mouth_neutral(bob) + walk_legs(ph)
def frame_hunt(ph):
    bob = 1 if ph else 0
    return body(bob) + eyes_blank(bob) + mouth_pant(bob)
def frame_jump(ph):
    lift = [0, 2, 3][ph]
    extra = (sparkle() + motion_lines()) if ph >= 1 else motion_lines()
    return body(lift) + eyes_happy(lift) + mouth_smile(lift) + extra
def frame_pet(ph):
    bob = 1 if ph else 0
    return body(bob) + eyes_happy(bob) + mouth_smile(bob) + blush()
def frame_type(ph):
    bob = 1 if ph else 0
    return body(bob) + eyes_focus(bob) + mouth_neutral(bob) + paws_keys()
def frame_overheat(ph):
    return body() + eyes_strain() + mouth_pant() + flush_sweat() + steam(ph)
def frame_scroll(ph):
    d = [R(0, 6 if ph else 4, 1, 2, AMBER, 0.7), R(15, 6 if ph else 4, 1, 2, AMBER, 0.7),
         R(0, 10 if ph else 8, 1, 2, AMBER, 0.7), R(15, 10 if ph else 8, 1, 2, AMBER, 0.7)]
    return body() + eyes_down() + mouth_neutral() + d
def frame_think(ph):  return body() + eyes_open() + mouth_neutral() + thought(ph)
def frame_stretch(ph):
    return body() + eyes_closed() + (mouth_yawn() if ph else mouth_neutral()) + reach_paws(bool(ph))
def frame_groom(ph):  return body() + eyes_closed() + groom_paw(bool(ph))
def frame_yawn(ph):
    return body() + eyes_closed() + (mouth_yawn() if ph else mouth_pant())


# state → (frame builders, per-frame durations ms)
STATES = {
    "Idle":       ([frame_idle()], [1000]),
    "Sleep":      ([frame_sleep(0), frame_sleep(1)], [700, 700]),
    "Walk":       ([frame_walk(0), frame_walk(1), frame_walk(2), frame_walk(3)], [130, 130, 130, 130]),
    "Hunt":       ([frame_hunt(0), frame_hunt(1)], [170, 170]),
    "Jump":       ([frame_jump(0), frame_jump(1), frame_jump(2)], [90, 90, 120]),
    "Pet":        ([frame_pet(0), frame_pet(1)], [380, 380]),
    "Groom":      ([frame_groom(0), frame_groom(1)], [300, 360]),
    "FollowEyes": ([frame_follow()], [1000]),
    "Type":       ([frame_type(0), frame_type(1)], [130, 130]),
    "Scroll":     ([frame_scroll(0), frame_scroll(1)], [120, 120]),
    "Think":      ([frame_think(0), frame_think(1)], [450, 450]),
    "Overheat":   ([frame_overheat(0), frame_overheat(1)], [90, 90]),
    "Stretch":    ([frame_stretch(0), frame_stretch(1)], [550, 1400]),
    "Yawn":       ([frame_yawn(0), frame_yawn(1)], [300, 700]),
}


def paint(tile_origin_x, atlas, parts):
    """Composite one pose's rects into the atlas at the given tile x-origin. Each rect
    is drawn onto its own transparent layer and alpha-composited, so translucent props
    (steam/flush/motion lines) blend correctly over whatever is beneath them."""
    for gx, gy, gw, gh, rgba in parts:
        px = tile_origin_x + (gx + PAD_X) * SCALE
        py = (gy + PAD_Y) * SCALE
        layer = Image.new("RGBA", (gw * SCALE, gh * SCALE), rgba)
        atlas.alpha_composite(layer, dest=(px, py))


def main():
    # Flatten frames in atlas order; remember each frame's x and build the states map.
    frames = []           # list of pose parts
    states_json = {}
    for name, (builders, durs) in STATES.items():
        entry = []
        for parts, dur in zip(builders, durs):
            idx = len(frames)
            frames.append(parts)
            entry.append({"x": idx * TILE_W, "y": 0, "w": TILE_W, "h": TILE_H, "duration": dur})
        states_json[name] = {"frames": entry}

    n = len(frames)
    atlas_w = n * TILE_W
    atlas = Image.new("RGBA", (atlas_w, TILE_H), (0, 0, 0, 0))
    for i, parts in enumerate(frames):
        paint(i * TILE_W, atlas, parts)

    OUT_PNG.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(OUT_PNG)
    print(f"wrote {OUT_PNG.relative_to(ROOT)} ({atlas_w}x{TILE_H}, {n} frames)")

    # Emit the manifest block to paste into assets/manifest.json (under atlases).
    import json
    block = {"image": "cat-ginger-atlas.png",
             "tile": {"tileWidth": TILE_W, "tileHeight": TILE_H},
             "states": states_json}
    out_json = ROOT / "scripts" / "art-candidates" / "ginger-states.json"
    out_json.write_text(json.dumps({"catGinger": block}, indent=2))
    print(f"wrote {out_json.relative_to(ROOT)} (paste catGinger into assets/manifest.json)")


if __name__ == "__main__":
    main()
