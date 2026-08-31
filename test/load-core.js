/**
 * Loads core/ and interception/ once and hands back the globals.
 *
 * They are classic scripts (an IIFE populating globalThis) because the same
 * files must run in a Chrome service worker, a Firefox event page and a <script
 * src> in an HTML page. Deciding how to load them for tests happens here, once,
 * rather than being copy-pasted into every test file.
 */
const ORDER = [
  "core/mutation-result.js",
  "core/reserved-prefix.js",
  "core/issue-reference.js",
  "core/shortcut-warning.js",
  "core/consent.js",
  "core/project-shortcut.js",
  "core/catch-all-key.js",
  "core/shortcut-key.js",
  "core/shortcut-id.js",
  "core/shortcut-registry.js",
  "core/custom-engine.js",
  "core/jump-policy.js",
  "core/policy-diff.js",
  "core/admission.js",
  "interception/search-engine-catalog.js",
  "interception/reference-pattern.js",
  "interception/rule-ranking.js",
  "interception/rule-set.js",
  "interception/rule-factory.js",
  "interception/origin-requirements.js",
  "interception/jump-preview.js",
  "stored-policy.js",
  // The storage-facing modules the journal tests exercise. They need Platform,
  // which the tests stand in for, so they load last.
  "platform.js",
  "versioned-entry.js",
  "key-acknowledgements.js",
  "destination-journal.js",
  "rule-installer.js",
];

let loaded = false;

export async function loadCore() {
  if (!loaded) {
    for (const file of ORDER) await import(`../src/${file}`);
    loaded = true;
  }
  return globalThis;
}

export { ORDER };
