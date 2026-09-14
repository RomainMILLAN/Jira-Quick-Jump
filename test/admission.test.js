import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCore } from "./load-core.js";
import * as IDENTITIES from "./fixtures/identities.js";

const g = await loadCore();
// The identifiers live in one file now: the same UUID was spelled in five,
// and the catch-all builder in three, with bodies that had already drifted.
const { ID } = IDENTITIES;

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
  assert.deepEqual(g.JumpPolicy.proposeImport(withExtra).refused.map((d) => d.code), ["UNKNOWN_FIELD"]);
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
  assert.equal(restored.policy.diagnose({ originsGranted: true, quarantinedCount: restored.quarantine.length, installed: true, coverageSatisfied: true }), "PARTIAL_POLICY");
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
  const handle = stored.quarantined()[0].fingerprint;
  const collides = stored.promoteAs(handle, g.ProjectKey.parse("ABC").value, g.JiraInstance.parse("https://example.atlassian.net").value);
  assert.equal(collides.code, "DUPLICATE_KEY");

  const fixed = stored.promoteAs(handle, g.ProjectKey.parse("DEV").value, g.JiraInstance.parse("https://example.atlassian.net").value);
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
  assert.equal(stored.dropQuarantined("no such entry").code, "UNKNOWN_QUARANTINED");
  assert.equal(stored.dropQuarantined(stored.quarantined()[0].fingerprint).value.quarantinedCount(), 0);
});

test("the kill switch fails CLOSED on anything that is not a boolean", () => {
  // The bug this pins: `armed: raw.armed` copied the field and restore armed on
  // `!== false`. Every value below therefore armed the extension -- from the one
  // channel the trust model names as an adversary.
  for (const hostile of ["false", "true", 0, 1, null, {}, [], "yes"]) {
    const restored = g.JumpPolicy.restore({
      schemaVersion: 1,
      armed: hostile,
      engines: ["google.com"],
      shortcuts: [],
    });
    assert.equal(restored.ok, true, `${JSON.stringify(hostile)} must not refuse the document`);
    assert.equal(
      restored.policy.armed(),
      false,
      `armed: ${JSON.stringify(hostile)} must never arm the extension`
    );
  }
});

test("an unreadable arming state travels as a DOCUMENT fact, not as a refused entry", () => {
  // Two things pinned here. The fact exists -- fail-closed without a word would
  // leave the user with everything disarmed and nothing to explain it. And it
  // travels in `unreadable`, never in `dropped`: `dropped` is the register of
  // refused ENTRIES, and the import surface renders "some entries were refused"
  // from its length.
  const restored = g.JumpPolicy.restore({
    schemaVersion: 1,
    armed: "false",
    shortcuts: [],
  });
  assert.deepEqual(restored.refused, [], "no entry was refused, so nothing is reported as one");
  const fact = restored.unreadable.find((u) => u.code === "ARMING_STATE_UNREADABLE");
  assert.ok(fact, "the refusal to believe the field must be carried out");
  assert.match(fact.message, /nothing is armed/);
  assert.equal("entry" in fact, false, "a document fact borrows no entry identity");
});

test("the import door never reports a refusal it did not make", () => {
  // It disarms whatever it reads, so it never consults `armed`. Refusing to
  // believe a field one was not going to read is a refusal without an object --
  // and it rendered as "some entries were refused" over an import where none were.
  const proposed = g.JumpPolicy.proposeImport({
    schemaVersion: 1,
    armed: "yes",
    engines: ["google.com"],
    shortcuts: [],
  });
  assert.equal(proposed.ok, true);
  assert.deepEqual(proposed.refused, [], "nothing was refused, so the screen must say nothing");
  assert.equal(proposed.policy.armed(), false);
});

test("an absent arming state is disarmed, and says nothing", () => {
  // EXACT rather than merely safe: toJSON always writes `armed`, so the absent
  // branch is unreachable for any document this model wrote. No note, because
  // nothing was refused.
  const restored = g.JumpPolicy.restore({ schemaVersion: 1, shortcuts: [] });
  assert.equal(restored.policy.armed(), false);
  assert.equal(restored.unreadable.length, 0);
});

test("a faithful round trip still survives the stricter reading", () => {
  // The guard must not cost the legitimate case: an armed policy comes back armed.
  const restored = g.JumpPolicy.restore(policy.toJSON());
  assert.equal(restored.policy.armed(), true);
  assert.equal(restored.unreadable.length, 0);
});

test("two entries claiming one identity: the second is quarantined, the first keeps its place", () => {
  // The squat this pins: register fell through to Map.set, which OVERWROTE the
  // living shortcut and handed it its position -- the evaluation order, i.e. who
  // intercepts what.
  const restored = g.JumpPolicy.restore({
    schemaVersion: 1,
    armed: true,
    engines: ["google.com"],
    shortcuts: [
      { id: ID, key: "ABC", baseUrl: "https://first.atlassian.net" },
      { id: ID, key: "*", baseUrl: "https://squatter.example.org" },
    ],
  });
  assert.equal(restored.policy.shortcuts().length, 1, "the squatter must not be registered");
  const survivor = restored.policy.shortcutFor(ID);
  assert.equal(survivor.keyText(), "ABC", "the first occupant keeps the identity");
  assert.equal(survivor.destination(), "https://first.atlassian.net");
  assert.equal(restored.quarantine.length, 1, "the squatter is set aside, never destroyed");
  assert.ok(restored.refused.some((d) => d.code === "DUPLICATE_ID"));
});

test("the document's order survives an entry being quarantined mid-list", () => {
  // register appends, so skipping an entry shifts nothing. The post-condition
  // that replaced reassertOrder proves it rather than repairing it.
  const A = "aaaaaaaa-1111-4111-8111-111111111111";
  const B = "bbbbbbbb-1111-4111-8111-111111111111";
  const restored = g.JumpPolicy.restore({
    schemaVersion: 1,
    armed: true,
    engines: ["google.com"],
    shortcuts: [
      { id: A, key: "AAA", baseUrl: "https://a.atlassian.net" },
      { id: "bad id!", key: "BAD", baseUrl: "https://b.atlassian.net" },
      { id: B, key: "BBB", baseUrl: "https://c.atlassian.net" },
    ],
  });
  assert.deepEqual(restored.policy.orderedIds(), [A, B], "order is the document's, gaps included");
  assert.equal(restored.quarantine.length, 1);
});

test("promoting a quarantined entry whose id is already alive strikes a fresh one", () => {
  // Before: the entry landed on register's replay no-op and left quarantine
  // WITHOUT anything being added -- a silent merge into someone else's shortcut.
  const restored = g.JumpPolicy.restore({
    schemaVersion: 1,
    armed: true,
    engines: ["google.com"],
    shortcuts: [
      { id: ID, key: "ABC", baseUrl: "https://live.atlassian.net" },
      { id: ID, key: "ABC", baseUrl: "https://live.atlassian.net" },
    ],
  });
  const stored = new g.StoredPolicy(restored.policy, restored.quarantine);
  assert.equal(stored.quarantinedCount(), 1);

  const promoted = stored.promoteAs(stored.quarantined()[0].fingerprint, g.ProjectKey.parse("DEV").value,
    g.JiraInstance.parse("https://other.atlassian.net").value, crypto.randomUUID());
  assert.equal(promoted.ok, true);
  assert.equal(promoted.value.policy().shortcuts().length, 2, "it is ADDED, never merged away");
  const ids = promoted.value.policy().orderedIds();
  assert.notEqual(ids[1], ID, "the readmitted entry carries a fresh identity");
  const readmitted = promoted.value.policy().shortcutFor(ids[1]);
  assert.equal(readmitted.armed(), false, "readmitted disarmed, so the warnings are read again");
});

test("a flood of ticked engines cannot quarantine the whole configuration", () => {
  // Bindings are shortcuts x engines, so an unbounded selection pushed
  // activeBindings() past MAX_BINDINGS -- and _guarded then refused EVERY
  // register, sending the entire configuration to quarantine on every device the
  // sync reached. A denial of service through the one field nobody had counted.
  //
  // IT TRUNCATES RATHER THAN REFUSING THE DOCUMENT, and that is strictly stronger.
  // A refusal left the ceiling to be enforced by whoever refused; truncation means
  // no policy can EVER hold more ticked ids than engines that can exist, whatever
  // arrives -- and it removes a downgrade cliff a refusal created, because a
  // document written by a future build with more built-in engines (same schema
  // version, so SCHEMA_TOO_NEW never fires) would have been refused ENTIRELY on
  // the way back.
  const flood = Array.from({ length: 500 }, (_, i) => `engine-${i}.example`);
  const restored = g.JumpPolicy.restore({
    schemaVersion: 1,
    armed: true,
    engines: flood,
    shortcuts: [{ id: ID, key: "ABC", baseUrl: "https://example.atlassian.net" }],
  });
  assert.equal(restored.ok, true, "the configuration survives: the shortcut is not lost");
  assert.equal(
    restored.policy.engineIds().length,
    g.ShortcutAdmission.MAX_ENGINES,
    "no policy may hold more ticked ids than engines that can exist",
  );
  assert.deepEqual(restored.policy.engineIds(), flood.slice(0, g.ShortcutAdmission.MAX_ENGINES),
    "and it keeps the document's own order, from the front");
  // The shortcut is admitted: this is the cascade the bound exists to prevent.
  assert.equal(restored.policy.shortcuts().length, 1);
  assert.equal(restored.quarantine.length, 0, "nothing was set aside");
  // AND IT IS SAID. A silent truncation is the same defect as a silent drop.
  assert.ok(
    restored.unreadable.some((f) => f.code === "ENGINES_TRUNCATED"),
    "a truncated selection must be reported, not swallowed",
  );
});

test("a refused or duplicate engine id costs no place a real engine needed", () => {
  /**
   * THE EVICTION ORDER USED TO BELONG TO WHOEVER WROTE THE DOCUMENT.
   *
   * The bound sliced the RAW list, before a single identity had been read, so an
   * id the door refuses three lines later had already consumed a slot. Measured
   * before the fix: 24 malformed ids followed by "google.com" left ZERO engines.
   */
  const junk = Array.from({ length: g.ShortcutAdmission.MAX_ENGINES }, (_, i) => `not an id ${i}`);
  const restored = g.JumpPolicy.restore({
    schemaVersion: 1,
    armed: true,
    engines: [...junk, "google.com"],
    shortcuts: [],
  });
  assert.equal(restored.ok, true);
  assert.deepEqual(
    restored.policy.engineIds(),
    ["google.com"],
    "a malformed id must not occupy the place of a real engine",
  );
  // Each refusal is still SAID, one per id, and no truncation is claimed: nothing
  // was dropped for want of room.
  assert.equal(restored.unreadable.filter((f) => f.code === "ENGINE_ID_SHAPE").length, junk.length);
  assert.equal(restored.unreadable.some((f) => f.code === "ENGINES_TRUNCATED"), false);

  // Same for duplicates: a list of one engine repeated cannot crowd out the rest.
  const duplicated = g.JumpPolicy.restore({
    schemaVersion: 1,
    armed: true,
    engines: [...Array.from({ length: 100 }, () => "google.com"), "bing.com"],
    shortcuts: [],
  });
  assert.deepEqual(duplicated.policy.engineIds(), ["google.com", "bing.com"]);
});

test("a truncation is announced only when something usable was left out", () => {
  /**
   * THE BOUND COUNTS WHAT WOULD HAVE BEEN ADMITTED.
   *
   * Tested before the parse, it called anything past the ceiling truncated --
   * duplicates included. Measured then: 24 distinct ids followed by 10 duplicates
   * OF THOSE kept all 24 and still announced "the extra entries were refused". The
   * direction was safe; the sentence was false, on the surface this trust model
   * says must be believed.
   */
  const distinct = Array.from({ length: g.ShortcutAdmission.MAX_ENGINES }, (_, i) => `e${i}.example`);
  const announces = (engines) =>
    g.JumpPolicy.restore({ schemaVersion: 1, armed: true, engines, shortcuts: [] })
      .unreadable.some((f) => f.code === "ENGINES_TRUNCATED");

  // Duplicates of ids already admitted cost nothing, so nothing is announced.
  assert.equal(announces([...distinct, ...distinct.slice(0, 10)]), false,
    "a duplicate is not a loss, and must not be reported as one");
  // Malformed ids likewise: they are refused one by one, with their own code.
  assert.equal(announces([...distinct, "not an id", "nor this"]), false);
  // A genuinely new id past the ceiling IS a loss, and is announced.
  assert.equal(announces([...distinct, "z1.example"]), true,
    "an id that would have been admitted must be reported as refused");
  // And the ceiling still holds in every case.
  for (const engines of [[...distinct, ...distinct.slice(0, 10)], [...distinct, "z1.example"]]) {
    const restored = g.JumpPolicy.restore({ schemaVersion: 1, armed: true, engines, shortcuts: [] });
    assert.equal(restored.policy.engineIds().length, g.ShortcutAdmission.MAX_ENGINES);
  }
});

test("a list longer than anything this door reads is refused outright", () => {
  // The OTHER bound, and it has the other job: termination, not selection. The
  // loop must be allowed to walk the whole list for the selection bound to count
  // admitted ids -- so the raw length needs a cheap absolute guard of its own.
  const enormous = Array.from({ length: g.ShortcutAdmission.MAX_RAW_ENGINES + 1 }, (_, i) => `e${i}.example`);
  const restored = g.JumpPolicy.restore({
    schemaVersion: 1, armed: true, engines: enormous, shortcuts: [],
  });
  assert.equal(restored.ok, false, "a payload is not a selection");
  assert.equal(restored.code, "TOO_MANY_ENGINES");
  // And the two bounds are not the same number, or one of them is decoration.
  assert.ok(g.ShortcutAdmission.MAX_RAW_ENGINES > g.ShortcutAdmission.MAX_ENGINES);
});

test("a selection that fits is left exactly as it is", () => {
  // The truncation must not touch a legitimate document -- including one sitting
  // exactly on the bound, which is where an off-by-one would live.
  const exact = Array.from({ length: g.ShortcutAdmission.MAX_ENGINES }, (_, i) => `e${i}.example`);
  const restored = g.JumpPolicy.restore({ schemaVersion: 1, armed: true, engines: exact, shortcuts: [] });
  assert.equal(restored.ok, true);
  assert.deepEqual(restored.policy.engineIds(), exact);
  assert.deepEqual(restored.unreadable, [], "nothing to report when nothing was dropped");
});

test("a quarantined entry is addressed by what it is, never by where it sits", () => {
  // VersionedEntry REPLAYS intentions against a re-read folder. Both gestures
  // took an index captured from a rendered snapshot, so if the winner promoted or
  // deleted another entry first, the loser's replay landed on a DIFFERENT ROW:
  // the user deletes something they never pointed at.
  const restored = g.JumpPolicy.restore({
    schemaVersion: 1,
    shortcuts: [
      { id: "bad-a", key: "!", baseUrl: "https://a.example.org" },
      { id: "bad-b", key: "?", baseUrl: "https://b.example.org" },
    ],
  });
  const stored = new g.StoredPolicy(restored.policy, restored.quarantine);
  const second = stored.quarantined()[1].fingerprint;

  // Someone else removes the FIRST entry, so every index shifts by one.
  const shifted = stored.dropQuarantined(stored.quarantined()[0].fingerprint).value;

  // Our intention, replayed against the shifted folder, must still aim at B.
  const dropped = shifted.dropQuarantined(second);
  assert.equal(dropped.ok, true);
  assert.equal(dropped.value.quarantinedCount(), 0, "it hit the entry it named, not the one at that rank");
});

test("a quarantined entry that has already gone is refused, not mistaken for its neighbour", () => {
  const restored = g.JumpPolicy.restore({
    schemaVersion: 1,
    shortcuts: [
      { id: "bad-a", key: "!", baseUrl: "https://a.example.org" },
      { id: "bad-b", key: "?", baseUrl: "https://b.example.org" },
    ],
  });
  const stored = new g.StoredPolicy(restored.policy, restored.quarantine);
  const first = stored.quarantined()[0].fingerprint;
  const without = stored.dropQuarantined(first).value;

  assert.equal(without.dropQuarantined(first).code, "UNKNOWN_QUARANTINED");
  assert.equal(without.quarantinedCount(), 1, "and the neighbour is untouched");
});

test("readmitting is idempotent under replay, because the caller strikes the identity", () => {
  // It used to call crypto.randomUUID() INSIDE the intention, which
  // VersionedEntry re-runs up to three times: each attempt invented a different
  // identity. The outcome happened to be one entry, but the letter of the
  // contract every other intention keeps was broken -- and it is the same
  // reasoning that makes register idempotent: the id comes from OUTSIDE.
  const restored = g.JumpPolicy.restore({
    schemaVersion: 1,
    shortcuts: [{ id: "bad id!", key: "ABC", baseUrl: "https://a.example.org" }],
  });
  const stored = new g.StoredPolicy(restored.policy, restored.quarantine);
  const handle = stored.quarantined()[0].fingerprint;
  const freshId = crypto.randomUUID();
  const instance = g.JiraInstance.parse("https://a.example.org").value;

  const once = stored.readmit(handle, instance, freshId);
  const twice = stored.readmit(handle, instance, freshId);
  assert.deepEqual(
    once.value.policy().orderedIds(),
    twice.value.policy().orderedIds(),
    "replaying the same intention yields the same identity"
  );
});

test("readmitting refuses rather than inventing an identity of its own", () => {
  const restored = g.JumpPolicy.restore({
    schemaVersion: 1,
    shortcuts: [{ id: "bad id!", key: "ABC", baseUrl: "https://a.example.org" }],
  });
  const stored = new g.StoredPolicy(restored.policy, restored.quarantine);
  const refused = stored.readmit(
    stored.quarantined()[0].fingerprint,
    g.JiraInstance.parse("https://a.example.org").value,
    undefined
  );
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "MISSING_FRESH_ID");
});

test("an entry repaired elsewhere stops asking to be repaired here", () => {
  // StoredPolicy's header states the invariant -- "an entry is in the policy OR
  // in quarantine, never both, never neither" -- and nothing checked it. The
  // repository concatenated two sources of quarantine without deduplicating, so
  // an entry readmitted on one device and still quarantined on this one existed
  // TWICE: the user faced a row asking to be fixed that was already fixed.
  const good = g.JumpPolicy.empty()
    .register(ID, g.ProjectKey.parse("ABC").value, g.JiraInstance.parse("https://ok.atlassian.net").value).value;
  const folder = new g.StoredPolicy(good, [{ id: ID, key: "!", baseUrl: "https://broken.example.org" }]);
  assert.deepEqual(folder.duplicatedIds(), [ID], "the folder can say whether its invariant holds");

  const clean = new g.StoredPolicy(good, [{ id: "other", key: "!", baseUrl: "https://x.example.org" }]);
  assert.deepEqual(clean.duplicatedIds(), []);
});

test("engines seeded at the door never dereference a refusal", () => {
  // `.value` was read without asking `ok`. withEngines goes through _guarded,
  // which can refuse -- and a refusal there is a TypeError in the service worker,
  // on the storage read path.
  const restored = g.JumpPolicy.restore({ schemaVersion: 1, engines: ["google.com"], shortcuts: [] });
  assert.equal(restored.ok, true);
  assert.deepEqual(restored.policy.engineIds(), ["google.com"]);
});

test("a policy written before the catch-all existed reads back, entry by entry", () => {
  // jump-policy.js spends thirteen lines explaining what a v1 reader does when it
  // meets a catch-all key -- quarantine THAT ONE entry, keep the quarantine,
  // diagnose PARTIAL_POLICY -- and nothing tested it. The reasoning behind
  // SCHEMA_VERSION staying at 1 rested on a behaviour no witness held.
  const OLD = {
    schemaVersion: 1,
    armed: true,
    engines: ["google"],
    shortcuts: [
      { id: "aaaaaaaa-1111-4111-8111-111111111111", key: "ABC", baseUrl: "https://a.atlassian.net",
        consent: { armed: true, acknowledged: [] } },
      { id: "bbbbbbbb-1111-4111-8111-111111111111", key: "OPS", baseUrl: "https://b.atlassian.net",
        consent: { armed: false, acknowledged: [] } },
    ],
  };
  const restored = g.JumpPolicy.restore(OLD);
  assert.equal(restored.ok, true);
  assert.equal(restored.policy.shortcuts().length, 2, "both entries survive");
  assert.equal(restored.quarantine.length, 0, "and nothing is set aside");
  // The engine spelling of that era still resolves.
  assert.deepEqual(restored.policy.engineIds(), ["google.com"]);
  // The order is the document's, which is what the whole feature rests on.
  assert.deepEqual(restored.policy.orderedIds(), OLD.shortcuts.map((s) => s.id));
});

test("a v1 reader meeting a catch-all quarantines THAT entry and keeps the rest", () => {
  // The scenario SCHEMA_VERSION's comment is built on: a device on an older build
  // meets a key it cannot parse. Losing one entry loudly beats losing everything,
  // and PARTIAL_POLICY is what the screen says.
  const withStar = {
    schemaVersion: 1,
    armed: true,
    engines: ["google.com"],
    shortcuts: [
      // Armed, so the reading reaches PARTIAL_POLICY rather than stopping at
      // ALL_SHORTCUTS_DISARMED -- which outranks it, and correctly so: "nothing
      // will fire at all" is a stronger fact than "some entries were lost".
      { id: "aaaaaaaa-1111-4111-8111-111111111111", key: "ABC", baseUrl: "https://a.atlassian.net",
        consent: { armed: true, acknowledged: [] } },
      { id: "cccccccc-1111-4111-8111-111111111111", key: "!!", baseUrl: "https://c.atlassian.net" },
    ],
  };
  const restored = g.JumpPolicy.restore(withStar);
  assert.equal(restored.ok, true, "the document is NOT refused as a whole");
  assert.equal(restored.policy.shortcuts().length, 1, "the readable entry survives");
  assert.equal(restored.quarantine.length, 1, "the unreadable one is set aside, never destroyed");

  const stored = new g.StoredPolicy(restored.policy, restored.quarantine);
  assert.equal(
    stored.policy().diagnose({ originsGranted: true, installed: true, coverageSatisfied: true,
                               quarantinedCount: stored.quarantinedCount() }),
    "PARTIAL_POLICY",
    "and the screen says a partial read happened"
  );
});

/**
 * AN UNREADABLE ENGINE ID IS DROPPED, NEVER FATAL -- and for a while it was fatal.
 *
 * `unreadableEngines` was a `const` declared forty-five lines BELOW the loop that
 * fills it, so the first refused id hit the temporal dead zone and threw
 * `ReferenceError: Cannot access 'unreadableEngines' before initialization` out of
 * readDocument. Out of JumpPolicy.restore, therefore, where nobody expects a jet:
 * background.js caught it in its outer catch and purged the rules, and the options
 * page did not catch it at all -- SectionHost.start rejected, the sections stayed
 * mounted and were never painted, and the banner said nothing. On every device the
 * sync reached, with no way to repair the entry that broke it.
 *
 * The comment three lines above the loop already promised the opposite: "A refused
 * id is DROPPED, never fatal: [...] losing the whole configuration over a ticked
 * engine would be the denial of service the bound above exists to prevent."
 *
 * BOTH DOORS, because both reach readDocument and the storage one is the one the
 * compromised sync channel writes.
 */
test("an unreadable engine id is dropped, and the rest of the document survives", () => {
  const document = {
    schemaVersion: 1,
    armed: true,
    // Three shapes that EngineId.parse refuses, beside one it accepts. None of
    // them is a non-string: that case is refused earlier as ENGINES_NOT_A_LIST,
    // so it would never have reached the dead zone.
    engines: ["google.com", "foo", "https://google.com", "pas un domaine"],
    shortcuts: [
      { id: "aaaaaaaa-1111-4111-8111-111111111111", key: "ABC",
        baseUrl: "https://a.atlassian.net", consent: { armed: true, acknowledged: [] } },
    ],
  };

  const restored = g.JumpPolicy.restore(document);
  assert.equal(restored.ok, true, "the document is admitted, not refused as a whole");
  assert.deepEqual(restored.policy.engineIds(), ["google.com"], "the readable id survives alone");
  assert.equal(restored.policy.shortcuts().length, 1, "and the shortcuts are untouched");
  assert.equal(restored.policy.armed(), true, "as is the arming state");
  assert.equal(restored.quarantine.length, 0, "nothing is quarantined: no ENTRY was unreadable");
  // SAID, not swallowed. The refused ids travel as document-scoped facts, which is
  // the whole point of the register that used to be declared too late.
  assert.equal(restored.unreadable.length, 3, "one fact per refused id");
  for (const fact of restored.unreadable) {
    assert.equal(fact.code, "ENGINE_ID_SHAPE", `refused for its shape, got ${fact.code}`);
    assert.equal(typeof fact.message, "string", "and it carries a message");
  }

  const imported = g.JumpPolicy.proposeImport(document);
  assert.equal(imported.ok, true, "the import door admits it too");
  assert.deepEqual(imported.policy.engineIds(), ["google.com"], "with the same reading");
  assert.equal(imported.policy.armed(), false, "and disarmed, as every import is");
});

/**
 * A DOCUMENT WHOSE ENGINE LIST IS ENTIRELY UNREADABLE IS STILL A DOCUMENT.
 *
 * The degenerate case of the one above, and the one a hostile sync would write: it
 * must come back as a policy with no engine ticked -- which installs no rule and
 * is repairable in one click -- never as an exception.
 */
test("a wholly unreadable engine list leaves a repairable policy, not a throw", () => {
  const restored = g.JumpPolicy.restore({
    schemaVersion: 1, armed: true, engines: ["x", "y"], shortcuts: [],
  });
  assert.equal(restored.ok, true);
  assert.deepEqual(restored.policy.engineIds(), []);
  assert.equal(restored.unreadable.length, 2);
});

/**
 * A CUSTOM DOMAIN IS BOUNDED BY AN RE2 BUDGET, not by tidiness.
 *
 * re2-budget.js names the case in writing -- "a CUSTOM engine domain of sixty
 * characters adds sixty units and more to an envelope this scalar was calibrated
 * against Google for [...]". forEnvelope() now HAS that caller -- the guards are
 * cut once per engine -- so this bound is no longer the only thing standing
 * between a long domain and a refused rule. It is kept because it answers at the
 * door the user is typing at, where a diagnostics panel cannot: see the paragraph
 * in custom-engine.js. Pinned against the budget rather than restated as a number.
 */
test("a custom domain cannot spend the whole alternation budget", () => {
  assert.ok(
    g.CustomEngine.MAX_HOST_LENGTH < g.Re2Budget.MAX_ALTERNATION_COST,
    "a single domain must not be able to consume the guards' entire budget"
  );
  // And it still admits a real intranet domain, which is what the bound is for.
  const ok = g.CustomEngine.parse({ host: "search.intranet.example.org", shape: "search-q" });
  assert.equal(ok.ok, true, "a plausible internal search domain is still accepted");

  const long = "a".repeat(g.CustomEngine.MAX_HOST_LENGTH) + ".example.org";
  const refused = g.CustomEngine.parse({ host: long, shape: "search-q" });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "HOST_TOO_LONG");
});

test("the door may narrow the aggregate's ceiling, never widen it", () => {
  /**
   * TWO CEILINGS THAT ARE NOT THE SAME THING.
   *
   * `JumpPolicy.MAX_ENGINES` bounds what a policy may HOLD, whatever door it came
   * through. `maxEngines` bounds what THIS BUILD can actually use, and only the
   * layer that knows the catalogue can say it. A caller passing a wider value
   * would bypass the aggregate's invariant through a parameter -- the mode flag
   * admission.js condemns in its own header.
   */
  const engines = Array.from({ length: 10 }, (_, i) => `e${i}.example`);
  const document = { schemaVersion: 1, armed: true, engines, shortcuts: [] };

  // Narrower: honoured.
  assert.deepEqual(
    g.JumpPolicy.restore(document, { maxEngines: 3 }).policy.engineIds(),
    engines.slice(0, 3),
  );
  // Absent: the domain's own ceiling, never the absence of one.
  assert.equal(g.JumpPolicy.restore(document).policy.engineIds().length, 10);

  // Wider, or nonsense: a programming error, loud.
  for (const bad of [g.JumpPolicy.MAX_ENGINES + 1, 0, -1, 1.5, "24", null, NaN]) {
    assert.throws(
      () => g.JumpPolicy.restore(document, { maxEngines: bad }),
      /cannot widen/,
      `maxEngines ${JSON.stringify(bad)} was accepted`,
    );
  }
});

/**
 * A SET-ASIDE ENTRY GOES THROUGH A READING DOOR TOO.
 *
 * destination-journal.js rebuilds a journalled fact field by field, on the
 * argument that a surplus field is written back for ever and an unbounded one
 * freezes the surface that shows it. The quarantine is the other half of that
 * class -- attacker-shaped by hypothesis, re-persisted by toJSON at every commit,
 * and rendered into two `<input>`s -- and it had no door: MAX_QUARANTINE bounded
 * the NUMBER of entries while nothing bounded their size or their shape.
 */
test("a quarantined entry keeps its three fields, bounded, and nothing else", () => {
  const document = {
    schemaVersion: 1,
    armed: false,
    engines: [],
    shortcuts: [{
      id: "11111111-1111-4111-8111-111111111111",
      key: "ABC",
      baseUrl: "javascript:alert(1)",
      // Not a field of a shortcut at all, so admitEntry refuses the entry on it --
      // and it used to travel into storage and back for ever.
      junk: "J".repeat(5000),
    }],
  };
  const restored = g.JumpPolicy.restore(document);
  assert.equal(restored.quarantine.length, 1);

  const folder = new g.StoredPolicy(restored.policy, g.StoredPolicy.admitting(restored.quarantine));
  const kept = folder.toJSON().quarantine[0];
  assert.deepEqual(Object.keys(kept).sort(), ["baseUrl", "id", "key"], "no surplus field survives");
  assert.equal(JSON.stringify(kept).includes("JJJ"), false, "the surplus field is not written back");

  // BOUNDED, and the bound cannot mangle a repairable value: the three parsers
  // refuse a base URL over 256, a key over 20 and an id over 64.
  const long = g.StoredPolicy.admitting([{ id: "x", key: "K", baseUrl: "https://" + "a".repeat(4000) }]);
  assert.equal(long[0].baseUrl.length, g.StoredPolicy.MAX_QUARANTINE_TEXT);
  assert.ok(g.StoredPolicy.MAX_QUARANTINE_TEXT >= 256, "a legitimate base URL must survive whole");

  // NEVER DROPPED, even with nothing readable in it: the count feeds
  // PARTIAL_POLICY, so losing an entry would make the diagnosis call the policy
  // whole. An empty row the Fix button refuses is the over-signalling direction.
  const junk = g.StoredPolicy.admitting(["a string", 42, null, { id: 7 }]);
  assert.equal(junk.length, 4, "an unreadable entry is still an entry");
  assert.deepEqual(junk[0], {});

  // And the entry stays repairable: what the user is asked to read is what is on
  // file, which is the property both parsers spend their headers on.
  const repairable = g.StoredPolicy.admitting([{ id: "22222222-2222-4222-8222-222222222222",
    key: "ABC", baseUrl: "https://example.atlassian.net", stray: true }]);
  const folder2 = new g.StoredPolicy(g.JumpPolicy.empty(), repairable);
  const readmitted = folder2.readmit(
    folder2.quarantined()[0].fingerprint,
    g.JiraInstance.parse("https://example.atlassian.net").value,
    crypto.randomUUID(),
  );
  assert.equal(readmitted.ok, true, "dropping a surplus field must not cost the repair");
  assert.equal(readmitted.value.quarantinedCount(), 0);
});
