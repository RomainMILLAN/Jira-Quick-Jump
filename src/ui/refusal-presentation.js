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
    // NAMED FOR WHAT DECIDES IT, and the sentence says the remedy rather than the
    // rule: a match pattern has no syntax for a bracketed host, so such a
    // permission can never be obtained -- and asking for one used to make the
    // grant fail for EVERY other origin in the same call.
    //
    // THE WORDING AVOIDS ONE WORD ON PURPOSE, like this file's header avoids
    // naming the translation helper literally. "every section declares every
    // collaborator it uses" greps for `<name>.` and `<name>(` after stripping
    // COMMENTS but not STRINGS, so an English sentence ending in the name of a
    // helper in ui/sections/parts.js reads as an undeclared call. Measured: the
    // first draft of this entry ended on that word and turned the whole suite red
    // with a message about a collaborator nobody borrows.
    BASE_IPV6_LITERAL: t("refuseBaseIpv6Literal",
      "A browser permission cannot name an IPv6 address. Use a host name instead."),
    // NAMED FOR THE SHAPE, and the sentence names the three things a user can
    // actually have typed. `https://*` and `https://*.corp.example` PARSED before
    // this code existed, and permissionOrigin() turned them into `https://*/*`
    // and `https://*.corp.example/*` -- a wildcard host permission, granted by
    // the browser because the joker is one of the manifest's own optional
    // patterns. The other half of the same refusal is the port's blast radius one
    // notation further: a host a match pattern cannot parse makes the single
    // permissions.request call fail for every origin in it.
    BASE_HOST_SHAPE: t("refuseBaseHostShape",
      "Write the host as a plain domain name: no wildcard, no underscore, no empty label."),
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

    // THE IMPORT PATH, at document level -- the codes the fallback used to cover
    // in English.
    //
    // transfer.js hands parseJson's and proposeImport's refusals straight to
    // sentence(), and none of them was in this table: a French build read
    // "This file is not valid JSON." on the one screen whose whole job is to be
    // believed. The header above already claimed the French build no longer shows
    // English "on EVERY validation error"; this is the half of that claim the
    // typed-input pass did not reach.
    //
    // WHAT WAS ALREADY SAFE, and it is worth writing down rather than
    // rediscovering: no attacker-authored text ever reached the banner. The two
    // messages that interpolate a value from the file -- UNKNOWN_FIELD
    // (`Unknown field "${field}"`) and UNKNOWN_WARNING_KIND -- were the two
    // already present, so the generic sentence won and the file's own words never
    // rendered. That was the right coverage priority; it was simply not the whole
    // of it.
    // THE CODES BELOW ARE REACHED BY TWO DOORS, AND FOUR OF THESE SENTENCES ONLY
    // KNEW ONE OF THEM.
    //
    // `readDocument` is shared: JumpPolicy.proposeImport walks it for a FILE, and
    // JumpPolicy.restore walks it for the SAVED CONFIGURATION. Nine of its refusal
    // codes therefore reach the host banner through PolicyRepository.load, where no
    // file exists -- and four of them said "that file". Measured, on a policy the
    // storage door cannot read, with nothing imported: the recovery banner read
    // "That file does not contain a configuration."
    //
    // On the one view this project calls a recovery view, that sends the reader
    // hunting for a bad import while what is unreadable is their own saved
    // configuration -- which, in this trust model, is potentially the trace of a
    // compromised sync. The bandeau pointed away from the event.
    //
    // The codes are neutral about provenance, so the sentences are too. `NOT_JSON`
    // and `MALICIOUS_KEY` keep the word: they are produced by parseJson, which only
    // the import door calls. A test forbids the word in any sentence indexed by a
    // code readDocument can return.
    NOT_JSON: t("refuseNotJson", "That file is not valid JSON."),
    MALICIOUS_KEY: t("refuseMaliciousKey", "That file contains keys that are never legitimate."),
    NOT_A_DOCUMENT: t("refuseNotADocument", "That configuration could not be read."),
    SCHEMA_MISSING: t("refuseSchemaMissing", "That configuration does not say which format it is written in."),
    SCHEMA_TOO_NEW: t("refuseSchemaTooNew", "That configuration was written by a newer version of this extension."),
    SHORTCUTS_NOT_A_LIST: t("refuseShortcutsNotAList", "The list of shortcuts could not be read."),
    TOO_MANY_SHORTCUTS: t("refuseTooManyShortcuts", "That configuration holds more shortcuts than this extension keeps."),
    ENGINES_NOT_A_LIST: t("refuseEnginesNotAList", "The list of search engines could not be read."),
    TOO_MANY_ENGINES: t("refuseTooManyEngines", "That configuration ticks more search engines than this extension reads."),
    CUSTOM_ENGINES_NOT_A_LIST: t("refuseCustomEnginesNotAList", "The list of added domains could not be read."),
    TOO_MANY_CUSTOM_ENGINES: t("refuseTooManyCustomEngines", "That configuration holds more added domains than this extension keeps."),
    ENTRY_NOT_AN_OBJECT: t("refuseEntryNotAnObject", "That entry could not be read as a shortcut."),
    // The quarantine repair door, reached from the Fix button when the entry
    // carries an identifier this build cannot use.
    MISSING_FRESH_ID: t("refuseMissingFreshId", "That entry needs a new identifier before it can be brought back."),

    // Limits and concurrency
    SHORTCUT_LIMIT: t("refuseShortcutLimit", "That would create more shortcuts than this extension keeps."),
    BINDING_LIMIT: t("refuseBindingLimit", "That would create more redirect rules than the browser allows."),
    ENGINE_LIMIT: t("refuseEngineLimit", "That would tick more search engines than this extension can use."),
    ORDER_STALE: t("refuseOrderStale", "The order changed in another window. Try again."),
    CONFLICT_EXHAUSTED: t("refuseConflict", "Another window changed the configuration at the same time. Try again."),
    QUOTA_EXCEEDED: t("refuseQuota", "There is no room left to save this."),
    // NOT A DOMAIN CODE: section-host.js mints it when PolicyRepository.load
    // THROWS instead of returning { ok: false }. It has to be here, because the
    // fallback for a missing entry is `result.message` -- and on that path the
    // message is a raw JavaScript error string, which is neither actionable nor
    // translated, on the one banner that tells a user why the extension is inert.
    POLICY_UNREADABLE: t("refusePolicyUnreadable",
      "The saved configuration could not be read, so nothing is redirecting."),

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
