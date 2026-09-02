/**
 * The key of a shortcut: the protocol, and the one door that reads one.
 *
 * NOT a base class -- this project uses inheritance nowhere, and value objects
 * are closed. This is a documented protocol plus a parse, and the two
 * implementations (ProjectKey, CatchAllKey) are checked against it by test.
 *
 * EIGHT MEMBERS, exactly:
 *
 *   toString()              -> the written form: a project key, or the catch-all's
 *   equals(other)           -> boolean
 *   isCatchAll()            -> boolean
 *   captures(projectKey)    -> boolean   -- the domain question
 *   exampleKey()            -> ProjectKey, for display only
 *   separators()            -> the separators this key accepts
 *   claim()                 -> what this key claims, in domain words:
 *                              { literal } or { anyKeyUpTo } -- never a regex
 *   nature()                -> "named" or "catch-all": the word, not a boolean
 *                              read backwards by whoever needs a label
 *
 * `claim()` IS WHY THE SHAPE TABLE IS GONE. The airlock held a two-entry table
 * and a `shapeOf(key) = key.isCatchAll() ? … : …`, which is the branch on the type
 * its own header said it had removed -- a table does not remove a branch, it moves
 * it. And that table was polymorphic on claimsKeysUpTo(), a member this protocol
 * deliberately excludes, which forced this file to document a substitution
 * violation it could not fix.
 *
 * The first fix over-corrected: it put the regex FRAGMENT, its capture ARITY and
 * its BACKREFERENCE in this protocol, so the domain began emitting RE2 and
 * CatchAllKey reached into `interception/` to ask a budget. A key says what it
 * CLAIMS; the airlock decides how to spell it. One is a domain fact, the other a
 * notation, and this protocol carries only the first.
 *
 * claimsKeysUpTo() STAYS OUT, and now genuinely has no polymorphic caller: on a
 * ProjectKey the honest answer to "your key length ceiling" is its own length,
 * not the validator's twenty -- two contracts under one name. It is CatchAllKey's
 * private business, consulted by CatchAllKey.fragmentFor alone. A test asserts it
 * exists there without adding it here.
 *
 * collidesWithOrdinarySearches() is deliberately NOT in the protocol: it is the
 * only candidate that does not speak about BEING a key, and it forced
 * CatchAllKey to answer a question that has no meaning for it.
 *
 * ShortcutKey.parse IS A THIRD SECURITY FUNCTION of this project, alongside
 * ProjectKey.parse and JiraInstance.parse: it is the only place where a string
 * becomes a catch-all key. The hostile-key corpus goes through this door too.
 */
(function (global) {
  "use strict";

  const ShortcutKey = {
    /**
     * THE STORAGE AND IMPORT DOOR, never the typed field.
     *
     * The options page never calls this and never mints a CatchAllKey: it
     * expresses a gesture (policy.registerCatchAll) and the core forges the key.
     * Two structure tests hold that line.
     *
     * The comparison is STRICT and deliberately skips normalize("NFKC"): the
     * full-width asterisk U+FF0A would fold onto `*`, and it must instead fall
     * through to ProjectKey.parse and be refused as KEY_NOT_NORMALISED. Refuse
     * rather than clean.
     *
     * CatchAllKey is resolved AT CALL TIME rather than destructured at the top of
     * the file: destructuring would make the load order decide whether this
     * module works, and the service worker would die at startup.
     */
    parse(raw) {
      if (typeof raw === "string" && raw.trim() === global.CatchAllKey.only().toString()) {
        return { ok: true, value: global.CatchAllKey.only() };
      }
      return global.ProjectKey.parse(raw);
    },

    /** The protocol, named once so the conformance test cannot drift from it. */
    MEMBERS: Object.freeze([
      "toString", "equals", "isCatchAll", "captures", "exampleKey", "separators",
      // THE THREE THAT ENDED THE SHAPE TABLE. reference-pattern.js used to carry a
      // two-entry table and a `shapeOf()` that branched on isCatchAll(), which is
      // the `if` on the type its own header claimed to have removed. Asking the
      // key instead puts the answer where the knowledge is -- and makes these
      // three genuinely polymorphic, unlike claimsKeysUpTo() below.
      "claim", "nature",
    ]),
  };

  global.ShortcutKey = ShortcutKey;
})(globalThis);
