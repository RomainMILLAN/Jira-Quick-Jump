/**
 * The regex notation of the reference format, and the SOLE owner of group
 * indices.
 *
 * IssueReference owns the FORMAT; this file owns the NOTATION. Keeping \1 in the
 * core would have been an unverifiable promise about the group numbering of an
 * expression the core does not assemble -- broken the day an engine's
 * searchUrlPattern introduces a capture group before it.
 *
 * A TABLE OF TWO ENTRIES rather than an `if`: the arity is then declared NEXT TO
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

  /** The two natures of key, each declaring its own arity next to its pattern. */
  const SHAPES = {
    named: {
      arity: 1,
      backreferences: ["\\1"],
      fragmentFor: (key) => key.toString(),
      // The key is written LITERALLY and in upper case, which is why abc-1 lands
      // on /browse/ABC-1 even though the rule is case-insensitive.
      referenceFor: () => IssueReference.render({ toString: () => "" }, "\\1"),
    },
    catchAll: {
      arity: 2,
      backreferences: ["\\1", "\\2"],
      // The SAME character set ProjectKey enforces, written for a
      // case-insensitive rule. Never a copy: it comes from its owner.
      fragmentFor: () => "(" + global.ProjectKey.CASE_INSENSITIVE_SHAPE + ")",
      referenceFor: () => IssueReference.render({ toString: () => "\\1" }, "\\2"),
    },
  };

  const shapeOf = (key) => (key.isCatchAll() ? SHAPES.catchAll : SHAPES.named);

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
     */
    forKey(key) {
      const shape = shapeOf(key);
      const pattern = emit(shape.fragmentFor(key), key.separators(), shape.arity);
      return {
        arity: shape.arity,
        pattern,
        substitutionFor(instance) {
          const substitution =
            escapeSubstitution(instance.baseUrl()) +
            "/browse/" +
            (key.isCatchAll() ? shape.referenceFor() : IssueReference.render(key, "\\1"));
          assertBackreferences(substitution, shape.backreferences);
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
    reservedPrefixPattern() {
      const words = global.ReservedPrefix.ALL;
      const shaped = new RegExp("^" + global.ProjectKey.CASE_INSENSITIVE_SHAPE + "$");
      for (const word of words) {
        // An alternative that cannot be a key is dead code guarding nothing.
        if (!shaped.test(word)) throw new Error("a reserved prefix is not key-shaped: " + word);
      }
      const pattern = "(?:" + words.join("|") + ")" + IN_URL["-"] + "\\d+";
      assertGroups(pattern, 0);
      return pattern;
    },
  };

  global.ReferencePattern = ReferencePattern;
})(globalThis);
