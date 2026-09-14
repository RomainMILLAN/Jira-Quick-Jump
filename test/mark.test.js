import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BRAND, CHEVRONS } from "../scripts/make-icons.mjs";

/**
 * The mark exists in four places and its colour in two, which is three copies
 * and one copy too many — but the alternative costs more than it saves. The
 * icon generator cannot read an SVG (it is a zero-dependency PNG encoder), the
 * extension pages cannot fetch one (`img-src 'self'` would allow it, but a
 * second request for eight bytes of geometry is worse than the duplication),
 * and the documentation needs a file a designer can open.
 *
 * So the copies stay, and this file makes them provable instead of promised.
 * The header of scripts/make-icons.mjs claims the toolbar icon and the wordmark
 * "stay the same object at two sizes"; without this test, that claim is held up
 * by nothing but the memory of whoever last edited one of them.
 */

const ROOT = new URL("..", import.meta.url).pathname;

/**
 * The two segments a chevron path describes, on the 24-unit grid.
 *
 * Only the exact shape `M x y l dx dy dx dy` is accepted. A parser that
 * understood the whole path grammar would accept a rewrite of the mark into
 * curves and call it unchanged, which is the one thing this test exists to
 * catch.
 */
const segmentsOf = (d) => {
  assert.match(d, /^M[\d.\s-]+l[\d.\s-]+$/, `unexpected path grammar: ${d}`);
  const [x, y, dx1, dy1, dx2, dy2] = d.match(/-?\d*\.?\d+/g).map(Number);
  const mid = [x + dx1, y + dy1];
  return [
    [[x, y], mid],
    [mid, [mid[0] + dx2, mid[1] + dy2]],
  ];
};

const marksIn = (path) => {
  const source = readFileSync(`${ROOT}${path}`, "utf8");
  const paths = [...source.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(paths.length, 2, `${path} should draw exactly two chevrons`);
  return paths.flatMap(segmentsOf);
};

const SURFACES = ["src/options.html", "src/popup.html", "docs/assets/logo.svg"];

test("every copy of the mark draws the same chevrons", () => {
  for (const surface of SURFACES) {
    assert.deepEqual(
      marksIn(surface),
      CHEVRONS,
      `${surface} has drifted from CHEVRONS in scripts/make-icons.mjs`
    );
  }
});

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

test("the icon, the tokens and the logo carry one brand colour", () => {
  const tokens = readFileSync(`${ROOT}src/ui/tokens.css`, "utf8");
  // The light palette's value: the first --brand declaration in the file. The
  // dark palette lightens it on purpose, and the icon does not follow — a
  // toolbar icon is drawn once and shown on both grounds.
  const declared = tokens.match(/--brand:\s*(#[0-9a-f]{6})/i);
  assert.ok(declared, "src/ui/tokens.css declares no --brand");
  assert.deepEqual(
    hexToRgb(declared[1]),
    BRAND,
    "--brand and BRAND in scripts/make-icons.mjs have drifted apart"
  );

  const logo = readFileSync(`${ROOT}docs/assets/logo.svg`, "utf8");
  const filled = logo.match(/<rect[^>]*fill="(#[0-9a-f]{6})"/i);
  assert.ok(filled, "docs/assets/logo.svg fills no tile");
  assert.deepEqual(hexToRgb(filled[1]), BRAND, "the logo tile is not the brand colour");
});
