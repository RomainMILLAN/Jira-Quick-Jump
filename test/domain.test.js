import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCore } from "./load-core.js";

const g = await loadCore();
const ID = "11111111-1111-4111-8111-111111111111";
const key = (k) => g.ProjectKey.parse(k).value;
const instance = (u) => g.JiraInstance.parse(u).value;

const armedPolicy = () => {
  let p = g.JumpPolicy.empty().withEngines(["google.com"]).value;
  p = p.register(ID, key("ABC"), instance("https://example.atlassian.net")).value;
  return p.armShortcut(ID).value;
};

test("the three separators are domain knowledge, tested directly", () => {
  const parseKey = (raw) => g.ProjectKey.parse(raw);
  for (const input of ["ABC-123", "ABC 123", "abc 123"]) {
    assert.equal(g.IssueReference.parse(input, parseKey).value.toString(), "ABC-123");
  }
});

test("any run of digits is an issue number, so ABC-2024 is an issue and not a year", () => {
  const reference = g.IssueReference.of(key("ABC"), "2024");
  assert.equal(reference.ok, true);
  assert.equal(reference.value.toString(), "ABC-2024");
});

test("register is idempotent, because the compare-and-set replays intentions", () => {
  const policy = armedPolicy();
  const again = policy.register(ID, key("ABC"), instance("https://example.atlassian.net"));
  assert.equal(again.ok, true, "a replay must be a no-op, not a DUPLICATE_KEY");
  assert.equal(again.value.activeBindings().length, 1);
});

test("DUPLICATE_KEY keeps its exact meaning: a real collision, never a retry artefact", () => {
  const policy = armedPolicy();
  const other = policy.register("22222222-2222-4222-8222-222222222222", key("ABC"), instance("https://other.example.org"));
  assert.equal(other.code, "DUPLICATE_KEY");
});

test("arming and disarming are absolute, so replaying them is safe", () => {
  // A relative delta would be catastrophic here: disarming the same shortcut from
  // both surfaces would RE-ARM it after the conflict replay.
  let policy = armedPolicy();
  for (let i = 0; i < 3; i += 1) policy = policy.disarmShortcut(ID).value;
  assert.equal(policy.registry().find(ID).armed(), false);
  for (let i = 0; i < 3; i += 1) policy = policy.armShortcut(ID).value;
  assert.equal(policy.registry().find(ID).armed(), true);
});

test("a consent is given to a destination: changing it forgets the acknowledgements", () => {
  const policy = armedPolicy();
  const moved = policy.withBaseUrlFor(ID, instance("http://jira:8080")).value;
  assert.deepEqual(
    moved.registry().find(ID).unacknowledgedWarnings().map((w) => w.kind),
    ["INSECURE_SCHEME", "INTERNAL_HOST"]
  );
});

test("a shortcut with pending warnings leaves activeBindings even while armed", () => {
  // arm() guards the front door; withBaseUrlFor changes the state from inside.
  const policy = armedPolicy().withBaseUrlFor(ID, instance("http://jira:8080")).value;
  assert.equal(policy.registry().find(ID).armed(), true);
  assert.equal(policy.activeBindings().length, 0);
  assert.equal(policy.armShortcut(ID).code, "UNACKNOWLEDGED_WARNING");
});

test("acknowledging brings the shortcut back without re-arming it", () => {
  let policy = armedPolicy().withBaseUrlFor(ID, instance("http://jira:8080")).value;
  policy = policy.acknowledge(ID, "INSECURE_SCHEME").value;
  policy = policy.acknowledge(ID, "INTERNAL_HOST").value;
  assert.equal(policy.activeBindings().length, 1);
});

test("an unknown warning kind is refused rather than silently ignored", () => {
  assert.equal(armedPolicy().acknowledge(ID, "NOPE").code, "UNKNOWN_WARNING_KIND");
});

test("changing a destination emits one event, and re-setting the same value emits none", () => {
  const policy = armedPolicy();
  const moved = policy.withBaseUrlFor(ID, instance("https://other.example.org"));
  assert.equal(moved.events.length, 1);
  assert.deepEqual(moved.events[0], {
    shortcutId: ID,
    key: "ABC",
    oldBaseUrl: "https://example.atlassian.net",
    newBaseUrl: "https://other.example.org",
  });
  // A replay must not fabricate an event where old === new.
  assert.deepEqual(moved.value.withBaseUrlFor(ID, instance("https://other.example.org")).events, []);
});

test("the global kill switch is not the per-shortcut one", () => {
  const policy = armedPolicy();
  assert.equal(policy.disarm().activeBindings().length, 0);
  assert.equal(policy.disarm().arm().activeBindings().length, 1);
});

test("diagnose says why nothing works, in a fixed order of priority", () => {
  const granted = { originsGranted: true };
  assert.equal(g.JumpPolicy.empty().disarm().diagnose(granted), "DISARMED");
  assert.equal(g.JumpPolicy.empty().diagnose(granted), "NO_SHORTCUTS");
  let policy = g.JumpPolicy.empty().register(ID, key("ABC"), instance("https://example.atlassian.net")).value;
  assert.equal(policy.diagnose(granted), "NO_ENGINES");
  policy = policy.withEngines(["google.com"]).value;
  assert.equal(policy.diagnose(granted), "ALL_SHORTCUTS_DISARMED");
  policy = policy.armShortcut(ID).value;
  assert.equal(policy.diagnose({ originsGranted: true, quarantinedCount: 2 }), "PARTIAL_POLICY");
  assert.equal(policy.diagnose({ originsGranted: false }), "MISSING_ORIGINS");
  assert.equal(policy.diagnose(granted), "READY");
});

test("every mutation returns the same shape, with events always present", () => {
  const policy = armedPolicy();
  for (const result of [
    policy.register("33333333-3333-4333-8333-333333333333", key("DEV"), instance("https://dev.example.org")),
    policy.armShortcut(ID),
    policy.disarmShortcut(ID),
    policy.withKeyFor(ID, key("OPS")),
    policy.acknowledge(ID, "PUNYCODE"),
    policy.remove(ID),
    policy.withEngines(["bing.com"]),
    policy.acknowledge(ID, "NOPE"),
  ]) {
    assert.ok(Array.isArray(result.events), "events must always be present, never sometimes");
  }
});
