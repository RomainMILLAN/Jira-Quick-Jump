/**
 * Derives build/firefox from src/.
 *
 * Mozilla's addons-linter rejects background.service_worker, so only
 * background.scripts survives here.
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const OUT = join(ROOT, "build", "firefox");

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync(SRC, OUT, { recursive: true });

const path = join(OUT, "manifest.json");
const manifest = JSON.parse(readFileSync(path, "utf8"));

if (manifest.background?.service_worker) delete manifest.background.service_worker;
if (!manifest.background?.scripts) {
  throw new Error("the Firefox manifest must define background.scripts");
}

writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
console.log("build/firefox ready (event page, no service_worker)");
