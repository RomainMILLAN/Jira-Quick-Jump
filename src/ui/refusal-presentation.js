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

  const SENTENCES = () => ({
    // Identity and uniqueness
    DUPLICATE_KEY: t("refuseDuplicateKey", "That key is already used by another shortcut."),
    DUPLICATE_CATCH_ALL: t("refuseDuplicateCatchAll", "There is already a catch-all shortcut."),
    DUPLICATE_ID: t("refuseDuplicateId", "Two entries claim the same identifier."),
    DUPLICATE_ENGINE: t("refuseDuplicateEngine", "That domain is already listed."),
    UNKNOWN_SHORTCUT: t("refuseUnknownShortcut", "This shortcut no longer exists."),
    UNKNOWN_QUARANTINED: t("refuseUnknownQuarantined", "This entry is no longer set aside."),
    KEY_NATURE_IMMUTABLE: t("refuseKeyNature", "A catch-all cannot be renamed, and a shortcut cannot become a catch-all."),
    MISSING_FRESH_ID: t("refuseMissingFreshId", "This entry needs a new identifier before it can be restored."),

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
  });

  const RefusalPresentation = {
    /**
     * The sentence to show, with the domain's English as the last resort.
     *
     * A code with no entry here falls back to the message the domain wrote, and
     * that is the honest failure: an untranslated sentence beats a code the user
     * cannot act on. It is also why this table needs no completeness test -- an
     * omission degrades, it does not break.
     */
    sentence(result) {
      if (!result || result.ok) return "";
      return SENTENCES()[result.code] || result.message || String(result.code || "");
    },
  };

  global.RefusalPresentation = RefusalPresentation;
})(globalThis);
