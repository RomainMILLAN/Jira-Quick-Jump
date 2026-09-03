import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCore } from "./load-core.js";
import * as IDENTITIES from "./fixtures/identities.js";
import { POSITIVE, NEGATIVE, NEGATIVE_WITH_CATCH_ALL } from "./fixtures/search-urls.js";

const g = await loadCore();
// The identifiers live in one file now: the same UUID was spelled in five,
// and the catch-all builder in three, with bodies that had already drifted.
const { ID } = IDENTITIES;

const policy = (() => {
  let p = g.JumpPolicy.empty().withEngines(["google.com", "bing.com", "duckduckgo.com"]).value;
  p = p.register(ID, g.ProjectKey.parse("ABC").value, g.JiraInstance.parse("https://example.atlassian.net").value).value;
  return p.armShortcut(ID).value;
})();

/**
 * The rules AS DELIVERED, which is what the preview now consumes. A simulator
 * that simulates a different programme from the installed one is a stage set.
 */
// The budget is passed EXPLICITLY: buildRules RECEIVES it rather than picking its
// own measurement, so a test declares the measurement it exercises -- and the day
// a per-engine budget arrives, Re2Budget.forEnvelope() has a path in.
//
// TWO COUNTERS, TWO TYPES -- the split this file's header used to promise for "the
// next batch". The criterion is a question, not a line number: DOES THIS ARGUMENT
// CROSS THE COUNTER? If the value goes into JumpPreview it is delivered(), no
// exception -- otherwise the preview simulates a different programme from the
// installed one, which this file's header calls a stage set.
//
// labelled() returns the RuleSet, NOT an array, so feeding it to JumpPreview trips
// its !Array.isArray and reddens at once. (It reddens with INPUT_TOO_LONG, whose
// message lies -- a pre-existing wart, named rather than fixed here.) The type trap
// separates a RuleSet from an array; it does NOT separate a labelled array from a
// stripped one, which is why delivered() is DEFINED BY labelled(): it then has no
// shape of its own to police, and the PLATFORM tooth below already guards it.
const budget = () => g.Re2Budget.conservative();
const labelled = (p, catalog = g.SearchEngineCatalog) =>
  g.RuleFactory.buildRules(p, catalog, budget());
const delivered = (p, catalog = g.SearchEngineCatalog) =>
  labelled(p, catalog).platformRules();

test("real search URLs land on the issue", () => {
  for (const url of POSITIVE.filter((u) => !u.includes("google.fr") && !u.includes("google.co.uk"))) {
    const result = g.JumpPreview.forSearchUrl(url, delivered(policy));
    assert.equal(result.ok, true, `${url} was not intercepted`);
    assert.match(result.destination, /^https:\/\/example\.atlassian\.net\/browse\/ABC-\d+$/);
  }
});

test("ordinary searches go through untouched", () => {
  for (const url of NEGATIVE) {
    const result = g.JumpPreview.forSearchUrl(url, delivered(policy));
    assert.equal(result.ok, false, `${url} was intercepted: ${result.destination}`);
  }
});

test("the anchor seam is locked against a literal expectation", () => {
  // ReferencePattern returns an UNANCHORED fragment; the engine wraps it and
  // places both anchors. Without this test the anchor ends up doubled or absent.
  const key = g.ProjectKey.parse("ABC").value;
  assert.equal(g.ReferencePattern.patternFor(key), "ABC(?:-|\\+|%20)(\\d+)");
  // One domain per entry, so the whole composed pattern is compared literally —
  // which is what actually locks the seam.
  assert.equal(
    g.SearchEngineCatalog.find("duckduckgo.com").searchUrlPattern("FRAGMENT"),
    "^https://(?:www\\.)?duckduckgo\\.com/\\?(?:(?:[^=&q][^=&]*|q[^=&]+)?=[^&]*&)*q=FRAGMENT(?:&|$)"
  );
  assert.equal(
    g.SearchEngineCatalog.find("google.com").searchUrlPattern("FRAGMENT"),
    "^https://(?:www\\.)?google\\.com/search\\?(?:(?:[^=&q][^=&]*|q[^=&]+)?=[^&]*&)*q=FRAGMENT(?:&|$)"
  );
  const rules = delivered(policy);
  assert.equal(
    rules[0].condition.regexFilter,
    "^https://(?:www\\.)?google\\.com/search\\?(?:(?:[^=&q][^=&]*|q[^=&]+)?=[^&]*&)*q=ABC(?:-|\\+|%20)(\\d+)(?:&|$)"
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
  const rules = delivered(policy);
  assert.equal(rules.length, 3);
  for (const rule of rules) {
    assert.deepEqual(rule.condition.resourceTypes, ["main_frame"]);
    assert.equal("excludedResourceTypes" in rule.condition, false);
  }
});

test("an unknown engine id is reported rather than crashing or being skipped in silence", () => {
  const withGhost = policy.withEngines(["google.com", "ghost"]).value;
  const set = g.RuleFactory.buildRules(withGhost, g.SearchEngineCatalog, budget());
  assert.equal(set.rules().length, 1);
  assert.deepEqual(set.skipped().map((s) => s.code), ["UNKNOWN_ENGINE"]);
});

test("the case of the typed key does not change the destination", () => {
  const lower = g.JumpPreview.forSearchUrl("https://www.google.com/search?q=abc-7", delivered(policy));
  assert.equal(lower.destination, "https://example.atlassian.net/browse/ABC-7");
});

test("the preview refuses an oversized input before compiling anything", () => {
  const huge = "https://www.google.com/search?q=" + "&".repeat(g.JumpPreview.MAX_INPUT);
  assert.equal(g.JumpPreview.forSearchUrl(huge, delivered(policy)).code, "INPUT_TOO_LONG");
});

test("the preview never returns null", () => {
  assert.equal(g.JumpPreview.forSearchUrl("not a url", delivered(policy)).code, "NOT_A_URL");
  assert.equal(g.JumpPreview.forSearchUrl("https://example.org/", delivered(policy)).code, "NO_MATCH");
});

test("required origins cover engines and every shortcut, disarmed ones included", () => {
  const disarmed = policy.disarmShortcut(ID).value;
  const origins = g.OriginRequirements.requiredOrigins(disarmed, g.SearchEngineCatalog);
  assert.ok(origins.includes("https://*.google.com/*"));
  assert.ok(origins.includes("https://*.bing.com/*"));
  assert.ok(origins.includes("https://*.duckduckgo.com/*"));
  // Only what was ticked: google.fr is its own entry and was not selected.
  assert.equal(origins.includes("https://*.google.fr/*"), false);
  assert.ok(origins.includes("https://example.atlassian.net/*"), "a disarmed shortcut still needs its origin");
  // Never a wildcard scheme: Chrome refuses what the manifest does not declare.
  assert.ok(origins.every((o) => o.startsWith("https://") || o.startsWith("http://")));
});

test("a self-hosted destination with a path keeps its path", () => {
  let p = g.JumpPolicy.empty().withEngines(["google.com"]).value;
  p = p.register(ID, g.ProjectKey.parse("ABC").value, g.JiraInstance.parse("https://intra.example.org/jira").value).value;
  p = p.acknowledge(ID, "INTERNAL_HOST").value;
  p = p.armShortcut(ID).value;
  const result = g.JumpPreview.forSearchUrl("https://www.google.com/search?q=ABC-9", delivered(p));
  assert.equal(result.destination, "https://intra.example.org/jira/browse/ABC-9");
});

test("a domain the user adds becomes a working engine", () => {
  // Only the HOST comes from the user; the path and query parameter come from a
  // closed set of shapes, so no user input ever reaches the regex as syntax.
  const custom = g.CustomEngine.parse({ host: "google.it", shape: "search-q" });
  assert.equal(custom.ok, true);

  let p = g.JumpPolicy.empty().withCustomEngine(custom.value).value;
  p = p.withEngines(["custom:google.it"]).value;
  p = p.register(ID, g.ProjectKey.parse("ABC").value, g.JiraInstance.parse("https://example.atlassian.net").value).value;
  p = p.armShortcut(ID).value;

  const catalog = g.SearchEngineCatalog.forPolicy(p);
  const result = g.JumpPreview.forSearchUrl("https://www.google.it/search?q=ABC-9", delivered(p, catalog));
  assert.equal(result.ok, true, "the added domain does not jump");
  assert.equal(result.destination, "https://example.atlassian.net/browse/ABC-9");

  // And it asks for exactly that origin, nothing wider.
  assert.deepEqual(g.OriginRequirements.requiredOrigins(p, catalog), [
    "https://*.google.it/*",
    "https://example.atlassian.net/*",
  ]);
});

test("a hostile domain is refused with its own reason", () => {
  for (const [host, code] of [
    ["*", "HOST_SHAPE"],
    ["*.google.com", "HOST_SHAPE"],
    ["https://google.it", "HOST_SHAPE"],
    ["google.it/search", "HOST_SHAPE"],
    ["google.it:8080", "HOST_SHAPE"],
    ["google", "HOST_SHAPE"],
    ["1.2.3.4", "HOST_SHAPE"],
    ["googlé.it", "HOST_SHAPE"],
    ["", "HOST_SHAPE"],
  ]) {
    const result = g.CustomEngine.parse({ host, shape: "search-q" });
    assert.equal(result.ok, false, `${JSON.stringify(host)} was accepted`);
    assert.equal(result.code, code, `${JSON.stringify(host)} gave ${result.code}`);
  }
  assert.equal(g.CustomEngine.parse({ host: "google.it", shape: "../evil" }).code, "SHAPE_SHAPE");
  assert.equal(g.CustomEngine.parse({ host: "google.it", shape: "search-q", extra: 1 }).code, "UNKNOWN_FIELD");
});

test("an unknown shape is filtered at the airlock, not trusted", () => {
  const custom = g.CustomEngine.parse({ host: "google.it", shape: "made-up" });
  assert.equal(custom.ok, true, "the core does not know which shapes exist");
  const p = g.JumpPolicy.empty().withCustomEngine(custom.value).value.withEngines(["custom:google.it"]).value;
  assert.equal(g.SearchEngineCatalog.forPolicy(p).find("custom:google.it"), undefined);
});

test("an engine selection written before the split still works", () => {
  // Without this migration an existing configuration silently loses every engine.
  const restored = g.JumpPolicy.restore({
    schemaVersion: 1, armed: true, engines: ["google", "bing", "duckduckgo"], shortcuts: [],
  });
  assert.deepEqual(restored.policy.engineIds(), ["google.com", "bing.com", "duckduckgo.com"]);
});

// ------------------------------------------------- three bands, and the catch-all

const ABC = "aaaaaaaa-1111-4111-8111-111111111111";
const OPS = "bbbbbbbb-2222-4222-8222-222222222222";
const STAR = "cccccccc-3333-4333-8333-333333333333";

/** The configuration of the golden rule set: two named keys, then a catch-all. */
const withCatchAll = (engines = ["google.com"]) => {
  let p = g.JumpPolicy.empty().withEngines(engines).value;
  p = p.register(ABC, g.ProjectKey.parse("ABC").value, g.JiraInstance.parse("https://example.atlassian.net").value).value;
  p = p.register(OPS, g.ProjectKey.parse("OPS").value, g.JiraInstance.parse("https://ops.example.com/jira").value).value;
  p = p.registerCatchAll(STAR, g.JiraInstance.parse("https://catchall.atlassian.net").value).value;
  p = p.acknowledge(STAR, "CATCH_ALL").value;
  return p.armShortcut(ABC).value.armShortcut(OPS).value.armShortcut(STAR).value;
};

test("the counter towards the platform is guarded in both directions", () => {
  // THREE TEETH, and the third is the one an allowlist silently disarms.
  //
  // The rest-spread this batch removed made the golden test REDDEN on a new field; an
  // allowlist would drop it in SILENCE. So: tooth 1 catches a field that APPEARS,
  // tooth 2 that nothing is AMPUTATED, tooth 3 that no label LEAKS.
  //
  // ALLOWED IS THE UNION, never `ALLOWED \ LABELS` nor two independent lists: with two
  // lists, the shortest way to go green again is `ALLOWED.push("x")`, after which
  // platformRules() drops the field in production and tooth 3 stays green too. The
  // union forces you to CLASSIFY it. An allowlist you can leave through the top
  // without deciding anything is a form, not an allowlist.
  //
  // PLATFORM is written BY HAND here, and its reference is the DNR SPEC -- that is what
  // makes an allowlist legitimate at all. It therefore exists in DUPLICATE on purpose:
  // this copy is the SPECIFICATION, rule-set.js's PLATFORM_FIELDS is the
  // IMPLEMENTATION. That duplication IS the tooth; merging them "for DRY" removes it.
  const PLATFORM = ["id", "priority", "action", "condition"];
  const LABELS = ["engineId", "isCatchAll", "guardedPrefixes"];
  const ALLOWED = [...PLATFORM, ...LABELS];
  // THE FIXTURE IS PRESCRIBED: rule-factory.js carries TWO rule literals, the binding
  // and the guard. On a policy with no catch-all no guard is produced at all, and
  // vandalising the guard literal would stay green.
  const fixture = () => withCatchAll(["google.com", "bing.com"]);

  for (const rule of labelled(fixture()).rules()) {
    for (const field of Object.keys(rule)) {
      assert.ok(ALLOWED.includes(field), `an unclassified field reaches the set: ${field}`);
    }
  }
  for (const rule of delivered(fixture())) {
    // notEqual, NOT `field in rule`: platformRules() derives from PLATFORM_FIELDS, so
    // the four keys always exist and `in` would be true by construction -- green on a
    // rule that arrived amputated from the forge, the one case worth catching.
    for (const field of PLATFORM) assert.notEqual(rule[field], undefined, `amputated: ${field}`);
    for (const label of LABELS) assert.equal(label in rule, false, `label leaked: ${label}`);
  }
  // Known limit, MEASURED rather than assumed: these three teeth only bite at the TOP
  // level -- action and condition are copied BY REFERENCE, so a field added INSIDE
  // condition travels through them untouched.
  //
  // It is not unguarded, though, and the first draft of this comment was too gloomy: a
  // bogus field inside condition was injected and the GOLDEN TEST reddened, because its
  // literal expectation is a full deep-equal. The real bound is narrower and worth
  // stating exactly: nesting is covered for the rules the golden test pins, and for
  // those only.
});

test("the preview names the catch-all, on the rules the platform actually holds", () => {
  // The code MATCHED_CATCH_ALL was unreachable in production and named in no test:
  // _install stripped isCatchAll before the platform, and report() hands back what the
  // store returns. The agreement test compared it only through claimantFor.
  const onCatchAll = g.JumpPreview.forSearchUrl(
    "https://www.google.com/search?q=BAN-123", delivered(withCatchAll()));
  assert.equal(onCatchAll.code, "MATCHED_CATCH_ALL");
  const onNamed = g.JumpPreview.forSearchUrl(
    "https://www.google.com/search?q=ABC-7", delivered(withCatchAll()));
  assert.equal(onNamed.code, "MATCHED_SHORTCUT");

  // AND THE `>= 1` OF THE BOUNDARY, which nothing else exercises: the foreign-store
  // witness in journal.test.js REMOVES priority, so Number.isInteger bites alone and
  // the floor is never reached. A band of 0 is an integer, and DNR refuses it -- so it
  // did not come from DNR, and it must read as the MOST alarming label, not the least.
  const flattened = delivered(withCatchAll()).map((rule) => ({ ...rule, priority: 0 }));
  assert.equal(
    g.JumpPreview.forSearchUrl("https://www.google.com/search?q=BAN-123", flattened).code,
    "MATCHED_CATCH_ALL");

  // THE THIRD FORM, which nothing exercised: a band that is READABLE and is not one
  // of ours. 7 is an integer >= 1, so it is presumed to be a band and kept as it is --
  // the deliberate assumption InstalledRule states, for want of a band registry. It
  // must NOT read as the catch-all.
  const bandSeven = delivered(withCatchAll()).map((rule) => ({ ...rule, priority: 7 }));
  assert.equal(
    g.JumpPreview.forSearchUrl("https://www.google.com/search?q=BAN-123", bandSeven).code,
    "MATCHED_SHORTCUT",
    "a foreign band is not the catch-all band");
});

test("InstalledRule normalises ONCE, and the forge keeps its own canary", () => {
  // The value object of the airlock: one place of normalisation, and a band() that
  // cannot be forgotten.
  const raw = {
    id: 4,
    action: { type: "redirect", redirect: { regexSubstitution: "https://x.example.org/browse/\\1" } },
    condition: { regexFilter: "ABC-(\\d+)", isUrlFilterCaseSensitive: false },
  };
  const absent = new g.InstalledRule(raw);
  assert.equal(absent.band(), g.InstalledRule.DNR_DEFAULT_PRIORITY, "absent means the DNR default");
  assert.equal(absent.isCatchAll(), true, "the default band IS the catch-all band");
  assert.equal(new g.InstalledRule({ ...raw, priority: 0 }).isCatchAll(), true, "0 is below the floor");
  assert.equal(new g.InstalledRule({ ...raw, priority: 7 }).isCatchAll(), false, "7 is kept as it is");
  assert.equal(new g.InstalledRule({ ...raw, priority: g.RuleRanking.NAMED }).isCatchAll(), false);

  // The three NAMED accessors, which is what makes a membrane rather than a wrapper:
  // no caller reads .condition. or .action. any more.
  assert.equal(absent.regexFilter(), "ABC-(\\d+)");
  assert.equal(absent.actionType(), "redirect");
  assert.equal(absent.substitution(), "https://x.example.org/browse/\\1");
  // DNR's own default for isCaseSensitive is TRUE, so ABSENT means case-SENSITIVE.
  assert.equal(absent.caseSensitive(), false, "explicit false");
  assert.equal(
    new g.InstalledRule({ ...raw, condition: { regexFilter: "X" } }).caseSensitive(),
    true,
    "absent means the platform default, which is sensitive");

  // AND THE FORGE'S CANARY IS STILL ALIVE: isCatchAllBand stays TOTAL, so a band
  // which rule-set.js designates as THE content check. The delegation passes a
  // SYNTHESISED band precisely so this stays true.
  assert.throws(() => g.RuleRanking.isCatchAllBand(undefined), /priority band/);
  assert.throws(() => g.RuleRanking.isCatchAllBand("3"), /priority band/);
});

test("the whole rule set is locked against a literal expectation", () => {
  // The golden test. Everything else in this file explains one line of it.
  const rules = labelled(withCatchAll()).rules();
  // THIS TEST IS THE THIRD PARTY THAT KNOWS THE STRIPPING -- production
  // (rule-set.js, since platformRules() became the sole counter) and journal.test.js
  // are the other two. Its rest-spread
  // gains `guardedPrefixes`; the literal expectation below does NOT. Written the
  // other way round -- widening the expectation -- it would have gone green over a
  // label handed to Chrome, which rejects the whole batch.
  assert.deepEqual(rules.map(({ engineId, isCatchAll, guardedPrefixes, ...rule }) => rule), [
    {
      id: 1, priority: 3,
      action: { type: "redirect", redirect: { regexSubstitution: "https://example.atlassian.net/browse/ABC-\\1" } },
      condition: {
        regexFilter: "^https://(?:www\\.)?google\\.com/search\\?(?:(?:[^=&q][^=&]*|q[^=&]+)?=[^&]*&)*q=ABC(?:-|\\+|%20)(\\d+)(?:&|$)",
        isUrlFilterCaseSensitive: false, resourceTypes: ["main_frame"],
      },
    },
    {
      id: 2, priority: 3,
      action: { type: "redirect", redirect: { regexSubstitution: "https://ops.example.com/jira/browse/OPS-\\1" } },
      condition: {
        regexFilter: "^https://(?:www\\.)?google\\.com/search\\?(?:(?:[^=&q][^=&]*|q[^=&]+)?=[^&]*&)*q=OPS(?:-|\\+|%20)(\\d+)(?:&|$)",
        isUrlFilterCaseSensitive: false, resourceTypes: ["main_frame"],
      },
    },
    {
      id: 3, priority: 1,
      action: { type: "redirect", redirect: { regexSubstitution: "https://catchall.atlassian.net/browse/\\1-\\2" } },
      condition: {
        // The claimed length, not the validator's: RE2 refuses {1,19} outright.
        // Built from its owner so the shape cannot be pasted wrong here.
        regexFilter: "^https://(?:www\\.)?google\\.com/search\\?(?:(?:[^=&q][^=&]*|q[^=&]+)?=[^&]*&)*q=(" +
          g.ProjectKey.caseInsensitiveShape(g.CatchAllKey.only().claimsKeysUpTo()) + ")-(\\d+)(?:&|$)",
        isUrlFilterCaseSensitive: false, resourceTypes: ["main_frame"],
      },
    },
    // THE GUARD IS NOW SEVERAL RUNS, because Chrome refuses 49 alternatives in one
    // rule. The runs come from the cut -- pinning which word lands in which run
    // would go red on a legitimate thematic reordering of ALL -- but the SHAPE
    // around them, the ids and the count stay literal here. This is the one place
    // in the repo where the split is visible in full.
    ...g.Re2Budget.conservative()
      .cutIntoAffordableRuns(g.CatchAllKey.only().prefixesWithinReach())
      .map((run, i) => ({
        id: 1001 + i, priority: 2,
        action: { type: "allow" },
        condition: {
          regexFilter: "^https://(?:www\\.)?google\\.com/search\\?(?:(?:[^=&q][^=&]*|q[^=&]+)?=[^&]*&)*q=(?:" +
            run.join("|") + ")-\\d+(?:&|$)",
          isUrlFilterCaseSensitive: false, resourceTypes: ["main_frame"],
        },
      })),
  ]);
});

test("three bands are enough, and they are strictly ordered", () => {
  // Two named keys can never match one URL: the key is the maximal run before the
  // first separator character, and none of -, + or % is a key character. So the
  // only frontiers are named > reserved > catch-all.
  assert.ok(g.RuleRanking.NAMED > g.RuleRanking.RESERVED_PREFIX);
  assert.ok(g.RuleRanking.RESERVED_PREFIX > g.RuleRanking.CATCH_ALL);
  assert.ok(g.RuleRanking.CATCH_ALL >= 1, "DNR demands an integer >= 1");
  for (const rule of delivered(withCatchAll())) {
    assert.ok(Number.isInteger(rule.priority) && rule.priority >= 1);
  }
});

test("the order between named keys has no effect on the rules, because they cannot collide", () => {
  const before = delivered(withCatchAll());
  const swapped = delivered(withCatchAll().withOrder([OPS, ABC, STAR]).value);
  const shape = (rules) => rules.map((r) => r.action.redirect ? r.action.redirect.regexSubstitution : "allow").sort();
  assert.deepEqual(shape(before), shape(swapped));
});

test("a reserved prefix reaches the search engine untouched while the catch-all is armed", () => {
  const rules = delivered(withCatchAll());
  for (const url of NEGATIVE_WITH_CATCH_ALL) {
    const result = g.JumpPreview.forSearchUrl(url, rules);
    assert.equal(result.ok, false, `${url} was intercepted: ${result.destination}`);
  }
});

test("a reserved prefix that is itself the prefix of another one is still held back", () => {
  // HTTP is a prefix of HTTPS. RE2 is an automaton and finds the match if one
  // exists; the JS engine backtracks into the next alternative. Both are correct,
  // but it earns its own test.
  const rules = delivered(withCatchAll());
  for (const word of ["HTTP", "HTTPS"]) {
    const result = g.JumpPreview.forSearchUrl(`https://www.google.com/search?q=${word}-1`, rules);
    assert.equal(result.code, "RESERVED_PREFIX", `${word}-1 was not held back`);
  }
});

test("a project genuinely named API still wins over the reserved prefixes", () => {
  // The whole answer to "what if the user owns a project called API": a named key
  // sits in band 3, the reserved prefixes in band 2, and DNR compares the priority
  // BEFORE the action type.
  let p = g.JumpPolicy.empty().withEngines(["google.com"]).value;
  p = p.register(ABC, g.ProjectKey.parse("API").value, g.JiraInstance.parse("https://api.atlassian.net").value).value;
  p = p.registerCatchAll(STAR, g.JiraInstance.parse("https://catchall.atlassian.net").value).value;
  p = p.acknowledge(STAR, "CATCH_ALL").value;
  p = p.armShortcut(ABC).value.armShortcut(STAR).value;
  const result = g.JumpPreview.forSearchUrl("https://www.google.com/search?q=api-42", delivered(p));
  assert.equal(result.ok, true);
  assert.equal(result.destination, "https://api.atlassian.net/browse/API-42");
});

test("the catch-all forwards the case that was typed, because a substitution cannot upper-case", () => {
  // Pinned rather than left silent: DNR cannot transform a backreference, so Jira
  // canonicalises it -- verified against Atlassian Cloud and Data Center.
  const result = g.JumpPreview.forSearchUrl("https://www.google.com/search?q=ban-123", delivered(withCatchAll()));
  assert.equal(result.destination, "https://catchall.atlassian.net/browse/ban-123");
  // While a NAMED key keeps landing upper-cased, since its substitution is a
  // literal.
  const named = g.JumpPreview.forSearchUrl("https://www.google.com/search?q=abc-7", delivered(withCatchAll()));
  assert.equal(named.destination, "https://example.atlassian.net/browse/ABC-7");
});

test("the catch-all accepts the hyphen only, so two tokens ending in a number never leave", () => {
  // Not availability: an outbound data flow. SALARY 2024 would land in the Jira
  // instance's access logs as /browse/SALARY-2024.
  const rules = delivered(withCatchAll());
  for (const q of ["SALARY+2024", "BUDGET%202024", "PAYROLL+7"]) {
    assert.equal(g.JumpPreview.forSearchUrl(`https://www.google.com/search?q=${q}`, rules).ok, false, q);
  }
  // A NAMED key keeps all three separators: it was declared, hence consented to.
  assert.equal(g.JumpPreview.forSearchUrl("https://www.google.com/search?q=ABC+7", rules).ok, true);
});

test("a shadowed shortcut produces no rule at all", () => {
  const shadowed = withCatchAll().withOrder([STAR, ABC, OPS]).value;
  const rules = delivered(shadowed);
  assert.equal(rules.filter((r) => r.action.type === "redirect").length, 1);
  assert.equal(rules.filter((r) => g.RuleRanking.isCatchAllBand(r.priority)).length, 1);
});

test("the reserved prefixes are a few allow rules per engine, never one per prefix", () => {
  // THE TITLE USED TO SAY "one per engine", and that became false the day the
  // guard was cut: Chrome refuses 49 alternatives in a single rule
  // (memoryLimitExceeded, measured 2026-09-01), so it ships as runs. The property
  // worth keeping is the one that motivated the sentence -- never one rule PER
  // PREFIX, which would be 49 x engines -- and the count is DERIVED, never a
  // literal that would lie the first time a prefix is added.
  const rules = labelled(withCatchAll(["google.com", "bing.com"])).rules();
  const allows = rules.filter((r) => r.action.type === "allow");
  const perEngine = g.Re2Budget.conservative()
    .cutIntoAffordableRuns(g.CatchAllKey.only().prefixesWithinReach()).length;
  assert.equal(allows.length, 2 * perEngine, "the runs, on both engines");
  assert.ok(perEngine < g.ReservedPrefix.ALL.length, "never one rule per prefix");
  assert.deepEqual(
    [...new Set(allows.map((r) => r.engineId))].sort(),
    ["bing.com", "google.com"]
  );
  // Every guard carries the manifest the final set's post-condition reads.
  for (const allow of allows) assert.ok(Array.isArray(allow.guardedPrefixes));
});

test("the reserved prefixes are installed only where a catch-all is active", () => {
  let p = g.JumpPolicy.empty().withEngines(["google.com"]).value;
  p = p.register(ABC, g.ProjectKey.parse("API").value, g.JiraInstance.parse("https://api.atlassian.net").value).value;
  p = p.armShortcut(ABC).value;
  assert.deepEqual(delivered(p).filter((r) => r.action.type === "allow"), []);
});

test("a catch-all whose reserved prefixes could not be installed is dropped with them", () => {
  // Deny by default: a partial reserved list is exactly the invisible failure the
  // unit exists to close, and its violation is an outbound flow.
  const set = labelled(withCatchAll());
  const guard = set.rules().find((r) => r.action.type === "allow");
  const pruned = set.withoutRules([guard.id]);
  assert.equal(pruned.rules().some((r) => r.isCatchAll), false, "the catch-all fell with its guard");
  assert.equal(pruned.coverageSatisfied(), false);
  assert.ok(pruned.skipped().length >= 2, "both halves of the unit are reported");
});

test("dropping a shortcut on one engine leaves the catch-all standing on the others", () => {
  const set = labelled(withCatchAll(["google.com", "bing.com"]));
  const bing = set.rules().find((r) => r.isCatchAll && r.engineId === "bing.com");
  const pruned = set.withoutRules([bing.id]);
  assert.equal(pruned.rules().some((r) => r.isCatchAll && r.engineId === "google.com"), true);
  assert.equal(pruned.rules().some((r) => r.isCatchAll && r.engineId === "bing.com"), false);
});

test("rule ids are unique across bindings and reserved prefixes", () => {
  const ids = delivered(withCatchAll(["google.com", "bing.com", "duckduckgo.com"])).map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("every rule is main_frame only, allow rules included", () => {
  for (const rule of delivered(withCatchAll(["google.com", "bing.com"]))) {
    assert.deepEqual(rule.condition.resourceTypes, ["main_frame"]);
    assert.equal("excludedResourceTypes" in rule.condition, false);
  }
});

test("a duplicate engine at the same host is deduplicated, so the canary stays unreachable", () => {
  // Otherwise two rules with the same priority, the same action and the same
  // regexFilter would reach DNR's unspecified tie-break through a perfectly
  // legitimate configuration -- and a canary firing there would break the user's
  // options page.
  const custom = g.CustomEngine.parse({ host: "google.com", shape: "search-q" });
  assert.equal(custom.ok, true);
  let p = withCatchAll().withCustomEngine(custom.value).value;
  p = p.withEngines(["google.com", "custom:google.com"]).value;
  const rules = delivered(p, g.SearchEngineCatalog.forPolicy(p));
  const signatures = rules.map((r) => r.condition.regexFilter + "|" + r.priority + "|" + r.action.type);
  assert.equal(new Set(signatures).size, signatures.length, "no two rules are indistinguishable");
});

// ------------------------------------------- the domain and the simulator agree

test("the domain and the simulator always agree on where a key lands", () => {
  // THE test that keeps the core and the airlock from drifting. claimantFor lives
  // on the aggregate precisely so this can hold: it needs arming, acknowledgements
  // and the ticked engines, which the registry knows nothing about.
  const policy = withCatchAll();
  const rules = delivered(policy);
  // GENERATED, not hand-picked. Seventeen chosen entries are blind to the case
  // nobody thought of, and this is a security control: a regex that claims MORE
  // than the domain is a universal redirector. Every reserved prefix, every
  // separator, and the lengths either side of what the catch-all claims.
  const reach = g.CatchAllKey.only().claimsKeysUpTo();
  const lengths = [2, reach - 1, reach, reach + 1, 20, 21];
  const corpus = [
    "ABC-1", "abc-1", "OPS-9", "PAYROLL-3", "BAN-123", "T1-123", "BESSON-42",
    "ABC", "ABC-", "ABCDEFGHIJKLMNOPQRSTU-1",
    ...g.ReservedPrefix.ALL.flatMap((word) => [`${word}-1`, `${word} 1`, `${word}+1`, word.toLowerCase() + "-9"]),
    ...lengths.map((n) => "K".repeat(Math.max(1, n)) + "-1"),
    ...lengths.map((n) => "K".repeat(Math.max(1, n)) + " 1"),
  ];
  for (const typed of corpus) {
    const reference = g.IssueReference.parse(typed, (k) => g.ProjectKey.parse(k));
    const fromDomain = reference.ok ? policy.claimantFor(reference.value) : { code: "NO_MATCH" };
    const engine = g.SearchEngineCatalog.find("google.com");
    const fromRules = g.JumpPreview.forTypedText(typed, rules, engine);
    // THE FOLD IS NAMED, and NON_DETERMINISTIC is not in it. Folding every other
    // simulator code into NO_MATCH silenced a canary through the very test that
    // exists to keep the two engines honest.
    // NO_MATCH is a verdict in its own right; the other three genuinely mean "not
    // a search this rule set has anything to say about". NON_DETERMINISTIC is
    // deliberately absent: it is an assertion canary, and folding it into NO_MATCH
    // silenced it through the very test that keeps the two engines honest.
    const FOLDED = new Set(["NO_MATCH", "NOT_A_URL", "NOT_A_SEARCH_URL", "INPUT_TOO_LONG"]);
    assert.ok(
      fromRules.ok || fromRules.code === "RESERVED_PREFIX" || FOLDED.has(fromRules.code),
      `${JSON.stringify(typed)}: the simulator said ${fromRules.code}, which the fold would have hidden`
    );
    const simulated = fromRules.ok ? fromRules.code : fromRules.code === "RESERVED_PREFIX" ? "RESERVED_PREFIX" : "NO_MATCH";
    assert.equal(
      simulated,
      fromDomain.code,
      `${JSON.stringify(typed)}: the domain says ${fromDomain.code} and the rules say ${simulated}`
    );
  }
});

test("an adversarial input still completes well inside a quarter of a second at the cap", () => {
  // The winner search can no longer exit on the first match, so the budget is
  // measured with every engine ticked and the reserved prefixes installed -- a
  // one-shortcut policy would prove nothing.
  let p = g.JumpPolicy.empty().withEngines(["google.com", "bing.com", "duckduckgo.com"]).value;
  for (let i = 0; i < 60; i += 1) {
    const id = `id-${String(i).padStart(4, "0")}`;
    p = p.register(id, g.ProjectKey.parse("K" + String(i).padStart(3, "0")).value, g.JiraInstance.parse("https://a.atlassian.net").value).value;
    p = p.armShortcut(id).value;
  }
  p = p.registerCatchAll(STAR, g.JiraInstance.parse("https://catchall.atlassian.net").value).value;
  p = p.acknowledge(STAR, "CATCH_ALL").value;
  p = p.armShortcut(STAR).value;
  const rules = delivered(p);
  assert.ok(rules.length > 150, `the cap is exercised: ${rules.length} rules`);

  const hostile = "https://www.google.com/search?q=" + "&".repeat(g.JumpPreview.MAX_INPUT - 40);
  const started = Date.now();
  g.JumpPreview.forSearchUrl(hostile, rules);
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 250, `took ${elapsed}ms`);
});

// ------------------------------------------------- the measured facts, and the cut

/**
 * MEASURED IN CHROME ON 2026-09-01 via chrome.declarativeNetRequest.isRegexSupported,
 * on the COMPLETE RULE. Re-measure before touching any number here; the command is
 * a paste into the service worker console, and the facts are:
 *
 *   key {1,19} REFUSED (memoryLimitExceeded) even as [A-Z] | {1,9} accepted
 *   guard 49 words (cost 211) REFUSED | 24 (107) REFUSED | 16 (70) accepted
 *   guard 49 words WITHOUT (?:.*&)? still REFUSED -- the cost is the alternation
 *
 * This is a CHANGELOCK, not a proof: it can only fail if somebody edits a constant,
 * and it will not explain why. Hence the date in the name.
 */
test("changelock 2026-09-01: the claimed bound fits the measured RE2 budget", () => {
  const budget = g.Re2Budget.conservative();
  assert.ok(budget.affordsKeyOfLength(g.CatchAllKey.only().claimsKeysUpTo()),
    "the domain claims more than the measurement carries");
  // The measured ceiling itself, so raising LONGEST_MEASURED_KEY without
  // re-measuring goes red.
  assert.equal(g.Re2Budget.LONGEST_MEASURED_KEY, 10);
  assert.equal(g.Re2Budget.MAX_ALTERNATION_COST, 60);
  // 60 rather than 70: the last measured-good point costs exactly 70 and the real
  // limit lies in (70, 107] -- unknown. Sitting on 70 would ship a run of
  // SEVENTEEN words, more alternatives than anything ever measured good.
  assert.ok(g.Re2Budget.MAX_ALTERNATION_COST < 70, "the margin pays for the unmeasured envelope");
});

test("the guard runs are affordable on the SHIPPED catalogue, and partition it exactly", () => {
  // The six refusals are DETERMINISTIC: they depend only on ReservedPrefix.ALL,
  // claimsKeysUpTo() and the budget, all shipped in the release. So a release that
  // refuses refuses for EVERY user -- but only at the moment they ARM a catch-all.
  // Without this test, a release can be green everywhere and brick that one sync.
  const budget = g.Re2Budget.conservative();
  const guards = g.ReferencePattern.reservedPrefixGuards(g.CatchAllKey.only(), budget);

  // Ordered partition: "the same words, two runs permuted" cannot pass. And no
  // pinning of WHICH word lands in WHICH run -- ALL is grouped thematically, and a
  // legitimate reordering must not go red.
  assert.deepEqual(guards.flatMap((guard) => guard.prefixes), g.ReservedPrefix.ALL);
  for (const guard of guards) {
    assert.ok(budget.affordsAlternation(guard.prefixes), "a run exceeds the measured budget");
    assert.ok(Object.isFrozen(guard.prefixes), "a shared run is frozen, not watched");
  }
  assert.ok(guards.length > 1, "49 words in one rule is what Chrome refused");
});

test("the guard holds HTTP and HTTPS, the pair a substring check confounded", () => {
  // includes() is wrong on seven pairs of this catalogue -- HTTP in HTTPS, NIS in
  // NIST, PS in FIPS and HTTPS, CI in ASCII and PCI, PR in GDPR -- and HTTP/HTTPS
  // fall in the SAME run, so the inspector had to match rather than read.
  const rules = delivered(withCatchAll());
  const allows = rules.filter((r) => r.action.type === "allow");
  const engine = g.SearchEngineCatalog.find("google.com");
  for (const word of ["HTTP", "HTTPS", "CVE", "ISO", "IPHONE", "PR", "CI"]) {
    const held = allows.some((allow) =>
      new RegExp(allow.condition.regexFilter, "i").test(engine.searchUrlFor(word + "-1")));
    assert.ok(held, `${word}-1 is not held back by any guard`);
  }
  // And a legitimate six-character key CONTAINING a reserved prefix is not killed:
  // the engine anchors ^…q= and (?:&|$) around the fragment.
  const url = engine.searchUrlFor("MYHTTP-1");
  assert.equal(
    allows.some((a) => new RegExp(a.condition.regexFilter, "i").test(url)),
    false,
    "MYHTTP-1 must not be caught by the HTTP alternative"
  );
});

test("an envelope that leaves nothing to spend is refused where the arithmetic happens", () => {
  // Subtracting an envelope was unguarded, so the first real client the header
  // names -- a custom domain of sixty-odd characters -- produced a budget of zero
  // or less. The cutter then threw on the FIRST word, which rule-installer turns
  // into a global INSTALL_FAILED: one long domain name, and nothing installs.
  assert.throws(
    () => g.Re2Budget.forEnvelope(g.Re2Budget.MAX_ALTERNATION_COST),
    (error) => error instanceof g.Re2Budget.Refusal
      && error.reason === g.Re2Budget.REASONS.ENVELOPE_OVER_BUDGET
  );
  assert.throws(() => g.Re2Budget.forEnvelope(g.Re2Budget.MAX_ALTERNATION_COST + 100));

  // And a usable one still comes back usable.
  const budget = g.Re2Budget.forEnvelope(10);
  assert.equal(budget.affordsAlternation(["ABC"]), true);
});

test("the domain proposes a key length and the foreign system gets to answer, in production", () => {
  // The changelock between CatchAllKey.claimsKeysUpTo() and the measured RE2
  // ceiling lived ONLY in the tests: nothing in production asked. Lowering one
  // without the other shipped a pattern the platform refuses, and
  // updateDynamicRules rejects THE WHOLE BATCH -- every shortcut dies for one
  // number nobody re-measured.
  // A key that claims more than the measured ceiling. It answers the whole
  // protocol itself, which is the point: there is no shape table left to consult.
  // A key that CLAIMS more than the measured ceiling. It says so in domain words;
  // the airlock is the one that asks the foreign system whether it can carry it.
  const overreaching = {
    isCatchAll: () => true,
    nature: () => "catch-all",
    claim: () => ({ anyKeyUpTo: g.Re2Budget.LONGEST_MEASURED_KEY + 1 }),
    separators: () => ["-"],
    toString: () => "*",
  };
  assert.throws(
    () => g.ReferencePattern.patternFor(overreaching),
    (error) => error instanceof g.Re2Budget.Refusal
      && error.reason === g.Re2Budget.REASONS.KEY_LENGTH_OVER_BUDGET,
    "a claim beyond the measured ceiling must be refused where it is emitted"
  );

  // And the shipped bound still passes, which is what makes the guard honest
  // rather than decorative.
  assert.ok(g.ReferencePattern.patternFor(g.CatchAllKey.only()).length > 0);
});

test("a rule whose action we cannot simulate is skipped, never dereferenced", () => {
  // These rules come from the DNR store -- "a foreign system", says jump-preview's
  // own header. A block or upgradeScheme rule, from an older build or a future
  // one, walked into `undefined.replace` and killed the whole preview with
  // "Could not read the installed rules".
  const hostile = [
    { id: 1, priority: 1, action: { type: "block" }, condition: { regexFilter: ".*", isUrlFilterCaseSensitive: false } },
  ];
  const result = g.JumpPreview.forSearchUrl("https://www.google.com/search?q=ABC-1", hostile);
  assert.equal(result.ok, false);
  assert.equal(result.code, "NO_MATCH", "an unsimulatable action tells us nothing, and says so");
});

test("a custom domain cannot shadow a built-in engine through its www form", () => {
  // `www.google.com` produced `(?:www\.)?www\.google\.com` -- a different
  // signature from the built-in `(?:www\.)?google\.com`, so deduplication saw two
  // entries where the two regexes match the same URLs. Two rules for one engine
  // burn budget and rule ids, and the one the user ticked is not the one firing.
  const engine = g.CustomEngine.parse({ host: "www.google.com", shape: "search-q" });
  assert.equal(engine.ok, true);
  assert.equal(engine.value.host(), "google.com", "the www form is normalised away");
  assert.equal(engine.value.id(), "custom:google.com", "so the identity cannot enter twice");
});

test("the preview encodes a space the way a browser does", () => {
  // encodeURIComponent gives %20; an address bar emits `+`. The rule matches both,
  // so the preview still said "matched" -- but through the OTHER branch of the
  // alternation than the one reality takes. A screen claiming to simulate the
  // delivered programme was validating a path no navigation ever walks.
  const catalog = g.SearchEngineCatalog.forPolicy(
    g.JumpPolicy.empty().withEngines(["google.com"]).value
  );
  const url = catalog.find("google.com").searchUrlFor("covid 19");
  assert.ok(url.includes("q=covid+19"), `expected a + separator, got ${url}`);
  assert.equal(url.includes("%20"), false);
});

test("two rules can never share an id, and the assertion that says so exists", () => {
  // rule-factory.js cited this guard rail as if it were there: "RuleSet asserts
  // that all ids are distinct". It did not. The separation between the binding
  // band (1..300) and the reserved-prefix band (1001+) rested on nothing --
  // raise MAX_BINDINGS past a thousand and two rules collide, at which point
  // updateDynamicRules rejects THE WHOLE BATCH and every shortcut dies together.
  const collide = {
    units: [[{ id: 7, priority: 1, action: {}, condition: {} }],
            [{ id: 7, priority: 2, action: {}, condition: {} }]],
    skipped: [],
    contract: g.CoverageContract.empty(),
  };
  assert.throws(
    () => g.RuleSet.sealed(collide).assertIdsAreDistinct(),
    /two rules share id 7/
  );

  // And a real programme passes it, which is what makes the guard honest.
  const policy = withCatchAll();
  assert.ok(g.RuleFactory.buildRules(policy, g.SearchEngineCatalog.forPolicy(policy),
    g.Re2Budget.conservative()).rules().length > 0);
});

test("a sealed rule set cannot be rewritten under its readers", () => {
  // The seal copied the runs and left the rule objects SHARED, with a note saying
  // "nobody trusts an immutability that does not exist" -- a strange thing to
  // write on a value object whose whole contract is that it cannot change.
  const policy = withCatchAll();
  const set = g.RuleFactory.buildRules(policy, g.SearchEngineCatalog.forPolicy(policy),
    g.Re2Budget.conservative());
  const rule = set.rules()[0];
  const before = rule.condition.regexFilter;
  try { rule.condition.regexFilter = ".*"; } catch { /* strict mode throws, also fine */ }
  assert.equal(set.rules()[0].condition.regexFilter, before, "the pattern cannot be swapped after sealing");
});

/**
 * A THIRD-PARTY PAGE CANNOT AIM THE REDIRECT.
 *
 * `\?(?:.*&)?q=` used to build the rule, and `.*&` swallowed `q=hello&` in
 * `?q=hello&q=ABC-1` -- so the rule fired on the SECOND `q`, the one every
 * search engine ignores. Any page could then navigate a visitor to
 * `<their Jira>/browse/ABC-1`, and with a catch-all armed to `/browse/ANYTHING`,
 * with no search performed and the address bar never used.
 *
 * This runs the DELIVERED regexFilter against real URLs rather than comparing it
 * to a literal: the changelock above locks the spelling, this locks the
 * consequence, and only one of the two would survive someone "simplifying" it.
 */
test("the rule fires on the parameter the engine reads, never a later one", () => {
  const rule = delivered(policy).find((r) => r.condition.regexFilter.includes("google"));
  const re = new RegExp(rule.condition.regexFilter);

  assert.equal(re.test("https://www.google.com/search?q=ABC-1"), true,
    "the ordinary search must still be rewritten");
  assert.equal(re.test("https://www.google.com/search?source=hp&q=ABC-1"), true,
    "a parameter before the query is normal and must not break interception");
  assert.equal(re.test("https://www.google.com/search?qx=z&q=ABC-1"), true,
    "a DIFFERENT parameter that starts with the same letter is not the query");

  assert.equal(re.test("https://www.google.com/search?q=hello&q=ABC-1"), false,
    "a second q is the one the engine ignores: firing on it lets any page aim the redirect");
  assert.equal(re.test("https://www.google.com/search?q=&q=ABC-1"), false,
    "an empty first q is still the one the engine reads");
});
