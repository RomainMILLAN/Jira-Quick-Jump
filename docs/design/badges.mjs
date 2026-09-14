/**
 * The README's badges, as local files.
 *
 * A shields.io badge would be four network requests on the front page of an
 * extension whose entire argument is that a request does not happen. These are
 * SVG files in the repository instead.
 *
 * They therefore carry only facts that do NOT change: the licence, the browsers,
 * the manifest version. Deliberately absent: a version badge (it would go stale
 * on every release -- the Releases link is the live answer) and a "tests
 * passing" badge (a static file cannot know, and a badge that asserts a green
 * suite it never ran is the kind of claim this repository takes care not to
 * make).
 *
 *   node docs/design/badges.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = new URL("../assets/badges/", import.meta.url).pathname;

const INK = "#4a5157";
const BRAND = "#1868db";
const H = 22;
const PAD = 9;
// The system UI face at 11px, averaged. Close enough: the box is drawn around
// the text, and 1px of slack is invisible at this size.
const width = (text) => Math.round(text.length * 6.35);

const badge = (label, value, fill) => {
  const lw = width(label) + PAD * 2;
  const vw = width(value) + PAD * 2;
  const w = lw + vw;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${H}" viewBox="0 0 ${w} ${H}" role="img" aria-label="${label}: ${value}">
  <title>${label}: ${value}</title>
  <clipPath id="r"><rect width="${w}" height="${H}" rx="4"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${lw}" height="${H}" fill="${INK}"/>
    <rect x="${lw}" width="${vw}" height="${H}" fill="${fill}"/>
  </g>
  <g fill="#ffffff" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="11" font-weight="500">
    <text x="${lw / 2}" y="15" text-anchor="middle">${label}</text>
    <text x="${lw + vw / 2}" y="15" text-anchor="middle" font-weight="600">${value}</text>
  </g>
</svg>
`;
};

mkdirSync(OUT, { recursive: true });

const badges = [
  ["licence.svg", "licence", "MIT", INK],
  ["browsers.svg", "browsers", "Chrome · Firefox", BRAND],
  ["manifest.svg", "manifest", "V3", BRAND],
];

for (const [file, label, value, fill] of badges) {
  writeFileSync(join(OUT, file), badge(label, value, fill));
  console.log(`badges/${file}`);
}
