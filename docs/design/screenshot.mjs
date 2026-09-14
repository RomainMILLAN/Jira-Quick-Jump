/**
 * Screenshots of the REAL options page, from the shipped markup.
 *
 * It does not copy src/options.html -- it reads it, injects a <base> so the
 * relative script tags still resolve, and puts a stand-in browser in front of
 * platform.js. So the screenshot cannot drift from the page: a section added to
 * options.html appears here on the next run without anyone remembering to.
 *
 *   node docs/design/screenshot.mjs
 *
 * Needs a Chrome or Chromium on PATH ($CHROME overrides). Makes no network
 * request: the fonts are the ones src/ui/fonts/ ships.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STORAGE } from "./state.mjs";

const ROOT = new URL("../..", import.meta.url).pathname;
const SRC = join(ROOT, "src");
const OUT = join(ROOT, "docs", "assets");

const chrome = process.env.CHROME ?? ["google-chrome", "chromium", "chromium-browser"]
  .find((c) => { try { execFileSync("command", ["-v", c]); return true; } catch { return c === "google-chrome"; } });

const messages = JSON.parse(readFileSync(join(SRC, "_locales", "en", "messages.json"), "utf8"));
const { version } = JSON.parse(readFileSync(join(SRC, "manifest.json"), "utf8"));

/** The page as shipped, with a base URL and a browser in front of it. */
const harness = (page, { storage, extra = "" }) => {
  const preamble = `
  <base href="file://${SRC}/">
  <script>
    globalThis.__SCREENSHOT_STORAGE__ = ${JSON.stringify(storage)};
    globalThis.__SCREENSHOT_MESSAGES__ = ${JSON.stringify(messages)};
    globalThis.__SCREENSHOT_VERSION__ = ${JSON.stringify(version)};
  </script>
  <script src="file://${ROOT}docs/design/fake-browser.js"></script>
  <style>${extra}</style>
`;
  // Right after the charset, NOT before </head>: <base> only governs the URLs
  // that come after it, and the stylesheet links are the first thing in the head.
  const source = readFileSync(join(SRC, page), "utf8");
  const anchor = '<meta charset="utf-8">';
  if (!source.includes(anchor)) throw new Error(`${page} no longer starts with ${anchor}`);
  return source.replace(anchor, `${anchor}${preamble}`);
};

const shot = (name, html, width, height) => {
  const dir = join(tmpdir(), "quick-jump-shots");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.html`);
  writeFileSync(file, html);
  execFileSync(chrome, [
    "--headless", "--disable-gpu", "--hide-scrollbars",
    `--window-size=${width},${height}`,
    `--screenshot=${join(OUT, `${name}.png`)}`,
    `--virtual-time-budget=4000`,
    `file://${file}`,
  ], { stdio: "ignore" });
  rmSync(file);
  console.log(`${name}.png`);
};

mkdirSync(OUT, { recursive: true });

shot("screenshot-options", harness("options.html", { storage: STORAGE }), 1280, 800);
