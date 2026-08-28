import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCore } from "./load-core.js";
import { POSITIVE, NEGATIVE } from "./fixtures/search-urls.js";

const g = await loadCore();
const ID = "11111111-1111-4111-8111-111111111111";

const policy = (() => {
  let p = g.JumpPolicy.empty().withEngines(["google", "bing", "duckduckgo"]).value;
  p = p.register(ID, g.ProjectKey.parse("ABC").value, g.JiraInstance.parse("https://example.atlassian.net").value).value;
  return p.armShortcut(ID).value;
})();

test("real search URLs land on the issue", () => {
  for (const url of POSITIVE) {
    const result = g.JumpPreview.forSearchUrl(url, policy, g.SearchEngineCatalog);
    assert.equal(result.ok, true, `${url} was not intercepted`);
    assert.match(result.destination, /^https:\/\/example\.atlassian\.net\/browse\/ABC-\d+$/);
  }
});

test("ordinary searches go through untouched", () => {
  for (const url of NEGATIVE) {
    const result = g.JumpPreview.forSearchUrl(url, policy, g.SearchEngineCatalog);
    assert.equal(result.ok, false, `${url} was intercepted: ${result.destination}`);
  }
});

test("the anchor seam is locked against a literal expectation", () => {
  // ReferencePattern returns an UNANCHORED fragment; the engine wraps it and
  // places both anchors. Without this test the anchor ends up doubled or absent.
  const key = g.ProjectKey.parse("ABC").value;
  assert.equal(g.ReferencePattern.patternFor(key), "ABC(?:-|\\+|%20)(\\d+)");
  assert.equal(
    g.SearchEngineCatalog.find("google").searchUrlPattern("FRAGMENT"),
    "^https://(?:www\\.)?google\\.[a-z.]+/search\\?(?:.*&)?q=FRAGMENT(?:&|$)"
  );
  const { rules } = g.RuleFactory.buildRules(policy, g.SearchEngineCatalog);
  assert.equal(
    rules[0].condition.regexFilter,
    "^https://(?:www\\.)?google\\.[a-z.]+/search\\?(?:.*&)?q=ABC(?:-|\\+|%20)(\\d+)(?:&|$)"
  );
});

test("the pattern has exactly one capture group and the substitution one backreference", () => {
  const key = g.ProjectKey.parse("ABC").value;
  const instance = g.JiraInstance.parse("https://example.atlassian.net").value;
  assert.equal((g.ReferencePattern.patternFor(key).match(/\((?!\?)/g) || []).length, 1);
  const substitution = g.ReferencePattern.substitutionFor(instance, key);
  assert.deepEqual(substitution.match(/\\[0-9]/g), ["\\1"]);
  assert.equal(substitution, "https://example.atlassian.net/browse/ABC-\\1");
});

test("every rule is main_frame only, and never uses excludedResourceTypes", () => {
  // If rules applied to sub-resources, any web page could map the visitor's
  // intranet with an <img> tag: which keys are configured, which internal hosts
  // exist and answer, and how far away they are.
  const { rules } = g.RuleFactory.buildRules(policy, g.SearchEngineCatalog);
  assert.equal(rules.length, 3);
  for (const rule of rules) {
    assert.deepEqual(rule.condition.resourceTypes, ["main_frame"]);
    assert.equal("excludedResourceTypes" in rule.condition, false);
  }
});

test("an unknown engine id is reported rather than crashing or being skipped in silence", () => {
  const withGhost = policy.withEngines(["google", "ghost"]).value;
  const { rules, skipped } = g.RuleFactory.buildRules(withGhost, g.SearchEngineCatalog);
  assert.equal(rules.length, 1);
  assert.deepEqual(skipped.map((s) => s.code), ["UNKNOWN_ENGINE"]);
});

test("the case of the typed key does not change the destination", () => {
  const lower = g.JumpPreview.forSearchUrl("https://www.google.com/search?q=abc-7", policy, g.SearchEngineCatalog);
  assert.equal(lower.destination, "https://example.atlassian.net/browse/ABC-7");
});

test("the preview refuses an oversized input before compiling anything", () => {
  const huge = "https://www.google.com/search?q=" + "&".repeat(g.JumpPreview.MAX_INPUT);
  assert.equal(g.JumpPreview.forSearchUrl(huge, policy, g.SearchEngineCatalog).code, "INPUT_TOO_LONG");
});

test("the preview never returns null", () => {
  assert.equal(g.JumpPreview.forSearchUrl("not a url", policy, g.SearchEngineCatalog).code, "NOT_A_URL");
  assert.equal(g.JumpPreview.forSearchUrl("https://example.org/", policy, g.SearchEngineCatalog).code, "NO_MATCH");
});

test("required origins cover engines and every shortcut, disarmed ones included", () => {
  const disarmed = policy.disarmShortcut(ID).value;
  assert.deepEqual(g.OriginRequirements.requiredOrigins(disarmed, g.SearchEngineCatalog), [
    "*://*.google.com/*",
    "*://*.bing.com/*",
    "*://*.duckduckgo.com/*",
    "https://example.atlassian.net/*",
  ]);
});

test("a self-hosted destination with a path keeps its path", () => {
  let p = g.JumpPolicy.empty().withEngines(["google"]).value;
  p = p.register(ID, g.ProjectKey.parse("ABC").value, g.JiraInstance.parse("https://intra.example.org/jira").value).value;
  p = p.acknowledge(ID, "INTERNAL_HOST").value;
  p = p.armShortcut(ID).value;
  const result = g.JumpPreview.forSearchUrl("https://www.google.com/search?q=ABC-9", p, g.SearchEngineCatalog);
  assert.equal(result.destination, "https://intra.example.org/jira/browse/ABC-9");
});
