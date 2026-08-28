import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCore } from "./load-core.js";
import { HOSTILE_KEYS, VALID_KEYS } from "./fixtures/hostile-keys.js";
import { HOSTILE_BASE_URLS, VALID_BASE_URLS } from "./fixtures/hostile-base-urls.js";

const g = await loadCore();

test("hostile project keys are refused by ProjectKey.parse itself", () => {
  // Not by isRegexSupported: `A|` and `.*` are perfectly valid regexes, and `A|`
  // would lift the alternation to the top level, turning the extension into a
  // universal redirector.
  for (const key of HOSTILE_KEYS) {
    const result = g.ProjectKey.parse(key);
    assert.equal(result.ok, false, `key ${JSON.stringify(key)} was accepted`);
    assert.ok(result.code, `key ${JSON.stringify(key)} was refused without a code`);
  }
});

test("legitimate project keys are accepted and normalised", () => {
  for (const [input, expected] of VALID_KEYS) {
    const result = g.ProjectKey.parse(input);
    assert.equal(result.ok, true, `key ${JSON.stringify(input)} was refused`);
    assert.equal(result.value.toString(), expected);
  }
});

test("full-width look-alikes are refused before normalisation can rewrite them", () => {
  assert.equal(g.ProjectKey.parse("ＡＢＣ").code, "KEY_NOT_NORMALISED");
});

test("ambiguous keys are flagged but not refused", () => {
  assert.equal(g.ProjectKey.parse("ISO").value.isAmbiguous(), true);
  assert.equal(g.ProjectKey.parse("CVE").value.isAmbiguous(), true);
  assert.equal(g.ProjectKey.parse("AB").value.isAmbiguous(), true, "two letters collide massively");
  assert.equal(g.ProjectKey.parse("PAYROLL").value.isAmbiguous(), false);
});

test("hostile base URLs are refused, each with its own distinct code", () => {
  for (const [input, code] of HOSTILE_BASE_URLS) {
    const result = g.JiraInstance.parse(input);
    assert.equal(result.ok, false, `base URL ${JSON.stringify(input)} was accepted`);
    assert.equal(result.code, code, `base URL ${JSON.stringify(input)} gave ${result.code}`);
  }
});

test("legitimate base URLs are accepted, self-hosted included", () => {
  for (const [input, expected] of VALID_BASE_URLS) {
    const result = g.JiraInstance.parse(input);
    assert.equal(result.ok, true, `base URL ${JSON.stringify(input)} was refused: ${result.code}`);
    assert.equal(result.value.baseUrl(), expected);
  }
});

test("a bare host name defaults to https, never http", () => {
  assert.equal(g.JiraInstance.parse("example.atlassian.net").value.protocol(), "https:");
});

test("the origin/path split has a single owner", () => {
  const instance = g.JiraInstance.parse("https://intra.example.org/jira").value;
  assert.deepEqual(instance.parts(), { origin: "https://intra.example.org", path: "/jira" });
});

test("a forged storage entry produces no rule at all", () => {
  // The most valuable test in the project: it exercises the key charset, the URL
  // validation and the "never trust your own storage" rule in one go.
  const forged = {
    schemaVersion: 1,
    armed: true,
    engines: ["google.com"],
    shortcuts: [
      { id: "a", key: ".*", baseUrl: "https://example.atlassian.net", consent: { armed: true, acknowledged: [] } },
      { id: "b", key: "ABC", baseUrl: "javascript:alert(1)", consent: { armed: true, acknowledged: [] } },
    ],
  };
  const restored = g.JumpPolicy.restore(forged);
  assert.equal(restored.ok, true);
  assert.equal(restored.policy.activeBindings().length, 0);
  assert.equal(restored.quarantine.length, 2, "both entries must be quarantined, not dropped");
  assert.deepEqual(restored.dropped.map((d) => d.code), ["KEY_SHAPE", "BASE_SCHEME"]);
  const { rules } = g.RuleFactory.buildRules(restored.policy, g.SearchEngineCatalog);
  assert.equal(rules.length, 0);
});
