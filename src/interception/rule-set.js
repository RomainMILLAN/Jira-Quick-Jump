/**
 * The rules to install, grouped into INDIVISIBLE UNITS.
 *
 * The invariant this object exists to hold: ON ENGINE E, NEVER A CATCH-ALL
 * WITHOUT ITS RESERVED-PREFIX ALLOW ON E. Violating it is not an availability
 * nuisance -- it is an outbound data flow, ISO-9001 landing in the Jira
 * instance's access logs.
 *
 * It used to be a repair pass: the installer filtered rule by rule and then
 * called a factory method that received its two arrays and corrected them. A
 * factory that mutates its client's collections is not a factory, and the
 * atomicity was guaranteed only by nobody forgetting the call -- which is to say
 * by nothing. One does not hand a pharmacist a pile of capsules with a note
 * saying "if the antidote is missing, remember to remove the poison too". One
 * hands over a sealed blister pack.
 *
 * THE UNIT IS PER ENGINE, not global. A capricious isRegexSupported on Bing must
 * not take down the catch-all on Google: equal security, better availability.
 *
 * And withoutRules is SYNCHRONOUS. The installer does the awaits and hands over
 * the set of unsupported ids; the atomicity logic is then testable with no
 * platform fake, and this stays a value object.
 */
(function (global) {
  "use strict";

  /**
   * What must be covered: the prefixes, and the engines that require them.
   *
   * ONE value object rather than two positional string arrays, because they are
   * one concept and always travel together -- two arrays of strings invert in
   * silence, and withoutRules then reports ONE thing instead of two, which makes
   * the `undefined.every` failure impossible rather than merely tested.
   *
   * IT ANSWERS, IT DOES NOT EXPOSE. It was created to kill two positional arrays;
   * treating it as the record it replaced would be the same mistake one
   * indirection down. And it COPIES its own arrays -- "at the boundary" means at
   * the boundary, and an array received from a caller stays mutable by that
   * caller.
   *
   * THE FOUR MEMBERS OF chrome.declarativeNetRequest.Rule, named here because this file
   * becomes the one that knows the PAYLOAD SHAPE (rule-installer.js keeping the
   * ENVELOPE). The spec is closed: four top-level members, not five.
   *
   * READ by platformRules(), not merely displayed: a frozen constant nobody reads is the
   * MEMBERS bug that shortcut-key.js paid a conformance test to learn.
   */
  const PLATFORM_FIELDS = Object.freeze(["id", "priority", "action", "condition"]);

  class CoverageContract {
    constructor(prefixes, engineIds) {
      this._prefixes = Object.freeze([...prefixes]);
      this._engineIds = Object.freeze([...engineIds]);
    }

    /**
     * IT ANSWERS, IT DOES NOT HAND OVER ITS INSIDES.
     *
     * `prefixes()` returned the array and assertGuardsCover iterated it from the
     * outside -- the header claims "IT ANSWERS, IT DOES NOT EXPOSE" two lines
     * above. The question the post-condition actually asks is "is this word one
     * of the ones you cover", so that is the question this offers.
     */
    covers(word) {
      return this._prefixes.includes(word);
    }

    /**
     * The first word this set of guards leaves uncovered, if any.
     *
     * The caller used to take `prefixes()` and loop -- so the post-condition of
     * the contract was enforced from OUTSIDE the object that carries it. Asking
     * puts the check back with the invariant, and the caller only has to say what
     * it did.
     */
    firstUncoveredIn(covered) {
      return this._prefixes.find((word) => !covered.has(word));
    }

    /** Availability, not safety: did every engine that wanted a catch-all get one?
     *  `.every()` on an empty array is true, so "no engine wanted one => installed"
     *  holds BY CONSTRUCTION with empty(), not by accident. */
    satisfiedBy(rules) {
      return this._engineIds.every((engineId) =>
        rules.some((rule) => rule.isCatchAll && rule.engineId === engineId));
    }
  }

  /** The docket of an empty truck. Without it, a policy with no catch-all -- the
   *  majority -- throws on every sync. */
  CoverageContract.empty = () => new CoverageContract([], []);

  class RuleSet {
    /**
     * `units` is an array of arrays: each inner array falls or stands together.
     *
     * THE CONSTRUCTOR SEALS, which is a NAMED DEROGATION from "a constructor only
     * assigns": the post-condition has to be replayed by withoutRules, and two
     * explicit calls at the call sites were the note stuck on the blister that
     * this file's own header mocks. Consequence to know: `new RuleSet(...)` can
     * now throw, including in test fixtures.
     */
    constructor(units, skipped, contract) {
      this._units = units;
      this._skipped = skipped;
      this._contract = contract;
      this.assertGuardsCover();
    }

    rules() {
      return this._units.flat();
    }

    skipped() {
      return [...this._skipped];
    }

    /**
     * The ONLY public door: it NAMES its arguments and COPIES them.
     *
     * A same-arity positional sealed() would be a sticker, not a seal: it could
     * not make an inversion impossible nor an omission visible. The constructor
     * stays the internal door, and it is the one that seals.
     *
     * THE SEAL REACHES THE RULES, and it did not. `units.map(spread)` copied the
     * runs and left the rule objects shared -- "written down so nobody trusts an
     * immutability that does not exist", said the note, which is a strange thing
     * to write on a value object whose whole contract is that it cannot change
     * under its readers. A documented falsehood is still a falsehood; freezing
     * costs one call and makes the sentence true.
     *
     * The rules are plain platform literals with no nested object beyond
     * action/condition, so a shallow freeze of each is the depth that matters:
     * nothing can swap a regexFilter or a redirect target after sealing.
     */
    static sealed({ units, skipped, contract }) {
      const frozen = units.map((unit) =>
        Object.freeze(unit.map((rule) => {
          if (rule.action) Object.freeze(rule.action);
          if (rule.action && rule.action.redirect) Object.freeze(rule.action.redirect);
          if (rule.condition) Object.freeze(rule.condition);
          return Object.freeze(rule);
        }))
      );
      return new RuleSet(Object.freeze(frozen), Object.freeze([...skipped]), contract);
    }

    /** Synchronous, and the UNIT decides: one refused rule drops its whole unit. */
    withoutRules(unsupportedIds) {
      const refused = new Set(unsupportedIds);
      const units = [];
      const skipped = [...this._skipped];
      for (const unit of this._units) {
        const broken = unit.filter((rule) => refused.has(rule.id));
        if (broken.length === 0) {
          units.push(unit);
          continue;
        }
        for (const rule of unit) {
          skipped.push(global.NotInstalled.of(
            refused.has(rule.id) ? "REGEX_UNSUPPORTED" : "UNIT_INCOMPLETE",
            `rule ${rule.id}`
          ));
        }
      }
      // THE CONTRACT IS CARRIED OVER UNCHANGED: pruning rules does not change what
      // the policy wanted. Dropped, this._contract would be undefined and
      // coverageSatisfied() would throw a TypeError. rule-installer calls it INSIDE its
      // try, so the throw would surface as INSTALL_FAILED rather than a silent break --
      // loud, but on a policy that is perfectly fine.
      return new RuleSet(units, skipped, this._contract);
    }

    /**
     * The post-condition, ASSERTED rather than deduced from how the units were
     * cut -- because it is a property of the final set, and a sealed blister is
     * checked sealed.
     *
     * ON THE PREFIX AXIS, PER ENGINE, RESTRICTED TO `needing`. With ONE guard per
     * engine, "an allow is present" was equivalent to "the 49 prefixes are
     * covered". With FOUR, that equivalence is gone: a set missing three runs out
     * of four would pass an engine-only check, and CVE-2024 would leave for the
     * Jira instance. The blister would be counting the blisters instead of looking
     * inside them.
     *
     * THE REFERENCE IS THE CONTRACT, never the survivors themselves -- that would
     * be the union of guardedPrefixes compared to the union of guardedPrefixes,
     * green on day one and forever. It is the only one of the three possible
     * sources that is not a tautology.
     *
     * And it does not touch the graceful per-engine degradation this file's header
     * promises: per-unit atomicity means an engine that loses a run loses its
     * catch-all too, so it leaves `needing`. All engines fall => `needing` is
     * empty => the loop does not run => nothing throws. It can only fire on an
     * incorrect unit cut -- a tautology breaker, not a new source of failure.
     */
    assertGuardsCover() {
      const guarded = new Map();
      const needing = new Set();
      for (const rule of this.rules()) {
        if (rule.action.type === "allow") {
          const covered = guarded.get(rule.engineId) ?? new Set();
          // `?? []` is FAIL-CLOSED: a missing label does not fill the union, so
          // the assertion throws. It is not a tolerance.
          for (const prefix of rule.guardedPrefixes ?? []) covered.add(prefix);
          guarded.set(rule.engineId, covered);
        } else if (rule.isCatchAll) needing.add(rule.engineId);
      }
      for (const engineId of needing) {
        const covered = guarded.get(engineId) ?? new Set();
        const missing = this._contract.firstUncoveredIn(covered);
        if (missing !== undefined) {
          throw new Error(`catch-all on ${engineId} is unguarded for ${missing}`);
        }
      }
      return this;
    }

    /**
     * EVERY RULE ID IS DISTINCT, and rule-factory.js already cited this assertion
     * as if it existed.
     *
     * Its header says the id counter is safe because "RuleSet asserts that all ids
     * are distinct". It did not. The separation between the binding band (1..300)
     * and the reserved-prefix band (1001+) rested on nothing at all: raise
     * MAX_BINDINGS past a thousand, or let ReservedPrefix.ALL grow, and two rules
     * collide -- at which point updateDynamicRules rejects THE WHOLE BATCH, so
     * every shortcut dies together.
     *
     * A commentary that invokes a guard rail nobody built is worse than none: it
     * argues the next reader out of writing one.
     */
    assertIdsAreDistinct() {
      const seen = new Set();
      for (const unit of this._units) {
        for (const rule of unit) {
          if (seen.has(rule.id)) {
            throw new Error(`two rules share id ${rule.id}: the id bands have collided`);
          }
          seen.add(rule.id);
        }
      }
      return this;
    }

    /**
     * THE SOLE OUTPUT TOWARDS THE PLATFORM.
     *
     * DERIVED from PLATFORM_FIELDS rather than rewriting the four names by hand, so the
     * named constant has a real reader.
     *
     * WHAT DERIVING CHANGES, and why the test's tooth is written with notEqual: the
     * rest-spread this replaces never invented a key, so `"priority" in r` used to catch
     * a rule that arrived AMPUTATED FROM THE FORGE. Object.fromEntries always creates
     * all four, `priority: undefined` included, so `k in r` would be true by
     * construction -- green on the one case the tooth exists to catch.
     *
     * AND WE DO NOT KNOW what DNR does with an explicit `priority: undefined`: WebIDL
     * treats an optional member set to undefined as absent (a SILENT demotion to band 1
     * -- on a guard that would mean parity with the catch-all, held only by an
     * action-type precedence this project says it never depends on), but a loud
     * rejection of the whole batch is just as plausible. SO THE POST-CONDITION IN THE
     * FORGE IS THE CONTROL, upstream of this counter.
     */
    platformRules() {
      return this.rules().map((rule) =>
        Object.fromEntries(PLATFORM_FIELDS.map((field) => [field, rule[field]])));
    }

    /** True when every engine that wanted a catch-all actually got one.
     *
     *  NAMED FOR WHEN IT ANSWERS, not for what happened: rule-installer.js evaluates
     *  this on the PRUNED set, BEFORE updateDynamicRules is ever called. It is a
     *  synchronous property of a value object, with no platform round trip -- and a
     *  method cannot honestly be called `...Installed` when it answers BEFORE the
     *  install. Whether the install then happened is what `installed` answers.
     *
     *  THE BOOLEAN STAYS A BOOLEAN, and the reasoning below has been RETURNED by the
     *  batch that split the two codes. It used to read: jump-policy.js compares
     *  `!== true`, and a list IS `!== true`, so a wrong type goes out as PERMANENT
     *  OVER-signalling rather than silence. Under the `=== false` that now governs
     *  CATCH_ALL_NOT_INSTALLED, a list is no longer `=== false`: it leaves as
     *  COVERAGE_STATE_UNKNOWN **if** the policy wants a catch-all, and as SILENCE
     *  otherwise. The direction is still safe -- ignorance about a coverage nobody
     *  asked for is not a fact worth shouting -- but it is no longer the same
     *  argument, and it is the INPUT that matters here: `wanted`, which the caller
     *  had to guess right, is gone. */
    coverageSatisfied() {
      return this._contract.satisfiedBy(this.rules());
    }
  }

  global.CoverageContract = CoverageContract;
  global.RuleSet = RuleSet;
})(globalThis);
