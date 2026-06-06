// Generates placeholder pixel art for Kitto using only Node built-ins (zlib).
// Output:
//   assets/cat-atlas.png   horizontal strip of clearly-distinct animation frames
//   src-tauri/icons/{32x32,128x128,icon}.png
// Placeholder art only — real pixel art lands before M6 (see KITTO_SPEC §7).
//
// Frames are intentionally exaggerated so each STATE reads at a glance:
//   Idle       : eyes open, gentle 1px breathing bob, occasional blink
//   Sleep      : eyes shut (lid lines), a "Z" that rises between frames
//   Walk       : paws alternate + body bob
//   FollowEyes : blank eye "sclera" — pupils are drawn live by the renderer so
//                the eyes track the cursor (so this frame must NOT bob/shift, or
//                the sclera would drift out from under the overlaid pupils)
//   Hunt       : same blank tracking eyes + open mouth + tense paw wiggle
//   Pet        : happy upturned (closed) eyes + pink blush, gentle bob
//   Type       : paws tap (keyboard kneading) + small focused mouth   [M3]
//   Overheat   : whole body flushes red + furrowed brows + steam puffs [M3]
//   Scroll     : eyes glance down + motion dashes streaming past       [M3]
//   Stretch    : content closed eyes + big yawn + paws reaching up,
//                body grows 1px on the peak frame                       [M4]
//   Think      : calm face + a thought bubble that forms up-and-right
//                (agent working — the cat thinks along)                 [M5]
//   Jump       : joyful hop — happy "^ ^" eyes + open smile + paws up,
//                body lifts on the peak frame (agent finished)          [M5]
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePng(pixels, w, h) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- Palette (color-keyed) ---
// . transparent  B body  D outline  E open-eye  W eye-white(sclera)  L lid  N nose
// P pink(ears/paws/blush)  K whisker  Z sleep-Z
const PAL = {
  ".": [0, 0, 0, 0],
  B: [120, 120, 130, 255], // grey fur (neutral placeholder; recolor lands M6)
  D: [40, 40, 48, 255], // outline
  P: [232, 158, 178, 255], // pink (ears/paws/blush)
  E: [25, 25, 30, 255], // open eye
  W: [228, 230, 238, 255], // eye-white sclera (the renderer overlays a live pupil)
  L: [60, 60, 70, 255], // closed-eye lid line
  N: [70, 70, 80, 255], // nose
  K: [205, 205, 215, 255], // whiskers (light, so they read against the grey fur)
  R: [200, 90, 80, 255], // overheat: flushed-red fur (recolor of B)
  M: [240, 240, 250, 235], // steam / scroll motion puffs (light, faintly translucent)
  Z: [250, 250, 255, 255], // floating sleep "Z" (bright, clearly visible)
  T: [188, 200, 246, 255], // thought-bubble cloud (bright periwinkle — reads as "thinking")
};

// Base cat face, 16x16 logical grid. Reads as a CAT (not a mouse): two tall,
// pointed, fairly-central triangular ears and whiskers fanning off the cheeks —
// deliberately *no* long thin tail (that's the mouse tell). Open eyes are 2x2
// blocks at rows 6-7, cols {3,4}/{11,12}; those positions are fixed because the
// renderer overlays a live pupil there (see src/cat.ts EYE_L/EYE_R) and the
// eye/lid helpers below key off them — don't move the eyes without updating both.
const BASE = [
  "................", // 0
  "...D........D...", // 1  ear tips (pointed)
  "..DPD......DPD..", // 2  ear inner = pink
  ".DPPPD....DPPPD.", // 3  ear base
  ".DBBBBBBBBBBBBD.", // 4  head crown (ears merge into a continuous head)
  ".DBBBBBBBBBBBBD.", // 5
  ".DBEEBBBBBBEEBD.", // 6  eyes
  "KKBEEBBNNBBEEBKK", // 7  eyes + nose + upper whiskers
  ".DBBBBBNNBBBBBD.", // 8  nose (lower)
  "KKBBBBBBBBBBBBKK", // 9  lower whiskers
  ".DBBBBBBBBBBBBD.", // 10
  ".DBBBBBBBBBBBBD.", // 11
  ".DBBPBBBBBBPBBD.", // 12 paw hints
  ".DBBBBBBBBBBBBD.", // 13
  "..DDDDDDDDDDDD..", // 14
  "................", // 15
];

const toGrid = (rows) => rows.map((r) => r.split(""));
const toRows = (g) => g.map((r) => r.join(""));
function set(g, r, c, ch) {
  if (g[r] && c >= 0 && c < g[r].length) g[r][c] = ch;
}

// Close both eyes: clear the 2x2 eye blocks and draw a short lid line.
function closeEyes(g) {
  for (const c of [3, 4, 11, 12]) {
    set(g, 6, c, "B");
    set(g, 7, c, "L");
  }
}

// Draw a 3-wide "Z" in the empty space between the ears. `top` = risen position.
function drawZ(g, top) {
  const r = top ? 0 : 1;
  for (const c of [6, 7, 8]) {
    set(g, r, c, "Z"); // top bar
    set(g, r + 2, c, "Z"); // bottom bar
  }
  set(g, r + 1, 7, "Z"); // diagonal
}

// Move the bottom paws to fake a step. step: -1 left fwd, +1 right fwd, 0 neutral.
function paws(g, step) {
  if (step === -1) {
    set(g, 12, 3, "B"); set(g, 13, 3, "P"); // left paw forward
  } else if (step === 1) {
    set(g, 12, 10, "B"); set(g, 13, 10, "P"); // right paw forward
  }
}

function blink(rows) {
  const g = toGrid(rows);
  closeEyes(g);
  return toRows(g);
}
function sleep(rows, top) {
  const g = toGrid(rows);
  closeEyes(g);
  drawZ(g, top);
  return toRows(g);
}
function walk(rows, step) {
  const g = toGrid(rows);
  paws(g, step);
  return toRows(g);
}
// Breathe / bob: shift the whole cat up 1px (blank the freed bottom row).
function up(rows) {
  return [...rows.slice(1), "................"];
}

// Replace the 2x2 eye blocks with blank "sclera" so the renderer can overlay a
// live, cursor-tracking pupil. Eyes stay at fixed rows 6-7, cols {3,4}/{11,12}.
function blankEyesG(g) {
  for (const c of [3, 4, 11, 12]) {
    set(g, 6, c, "W");
    set(g, 7, c, "W");
  }
}

// FollowEyes base: blank tracking eyes, body otherwise at rest. Single frame —
// the moving pupils carry the animation, so it must not bob (see header note).
function look(rows) {
  const g = toGrid(rows);
  blankEyesG(g);
  return toRows(g);
}

// Hunt: tracking eyes + open mouth + tense paw wiggle. `step` flicks the paws
// (-1/+1) without touching the eye rows, keeping the pupil overlay aligned.
function huntFace(rows, step) {
  const g = toGrid(rows);
  blankEyesG(g);
  set(g, 9, 7, "D"); // open mouth (small dark gap below the nose)
  set(g, 9, 8, "D");
  paws(g, step);
  return toRows(g);
}

// Pet: happy upturned (closed) eyes "^ ^" + pink blush on the cheeks.
function petFace(rows) {
  const g = toGrid(rows);
  for (const [r, c] of [[6, 3], [6, 4], [7, 3], [7, 4], [6, 11], [6, 12], [7, 11], [7, 12]]) {
    set(g, r, c, "B"); // clear the open-eye blocks
  }
  set(g, 7, 3, "L"); set(g, 6, 4, "L"); // left eye  "/" curving up to centre
  set(g, 7, 12, "L"); set(g, 6, 11, "L"); // right eye "\" curving up to centre
  set(g, 8, 2, "P"); set(g, 8, 13, "P"); // blush
  return toRows(g);
}

// Recolor every cell of `ch` to `to` in place (used for the overheat flush).
function recolor(g, ch, to) {
  for (let r = 0; r < g.length; r++) {
    for (let c = 0; c < g[r].length; c++) if (g[r][c] === ch) set(g, r, c, to);
  }
}

// M3 ── Type: paws tap (keyboard kneading) + a small focused mouth, eyes open.
// `step` flicks the paws (-1/+1) like Walk so it reads as a quick patter.
function typeFace(rows, step) {
  const g = toGrid(rows);
  paws(g, step);
  set(g, 9, 7, "D"); set(g, 9, 8, "D"); // small flat "working" mouth
  return toRows(g);
}

// M3 ── Overheat: whole body flushes red, furrowed brows, steam puffs rising off
// both sides of the head. `step` alternates the puff height so the steam drifts up.
function overheatFace(rows, step) {
  const g = toGrid(rows);
  recolor(g, "B", "R"); // flushed red fur
  for (const c of [3, 4, 11, 12]) set(g, 5, c, "D"); // furrowed brows over the eyes
  set(g, 9, 7, "D"); set(g, 9, 8, "D"); // gritted mouth
  const dy = step ? 0 : 1; // puffs sit lower on frame 0, higher on frame 1 → rising
  set(g, dy, 1, "M"); set(g, dy + 1, 0, "M"); // left steam puff, drifting up-left
  set(g, dy, 14, "M"); set(g, dy + 1, 15, "M"); // right steam puff, up-right
  return toRows(g);
}

// M3 ── Scroll: eyes glance downward (reading) + motion dashes streaming down the
// margins, shifting with `step` so the "paper" reads as unrolling past the cat.
function scrollFace(rows, step) {
  const g = toGrid(rows);
  for (const c of [3, 4, 11, 12]) {
    set(g, 6, c, "B"); // clear the resting eye row
    set(g, 8, c, "E"); // re-draw the eyes one row lower → looking down
  }
  const top = step ? 4 : 6; // dashes scroll down by 2px between frames
  for (const r of [top, top + 3]) {
    set(g, r, 0, "M");
    set(g, r, 15, "M");
  }
  return toRows(g);
}

// M4 ── Stretch: a yawning, reaching stretch. Content closed eyes; on the peak
// frame the mouth opens into a big pink yawn and the front paws reach up the sides.
// `phase` 0 = wind-up (small mouth, paws mid), 1 = full stretch (yawn + paws up).
function stretchFace(rows, phase) {
  const g = toGrid(rows);
  for (const c of [3, 4, 11, 12]) {
    set(g, 6, c, "B"); // clear the open-eye blocks
    set(g, 7, c, "L"); // content closed-eye lids
  }
  if (phase === 1) {
    for (const c of [6, 7, 8, 9]) {
      set(g, 8, c, "D"); // wide-open yawn outline
      set(g, 9, c, "D");
    }
    set(g, 8, 7, "P"); set(g, 8, 8, "P"); // pink mouth interior
    set(g, 3, 1, "B"); set(g, 4, 1, "P"); // left paw reaching up
    set(g, 3, 14, "B"); set(g, 4, 14, "P"); // right paw reaching up
  } else {
    set(g, 9, 7, "D"); set(g, 9, 8, "D"); // small mouth (winding up)
    set(g, 5, 1, "P"); set(g, 5, 14, "P"); // paws mid-raise
  }
  return toRows(g);
}

// M5 ── Think: the cat thinks along while a watched AI agent is working. A calm
// face (base eyes) with a thought bubble that grows over three frames in the
// transparent corner up and to the right of the head — a tail dot, then a forming
// puff, then a full 3×2 cloud — so it reads as an active, rising thought. (Stays at
// rest height: the cloud lives in the top rows, so a bob via up() would clip it.)
function thinkFace(rows, phase) {
  const g = toGrid(rows);
  set(g, 9, 7, "L"); set(g, 9, 8, "L"); // small contemplative mouth line
  // A short tail of bubbles leading up from the cheek to the cloud (always shown).
  set(g, 3, 15, "T");
  if (phase === 0) {
    // Winding up: just the tail starting to rise.
    set(g, 2, 14, "T");
  } else if (phase === 1) {
    // Forming: tail + a small puff drifting up.
    set(g, 2, 14, "T");
    set(g, 1, 14, "T"); set(g, 1, 15, "T");
    set(g, 0, 14, "T");
  } else {
    // Full cloud: a bright 3×2 puff in the corner with the tail beneath it.
    set(g, 2, 14, "T");
    set(g, 1, 13, "T"); set(g, 1, 14, "T"); set(g, 1, 15, "T");
    set(g, 0, 13, "T"); set(g, 0, 14, "T"); set(g, 0, 15, "T");
  }
  return toRows(g);
}

// M5 ── Jump: a celebratory hop when the agent finishes. Happy upturned "^ ^" eyes
// (like Pet), an open smile, and both paws thrown up. The hop height is applied by
// the frame list (via up()), so this just draws the joyful pose at rest height.
function jumpFace(rows) {
  const g = toGrid(rows);
  for (const [r, c] of [[6, 3], [6, 4], [7, 3], [7, 4], [6, 11], [6, 12], [7, 11], [7, 12]]) {
    set(g, r, c, "B"); // clear the open-eye blocks
  }
  set(g, 7, 3, "L"); set(g, 6, 4, "L"); // left eye  "^"
  set(g, 7, 12, "L"); set(g, 6, 11, "L"); // right eye "^"
  set(g, 9, 6, "D"); set(g, 9, 9, "D"); // smile corners
  set(g, 9, 7, "P"); set(g, 9, 8, "P"); // open-mouth (pink)
  set(g, 10, 7, "D"); set(g, 10, 8, "D"); // smile underline
  set(g, 3, 1, "B"); set(g, 4, 1, "P"); // left paw thrown up
  set(g, 3, 14, "B"); set(g, 4, 14, "P"); // right paw thrown up
  return toRows(g);
}

// MA-3 ── Groom: an ambient idle filler — the cat lifts a front paw and licks it.
// Content closed eyes; `phase` 0 = paw mid-lift, 1 = paw at the mouth with a small
// pink tongue. A quiet "life between the big beats" pose (A3).
function groomFace(rows, phase) {
  const g = toGrid(rows);
  for (const c of [3, 4, 11, 12]) {
    set(g, 6, c, "B"); // clear the open-eye blocks
    set(g, 7, c, "L"); // content closed-eye lids
  }
  if (phase === 1) {
    set(g, 8, 7, "P"); set(g, 8, 8, "P"); // raised paw held up at the muzzle
    set(g, 9, 8, "P"); // a little tongue mid-lick
  } else {
    set(g, 10, 7, "P"); set(g, 10, 8, "P"); // paw on the way up
  }
  return toRows(g);
}

// MA-3 ── Yawn: an ambient idle filler — a sleepy wide-mouthed yawn, eyes squeezed
// shut. `phase` 0 = mouth opening, 1 = full yawn (pink interior). Distinct from
// Stretch (no reaching paws, no body grow) — just the yawn (A3).
function yawnFace(rows, phase) {
  const g = toGrid(rows);
  for (const c of [3, 4, 11, 12]) {
    set(g, 6, c, "B"); // clear the open-eye blocks
    set(g, 7, c, "L"); // squeezed-shut eyes
  }
  if (phase === 1) {
    for (const c of [6, 7, 8, 9]) {
      set(g, 8, c, "D"); // wide-open yawn outline
      set(g, 9, c, "D");
    }
    set(g, 8, 7, "P"); set(g, 8, 8, "P"); // pink mouth interior
  } else {
    set(g, 9, 7, "D"); set(g, 9, 8, "D"); // mouth just opening
  }
  return toRows(g);
}

function rasterize(art, scale, pal = PAL) {
  const gw = art[0].length, gh = art.length;
  const w = gw * scale, h = gh * scale;
  const px = Buffer.alloc(w * h * 4);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const [r, g, b, a] = pal[art[gy][gx]] || [0, 0, 0, 0];
      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          const x = gx * scale + sx, y = gy * scale + sy;
          const o = (y * w + x) * 4;
          px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = a;
        }
      }
    }
  }
  return { px, w, h };
}
function save(path, buf) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buf);
}

const root = new URL("..", import.meta.url).pathname;
const SCALE = 2; // 16px grid -> 32px tile
const TILE = 16 * SCALE;

// Frame order MUST match assets/manifest.json.
const frames = [
  BASE, // 0  Idle: eyes open, resting
  up(BASE), // 1  Idle: breathe in (body up 1px)
  blink(BASE), // 2  Idle: blink (eyes shut briefly)
  sleep(BASE, false), // 3  Sleep: eyes shut, Z low
  sleep(BASE, true), // 4  Sleep: eyes shut, Z risen
  walk(BASE, -1), // 5  Walk: left paw forward (down)
  up(walk(BASE, 1)), // 6  Walk: right paw forward (bob up)
  walk(BASE, 1), // 7  Walk: right paw forward (down)
  up(walk(BASE, -1)), // 8  Walk: left paw forward (bob up)
  look(BASE), // 9  FollowEyes: blank tracking eyes (pupils drawn live)
  huntFace(BASE, -1), // 10 Hunt: tracking eyes + mouth, paws tense left
  huntFace(BASE, 1), // 11 Hunt: tracking eyes + mouth, paws tense right
  petFace(BASE), // 12 Pet: happy eyes + blush
  up(petFace(BASE)), // 13 Pet: happy eyes + blush, bob up
  typeFace(BASE, -1), // 14 Type: paws tap left
  up(typeFace(BASE, 1)), // 15 Type: paws tap right (bob up)
  overheatFace(BASE, 0), // 16 Overheat: red + steam (low)
  overheatFace(BASE, 1), // 17 Overheat: red + steam (risen)
  scrollFace(BASE, 0), // 18 Scroll: eyes down + dashes
  scrollFace(BASE, 1), // 19 Scroll: eyes down + dashes (scrolled)
  stretchFace(BASE, 0), // 20 Stretch: wind-up (paws mid, small mouth)
  up(stretchFace(BASE, 1)), // 21 Stretch: full reach (yawn + paws up), body grows 1px
  thinkFace(BASE, 0), // 22 Think: thought tail winding up
  thinkFace(BASE, 1), // 23 Think: thought puff forming
  thinkFace(BASE, 2), // 24 Think: full thought cloud
  jumpFace(BASE), // 25 Jump: landed (bounce trough)
  up(jumpFace(BASE)), // 26 Jump: hop (up 1px)
  up(up(jumpFace(BASE))), // 27 Jump: peak of the hop (up 2px)
  groomFace(BASE, 0), // 28 Groom: paw lifting toward the muzzle
  groomFace(BASE, 1), // 29 Groom: paw at the mouth, licking
  yawnFace(BASE, 0), // 30 Yawn: mouth opening
  yawnFace(BASE, 1), // 31 Yawn: full yawn
];

const atlasW = TILE * frames.length;
const atlas = Buffer.alloc(atlasW * TILE * 4);
frames.forEach((art, i) => {
  const { px } = rasterize(art, SCALE);
  const xOff = i * TILE;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const src = (y * TILE + x) * 4;
      const dst = (y * atlasW + (xOff + x)) * 4;
      px.copy(atlas, dst, src, src + 4);
    }
  }
});
save(root + "assets/cat-atlas.png", encodePng(atlas, atlasW, TILE));
console.log(`wrote assets/cat-atlas.png (${atlasW}x${TILE}, ${frames.length} frames)`);

// --- Pattern overlay masks (M6, KITTO_SPEC §7: "pattern as a separate overlay
// mask layer"). For each pattern we emit a mask atlas with the SAME geometry as
// the cat atlas, so frame rects line up. A mask cell is painted only where that
// frame's pixel is fur ("B"), with a MARKER color encoding a *role*; the runtime
// recolor (src/sprites/recolor.ts) resolves each role to a final color — `d`
// derives a darker shade of the *chosen* fur (so tabby stripes follow the fur),
// while `w`/`o` are fixed patch colors. Markers are pure magenta/cyan/yellow so
// they never collide with real art and recolor can key off them exactly.
const MARK = {
  ".": [0, 0, 0, 0],
  d: [255, 0, 255, 255], // role: darker fur (tabby stripes, calico dark patch)
  w: [0, 255, 255, 255], // role: white patch (tuxedo chest/paws)
  o: [255, 255, 0, 255], // role: ginger patch (calico)
};

// A pattern is a predicate (gx, gy) -> marker char | null, evaluated only over fur
// cells. Coordinates are the 16×16 logical grid (see BASE).
const PATTERNS = {
  // Tabby: forehead stripes + back stripes.
  tabby: (gx, gy) => {
    if (gy >= 4 && gy <= 5 && [4, 7, 10].includes(gx)) return "d";
    if (gy >= 10 && gy <= 13 && [3, 6, 9, 12].includes(gx)) return "d";
    return null;
  },
  // Tuxedo: white chest/belly + a white muzzle.
  tuxedo: (gx, gy) => {
    if (gy >= 11 && gy <= 13 && gx >= 5 && gx <= 10) return "w";
    if (gy === 9 && gx >= 6 && gx <= 9) return "w";
    return null;
  },
  // Calico: a ginger patch upper-left + a dark patch lower-right over the base fur.
  calico: (gx, gy) => {
    if (gy >= 4 && gy <= 8 && gx >= 2 && gx <= 5) return "o";
    if (gy >= 9 && gy <= 13 && gx >= 10 && gx <= 13) return "d";
    return null;
  },
};

function buildMaskAtlas(markFn) {
  const buf = Buffer.alloc(atlasW * TILE * 4);
  frames.forEach((art, i) => {
    const grid = toGrid(art);
    const maskRows = toRows(
      grid.map((row, gy) => row.map((ch, gx) => (ch === "B" ? markFn(gx, gy) || "." : "."))),
    );
    const { px } = rasterize(maskRows, SCALE, MARK);
    const xOff = i * TILE;
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const src = (y * TILE + x) * 4;
        const dst = (y * atlasW + (xOff + x)) * 4;
        px.copy(buf, dst, src, src + 4);
      }
    }
  });
  return buf;
}

for (const [name, fn] of Object.entries(PATTERNS)) {
  save(root + `assets/pattern-${name}.png`, encodePng(buildMaskAtlas(fn), atlasW, TILE));
  console.log(`wrote assets/pattern-${name}.png (${atlasW}x${TILE})`);
}

// App icons — single idle face on a solid light bg.
const ICON_BG = [245, 245, 248, 255];
function saveIcon(path, scale) {
  const { px, w, h } = rasterize(BASE, scale);
  for (let i = 0; i < w * h; i++) {
    if (px[i * 4 + 3] === 0) {
      px[i * 4] = ICON_BG[0]; px[i * 4 + 1] = ICON_BG[1];
      px[i * 4 + 2] = ICON_BG[2]; px[i * 4 + 3] = ICON_BG[3];
    }
  }
  save(path, encodePng(px, w, h));
  console.log(`wrote ${path} (${w}x${h})`);
}
saveIcon(root + "src-tauri/icons/32x32.png", 2);
saveIcon(root + "src-tauri/icons/128x128.png", 8);
saveIcon(root + "src-tauri/icons/icon.png", 32);
