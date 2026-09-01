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
  assert.deepEqual(restored.dropped.map((d) => d.code), ["KEY_SHAPE", "BASE_SCHEME"]);
  const { rules } = g.RuleFactory.buildRules(restored.policy, g.SearchEngineCatalog, g.Re2Budget.conservative());
  assert.equal(rules.length, 0);
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
  // key-scoped acknowledgement, the entry is still ADMITTED (quarantining it would
  // hit the legitimate path on every device), and activeBindings excludes it.
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
  });
  assert.equal(restored.ok, true, "the entry must be admitted, not quarantined");
  assert.equal(restored.quarantine.length, 0, "quarantine is for what we cannot READ");
  const shortcut = restored.policy.shortcuts()[0];
  assert.equal(shortcut.consent().acknowledged("CATCH_ALL"), false, "the acknowledgement did not travel");
  assert.equal(restored.policy.activeBindings().length, 0, "an unacknowledged catch-all installs nothing");
  const { rules } = { rules: g.RuleFactory.buildRules(restored.policy, g.SearchEngineCatalog, g.Re2Budget.conservative()).rules() };
  assert.deepEqual(rules, []);
});

test("a destination-scoped acknowledgement still travels, because it was always destination-bound", () => {
  const restored = g.JumpPolicy.restore({
    schemaVersion: 1,
    armed: true,
    engines: ["google.com"],
    shortcuts: [{
      id: "22222222-2222-4222-8222-222222222222",
      key: "ABC",
      baseUrl: "http://intra.example.org/jira",
      consent: { armed: true, acknowledged: ["INSECURE_SCHEME", "INTERNAL_HOST"] },
    }],
  });
  assert.equal(restored.ok, true);
  const shortcut = restored.policy.shortcuts()[0];
  assert.equal(shortcut.consent().acknowledged("INSECURE_SCHEME"), true);
  assert.equal(shortcut.unacknowledgedWarnings().length, 0);
});

test("a key-scoped acknowledgement is never projected into the document", () => {
  const consent = g.Consent.fresh().acknowledging("CATCH_ALL").acknowledging("INSECURE_SCHEME");
  assert.deepEqual(consent.toJSON().acknowledged, ["INSECURE_SCHEME"]);
  // It survives in memory, which is what lets the local store carry it.
  assert.equal(consent.acknowledged("CATCH_ALL"), true);
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
  const promoted = stored.promote(0, key, instance);
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
  const promoted = stored.promote(0, undefined, instance);
  assert.equal(promoted.ok, true);
  assert.equal(promoted.value.policy().shortcuts()[0].key().isCatchAll(), true);
  assert.equal(promoted.value.quarantined().length, 0);
});
