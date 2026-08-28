import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCore } from "./load-core.js";

const g = await loadCore();
const ID = "11111111-1111-4111-8111-111111111111";

const policy = (() => {
  let p = g.JumpPolicy.empty().withEngines(["google.com"]).value;
  p = p.register(ID, g.ProjectKey.parse("ABC").value, g.JiraInstance.parse("http://jira:8080").value).value;
  p = p.acknowledge(ID, "INSECURE_SCHEME").value;
  p = p.acknowledge(ID, "INTERNAL_HOST").value;
  return p.armShortcut(ID).value;
})();

test("persistence is a faithful mirror", () => {
  const restored = g.JumpPolicy.restore(policy.toJSON());
  assert.equal(restored.ok, true);
  assert.deepEqual(restored.policy.toJSON(), policy.toJSON());
  assert.equal(restored.quarantine.length, 0);
});

test("import is strictly less privileged than what was exported", () => {
  // Monotonicity of privilege: stronger than a mirror test, and it is what keeps
  // "everything imported arrives disarmed, with no acknowledgements" true.
  const proposed = g.JumpPolicy.proposeImport(policy.toTransfer());
  assert.equal(proposed.ok, true);
  assert.equal(proposed.policy.armed(), false);
  for (const shortcut of proposed.policy.shortcuts()) {
    assert.equal(shortcut.armed(), false, "an imported shortcut must never arrive armed");
    assert.deepEqual(shortcut.consent().acknowledgedKinds(), [], "a file cannot pre-approve its own warnings");
  }
  assert.equal(proposed.policy.activeBindings().length, 0, "a hostile import installs no rule at all");
});

test("the export carries no acknowledgement", () => {
  const transfer = policy.toTransfer();
  assert.equal(JSON.stringify(transfer).includes("consent"), false);
  assert.equal(JSON.stringify(transfer).includes("armed"), false);
});

test("import refuses an unknown field wholesale rather than ignoring it", () => {
  // Ignoring extras "for forward compatibility" is exactly how a meaningful
  // field from a future version smuggles itself in today.
  assert.equal(g.JumpPolicy.proposeImport({ schemaVersion: 1, shortcuts: [], surprise: 1 }).code, "UNKNOWN_FIELD");
  const withExtra = { schemaVersion: 1, shortcuts: [{ id: "a", key: "ABC", baseUrl: "https://x.example.org", extra: 1 }] };
  assert.deepEqual(g.JumpPolicy.proposeImport(withExtra).dropped.map((d) => d.code), ["UNKNOWN_FIELD"]);
});

test("a schema newer than the code is refused, never overwritten", () => {
  assert.equal(g.JumpPolicy.restore({ schemaVersion: 99, shortcuts: [] }).code, "SCHEMA_TOO_NEW");
  assert.equal(g.JumpPolicy.restore({ shortcuts: [] }).code, "SCHEMA_MISSING");
});

test("prototype pollution keys are refused, not stripped", () => {
  // JSON.parse alone is not vulnerable; the danger is a recursive merge
  // afterwards. We never merge, and the reviver is the belt on top of the braces.
  const result = g.ShortcutAdmission.parseJson('{"__proto__":{"armed":true},"schemaVersion":1}');
  assert.equal(result.code, "MALICIOUS_KEY");
  assert.equal({}.armed, undefined);
});

test("a project key named PROTO or CONSTRUCTOR cannot break key uniqueness", () => {
  // Valid against [A-Z][A-Z0-9_]+, and it would break `key in obj` on an object
  // literal. The registry uses a Map.
  let p = g.JumpPolicy.empty();
  for (const name of ["PROTO", "CONSTRUCTOR", "TOSTRING", "HASOWNPROPERTY"]) {
    const result = p.register(`id-${name}`, g.ProjectKey.parse(name).value, g.JiraInstance.parse("https://x.example.org/" + name.toLowerCase()).value);
    assert.equal(result.ok, true, `${name} was refused`);
    p = result.value;
  }
  assert.equal(p.shortcuts().length, 4);
  const duplicate = p.register("other", g.ProjectKey.parse("PROTO").value, g.JiraInstance.parse("https://y.example.org").value);
  assert.equal(duplicate.code, "DUPLICATE_KEY");
});

test("an invalid entry is quarantined and the valid ones still work", () => {
  const document = {
    schemaVersion: 1,
    armed: true,
    engines: ["google.com"],
    shortcuts: [
      { id: "good", key: "ABC", baseUrl: "https://example.atlassian.net", consent: { armed: true, acknowledged: [] } },
      { id: "bad", key: "ABC.*", baseUrl: "https://example.atlassian.net", consent: { armed: true, acknowledged: [] } },
    ],
  };
  const restored = g.JumpPolicy.restore(document);
  assert.equal(restored.policy.activeBindings().length, 1, "the healthy shortcut keeps working");
  assert.equal(restored.quarantine.length, 1);
  assert.equal(restored.policy.diagnose({ originsGranted: true, quarantinedCount: restored.quarantine.length }), "PARTIAL_POLICY");
});

test("a quarantined entry survives a later write instead of being erased", () => {
  // Without quarantine, restore() drops the entry, the in-memory policy no longer
  // holds it, and the first apply rewrites storage from an amputated policy --
  // erasing, permanently, a configuration the user created.
  const document = {
    schemaVersion: 1,
    armed: true,
    engines: ["google.com"],
    shortcuts: [{ id: "bad", key: "ABC.*", baseUrl: "https://example.atlassian.net" }],
  };
  const restored = g.JumpPolicy.restore(document);
  const stored = new g.StoredPolicy(restored.policy, restored.quarantine);
  const afterAnUnrelatedEdit = stored.withPolicy(stored.policy().withEngines(["google", "bing"]).value);
  assert.equal(afterAnUnrelatedEdit.toJSON().quarantine.length, 1, "the entry must still be there");
  assert.deepEqual(afterAnUnrelatedEdit.toJSON().quarantine[0], document.shortcuts[0]);
});

test("fixing a quarantined entry goes back through the one door and can fail", () => {
  const document = {
    schemaVersion: 1,
    armed: true,
    engines: ["google.com"],
    shortcuts: [
      { id: "good", key: "ABC", baseUrl: "https://example.atlassian.net" },
      { id: "bad", key: "ABC.*", baseUrl: "https://example.atlassian.net" },
    ],
  };
  const restored = g.JumpPolicy.restore(document);
  const stored = new g.StoredPolicy(restored.policy, restored.quarantine);

  // Uniqueness does not extend to quarantine, so fixing can legitimately collide.
  const collides = stored.promote(0, g.ProjectKey.parse("ABC").value, g.JiraInstance.parse("https://example.atlassian.net").value);
  assert.equal(collides.code, "DUPLICATE_KEY");

  const fixed = stored.promote(0, g.ProjectKey.parse("DEV").value, g.JiraInstance.parse("https://example.atlassian.net").value);
  assert.equal(fixed.ok, true);
  assert.equal(fixed.value.quarantinedCount(), 0, "promotion is atomic: registered AND removed");
  assert.equal(fixed.value.policy().shortcuts().length, 2);
});

test("deleting a quarantined entry is a deliberate gesture", () => {
  const restored = g.JumpPolicy.restore({
    schemaVersion: 1,
    shortcuts: [{ id: "bad", key: "!", baseUrl: "https://x.example.org" }],
  });
  const stored = new g.StoredPolicy(restored.policy, restored.quarantine);
  assert.equal(stored.dropQuarantined(9).code, "UNKNOWN_QUARANTINED");
  assert.equal(stored.dropQuarantined(0).value.quarantinedCount(), 0);
});
