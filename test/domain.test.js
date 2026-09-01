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

test("a mutator emits nothing: the diff between two states is the single producer", () => {
  // Two producers put the same change twice into a journal capped at twenty
  // entries, so withBaseUrlFor stopped building the fact itself.
  const policy = armedPolicy();
  const moved = policy.withBaseUrlFor(ID, instance("https://other.example.org"));
  assert.deepEqual(moved.events, [], "a mutator no longer emits");

  assert.deepEqual(g.PolicyDiff.between(policy, moved.value), [{
    type: "DestinationChanged",
    shortcutId: ID,
    key: "ABC",
    oldBaseUrl: "https://example.atlassian.net",
    newBaseUrl: "https://other.example.org",
  }]);
  // A replay must not fabricate a fact where old === new.
  assert.deepEqual(g.PolicyDiff.between(moved.value, moved.value), []);
});

test("the global kill switch is not the per-shortcut one", () => {
  const policy = armedPolicy();
  assert.equal(policy.disarm().activeBindings().length, 0);
  assert.equal(policy.disarm().arm().activeBindings().length, 1);
});

test("diagnose says why nothing works, in a fixed order of priority", () => {
  // THE TWO FACTS OF INSTALLED REALITY ARE DECLARED, never defaulted: diagnose() no
  // longer supplies them, because an absent fact is not a true one. This literal
  // serves FIVE assertions -- correcting it here repairs five sites.
  const granted = { originsGranted: true, installed: true, coverageSatisfied: true };
  assert.equal(g.JumpPolicy.empty().disarm().diagnose(granted), "DISARMED");
  assert.equal(g.JumpPolicy.empty().diagnose(granted), "NO_SHORTCUTS");
  let policy = g.JumpPolicy.empty().register(ID, key("ABC"), instance("https://example.atlassian.net")).value;
  assert.equal(policy.diagnose(granted), "NO_ENGINES");
  policy = policy.withEngines(["google.com"]).value;
  assert.equal(policy.diagnose(granted), "ALL_SHORTCUTS_DISARMED");
  policy = policy.armShortcut(ID).value;
  // The rank-11 PARTIAL_POLICY, on a POPULATED policy. The other entry, conditioned on
  // an empty registry, is the one admission.test.js interrogates -- two ranks, one code.
  assert.equal(policy.diagnose({ originsGranted: true, quarantinedCount: 2, installed: true, coverageSatisfied: true }), "PARTIAL_POLICY");
  // The two reality facts, but originsGranted stays FALSE -- supplying it true here
  // would test something else entirely.
  assert.equal(policy.diagnose({ originsGranted: false, installed: true, coverageSatisfied: true }), "MISSING_ORIGINS");
  assert.equal(policy.diagnose(granted), "READY");
});

test("a fact of installed reality that is ABSENT is not a true one", () => {
  // TWO LINKS IN SERIES, so TWO witnesses. INSTALL_FAILED ranks FIRST and MASKS
  // CATCH_ALL_NOT_INSTALLED, which is ninth -- so someone restoring the second
  // predicate to `=== false` would leave the suite green, every other call now passing
  // the fact explicitly, for which both forms are indistinguishable.
  //
  // THE FIXTURE MATTERS: these witnesses need a policy that CLEARS ranks 2 to 8.
  // ordered() answers ALL_SHORTCUTS_DISARMED and ordered().disarm() answers DISARMED;
  // this one is armed, acknowledged and engined, so it reaches READY when told the
  // truth.
  let p = g.JumpPolicy.empty().withEngines(["google.com"]).value;
  p = p.register(ID, key("ABC"), instance("https://example.atlassian.net")).value;
  p = p.armShortcut(ID).value;
  assert.equal(p.diagnose({ originsGranted: true, quarantinedCount: 0, installed: true,
                            coverageSatisfied: true }), "READY", "the fixture must reach READY");

  // Link 1, and "bare facts" names two different things: one answers MISSING_ORIGINS
  // today, the other answered READY.
  assert.equal(p.diagnose({}), "INSTALL_FAILED");
  assert.equal(p.diagnose({ originsGranted: true, quarantinedCount: 0 }), "INSTALL_FAILED");
  // Link 2: installed present, the coverage fact absent.
  assert.equal(p.diagnose({ originsGranted: true, quarantinedCount: 0, installed: true }),
               "CATCH_ALL_NOT_INSTALLED");

  // THE THIRD LINK IS DELIBERATELY NOT HARDENED: `f.quarantinedCount > 0` is mute on
  // undefined too. PARTIAL_POLICY is under-signalling at a BOUNDED cost -- the user
  // sees an incomplete configuration without knowing it is -- whereas a masked
  // INSTALL_FAILED lets them believe a jump departs when it does not. Written here so
  // the next batch does not read it as a regression of this one.
  assert.equal(p.diagnose({ originsGranted: true, installed: true, coverageSatisfied: true }),
               "READY", "quarantinedCount stays undefined-tolerant, on purpose");
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

// ------------------------------------------- evaluation order and the catch-all

const ORDER_A = "aaaaaaaa-1111-4111-8111-111111111111";
const ORDER_B = "bbbbbbbb-2222-4222-8222-222222222222";
const STAR = "cccccccc-3333-4333-8333-333333333333";

const ordered = () => {
  let p = g.JumpPolicy.empty().withEngines(["google.com"]).value;
  p = p.register(ORDER_A, g.ProjectKey.parse("ECR").value, instance("https://a.atlassian.net")).value;
  p = p.register(STAR, g.CatchAllKey.only(), instance("https://c.atlassian.net")).value;
  p = p.register(ORDER_B, g.ProjectKey.parse("JUL").value, instance("https://b.atlassian.net")).value;
  return p;
};

test("register appends, so the admission door never rewrites the persisted order", () => {
  // A customs officer stamps or refuses; he does not rearrange the suitcases.
  // restore replays register entry by entry, so a register that placed rows would
  // silently change an effective destination on every read.
  assert.deepEqual(ordered().registry().orderedIds(), [ORDER_A, STAR, ORDER_B]);
});

test("the order round-trips through toJSON and restore, catch-all in first position included", () => {
  const moved = ordered().withOrder([STAR, ORDER_A, ORDER_B]).value;
  const restored = g.JumpPolicy.restore(moved.toJSON());
  assert.equal(restored.ok, true);
  assert.deepEqual(restored.policy.registry().orderedIds(), [STAR, ORDER_A, ORDER_B]);
});

test("editing a destination does not move the row", () => {
  // Map.set on an existing key preserves the position, which is what makes the
  // round trip true BY CONSTRUCTION rather than by luck.
  const edited = ordered().withBaseUrlFor(ORDER_A, instance("https://moved.example.org")).value;
  assert.deepEqual(edited.registry().orderedIds(), [ORDER_A, STAR, ORDER_B]);
});

test("withOrder is absolute, so replaying it three times lands in the same place", () => {
  // VersionedEntry replays the intention on a value that may already contain its
  // own effect: "move up by one" would move up by two.
  const target = [ORDER_B, ORDER_A, STAR];
  let p = ordered();
  for (let i = 0; i < 3; i += 1) p = p.withOrder(target).value;
  assert.deepEqual(p.registry().orderedIds(), target);
});

test("withOrder written against a stale set is refused rather than applied to a different one", () => {
  // Appending the unknown ids would silently drop a concurrently added shortcut
  // BELOW the catch-all, which is to say kill it.
  assert.equal(ordered().withOrder([ORDER_A, STAR]).code, "ORDER_STALE");
  assert.equal(ordered().withOrder([ORDER_A, STAR, ORDER_A]).code, "ORDER_STALE");
});

test("a catch-all may sit anywhere, and everything after it is shadowed", () => {
  const p = ordered();
  assert.deepEqual(p.shadowedShortcuts().map((s) => s.key().toString()), ["JUL"]);
  const last = p.withOrder([ORDER_A, ORDER_B, STAR]).value;
  assert.deepEqual(last.shadowedShortcuts(), []);
  const first = p.withOrder([STAR, ORDER_A, ORDER_B]).value;
  assert.deepEqual(first.shadowedShortcuts().map((s) => s.key().toString()), ["ECR", "JUL"]);
});

test("a shadowed shortcut produces no binding at all, and comes back when the catch-all goes", () => {
  let p = ordered().withOrder([STAR, ORDER_A, ORDER_B]).value;
  p = p.acknowledge(STAR, "CATCH_ALL").value;
  p = p.armShortcut(ORDER_A).value.armShortcut(ORDER_B).value.armShortcut(STAR).value;
  assert.deepEqual(p.activeBindings().map((b) => b.describe()), ["the catch-all on google.com"]);
  const without = p.remove(STAR).value;
  assert.deepEqual(without.activeBindings().map((b) => b.describe()).sort(), ["ECR on google.com", "JUL on google.com"]);
});

test("there can be only one catch-all, and the second one is refused with its own code", () => {
  // A dedicated code is a better MESSAGE than DUPLICATE_KEY, but not a second
  // control: _holdsKey already refuses, and two controls end up disagreeing.
  const refused = ordered().register("dddddddd-4444-4444-8444-444444444444", g.CatchAllKey.only(), instance("https://d.example.org"));
  assert.equal(refused.code, "DUPLICATE_CATCH_ALL");
});

test("a catch-all cannot be renamed, and a shortcut cannot become a catch-all", () => {
  // Otherwise an armed, acknowledged shortcut becomes a universal redirector
  // WHILE KEEPING ITS CONSENT -- without ever showing the CATCH_ALL warning.
  const p = ordered();
  assert.equal(p.withKeyFor(STAR, g.ProjectKey.parse("ABC").value).code, "KEY_NATURE_IMMUTABLE");
  assert.equal(p.withKeyFor(ORDER_A, g.CatchAllKey.only()).code, "KEY_NATURE_IMMUTABLE");
  // And the entity refuses on its own, because guarding in the registry does not
  // protect the entity.
  assert.throws(() => p.registry().find(STAR).withKey(g.ProjectKey.parse("ABC").value));
  // Renaming between two named keys stays legal.
  assert.equal(p.withKeyFor(ORDER_A, g.ProjectKey.parse("XYZ").value).ok, true);
});

test("a new named shortcut is placed above the catch-all, so it is never born shadowed", () => {
  // The convenience is an APPLICATION intention, and it lives inside the
  // membrane -- restore never borrows this door.
  const p = ordered().registerAboveCatchAll("eeeeeeee-5555-4555-8555-555555555555", g.ProjectKey.parse("NEW").value, instance("https://e.example.org")).value;
  assert.deepEqual(p.registry().orderedIds(), [ORDER_A, "eeeeeeee-5555-4555-8555-555555555555", STAR, ORDER_B]);
  assert.equal(p.statusOf("eeeeeeee-5555-4555-8555-555555555555"), "DISARMED");
});

test("statusOf is the sole judge of a row, and shadowed beats disarmed", () => {
  let p = ordered().withOrder([STAR, ORDER_A, ORDER_B]).value;
  p = p.armShortcut(ORDER_A).value;
  assert.equal(p.statusOf(ORDER_A), "SHADOWED", "an armed but shadowed row does not jump");
  assert.equal(p.statusOf(STAR), "AWAITING_ACKNOWLEDGEMENT");
  assert.equal(p.statusOf(ORDER_B), "SHADOWED");
});

test("diagnose distinguishes nothing armed, nothing acknowledged, and everything shadowed", () => {
  const facts = { originsGranted: true, quarantinedCount: 0, installed: true, coverageSatisfied: true };
  let p = ordered();
  assert.equal(p.diagnose(facts), "ALL_SHORTCUTS_DISARMED");

  let onlyStar = g.JumpPolicy.empty().withEngines(["google.com"]).value;
  onlyStar = onlyStar.registerCatchAll(STAR, instance("https://c.atlassian.net")).value;
  onlyStar = onlyStar.armShortcut(STAR).ok ? onlyStar.armShortcut(STAR).value : onlyStar;
  assert.equal(onlyStar.diagnose(facts), "ALL_SHORTCUTS_DISARMED", "arming is refused until acknowledged");

  // The reachable path: acknowledge, arm, then change the destination -- which
  // clears the destination acknowledgements WITHOUT disarming. That is the state
  // the previous diagnosis called "everything is disarmed", to someone who had
  // just armed it.
  let awaiting = g.JumpPolicy.empty().withEngines(["google.com"]).value;
  awaiting = awaiting.register(ORDER_A, g.ProjectKey.parse("ECR").value, instance("http://intra.example.org")).value;
  awaiting = awaiting.acknowledge(ORDER_A, "INSECURE_SCHEME").value;
  awaiting = awaiting.acknowledge(ORDER_A, "INTERNAL_HOST").value;
  awaiting = awaiting.armShortcut(ORDER_A).value;
  assert.equal(awaiting.diagnose(facts), "READY");
  awaiting = awaiting.withBaseUrlFor(ORDER_A, instance("http://other.internal")).value;
  assert.equal(awaiting.diagnose(facts), "ALL_SHORTCUTS_AWAITING_ACKNOWLEDGEMENT");

  let shadowed = ordered().withOrder([STAR, ORDER_A, ORDER_B]).value;
  shadowed = shadowed.armShortcut(ORDER_A).value.armShortcut(ORDER_B).value;
  assert.equal(shadowed.diagnose(facts), "ALL_SHORTCUTS_SHADOWED");
});

test("a failed install outranks everything, because the installed reality contradicts the screen", () => {
  // DISARMED means "no jump" IN INTENTION; INSTALL_FAILED means the rules are
  // still live. An emergency stop reporting "stopped" without stopping is worse
  // than no emergency stop.
  const p = ordered().disarm();
  assert.equal(p.diagnose({ originsGranted: false, quarantinedCount: 9, installed: false }), "INSTALL_FAILED");
});

test("a configuration read back with nothing but quarantine says so, instead of no shortcut yet", () => {
  const restored = g.JumpPolicy.restore({
    schemaVersion: 1, armed: true, engines: ["google.com"],
    shortcuts: [{ id: "ffffffff-6666-4666-8666-666666666666", key: "ABC", baseUrl: "javascript:alert(1)" }],
  });
  assert.equal(restored.policy.shortcuts().length, 0);
  assert.equal(restored.quarantine.length, 1);
  assert.equal(
    restored.policy.diagnose({ originsGranted: true, quarantinedCount: restored.quarantine.length, installed: true, coverageSatisfied: true }),
    "PARTIAL_POLICY",
    "there are not NO shortcuts, there are unreadable ones"
  );
});

test("a shortcut list longer than the cap is refused by the policy, not only at the storage door", () => {
  // The cap used to live at the admission door only, on the length of the
  // incoming array, so the UI could legally create three hundred.
  let p = g.JumpPolicy.empty().withEngines(["google.com"]).value;
  for (let i = 0; i < g.JumpPolicy.MAX_SHORTCUTS; i += 1) {
    const id = `id-${String(i).padStart(4, "0")}`;
    p = p.register(id, g.ProjectKey.parse("K" + String(i).padStart(3, "0")).value, instance("https://a.example.org")).value;
  }
  assert.equal(p.shortcuts().length, g.JumpPolicy.MAX_SHORTCUTS);
  assert.equal(p.register("one-too-many", g.ProjectKey.parse("ZZZ").value, instance("https://a.example.org")).code, "SHORTCUT_LIMIT");
});

// ------------------------------------------------------------- the diff of facts

test("the diff covers all three sets, so an appearing shortcut is never silent", () => {
  // The previous design compared "every id present in both", which is
  // structurally blind to the gesture most useful to an attacker.
  const before = ordered();
  const NEW_ID = "99999999-9999-4999-8999-999999999999";
  // register APPENDS, so a plain registration behind a catch-all is born
  // shadowed -- and the diff says both things rather than hiding the second.
  // Which is precisely why the UI goes through registerAboveCatchAll.
  const appended = before.register(NEW_ID, g.ProjectKey.parse("NEW").value, instance("https://new.example.org")).value;
  assert.deepEqual(g.PolicyDiff.between(before, appended).map((f) => f.type), ["ShortcutAppeared", "ShadowingChanged"]);
  assert.deepEqual(g.PolicyDiff.between(appended, before).map((f) => f.type), ["ShortcutRemoved"]);
  assert.deepEqual(g.PolicyDiff.between(before, before.remove(STAR).value).map((f) => f.type), ["CatchAllRemoved"]);

  // Through the named door, nothing is shadowed and only the appearance is a fact.
  const above = before.registerAboveCatchAll(NEW_ID, g.ProjectKey.parse("NEW").value, instance("https://new.example.org")).value;
  assert.deepEqual(g.PolicyDiff.between(before, above).map((f) => f.type), ["ShortcutAppeared"]);
});

test("moving the catch-all reports ONE fact that names the host, not one per shadowed row", () => {
  // MAX_ENTRIES is twenty, and PRIVACY.md says so publicly. One ordinary gesture
  // must not be able to flush the journal -- least of all an unacknowledged
  // UNKNOWN left by an earlier compromise.
  const facts = g.PolicyDiff.between(ordered(), ordered().withOrder([STAR, ORDER_A, ORDER_B]).value);
  assert.equal(facts.length, 1);
  assert.equal(facts[0].type, "ShadowingChanged");
  assert.equal(facts[0].catchAllBaseUrl, "https://c.atlassian.net", "the journal must say WHERE the traffic goes");
  assert.deepEqual(facts[0].affectedKeys, ["ECR"]);
});

test("a wholesale replacement collapses into a single fact rather than evicting the journal", () => {
  let before = g.JumpPolicy.empty().withEngines(["google.com"]).value;
  for (let i = 0; i < 8; i += 1) {
    before = before.register(`id-${i}`, g.ProjectKey.parse("K" + i + "0").value, instance("https://a.example.org")).value;
  }
  let after = before;
  for (let i = 0; i < 8; i += 1) {
    after = after.withBaseUrlFor(`id-${i}`, instance("https://elsewhere.example.org")).value;
  }
  const facts = g.PolicyDiff.between(before, after);
  assert.equal(facts.length, 1);
  assert.deepEqual(facts[0], { type: "PolicyReplaced", changedCount: 8 });
});

test("every mutation still returns the same shape, withOrder included, with events always present", () => {
  const p = ordered();
  const results = [
    p.withOrder([ORDER_A, ORDER_B, STAR]),
    p.registerCatchAll("gggggggg-7777-4777-8777-777777777777", instance("https://g.example.org")),
    p.remove(ORDER_A),
    p.withKeyFor(STAR, g.ProjectKey.parse("ABC").value),
  ];
  for (const result of results) {
    assert.equal(typeof result.ok, "boolean");
    assert.ok(Array.isArray(result.events), "events is always present");
    // No producer fills it any more: PolicyDiff is the single producer.
    assert.deepEqual(result.events, []);
  }
});

// ------------------------------------------------- reordering around a catch-all

const REACH = ["r-aaa", "r-star", "r-bbb", "r-ddd"];

const withCatchAllInside = () => {
  let p = g.JumpPolicy.empty().withEngines(["google.com"]).value;
  p = p.register(REACH[0], g.ProjectKey.parse("AAA").value, instance("https://a.example.org")).value;
  p = p.registerCatchAll(REACH[1], instance("https://c.example.org")).value;
  p = p.register(REACH[2], g.ProjectKey.parse("BBB").value, instance("https://b.example.org")).value;
  p = p.register(REACH[3], g.ProjectKey.parse("DDD").value, instance("https://d.example.org")).value;
  return p;
};

test("the aggregate answers for the order and for one row, so nobody reaches past it", () => {
  // Two delegations that close a pair: the aggregate accepts withOrder(ids), an
  // absolute intention about the order, but could not tell you the current one.
  // And it was reaching through its own registry to read it, in
  // registerAboveCatchAll.
  const p = withCatchAllInside();
  assert.deepEqual(p.orderedIds(), REACH);
  assert.equal(p.shortcutFor(REACH[1]).key().isCatchAll(), true);
  assert.equal(p.shortcutFor("nope"), undefined);
});

test("every order is reachable without ever PICKING UP the catch-all", () => {
  // This is what makes pinning it acceptable under WCAG 2.1.1, and it is only true
  // because the step is constrained: withOrder is ABSOLUTE, so a single call
  // reaches any permutation and a test "by a sequence of withOrder" would be a
  // tautology. Each step here is an ADJACENT SWAP whose picked element is never the
  // catch-all -- the exact model of the arrows.
  //
  // The mechanism, which is the part worth remembering: the catch-all IS moved,
  // pushed by the others. It is never the one you pick up.
  const swapPicking = (policy, index, delta) => {
    const ids = [...policy.orderedIds()];
    assert.notEqual(ids[index], REACH[1], "the catch-all is never the picked element");
    const to = index + delta;
    assert.ok(Math.abs(delta) === 1 && to >= 0 && to < ids.length, "adjacent swaps only");
    ids.splice(to, 0, ...ids.splice(index, 1));
    const moved = policy.withOrder(ids);
    assert.equal(moved.ok, true);
    return moved.value;
  };

  const targets = [
    [REACH[1], REACH[0], REACH[2], REACH[3]],   // catch-all first: everything shadowed
    [REACH[0], REACH[2], REACH[3], REACH[1]],   // catch-all last: nothing shadowed
    [REACH[2], REACH[0], REACH[1], REACH[3]],   // a named key pulled to the top
  ];

  for (const target of targets) {
    let policy = withCatchAllInside();
    for (let guard = 0; guard < 24 && policy.orderedIds().join() !== target.join(); guard += 1) {
      const ids = policy.orderedIds();
      const wrong = ids.findIndex((id, i) => id !== target[i] && id !== REACH[1]);
      assert.notEqual(wrong, -1, "a misplaced element that is not the catch-all always exists");
      const want = target.indexOf(ids[wrong]);
      policy = swapPicking(policy, wrong, want < wrong ? -1 : 1);
    }
    assert.deepEqual(policy.orderedIds(), target);
  }
});

test("dropping a named key below the catch-all shadows it, and nothing above it", () => {
  let p = withCatchAllInside().withOrder([REACH[0], REACH[1], REACH[2], REACH[3]]).value;
  assert.deepEqual(p.shadowedShortcuts().map((s) => s.key().toString()), ["BBB", "DDD"]);
  assert.equal(p.statusOf(REACH[0]), "DISARMED", "the row above is untouched");
  assert.equal(p.statusOf(REACH[2]), "SHADOWED");
  // And it comes back when the catch-all goes.
  assert.deepEqual(p.remove(REACH[1]).value.shadowedShortcuts(), []);
});

test("at a constant id set, the status after a reorder depends on nothing but the order", () => {
  // The property that makes moveTo's prediction trustworthy: it consults the domain
  // on the future, and what it asks about -- shadowing -- is a pure function of the
  // order and of which row is the catch-all. Arming and acknowledgements cannot
  // change it, and "being a catch-all" is invariant under set-preserving mutations
  // because withKeyFor refuses KEY_NATURE_IMMUTABLE.
  const target = [REACH[1], REACH[0], REACH[2], REACH[3]];
  const plain = withCatchAllInside().withOrder(target).value;

  let armedFirst = withCatchAllInside();
  armedFirst = armedFirst.armShortcut(REACH[0]).value;
  armedFirst = armedFirst.acknowledge(REACH[1], "CATCH_ALL").value.armShortcut(REACH[1]).value;
  const reordered = armedFirst.withOrder(target).value;

  for (const id of REACH) {
    assert.equal(
      plain.registry().isShadowed(id),
      reordered.registry().isShadowed(id),
      `${id}: shadowing must not depend on arming`
    );
  }
  // And the status the UI reads agrees with it, because SHADOWED is the FIRST test
  // of the chain -- which is what lets one call answer both questions.
  assert.equal(reordered.statusOf(REACH[0]), "SHADOWED");
  assert.equal(plain.statusOf(REACH[0]) === "SHADOWED", plain.registry().isShadowed(REACH[0]));
});

test("which half of a row the pointer is in is three numbers, so it is tested like anything else", () => {
  // The previous plan declared this untestable for want of a DOM harness. It was
  // untestable of the DESIGN, not of the problem: extracting the collaborator left
  // an arithmetic that needs no document at all.
  assert.equal(g.RowReorder.dropsBefore(100, 40, 101), true, "just inside the top half");
  assert.equal(g.RowReorder.dropsBefore(100, 40, 119), true, "still the top half");
  assert.equal(g.RowReorder.dropsBefore(100, 40, 120), false, "the midpoint belongs below");
  assert.equal(g.RowReorder.dropsBefore(100, 40, 139), false, "the bottom half");
});

// ---------------------------------------------- the changelocks of the bounded claim

/**
 * CHANGELOCKS, and the word matters: these cannot fail unless somebody edits a
 * constant. They are NOT proofs, and they must not be counted among the green
 * tests as if they were -- see the measured facts pinned in interception.test.js.
 *
 * THEIR HOME IS HERE AND NOT AT LOAD TIME. importScripts is synchronous at the top
 * of the service worker (background.js), so a throw there aborts the whole script:
 * no listener registered, sync() never called, nothing purged -- and the dynamic
 * rules SURVIVE the restart, so the old ones keep firing under a mute badge. In
 * options.html the same throw is a blank page. shortcut-key.js already writes the
 * doctrine: "the service worker would die at startup".
 *
 * Three load-time assertions remain in the repo, deliberately, and they are named
 * so that the doctrine does not read as contradicted by its own tree:
 * project-shortcut.js (assertShapesCannotDrift), reference-pattern.js
 * (assertSeparatorsCannotExtendAKey) and rule-ranking.js -- all three decided on
 * literals of their own file, never on data.
 */
test("changelock: the emitted key class is the owner's, verified rather than copied", () => {
  // The airlock does not recompose the character class -- "never a copy: it comes
  // from its owner". This is the only value where both expressions must coincide.
  assert.equal(
    g.ProjectKey.caseInsensitiveShape(g.ProjectKey.MAX_LENGTH),
    g.ProjectKey.CASE_INSENSITIVE_SHAPE
  );
  assert.equal(g.ProjectKey.MAX_LENGTH, 20, "the validator's bound, on a literal");
  // The function carries its own rule: capping can only ever NARROW the matcher,
  // and {1,0} matches nothing while RE2 would accept it without a word.
  assert.equal(g.ProjectKey.caseInsensitiveShape(25), g.ProjectKey.CASE_INSENSITIVE_SHAPE);
  assert.throws(() => g.ProjectKey.caseInsensitiveShape(1), TypeError_or_Error);
});

function TypeError_or_Error(err) {
  return err instanceof Error;
}

test("changelock: the claim stays inside the validator, and reaches every reserved prefix", () => {
  const star = g.CatchAllKey.only();
  assert.ok(star.claimsKeysUpTo() <= g.ProjectKey.MAX_LENGTH,
    "the catch-all cannot claim more than a project key can be");
  // Every reserved prefix must be REACHABLE, or its alternative in the guard would
  // be dead code guarding nothing. IPHONE is exactly six -- the bound has no slack.
  const longest = Math.max(...g.ReservedPrefix.ALL.map((w) => w.length));
  assert.ok(star.claimsKeysUpTo() >= longest, `a reserved prefix is ${longest} long`);
  // The list's shape became load-bearing the day the guard was cut into a
  // partition: a duplicate would build two runs matching the same URL.
  assert.equal(new Set(g.ReservedPrefix.ALL).size, g.ReservedPrefix.ALL.length);
});

test("changelock: the catch-all only ever accepts the hyphen", () => {
  // separators() carries thirteen lines explaining why -- SALARY 2024, WINDOWS 11
  // -- and, until now, no assertion. Widening it would make "PS 800" claimed while
  // the guard only holds "PS-800": an outbound flow, not a nuisance.
  assert.deepEqual(g.CatchAllKey.only().separators(), ["-"]);
});

test("changelock: the example the catch-all shows is one it actually claims", () => {
  // "EXAMPLE" was seven characters: the row offered as an example a key its own
  // rule no longer claimed. Asserted generically, so the recurrence is impossible
  // rather than merely fixed once.
  const star = g.CatchAllKey.only();
  assert.ok(star.captures(star.exampleKey()));
});

test("the ShortcutKey protocol is checked against its implementations, at last", () => {
  // shortcut-key.js:6 promises "the two implementations are checked against it by
  // test" and :52 says MEMBERS is "named once so the conformance test cannot drift
  // from it". Grep found NO reader: both promises were dead from the start. This
  // test will be GREEN on day one -- saying so, so nobody hunts for the red.
  assert.ok(g.ShortcutKey.MEMBERS.length > 0);
  for (const key of [g.ProjectKey.parse("ABC").value, g.CatchAllKey.only()]) {
    for (const member of g.ShortcutKey.MEMBERS) {
      assert.equal(typeof key[member], "function", `${member} is missing`);
    }
  }
  // And the member OUTSIDE the protocol, verified without entering it: shapeOf()
  // is now the only thing between SHAPES.catchAll and a TypeError, and the
  // conformance loop cannot see that by construction.
  assert.equal(typeof g.CatchAllKey.only().claimsKeysUpTo, "function");
  assert.equal(g.ShortcutKey.MEMBERS.includes("claimsKeysUpTo"), false,
    "it is deliberately outside the protocol: on a ProjectKey the honest answer differs");
});

test("a long named key below the catch-all stays shadowed, and that is deliberate", () => {
  // THE OVERAPPROXIMATION, pinned. Shadowing is POSITIONAL: everything after the
  // catch-all is switched off, including what the catch-all no longer claims. That
  // was already true for ISO -- captures("ISO") is false and it is still shadowed
  // -- so the bound widens the overapproximation, it does not create it. It is
  // CHOSEN for predictability over a shadowing that would depend on key length,
  // where two neighbouring rows behave differently with no way to explain it.
  const LONG = "dddddddd-4444-4444-8444-444444444444";
  let p = g.JumpPolicy.empty().withEngines(["google.com"]).value;
  p = p.registerCatchAll(STAR, instance("https://catchall.atlassian.net")).value;
  p = p.acknowledge(STAR, "CATCH_ALL").value;
  p = p.armShortcut(STAR).value;
  p = p.register(LONG, g.ProjectKey.parse("PROJECTX1").value, instance("https://x.atlassian.net")).value;
  p = p.armShortcut(LONG).value;

  assert.equal(p.statusOf(LONG), "SHADOWED");
  assert.equal(p.registry().isShadowed(LONG), true);
  // …and the catch-all does NOT claim it. The three assertions together ARE the
  // statement "deliberate overapproximation".
  assert.equal(
    g.CatchAllKey.only().captures(g.ProjectKey.parse("PROJECTX1").value),
    false
  );
  // The announced way out works: registerAboveCatchAll.
  const above = g.JumpPolicy.empty().withEngines(["google.com"]).value;
  assert.ok(above.registerCatchAll(STAR, instance("https://catchall.atlassian.net")).ok);
});
