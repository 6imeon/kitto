import { describe, it, expect } from "vitest";
import { parseHex, darken, blend, applyRecolor } from "./recolor";

describe("recolor helpers", () => {
  it("parses #rrggbb", () => {
    expect(parseHex("#102030")).toEqual([16, 32, 48]);
    expect(parseHex("#ffffff")).toEqual([255, 255, 255]);
  });

  it("darkens toward black by a fraction", () => {
    expect(darken([100, 200, 50], 0)).toEqual([100, 200, 50]);
    expect(darken([100, 200, 50], 1)).toEqual([0, 0, 0]);
    expect(darken([100, 200, 50], 0.5)).toEqual([50, 100, 25]);
  });

  it("blends two colors linearly", () => {
    expect(blend([0, 0, 0], [255, 255, 255], 0.5)).toEqual([128, 128, 128]);
    expect(blend([10, 20, 30], [10, 20, 30], 0.5)).toEqual([10, 20, 30]);
  });
});

// Build an RGBA buffer from [r,g,b,a] tuples.
function buf(...px: Array<[number, number, number, number]>): Uint8ClampedArray {
  return new Uint8ClampedArray(px.flat());
}

describe("applyRecolor (pure pixel transform)", () => {
  const FUR_BASE: [number, number, number, number] = [120, 120, 130, 255];
  const FUR_FLUSH: [number, number, number, number] = [200, 90, 80, 255];

  it("remaps the base fur index to the chosen color, leaving other pixels alone", () => {
    const px = buf(
      FUR_BASE, // → fur color
      [40, 40, 48, 255], // outline (non-fur) → untouched
      [0, 0, 0, 0], // transparent → untouched
    );
    applyRecolor(px, null, "#102030");
    expect([...px.slice(0, 3)]).toEqual([16, 32, 48]); // fur recolored
    expect([...px.slice(4, 7)]).toEqual([40, 40, 48]); // outline preserved
    expect(px[11]).toBe(0); // transparent alpha preserved
  });

  it("derives the overheat flush from the chosen fur (pushed toward red)", () => {
    const px = buf(FUR_FLUSH);
    applyRecolor(px, null, "#102030");
    expect([...px.slice(0, 3)]).toEqual(blend([16, 32, 48], [205, 70, 60], 0.5));
  });

  it("composites a 'dark' pattern marker as a darker shade of the fur over fur pixels", () => {
    const px = buf(FUR_BASE);
    const mask = buf([255, 0, 255, 255]); // ROLE_DARK marker aligned to the fur pixel
    applyRecolor(px, mask, "#646464"); // mid grey fur
    const fur: [number, number, number] = [100, 100, 100];
    const expected = blend(fur, darken(fur, 0.45), 0.55);
    expect([...px.slice(0, 3)]).toEqual(expected);
  });

  it("ignores transparent mask pixels (no pattern there)", () => {
    const px = buf(FUR_BASE);
    const mask = buf([255, 0, 255, 0]); // marker color but fully transparent
    applyRecolor(px, mask, "#646464");
    expect([...px.slice(0, 3)]).toEqual([100, 100, 100]); // plain fur, no stripe
  });
});
