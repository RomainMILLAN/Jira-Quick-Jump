/**
 * A refusal, in the reader's language.
 *
 * EVERY REFUSAL MESSAGE IN THE DOMAIN IS ENGLISH, HARD-CODED. `shortcut-registry`,
 * `jump-policy`, `stored-policy`, `versioned-entry` and every parse build their
 * own sentence -- and the surfaces printed `result.message` straight into the DOM.
 * So the French build showed English on EVERY validation error: the one moment
 * the user is being told something went wrong.
 *
 * That is exactly the symptom structure.test.js claims to prevent, and it could
 * not see it: that test scans calls to the translation helper, and these
 * sentences never went through it.
 *
 * (The phrasing above is deliberate. Spelling that call out literally here made
 * the scanner read this COMMENT as a call site and report a duplicate key -- the
 * test reads the source, comments included.)
 *
 * THE `code` IS THE INDEX, not the message. Every refusal already carries one --
 * `MutationResult.refused(code, message)` -- and a code is a stable identifier
 * where a sentence is prose that drifts. The English text stays in the domain as
 * the DEVELOPER-FACING fallback: it reaches a console, a test name, a bug report,
 * and it must not need a browser to be legible.
 */
(function (global) {
  "use strict";

  const t = (key, fallback) => global.Platform.t(key, fallback);

  /**
   * BUILT ONCE PER LANGUAGE, not once per refusal.
   *
   * It was a function rebuilding ~35 Platform.t() calls on every render of every
   * refusal. Lazy because Platform.t needs the platform, memoised because the
   * catalogue cannot change under a running page: i18n.getMessage reads a bundle
   * fixed at load.
   */
  let cached;
  const SENTENCES = () => (cached ??= build());

  const build = () => new Map(Object.entries({
    // Identity and uniqueness
    DUPLICATE_KEY: t("refuseDuplicateKey", "That key is already used by another shortcut."),
    DUPLICATE_CATCH_ALL: t("refuseDuplicateCatchAll", "There is already a catch-all shortcut."),
    DUPLICATE_ID: t("refuseDuplicateId", "Two entries claim the same identifier."),
    DUPLICATE_ENGINE: t("refuseDuplicateEngine", "That domain is already listed."),
    UNKNOWN_SHORTCUT: t("refuseUnknownShortcut", "This shortcut no longer exists."),
    UNKNOWN_QUARANTINED: t("refuseUnknownQuarantined", "This entry is no longer set aside."),
    KEY_NATURE_IMMUTABLE: t("refuseKeyNature", "A catch-all cannot be renamed, and a shortcut cannot become a catch-all."),

    // What the user typed
    KEY_SHAPE: t("refuseKeyShape", "A key looks like ABC: 2 to 20 letters, digits or underscores, starting with a letter."),
    KEY_CONTROL_CHARS: t("refuseKeyControl", "That key contains an invisible or control character."),
    KEY_NOT_NORMALISED: t("refuseKeyLookalike", "That key contains look-alike characters."),
    BASE_EMPTY: t("refuseBaseEmpty", "Enter a Jira address."),
    BASE_SCHEME: t("refuseBaseScheme", "Only http and https addresses are accepted."),
    BASE_USERINFO: t("refuseBaseUserinfo", "An address cannot carry credentials."),
    BASE_QUERY: t("refuseBaseQuery", "An address cannot carry a query string."),
    BASE_FRAGMENT: t("refuseBaseFragment", "An address cannot carry a fragment."),
    BASE_NOT_CANONICAL: t("refuseBaseCanonical", "Write the address in its plain form, for example https://example.atlassian.net/jira."),
    BASE_FORBIDDEN_HOST: t("refuseBaseForbiddenHost", "That address is a cloud metadata or link-local endpoint."),
    BASE_UNSAFE_PORT: t("refuseBaseUnsafePort", "Browsers refuse to connect to that port."),
    BASE_PATH_DEPTH: t("refuseBasePathDepth", "An address cannot have more than four path segments."),
    BASE_TOO_LONG: t("refuseBaseTooLong", "That address is too long."),
    // THE ONES REACHED BY TYPING, which is to say the likeliest of all. They were
    // missing while the header above claimed the French build no longer showed
    // English "on EVERY validation error" -- a comment asserting a coverage the
    // table did not have, in the file written to end exactly that.
    BASE_NOT_A_URL: t("refuseBaseNotAUrl", "That is not a valid address."),
    BASE_NOT_A_STRING: t("refuseBaseNotText", "A Jira address must be text."),
    BASE_CONTROL_CHARS: t("refuseBaseControl", "That address contains an invisible or control character."),
    BASE_PERCENT: t("refuseBasePercent", "Percent-encoded characters are not accepted in an address."),
    BASE_BACKSLASH: t("refuseBaseBackslash", "An address cannot contain a backslash."),
    BASE_TRAVERSAL: t("refuseBaseTraversal", "An address cannot contain . or .. path segments."),
    BASE_PORT: t("refuseBasePort", "The port must be a number between 1 and 65535."),
    BASE_NOT_ASCII: t("refuseBaseNotAscii", "That address contains non-ASCII characters."),
    KEY_NOT_A_STRING: t("refuseKeyNotText", "A project key must be text."),
    HOST_NOT_A_STRING: t("refuseHostNotText", "A domain name must be text."),
    SHAPE_SHAPE: t("refuseShapeShape", "That is not a search-engine shape this version knows."),
    ENGINE_NOT_AN_OBJECT: t("refuseEngineShape", "That search engine could not be read."),
    ENTRY_BAD_ID: t("refuseEntryBadId", "That entry has no usable identifier."),
    CONSENT_NOT_AN_OBJECT: t("refuseConsentShape", "The saved consent could not be read."),
    CONSENT_NOT_A_LIST: t("refuseConsentList", "The saved acknowledgements could not be read."),
    CONSENT_ARMED_NOT_BOOLEAN: t("refuseConsentArmed", "The saved on/off state could not be read."),
    DUPLICATE_ACKNOWLEDGEMENT: t("refuseDuplicateAck", "That acknowledgement is listed twice."),
    UNKNOWN_FIELD: t("refuseUnknownField", "That file contains a field this version does not know."),
    HOST_SHAPE: t("refuseHostShape", "Enter a plain domain name, with no scheme and no path."),
    HOST_TOO_LONG: t("refuseHostTooLong", "That domain name is too long."),

    // Limits and concurrency
    SHORTCUT_LIMIT: t("refuseShortcutLimit", "That would create more shortcuts than this extension keeps."),
    BINDING_LIMIT: t("refuseBindingLimit", "That would create more redirect rules than the browser allows."),
    ORDER_STALE: t("refuseOrderStale", "The order changed in another window. Try again."),
    CONFLICT_EXHAUSTED: t("refuseConflict", "Another window changed the configuration at the same time. Try again."),
    QUOTA_EXCEEDED: t("refuseQuota", "There is no room left to save this."),

    // Consent
    UNACKNOWLEDGED_WARNING: t("refuseUnacknowledged", "Read the destination warnings before switching this shortcut on."),
    UNKNOWN_WARNING_KIND: t("refuseUnknownWarning", "That acknowledgement is not one this version knows."),
  }));

  const RefusalPresentation = {
    /**
     * The sentence to show, with the domain's English as the last resort.
     *
     * MISSING_FRESH_ID IS DELIBERATELY ABSENT. It is a developer pre-condition,
     * not a refusal a user can act on: the only production caller always strikes a
     * fresh UUID, so the branch is unreachable from the screen. Giving it a
     * sentence promised the reader an action they cannot take -- the "refusal
     * without an object" admission.js condemns elsewhere. The guard stays; its
     * English reaches a console, which is who it is for.
     *
     * A code with no entry here falls back to the message the domain wrote, and
     * that is the honest failure: an untranslated sentence beats a code the user
     * cannot act on.
     *
     * IT DOES NEED A COMPLETENESS TEST, and the first version of this file said
     * otherwise. "An omission degrades, it does not break" is true of the
     * MECHANISM and false of the RESULT: nine codes were missing -- all of them
     * reachable by typing in the destination field, which makes them the likeliest
     * of all -- while this header claimed the French build no longer showed English
     * on every validation error. test/ui.test.js now walks what the three
     * typed-input parsers can refuse and requires a sentence for each.
     */
    sentence(result) {
      if (!result || result.ok) return "";
      // A Map, never `obj[code]`. ShortcutRegistry spends a paragraph on why a
      // string-keyed object literal is unsafe as a dictionary -- CONSTRUCTOR,
      // PROTO -- and a refusal code travels from storage through the domain to
      // here. The codes are ours today; the rule holds whether or not this
      // particular set is trusted, or it is not a rule.
      return SENTENCES().get(result.code) || result.message || String(result.code || "");
    },
  };

  global.RefusalPresentation = RefusalPresentation;
})(globalThis);
