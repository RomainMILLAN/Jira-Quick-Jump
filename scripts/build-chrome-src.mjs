/**
 * Derives build/chrome from src/.
 *
 * Chrome uses background.service_worker and warns about "unrecognized
 * permission" for Firefox-only entries, so both are removed here rather than
 * duplicating the manifest.
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const OUT = join(ROOT, "build", "chrome");

const FIREFOX_ONLY = new Set([]);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync(SRC, OUT, { recursive: true });

const path = join(OUT, "manifest.json");
const manifest = JSON.parse(readFileSync(path, "utf8"));

delete manifest.background.scripts;
delete manifest.browser_specific_settings;
manifest.permissions = manifest.permissions.filter((p) => !FIREFOX_ONLY.has(p));

writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
console.log("build/chrome ready (service_worker, no gecko settings)");
