/**
 * Loads core/, interception/ and the UI helpers that hold testable arithmetic,
 * once, and hands back the globals.
 *
 * They are classic scripts (an IIFE populating globalThis) because the same
 * files must run in a Chrome service worker, a Firefox event page and a <script
 * src> in an HTML page. Deciding how to load them for tests happens here, once,
 * rather than being copy-pasted into every test file.
 *
 * THE ORDER IS THE ONE THAT SHIPS. This was the FIFTH loading list and the only
 * one no test read, so it was free to drift from the four that reach a browser --
 * and it had: stored-policy.js sat before platform.js here and after it in both
 * pages. A changelock resting on load order could therefore be green in the suite
 * and broken in the browser, or the reverse. structure.test.js now compares the
 * two, so this list is maintained by copying the manifest's, never by hand.
 */
const ORDER = [
  "platform.js",
  "core/mutation-result.js",
  "core/engine-id.js",
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
  "core/diagnosis.js",
  "core/policy-diff.js",
  "core/admission.js",
  "interception/search-engine-catalog.js",
  "interception/re2-budget.js",
  "interception/not-installed.js",
  "interception/reference-pattern.js",
  "interception/rule-ranking.js",
  "interception/installed-rule.js",
  "interception/rule-set.js",
  "interception/rule-factory.js",
  "interception/origin-requirements.js",
  "interception/jump-preview.js",
  "versioned-entry.js",
  "install-outcome.js",
  "stored-policy.js",
  "key-acknowledgements.js",
  "installed-projection.js",
  "policy-repository.js",
  "destination-journal.js",
  "rule-installer.js",
  // AFTER platform.js, because it calls t() -- and after core/diagnosis.js, whose
  // catalogue it reads AT LOAD TIME to refuse an incomplete table. It touches
  // neither document nor window, like row-reorder.js below, which is what makes
  // both safe to load in a bare Node process.
  //
  // NOT in the manifest, and correctly so: background.scripts carries no ui/*.
  // They sit at the END so the shared prefix above stays IDENTICAL to what ships,
  // which is what the structure test compares.
  "ui/diagnosis-presentation.js",
  "ui/refusal-presentation.js",
  "ui/write-queue.js",
  "ui/hold-watch.js",
  "ui/section.js",
  "ui/focus-memory.js",
  "ui/row-reorder.js",
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
