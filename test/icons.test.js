import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { renderPixels, SIZES } from "../scripts/make-icons.mjs";

const ROOT = new URL("..", import.meta.url).pathname;

/** Minimal PNG reader: enough to get the pixels back out of what we shipped. */
const decode = (path) => {
  const buf = readFileSync(path);
  let offset = 8;
  let size = 0;
  const parts = [];
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    if (type === "IHDR") size = buf.readUInt32BE(offset + 8);
    if (type === "IDAT") parts.push(buf.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(parts));
  const stride = size * 4 + 1;
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    assert.equal(raw[y * stride], 0, "unexpected PNG row filter");
    raw.copy(rgba, y * size * 4, y * stride + 1, y * stride + 1 + size * 4);
  }
  return { size, rgba };
};

test("the committed icons are the image this script draws", () => {
  // Compared on PIXELS, never on bytes. Deflate output depends on the zlib build,
  // so a byte comparison fails on any machine other than the one that generated
  // the files — a fact about the compressor, not about the icon. This assertion
  // is the one that actually means "these PNGs came from this source".
  for (const size of SIZES) {
    const shipped = decode(`${ROOT}src/icons/icon-${size}.png`);
    assert.equal(shipped.size, size, `icon-${size}.png is not ${size}px`);
    assert.deepEqual(shipped.rgba, renderPixels(size), `icon-${size}.png differs from the drawing`);
  }
});

test("the mark stays legible at 16px", () => {
  // The size the browser shows most of the time. A mark that only works large is
  // not a mark, so this pins the two properties that make it readable: the glyph
  // covers a real share of the tile, and it is centred within a pixel.
  const { rgba } = { rgba: renderPixels(16) };
  let minX = 16;
  let maxX = -1;
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const i = (y * 16 + x) * 4;
      const isGlyph = rgba[i] > 200 && rgba[i + 3] > 200;
      if (!isGlyph) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
    }
  }
  const width = maxX - minX + 1;
  assert.ok(width >= 9, `the glyph is only ${width}px wide at 16px`);
  const centre = (minX + maxX) / 2;
  assert.ok(Math.abs(centre - 7.5) <= 1, `the glyph is off-centre by ${Math.abs(centre - 7.5)}px`);
});
