/**
 * Derives build/chrome from src/.
 *
 * Chrome uses background.service_worker, so background.scripts and the gecko
 * settings are removed here rather than duplicating the manifest. No permission
 * is filtered: the manifest requests none that Chrome does not recognise, and a
 * filter over an empty list is a claim with nothing behind it.
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const OUT = join(ROOT, "build", "chrome");

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync(SRC, OUT, { recursive: true });

const path = join(OUT, "manifest.json");
const manifest = JSON.parse(readFileSync(path, "utf8"));

delete manifest.background.scripts;
delete manifest.browser_specific_settings;

writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
console.log("build/chrome ready (service_worker, no gecko settings)");
