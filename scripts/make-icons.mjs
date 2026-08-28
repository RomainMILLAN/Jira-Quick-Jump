/**
 * Generates the extension icons — zero dependencies, no image library.
 *
 * The glyph is CUT FROM the logotype's mark rather than drawn separately, so the
 * toolbar icon and the wordmark stay the same object at two sizes. Geometry is
 * expressed on the same 24-unit grid the SVG uses, so changing one changes both.
 *
 * CI runs this and fails if the committed PNGs differ (`make icons`), which keeps
 * the shipped bytes reviewable in git instead of being binaries nobody can rebuild.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "src", "icons");

const TEAL = [13, 127, 116];
const WHITE = [255, 255, 255];

// The mark, on the SVG's 24-unit grid: two chevrons.
const CHEVRONS = [
  [[4.5, 6], [10.5, 12]],
  [[10.5, 12], [4.5, 18]],
  [[13.5, 6], [19.5, 12]],
  [[19.5, 12], [13.5, 18]],
];

// Thicker strokes at small sizes: a 2-unit stroke that reads at 128 disappears at 16.
const STROKE = { 16: 3.1, 32: 2.6, 48: 2.35, 128: 2.05 };

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Signed distance to a rounded rectangle centred on the tile. */
const sdRoundRect = (px, py, half, radius) => {
  const qx = Math.abs(px) - half + radius;
  const qy = Math.abs(py) - half + radius;
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - radius;
};

/** Signed distance to a capsule: a line segment with a round cap, i.e. a stroke. */
const sdSegment = (px, py, ax, ay, bx, by, halfWidth) => {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const t = clamp01((wx * vx + wy * vy) / (vx * vx + vy * vy));
  return Math.hypot(wx - vx * t, wy - vy * t) - halfWidth;
};

const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

const encodePng = (size, rgba) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

const render = (size) => {
  const rgba = Buffer.alloc(size * size * 4);
  const scale = size / 24;
  const half = size / 2;
  const radius = size * 0.22;
  const strokeHalf = (STROKE[size] * scale) / 2;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;

      const tile = clamp01(0.5 - sdRoundRect(px - half, py - half, half, radius));
      let glyph = 0;
      for (const [[ax, ay], [bx, by]] of CHEVRONS) {
        const d = sdSegment(px, py, ax * scale, ay * scale, bx * scale, by * scale, strokeHalf);
        glyph = Math.max(glyph, clamp01(0.5 - d));
      }

      // The glyph is punched over the tile, then both are cut by the tile's alpha.
      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c += 1) {
        rgba[i + c] = Math.round(TEAL[c] * (1 - glyph) + WHITE[c] * glyph);
      }
      rgba[i + 3] = Math.round(tile * 255);
    }
  }
  return encodePng(size, rgba);
};

mkdirSync(OUT, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const png = render(size);
  writeFileSync(join(OUT, `icon-${size}.png`), png);
  console.log(`src/icons/icon-${size}.png  ${png.length} bytes`);
}
