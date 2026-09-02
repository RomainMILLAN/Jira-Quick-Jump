/**
 * The regex notation of the reference format, and the SOLE owner of group
 * indices.
 *
 * IssueReference owns the FORMAT; this file owns the NOTATION. Keeping \1 in the
 * core would have been an unverifiable promise about the group numbering of an
 * expression the core does not assemble -- broken the day an engine's
 * searchUrlPattern introduces a capture group before it.
 *
 * THE KEY'S CLAIM, spelled here rather than branched on: the arity is then declared NEXT TO
 * the pattern that produces it. With a branch, the two can drift two lines
 * apart. Same gesture as the diagnosis catalogue and the list of caps in
 * _guarded.
 *
 * THE ARITY IS NEVER DECLARED BY THE CALLER. forKey knows the nature of the key,
 * so it is the only thing that knows the arity, and it REPORTS it. A caller
 * announcing "2" would disarm the very check that exists to catch a relaxation of
 * the character set.
 */
(function (global) {
  "use strict";

  const { IssueReference } = global;

  // How each domain separator appears inside a URL query string. URL knowledge,
  // hence interception, not core.
  const IN_URL = { "-": "-", " ": "\\+", "%20": "%20" };

  /**
   * THE LOAD-BEARING PROPERTY OF THE WHOLE PRIORITY DESIGN, asserted rather than
   * left in a comment.
   *
   * Three constant priority bands are enough only because a search URL can never
   * be matched by two DISTINCT named keys -- and that holds because THE FIRST
   * CHARACTER of every separator's URL form (`-`, `+`, `%`) lies outside the key
   * character set, so the key is the maximal run before it and is uniquely
   * determined by the URL.
   *
   * Note the precision: it is the FIRST character, not the whole form. `%20`
   * contains `2` and `0`, which ARE key characters. Written the naive way this
   * assertion would fail on %20 and somebody would weaken it.
   *
   * The day someone adds `.` or `_` as a separator, three bands become wrong in
   * SILENCE and the unspecified DNR tie-break is reached with no canary. One does
   * not keep a theorem in a comment.
   */
  (function assertSeparatorsCannotExtendAKey() {
    const keyCharacter = /[A-Za-z0-9_]/;
    for (const form of Object.values(IN_URL)) {
      const first = form.startsWith("\\") ? form[1] : form[0];
      if (keyCharacter.test(first)) {
        throw new Error("a separator can extend a key: " + form);
      }
    }
  })();

  /**
   * Backslashes are escaped at emission even though JiraInstance.parse already
   * refuses them: validation protects the user, escaping protects against the day
   * another source (a migration, a future importer) bypasses validation.
   */
  const escapeSubstitution = (text) => text.replace(/\\/g, "\\\\");

  const assertGroups = (pattern, arity) => {
    const groups = pattern.replace(/\(\?:/g, "").match(/\((?!\?)/g) || [];
    if (groups.length !== arity) {
      throw new Error(`reference pattern must contain exactly ${arity} capture group(s)`);
    }
  };

  /**
   * The EXACT ORDERED SEQUENCE, so \2\1 and \1\1 are refused too -- the previous
   * check only counted, and a repeated or swapped backreference would have
   * silently pointed the destination elsewhere.
   *
   * Plus: a backreference immediately followed by a digit is refused, because \10
   * reads as "group 10" in some engines.
   */
  const assertBackreferences = (substitution, expected) => {
    const found = substitution.match(/\\[0-9]/g) || [];
    if (found.length !== expected.length || found.some((ref, i) => ref !== expected[i])) {
      throw new Error("substitution must contain exactly " + expected.join(" then "));
    }
    if (/\\[0-9][0-9]/.test(substitution)) {
      throw new Error("a backreference must not be followed by a digit");
    }
  };

  const emit = (keyFragment, separators, arity) => {
    const forms = separators.map((s) => IN_URL[s]);
    // A single separator needs no alternation group. One construct fewer for
    // RE2, and the emitted rule reads as what it is.
    const gap = forms.length === 1 ? forms[0] : "(?:" + forms.join("|") + ")";
    const pattern = keyFragment + gap + "(\\d+)";
    assertGroups(pattern, arity);
    return pattern;
  };

  /** The notation, and the only place that knows one. */
  /**
   * THE NOTATION LIVES HERE, and the key never spells it.
   *
   * It branches on the CLAIM -- a domain value -- never on the type of the key
   * and never on `instanceof`. That is what a two-entry SHAPES table plus
   * `shapeOf()` was pretending to do while branching on isCatchAll() three lines
   * further down; and it is what an over-corrected first fix broke the other way,
   * by putting the fragment, the arity and the backreferences into the key
   * protocol -- at which point the DOMAIN was emitting RE2 and calling Re2Budget
   * from `core/`.
   *
   * THE FOREIGN SYSTEM IS ASKED ON THIS SIDE. catch-all-key.js says "the domain
   * proposes, the foreign system says whether it can carry"; the proposal is
   * `{ anyKeyUpTo }`, and the asking is this line -- where the refusal already has
   * a channel that reaches the user.
   */
  const spell = (claim) => {
    if (typeof claim.anyKeyUpTo === "number") {
      const claimed = claim.anyKeyUpTo;
      if (!global.Re2Budget.conservative().affordsKeyOfLength(claimed)) {
        throw global.Re2Budget.refusal("KEY_LENGTH_OVER_BUDGET", { claimed });
      }
      return {
        fragment: "(" + global.ProjectKey.caseInsensitiveShape(claimed) + ")",
        arity: 2,
        // Two groups: the key this rule captured, then the reference number.
        reference: IssueReference.render({ toString: () => "\\1" }, "\\2"),
      };
    }
    // A literal key opens no group of its own; the reference number is the rule's
    // single one. Written in UPPER CASE, which is why abc-1 lands on /browse/ABC-1
    // even though the condition is case-insensitive.
    return {
      fragment: claim.literal,
      arity: 1,
      reference: IssueReference.render({ toString: () => claim.literal }, "\\1"),
    };
  };

  const ReferencePattern = {
    IN_URL,

    /**
     * Everything the airlock needs for one key, decided in ONE place.
     *
     * The separators come from the KEY, because which separators a key accepts is
     * a domain rule: a catch-all takes the hyphen only, so that "two tokens whose
     * second is a number" -- SALARY 2024, LOI 2024 -- never leaves for the Jira
     * instance. Writing that restriction here instead would make claimantFor and
     * the emitted rule disagree, and the agreement test would fail the day it is
     * written.
     *
     * THE KEY ANSWERS ALL THREE QUESTIONS, so there is no table and no `if`.
     *
     * There used to be `SHAPES` -- two entries -- plus
     * `shapeOf(key) = key.isCatchAll() ? catchAll : named`. A table does not
     * remove a branch on the type, it moves it three lines down; and this one had
     * to be polymorphic on `claimsKeysUpTo()`, a member the key protocol
     * deliberately excluded, which shortcut-key.js documented as a substitution
     * violation. Both problems were one problem: the airlock was deciding
     * something only the key knows.
     *
     * Adding a third nature of key now costs a class, not an edit here.
     */
    forKey(key) {
      const spelled = spell(key.claim());
      const arity = spelled.arity;
      const pattern = emit(spelled.fragment, key.separators(), arity);
      return {
        arity,
        pattern,
        substitutionFor(instance) {
          const substitution =
            escapeSubstitution(instance.baseUrl()) + "/browse/" + spelled.reference;
          assertBackreferences(
            substitution,
            Array.from({ length: arity }, (_, at) => "\\" + (at + 1))
          );
          return substitution;
        },
      };
    },

    /** UNANCHORED: the engine wraps it and places the anchors. */
    patternFor(key) {
      return ReferencePattern.forKey(key).pattern;
    },

    /** The full destination, with the backreference. */
    substitutionFor(instance, key) {
      return ReferencePattern.forKey(key).substitutionFor(instance);
    },

    /**
     * The reserved prefixes, as ONE literal alternation -- an `allow` condition,
     * so ZERO capture groups, and that is ASSERTED rather than intended.
     *
     * Only the hyphen, because it only ever has to hold back the catch-all, and a
     * catch-all accepts nothing else.
     */
    reservedPrefixGuards(catchAllKey, budget) {
      const { refusal } = global.Re2Budget;
      // The prefixes come from the KEY, not from a bound handed over: an integer
      // that leaves core/, travels through the airlock and is injected back into
      // core/ makes the airlock a courier. And `guardableBy(undefined)` returning
      // [] -- zero guards with every assertion green -- is a fail-open opened by a
      // signature, which is unreachable when there is no parameter at all.
      const words = catchAllKey.prefixesWithinReach();
      if (words.length === 0) throw refusal("EMPTY_REACH");

      // Two shapes in one function, and the roles are DIFFERENT: this one is a
      // metacharacter check on SHIPPED words, at the validator's full length; the
      // emitted key fragment is a CLAIM, at the key's length. Two neighbouring
      // bounds in a file that forbids bound drift, so the roles are named.
      const shaped = new RegExp("^" + global.ProjectKey.CASE_INSENSITIVE_SHAPE + "$");
      for (const word of words) {
        // THIS throw is not the one that was removed, and it guards TWO things:
        // metacharacter injection -- "NODE.JS" would make the dot a WILDCARD in a
        // priority 2 allow, silently killing legitimate jumps -- AND the
        // termination of the cut, since a key-shaped word costs at most 21 < 60,
        // so no single word can ever exceed the budget.
        if (!shaped.test(word)) throw refusal("PREFIX_NOT_KEY_SHAPED", { word });
      }

      const guards = budget.cutIntoAffordableRuns(words).map((run) => {
        const pattern = "(?:" + run.join("|") + ")" + IN_URL["-"] + "\\d+";
        // assertGroups throws a BARE Error and is SHARED with emit(), so it is
        // wrapped here rather than having its contract changed -- and { cause } is
        // forwarded, because a catch that swallows destroys what debugging needs.
        try {
          assertGroups(pattern, 0);
        } catch (err) {
          throw refusal("GUARD_HAS_CAPTURE_GROUP", { cause: err });
        }
        // THE INSPECTOR MATCHES; IT NO LONGER READS THE LABEL. `includes(word)`
        // is wrong on SEVEN pairs of this catalogue -- HTTP in HTTPS, NIS in NIST,
        // PS in FIPS and HTTPS, CI in ASCII and PCI, PR in GDPR -- and HTTP/HTTPS
        // fall in the SAME run. The day something deduplicates, HTTP leaves the
        // pattern, the label stays, the inspector smiles, and HTTP-1 leaves for
        // the Jira instance.
        //
        // BOTH CASES, because the flag that makes the guard insensitive lives in
        // another file (rule-factory.js) and lowercase is the form actually typed,
        // hence the leak scenario. And it checks THE FRAGMENT: this file does not
        // know the engines, so the real-URL assertion lives in the golden test.
        const live = new RegExp("^" + pattern + "$", "i");
        for (const word of run) {
          if (!live.test(word + "-1")) throw refusal("GUARD_DOES_NOT_HOLD", { word });
          if (!live.test(word.toLowerCase() + "-1")) throw refusal("GUARD_DOES_NOT_HOLD", { word });
        }
        return Object.freeze({ prefixes: run, pattern });
      });

      // THE CONTROL IS THIS PARTITION -- order-sensitive, so "the same words, two
      // runs permuted" cannot pass. The inspector above is QUASI-TAUTOLOGICAL
      // today: `pattern` is built two lines up from run.join("|") and `run` is
      // also what becomes `prefixes`, so a word dropped by a deduplication leaves
      // BOTH and the inspector stays green. It is kept -- three lines, and it
      // covers the day the pattern and the label stop sharing a source -- but the
      // partition is what catches, and saying so stops someone from removing the
      // partition on the grounds that the inspector suffices.
      if (guards.flatMap((guard) => guard.prefixes).join("|") !== words.join("|")) {
        throw refusal("GUARDS_NOT_A_PARTITION");
      }
      return guards;
    },
  };

  global.ReferencePattern = ReferencePattern;
})(globalThis);
