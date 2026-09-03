import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCore } from "./load-core.js";
import { HOSTILE_KEYS, VALID_KEYS } from "./fixtures/hostile-keys.js";
import { HOSTILE_BASE_URLS, VALID_BASE_URLS } from "./fixtures/hostile-base-urls.js";
import { readFileSync } from "node:fs";

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

test("a key that collides with ordinary searches is flagged but not refused", () => {
  assert.equal(g.ProjectKey.parse("ISO").value.collidesWithOrdinarySearches(), true);
  assert.equal(g.ProjectKey.parse("CVE").value.collidesWithOrdinarySearches(), true);
  assert.equal(g.ProjectKey.parse("AB").value.collidesWithOrdinarySearches(), true, "two letters collide massively");
  assert.equal(g.ProjectKey.parse("PAYROLL").value.collidesWithOrdinarySearches(), false);
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
  assert.deepEqual(restored.refused.map((d) => d.code), ["KEY_SHAPE", "BASE_SCHEME"]);
  // `.rules()`, NOT a destructured `rules`: `const { rules } = ...` binds the METHOD,
  // and `rules.length` is then its ARITY -- zero -- so the assertion was green whatever
  // the forge produced, in the very test claiming a quarantined hostile entry installs
  // nothing.
  const set = g.RuleFactory.buildRules(restored.policy, g.SearchEngineCatalog, () => g.Re2Budget.conservative());
  assert.equal(set.rules().length, 0);
});

// ---------------------------------------------------------- the catch-all key

test("the typed field's parser never accepts a star, and only the storage door builds a catch-all", () => {
  // ProjectKey.parse is not relaxed by a single character. The corpus above
  // already replays every hostile key through it; this pins the one that only
  // became hostile when a catch-all existed.
  assert.equal(g.ProjectKey.parse("*").ok, false);
  assert.equal(g.ProjectKey.parse("*").code, "KEY_SHAPE");
  assert.equal(g.ShortcutKey.parse("*").ok, true);
  assert.equal(g.ShortcutKey.parse("*").value.isCatchAll(), true);
});

test("hostile keys are refused by the storage door too, not only by ProjectKey", () => {
  // ShortcutKey.parse is a THIRD security function: it is the only place where a
  // string becomes a catch-all key, so the hostile corpus goes through it as well.
  for (const key of HOSTILE_KEYS) {
    if (key === "*") continue; // the one value it legitimately accepts
    assert.equal(g.ShortcutKey.parse(key).ok, false, `${JSON.stringify(key)} was accepted`);
  }
});

test("a full-width asterisk is refused rather than folded into a catch-all", () => {
  // NFKC would fold U+FF0A onto `*`, so the comparison is strict and normalises
  // nothing: refuse rather than clean.
  const refused = g.ShortcutKey.parse("\uff0a");
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "KEY_NOT_NORMALISED");
});

test("the catch-all's EMITTED shape holds the hostile corpus, and is bounded to six", () => {
  // THE TITLE USED TO SAY "literally the one ProjectKey enforces". That became
  // false the day the catch-all was bounded -- ProjectKey still allows twenty --
  // and the test STAYED GREEN, because it replayed the validator's shape instead
  // of the one shipped. A test that asserts a false property about the very
  // control the batch changed is worse than no test.
  //
  // So it is aimed at what the RULE carries, and ANCHORED: patternFor is
  // documented UNANCHORED (the engine places the anchors), so an unanchored replay
  // would match "PAYROLL-1" through its sub-word "AYROLL-1" and the bound would
  // have no teeth at all.
  //
  // The rule ships with isUrlFilterCaseSensitive false, so the corpus is replayed
  // WITH the real flag. Testing the case-sensitive form would validate a
  // different regex from the one delivered.
  const emitted = new RegExp("^" + g.ReferencePattern.patternFor(g.CatchAllKey.only()) + "$", "i");

  // The 49 hostile strings stay: this is the ONLY place in the repo that replays
  // them against a MATCHER rather than a parse door. The bounded corpus below is
  // additive, never a replacement.
  for (const key of HOSTILE_KEYS) {
    if (typeof key !== "string") continue;
    assert.equal(emitted.test(key + "-1"), false, `${JSON.stringify(key)} is matched by the emitted shape`);
  }

  // The bound, on the emitted form: six characters in, seven out.
  const bound = g.CatchAllKey.only().claimsKeysUpTo();
  assert.equal(emitted.test("A".repeat(bound) + "-1"), true, "the bound itself must match");
  assert.equal(emitted.test("A".repeat(bound + 1) + "-1"), false, "one past the bound must not");
  assert.equal(emitted.test("BESSON-42"), true);
  assert.equal(emitted.test("PAYROLL-3"), false);

  // VALID_KEYS keeps testing ProjectKey.parse, which must still accept seven
  // characters and more: the validator did not move, only the claim did.
  for (const [input, expected] of VALID_KEYS) {
    assert.equal(g.ProjectKey.parse(input).value.toString(), expected);
  }
});

test("the case-insensitive shape cannot be rewritten by another file", () => {
  // Every file shares globalThis, so an assignment before the airlock builds its
  // pattern would turn the extension into a universal redirector.
  const before = g.ProjectKey.CASE_INSENSITIVE_SHAPE;
  try {
    g.ProjectKey.CASE_INSENSITIVE_SHAPE = ".*";
  } catch {
    /* strict mode throws, sloppy mode ignores; both are fine */
  }
  assert.equal(g.ProjectKey.CASE_INSENSITIVE_SHAPE, before);
});

test("a catch-all claims a SHORT well-formed key, T1 included, and says why it refuses", () => {
  // THE CONTRACT CHANGED, and this is the new one -- not a relaxation. The title
  // used to say "any well-formed key" and listed PAYROLL among the claimed; seven
  // characters is now beyond reach, because RE2 refuses the unbounded form
  // (measured, memoryLimitExceeded).
  //
  // AND THE TEST NAMES WHICH OF THE TWO REFUSALS APPLIES. Collapsing them under one
  // `false` is what made the obvious "fix" for this test, back when it went red,
  // be to take IPHONE out of the deny-list -- the most dangerous direction
  // available. verdictFor buys exactly that distinction.
  const star = g.ShortcutKey.parse("*").value;
  const V = g.CatchAllKey.VERDICTS;
  const verdict = (key) => star.verdictFor(g.ProjectKey.parse(key).value);

  // T1 stays claimed: reserved-prefix.js records that product decision, and it is
  // why PS/MP/WD/F1 are on the list while T1 is not.
  for (const key of ["BAN", "T1", "BESSON", "AB"]) {
    assert.equal(verdict(key), V.CLAIMED, `${key} is not claimed`);
  }
  // Too long -- nothing to do with the deny-list.
  for (const key of ["PAYROLL", "PROJECTX1"]) {
    assert.equal(verdict(key), V.OUT_OF_REACH, `${key} should be out of reach`);
  }
  // On the list. IPHONE is here for THIS reason and no other: it is six
  // characters, so it is well within reach.
  for (const key of ["ISO", "CVE", "COVID", "WD", "HTTPS", "IPHONE"]) {
    assert.equal(verdict(key), V.RESERVED_PREFIX, `${key} should be held back`);
  }
  // The enumeration is read, not decorative: nothing else can come out.
  for (const key of ["BAN", "PAYROLL", "IPHONE"]) {
    assert.ok(Object.values(V).includes(verdict(key)));
  }
});

test("a named shortcut on a reserved prefix still works: the list bounds the catch-all, not the user", () => {
  // Excluding a word means "declare that one explicitly", never "that one is
  // forbidden".
  const iso = g.ProjectKey.parse("ISO").value;
  assert.equal(iso.captures(iso), true);
  assert.equal(g.ReservedPrefix.has("ISO"), true);
});

test("the reserved prefixes have one owner, and every entry is key-shaped", () => {
  // An alternative that cannot be a key is dead code guarding nothing.
  for (const word of g.ReservedPrefix.ALL) {
    assert.equal(g.ProjectKey.parse(word).ok, true, `${word} is not a valid key`);
  }
  // The advice and the hard exclusion read the SAME array, but they are two
  // questions: the two-character rule belongs to the advice alone.
  assert.equal(g.ProjectKey.parse("T1").value.collidesWithOrdinarySearches(), true);
  assert.equal(g.ReservedPrefix.has("T1"), false);
});

// ------------------------------------------------- consent cannot be imported

test("a forged storage entry cannot pre-acknowledge a catch-all, so it produces no rule at all", () => {
  // The cheapest sync attack: point a catch-all at a host the user has already
  // granted, and acknowledge the warning on their behalf. Consent.parse drops the
  // key-scoped acknowledgement UNCONDITIONALLY -- no door has ever had a reason to
  // believe a document about the catch-all, which is why this one kind is refused
  // in the parse and not left to the door's `trustsSavedConsent`. The entry is
  // still ADMITTED (quarantining it would hit the legitimate path on every
  // device), and activeBindings excludes it.
  //
  // ASSERTED ON THE TRUSTING DOOR, deliberately: the default would pass this test
  // for the wrong reason once the destination scopes started depending on the
  // door, and the catch-all's protection must not become a side effect of that.
  const restored = g.JumpPolicy.restore({
    schemaVersion: 1,
    armed: true,
    engines: ["google.com"],
    shortcuts: [{
      id: "11111111-1111-4111-8111-111111111111",
      key: "*",
      baseUrl: "https://already-granted.atlassian.net",
      consent: { armed: true, acknowledged: ["CATCH_ALL"] },
    }],
  }, { trustsSavedConsent: true });
  assert.equal(restored.ok, true, "the entry must be admitted, not quarantined");
  assert.equal(restored.quarantine.length, 0, "quarantine is for what we cannot READ");
  const shortcut = restored.policy.shortcuts()[0];
  assert.equal(shortcut.consent().acknowledged("CATCH_ALL"), false, "the acknowledgement did not travel");
  assert.equal(restored.policy.activeBindings().length, 0, "an unacknowledged catch-all installs nothing");
  const { rules } = { rules: g.RuleFactory.buildRules(restored.policy, g.SearchEngineCatalog, () => g.Re2Budget.conservative()).rules() };
  assert.deepEqual(rules, []);
});

/**
 * THIS TEST USED TO ASSERT THE HOLE, and it is worth saying so rather than
 * quietly rewriting it.
 *
 * It was called "a destination-scoped acknowledgement still travels, because it
 * was always destination-bound", and it required exactly what an attacker
 * needed: a document claiming `acknowledged: ["INSECURE_SCHEME"]` came back with
 * zero unacknowledged warnings. "Destination-bound" is true and answers a
 * different question -- WHICH acknowledgements a change of destination forgets --
 * while the question that decides whether a rule installs is WHO SAID SO. The
 * configuration lives in storage.sync as soon as the user ticks "Sync across
 * devices", so the answer was "a browser account", for two HIGH-severity
 * warnings.
 *
 * The door is now told whether it may believe the document, and this test asserts
 * both answers -- because a fix that only ever checks the refusing branch cannot
 * see the day the trusting one stops working, and that branch is the migration
 * every existing profile walks through.
 */
const SAVED_WITH_ACKS = () => ({
  schemaVersion: 1,
  armed: true,
  engines: ["google.com"],
  shortcuts: [{
    id: "22222222-2222-4222-8222-222222222222",
    key: "ABC",
    baseUrl: "http://jira.corp/jira",
    consent: { armed: true, acknowledged: ["INSECURE_SCHEME", "INTERNAL_HOST"] },
  }],
});

test("a synced document cannot pre-acknowledge a destination warning, so its rule stays inert", () => {
  const restored = g.JumpPolicy.restore(SAVED_WITH_ACKS(), { trustsSavedConsent: false });
  assert.equal(restored.ok, true, "the entry is admitted, not quarantined");
  assert.equal(restored.quarantine.length, 0, "quarantine is for what we cannot READ");
  const shortcut = restored.policy.shortcuts()[0];
  assert.equal(shortcut.consent().acknowledged("INSECURE_SCHEME"), false, "the attestation did not travel");
  assert.deepEqual(
    shortcut.unacknowledgedWarnings().map((w) => w.kind).sort(),
    ["INSECURE_SCHEME", "INTERNAL_HOST"],
    "both warnings are owed again, on this machine",
  );
  // THE ARMING SURVIVES, and that is deliberate: withoutAcknowledgements is not
  // Consent.fresh(). What the user sees on screen is the switch that was saved,
  // and nothing fires until the warnings are accepted.
  assert.equal(shortcut.armed(), true, "the arming is not the attestation");
  assert.equal(restored.policy.activeBindings().length, 0, "an unacknowledged shortcut installs nothing");
});

test("a locally saved document keeps its acknowledgements, or every upgrade re-asks for all of them", () => {
  // The migration branch. An older build wrote these into the configuration, and
  // on storage.local that record genuinely is this browser's -- a local attacker
  // who could forge it can forge the local acknowledgement entry just as easily,
  // which is the limit local-acknowledgements.js states about itself.
  const restored = g.JumpPolicy.restore(SAVED_WITH_ACKS(), { trustsSavedConsent: true });
  assert.equal(restored.ok, true);
  const shortcut = restored.policy.shortcuts()[0];
  assert.equal(shortcut.consent().acknowledged("INSECURE_SCHEME"), true);
  assert.equal(shortcut.unacknowledgedWarnings().length, 0, "no warning is owed twice");
  assert.equal(restored.policy.activeBindings().length, 1, "and it installs");
});

test("the door DEFAULTS to distrusting, because an omission must cost a click and never a control", () => {
  // rule-installer.js refuses a default for `source` on the grounds that both
  // values are meaningful. These two are not symmetric: `false` costs an
  // acknowledgement given again while looking at the destination, `true` can arm
  // a high-severity warning on somebody else's word. So the omission lands on
  // `false`, like `armed` in readDocument.
  const shortcut = g.JumpPolicy.restore(SAVED_WITH_ACKS()).policy.shortcuts()[0];
  assert.equal(shortcut.consent().acknowledged("INSECURE_SCHEME"), false);
  assert.equal(
    g.JumpPolicy.restore(SAVED_WITH_ACKS(), {}).policy.shortcuts()[0].unacknowledgedWarnings().length,
    2,
    "an empty option bag is an omission too",
  );
});

test("NO acknowledgement is ever projected into the document, whatever its scope", () => {
  const consent = g.Consent.fresh().acknowledging("CATCH_ALL").acknowledging("INSECURE_SCHEME");
  // `acknowledged` is GONE from the projection, not emptied: a field that is
  // sometimes there is the meaningful absence this project bans, and an empty
  // array would read as "nothing was ever accepted" rather than "this is not
  // where that is recorded".
  assert.deepEqual(Object.keys(consent.toJSON()), ["armed"]);
  // Both survive in memory, which is what lets the local store carry them.
  assert.equal(consent.acknowledged("CATCH_ALL"), true);
  assert.equal(consent.acknowledged("INSECURE_SCHEME"), true);
  // And the round trip through the configuration loses both, on every scope.
  const reparsed = g.Consent.parse(consent.toJSON());
  assert.equal(reparsed.ok, true);
  assert.deepEqual(reparsed.value.acknowledgedKinds(), []);
});

test("every acknowledgeable kind is filed in the local entry, none is left to the document", () => {
  // THE WHOLE CATALOGUE, walked rather than sampled. The hole was one scope out
  // of two, and a test naming two kinds by hand is what let that stand: the day a
  // sixth warning is added, this goes red unless its home is the local entry.
  const instance = g.JiraInstance.parse("http://jira.corp/jira").value;
  let policy = g.JumpPolicy.empty();
  const id = "33333333-3333-4333-8333-333333333333";
  policy = policy.registerCatchAll(id, instance).value;
  for (const kind of g.ShortcutWarning.KINDS) {
    const next = policy.acknowledge(id, kind);
    if (next.ok) policy = next.value;
  }
  const filed = g.LocalAcknowledgements.Acknowledgements.attestedBy(policy);
  const rows = Object.values(filed.toJSON());
  assert.equal(rows.length, 1, "one row for the shortcut");
  const shortcut = policy.shortcuts()[0];
  assert.deepEqual(
    rows[0].slice().sort(),
    shortcut.consent().acknowledgedKinds().slice().sort(),
    "everything the shortcut holds is filed locally",
  );
  // The other half: nothing at all is left in the configuration.
  assert.deepEqual(Object.keys(shortcut.toJSON().consent), ["armed"]);
});

test("editing a destination forgets the destination acknowledgements and keeps the key one", () => {
  // withInstance runs on EVERY keystroke that parses, so wiping the key scope
  // there would make the user re-tick a box while typing a URL.
  const consent = g.Consent.fresh().acknowledging("CATCH_ALL").acknowledging("INSECURE_SCHEME");
  const after = consent.forgettingDestinationAcknowledgements();
  assert.deepEqual(after.acknowledgedKinds(), ["CATCH_ALL"]);
});

test("an unknown acknowledgement is still a hard refusal, because a misspelling is a silent failure", () => {
  assert.equal(g.Consent.parse({ armed: true, acknowledged: ["NOT_A_KIND"] }).code, "UNKNOWN_WARNING_KIND");
});

// ------------------------------------------------------------ hostile ids

test("a hostile shortcut id is refused, including through the quarantine door", () => {
  // The options page keeps the rendered node's reference rather than querying by
  // an interpolated data-id, and this closes the class at its source: a
  // quarantined entry reaches register without passing through admitEntry.
  const instance = g.JiraInstance.parse("https://example.atlassian.net").value;
  const key = g.ProjectKey.parse("ABC").value;
  const registry = g.ShortcutRegistry.empty();
  for (const id of ['a"] , [data-field="del', "", "x".repeat(65), "a b"]) {
    assert.equal(registry.register(id, key, instance).code, "ENTRY_BAD_ID", `${JSON.stringify(id)} accepted`);
  }
  // promote mints a fresh id rather than trusting the raw one.
  const stored = new g.StoredPolicy(g.JumpPolicy.empty(), [{ id: 'a"] , [x', key: "ABC", baseUrl: "https://example.atlassian.net" }]);
  const promoted = stored.promoteAs(stored.quarantined()[0].fingerprint, key, instance, crypto.randomUUID());
  assert.equal(promoted.ok, true);
  assert.equal(g.ShortcutId.isWellFormed(promoted.value.policy().shortcuts()[0].id()), true);
});

test("a quarantined catch-all is repairable without the UI ever typing a star", () => {
  // "Fix" used to demand a typed key, and the options page has no right to type
  // `*`, which made a legitimately quarantined catch-all unrepairable.
  const instance = g.JiraInstance.parse("https://example.atlassian.net").value;
  const stored = new g.StoredPolicy(g.JumpPolicy.empty(), [
    { id: "33333333-3333-4333-8333-333333333333", key: "*", baseUrl: "https://example.atlassian.net" },
  ]);
  const promoted = stored.readmit(stored.quarantined()[0].fingerprint, instance, crypto.randomUUID());
  assert.equal(promoted.ok, true);
  assert.equal(promoted.value.policy().shortcuts()[0].isCatchAll(), true);
  assert.equal(promoted.value.quarantined().length, 0);
});


/**
 * A DESTINATION CANNOT SMUGGLE A BACKREFERENCE INTO THE SUBSTITUTION.
 *
 * `reference-pattern.js:62` is the only line between a `baseUrl` -- written by the
 * sync channel, this project's named adversary -- and the `regexSubstitution` the
 * platform interprets. In a DNR substitution `\1`..`\9` are BACKREFERENCES: a
 * baseUrl carrying one would redirect to a destination assembled from a fragment
 * of the intercepted URL, chosen by whoever wrote the policy.
 *
 * THE TWO FUNCTIONS DO NOT BACK EACH OTHER UP -- they SPLIT the domain, which is
 * measured here rather than assumed, because the split is written nowhere:
 *
 *   - backslash FOLLOWED BY A DIGIT -> `assertBackreferences` REFUSES. It throws
 *     rather than neutralises, and it throws even on the already-doubled form,
 *     because its `/\\[0-9]/g` does not model escaping. Fail-closed.
 *   - backslash WITHOUT a digit (`a\d`, a trailing `a\`) -> the assertion never
 *     sees it, and `escapeSubstitution` alone doubles it so DNR reads a literal
 *     backslash instead of an escape that would eat the next character.
 *
 * Neither is redundant, and removing either leaves a hole the other does not
 * cover. That is why both halves are exercised below.
 *
 * THE DOUBLE BYPASSES `JiraInstance.parse`, ON PURPOSE. That parse already refuses
 * a backslash (`project-shortcut.js:302`, BASE_BACKSLASH), so a test built through
 * it would go red on the WRONG refusal and be disarmed by the next cleanup. The
 * stand-in is exactly the scenario escapeSubstitution's own docstring names:
 * "another source (a migration, a future importer) bypasses validation".
 * The two functions stay private -- exporting them to test them would widen the
 * surface for nothing.
 */
test("a baseUrl carrying a backreference is refused, never emitted", () => {
  const key = g.ProjectKey.parse("ABC").value;

  const honest = { baseUrl: () => "https://jira.example.org" };
  const emitted = g.ReferencePattern.substitutionFor(honest, key);
  assert.equal(emitted, "https://jira.example.org/browse/ABC-\\1");
  assert.deepEqual(emitted.match(/\\[0-9]/g), ["\\1"],
    "exactly the one backreference the key put there, and no other");

  // Half one: a digit follows, so the assertion refuses outright.
  for (const smuggled of [
    "https://example.org/a\\1",   // the key's own group, duplicated
    "https://example.org/\\0",    // the whole match
    "https://example.org/x\\9y",  // a group that does not exist
    "https://example.org/a\\\\1",  // already doubled: still refused
  ]) {
    assert.throws(
      () => g.ReferencePattern.substitutionFor({ baseUrl: () => smuggled }, key),
      /substitution must contain exactly/,
      `${smuggled} reached the platform instead of being refused`
    );
  }

  // Half two: no digit follows, so the assertion is blind and only the escaping
  // stands between a lone backslash and the platform's substitution parser.
  for (const [raw, doubled] of [
    ["https://example.org/a\\d", "https://example.org/a\\\\d/browse/ABC-\\1"],
    ["https://example.org/a\\", "https://example.org/a\\\\/browse/ABC-\\1"],
  ]) {
    assert.equal(g.ReferencePattern.substitutionFor({ baseUrl: () => raw }, key), doubled,
      "a lone backslash must reach DNR doubled, or it escapes the character after it");
  }
});

/**
 * THE AIRLOCK COUNTS WHAT IT COULD NOT CARRY.
 *
 * Key-scoped consent is a distinct bounded context -- local-only, because a control
 * that travels by the channel it watches is worthless -- and `admitting` is its
 * anticorruption layer. Two facts used to vanish there without a word: the 400-row
 * ceiling, and an unknown `kind`, which disappeared DISGUISED AS A FILTER because
 * `ShortcutWarning.scopeOf` returns `undefined` for anything it does not know.
 *
 * Both stay fail-safe -- a forgotten acknowledgement DISARMS, it never arms -- and
 * neither is reachable by the sync channel. They are counted, not refused: refusing
 * would un-acknowledge in the same breath.
 */
test("the consent airlock counts both of its silent losses", () => {
  const overflowing = {};
  for (let at = 0; at < 420; at += 1) overflowing[`row-${at}`] = ["CATCH_ALL"];
  const spilled = g.LocalAcknowledgements.Acknowledgements.admitting(overflowing);
  assert.equal(spilled.losses().overflowed, 20, "the rows past the ceiling are counted");
  assert.equal(spilled.losses().unknownKinds, 0);

  const future = g.LocalAcknowledgements.Acknowledgements.admitting({
    "row-a": ["CATCH_ALL", "A_KIND_FROM_A_LATER_BUILD", "ANOTHER"],
  });
  assert.equal(future.losses().unknownKinds, 2,
    "an unknown kind is counted, not swallowed by a filter");
  assert.equal(future.losses().overflowed, 0);

  const clean = g.LocalAcknowledgements.Acknowledgements.admitting({ "row-a": ["CATCH_ALL"] });
  assert.deepEqual(clean.losses(), { overflowed: 0, unknownKinds: 0 },
    "and an honest store loses nothing");
});

/**
 * THE LIST THAT BOUNDS AN OUTBOUND FLOW MUST NOT SHRINK BY ACCIDENT.
 *
 * ReservedPrefix.ALL answers two questions that are not the same one:
 * `neverClaimedByCatchAll` bounds what leaves for a Jira instance, while
 * ProjectKey.collidesWithOrdinarySearches is a non-blocking warning and is the
 * UNION of this list with the two-character rule. Removing a word for a UI reason
 * used to widen the outbound flow in silence, because both read `has`.
 *
 * Only the security half gets a test that goes red when the list shrinks.
 */
test("the catch-all refuses every reserved prefix, and the list cannot quietly shrink", () => {
  const star = g.CatchAllKey.only();
  const words = g.ReservedPrefix.ALL;

  assert.equal(words.length, 49, "the shipped count, pinned: a shrink is a widened flow");

  for (const word of words) {
    if (word.length > star.claimsKeysUpTo()) continue;
    const key = g.ProjectKey.parse(word);
    if (!key.ok) continue;
    assert.equal(star.verdictFor(key.value), g.CatchAllKey.VERDICTS.RESERVED_PREFIX,
      `${word} would be claimed by the catch-all and leave for the Jira instance`);
  }

  // The two questions are distinct, and T1 is the proof: it collides with ordinary
  // searches (so the UI warns) but MUST be claimed (so it is not in the list).
  assert.equal(g.ReservedPrefix.neverClaimedByCatchAll("T1"), false);
  assert.equal(g.ProjectKey.parse("T1").value.collidesWithOrdinarySearches(), true,
    "the polite half is the union, and it is a different question");

  // And the catalogue answers its own length question rather than handing out ALL.
  assert.deepEqual(g.ReservedPrefix.withinLength(3).filter((w) => w.length > 3), []);
  assert.throws(() => g.ReservedPrefix.withinLength(0), /positive integer/);
});

test("a private host is warned about, whatever its flavour of private", () => {
  // `https://jira.lan` used to produce NO warning at all: not INTERNAL_HOST (the
  // suffix was not in the chain), not LITERAL_IP, not INSECURE_SCHEME (it is
  // https), not PUNYCODE. With nothing pending, the row armed on the first click
  // with no screen to read.
  //
  // WHAT THIS TEST IS AND IS NOT. It does not guard an outbound flow -- nothing
  // reaches jira.lan without a browser prompt naming `https://jira.lan/*`, and the
  // genuinely dangerous targets (cloud metadata, link-local) are a HARD REFUSAL in
  // JiraInstance.parse. It guards the SENTENCE "that host is private", on the
  // screen where the user decides to arm. The direction of failure is one-way: a
  // suffix added here can only ever produce more warnings.
  const kindsFor = (raw) => {
    const instance = g.JiraInstance.parse(raw);
    assert.equal(instance.ok, true, `${raw} should parse`);
    return g.ShortcutWarning.forInstance(instance.value).map((w) => w.kind);
  };

  // Walked from the real list, never a second copy of it: a duplicated catalogue
  // is what drifts.
  for (const suffix of g.ShortcutWarning.INTERNAL_SUFFIXES) {
    const host = `https://jira${suffix}`;
    assert.ok(kindsFor(host).includes("INTERNAL_HOST"), `${host} is not reported as internal`);
  }

  // The ranges, including the two that had been left out: 0.0.0.0/8 and TEST-NET-1.
  for (const host of ["https://10.1.2.3", "https://192.168.1.1", "https://172.16.0.1",
                      "https://100.64.0.1", "https://127.0.0.1", "https://0.1.2.3",
                      "https://192.0.2.5"]) {
    const kinds = kindsFor(host);
    assert.ok(kinds.includes("INTERNAL_HOST"), `${host} is not reported as internal`);
    assert.ok(kinds.includes("LITERAL_IP"), `${host} is not reported as a literal IP`);
  }

  // A bare name, and the loopback in brackets.
  assert.ok(kindsFor("https://jira").includes("INTERNAL_HOST"));
  assert.ok(kindsFor("https://[::1]").includes("INTERNAL_HOST"));

  // And a public host stays unwarned, or the control would cry on every profile.
  assert.deepEqual(kindsFor("https://example.atlassian.net"), []);

  // Every warning blocks arming until it is acknowledged -- which is what makes
  // the sentence above worth anything.
  const ID = "11111111-1111-1111-1111-111111111111";
  let policy = g.JumpPolicy.empty().withEngines(["google.com"]).value;
  policy = policy.register(ID, g.ProjectKey.parse("ABC").value,
    g.JiraInstance.parse("https://jira.lan").value).value;
  assert.equal(policy.armShortcut(ID).code, "UNACKNOWLEDGED_WARNING",
    "an internal host must be acknowledged before the shortcut can arm");
});

// ------------------------------------------- invisible and bidi characters

test("every explicit bidi formatting character is refused BY NAME, not by a downstream shape check", () => {
  // THE LIST WAS MISSING THE MODERN SPELLING. U+202A-U+202E were refused;
  // U+2066-U+2069 -- the isolates Unicode 6.3 added to REPLACE them -- and
  // U+061C were not.
  //
  // NOTHING WAS EXPLOITABLE THROUGH THE GAP, and this test asserts the thing that
  // actually was wrong: the CODE. Measured before the fix, every uncovered
  // character was already refused downstream -- BASE_NOT_A_URL or
  // BASE_NOT_CANONICAL, KEY_SHAPE, HOST_SHAPE -- so the user was told "this is not
  // a valid URL" about a string whose only fault was a character nobody can see.
  // That sentence is the one project-shortcut.js exists to avoid, and a test on
  // `ok === false` would have stayed green through the whole defect.
  const invisible = [
    "‎", "‏", "؜",
    "‪", "‫", "‬", "‭", "‮",
    "⁦", "⁧", "⁨", "⁩",
    "­", "᠎", "​", "﻿", " ", " ",
  ];
  for (const ch of invisible) {
    const at = `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`;
    assert.equal(
      g.JiraInstance.parse(`https://jira.corp.example${ch}/jira`).code,
      "BASE_CONTROL_CHARS",
      `${at} in a base URL must be named, not blamed on the URL shape`,
    );
    assert.equal(
      g.ProjectKey.parse(`AB${ch}C`).code,
      "KEY_CONTROL_CHARS",
      `${at} in a key must be named, not blamed on the key shape`,
    );
  }
});

test("the refusal catalogue covers every code the import and repair doors can produce", () => {
  // THE FALLBACK IS `result.message`, i.e. the domain's hard-coded ENGLISH, so a
  // missing entry means a French build reading English on the one screen that
  // tells the user something went wrong. ui.test.js pins the three TYPED-input
  // parsers; this pins the other path, which is the one a shared configuration
  // file walks.
  //
  // WHAT WAS ALREADY SAFE, so the next reader does not re-derive it: no
  // attacker-authored text ever reached the banner. The two messages that
  // interpolate a value from the file -- UNKNOWN_FIELD and UNKNOWN_WARNING_KIND --
  // were among the few already present, so the generic sentence won.
  //
  // DERIVED FROM THE SOURCE, never a hand-kept list: a list would drift the day a
  // new refusal is added, which is precisely how the gap opened.
  //
  // `\\(\\s*` IS LOAD-BEARING. Without it the scan missed every refusal whose
  // code sits on the line AFTER the opening parenthesis -- MutationResult.refused(
  // is written that way in stored-policy.js -- so MISSING_FRESH_ID was invisible
  // to a test whose whole job is to find what is missing. A scan with a blind spot
  // is worse than no scan: it reports zero and is believed.
  const doors = ["src/core/admission.js", "src/stored-policy.js"];
  const emitted = new Set();
  for (const door of doors) {
    const source = readFileSync(new URL(`../${door}`, import.meta.url), "utf8");
    for (const m of source.matchAll(/(?:refuse|refused|rejectEntry)\(\s*(?:[^,]+,\s*)?"([A-Z_0-9]+)"/g)) {
      emitted.add(m[1]);
    }
  }
  // ARMING_STATE_UNREADABLE is deliberately excluded: it travels in `unreadable`,
  // which policy-repository.js states has NO reader on screen yet -- named debt.
  // An entry for it would be the dead catalogue row this project condemns.
  emitted.delete("ARMING_STATE_UNREADABLE");

  assert.ok(emitted.size > 10, `the scan found only ${emitted.size} codes, so it is broken`);
  const missing = [...emitted].filter((code) => g.RefusalPresentation.sentence({ ok: false, code }) === code);
  assert.deepEqual(missing, [], "these codes fall back to the raw code or to English");
});
