/**
 * The key of a shortcut: the protocol, and the one door that reads one.
 *
 * NOT a base class -- this project uses inheritance nowhere, and value objects
 * are closed. This is a documented protocol plus a parse, and the two
 * implementations (ProjectKey, CatchAllKey) are checked against it by test.
 *
 * SIX MEMBERS, exactly:
 *
 *   toString()              -> the written form: a project key, or the catch-all's
 *   equals(other)           -> boolean
 *   isCatchAll()            -> boolean
 *   captures(projectKey)    -> boolean   -- the domain question
 *   exampleKey()            -> ProjectKey, for display only
 *   separators()            -> the separators this key accepts
 *
 * claimsKeysUpTo() is deliberately NOT in the protocol either, and unlike
 * collidesWithOrdinarySearches() it is carried by CatchAllKey ALONE: on a
 * ProjectKey the honest answer to "your key length ceiling" is its own length, not
 * the validator's twenty -- two contracts under one name, a substitution violation
 * a typeof check would never see. Its only caller is SHAPES.catchAll in
 * reference-pattern.js, which branches on shapeOf(key) BEFORE asking, so no caller
 * is polymorphic. A test asserts it exists on the catch-all without adding it here.
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
    ]),
  };

  global.ShortcutKey = ShortcutKey;
})(globalThis);
