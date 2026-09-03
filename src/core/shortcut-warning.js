/**
 * The closed catalogue of ACKNOWLEDGEABLE WARNINGS ABOUT A SHORTCUT.
 *
 * Renamed from DestinationWarning, and the rename is not cosmetic: a module that
 * warns about a KEY cannot be called DestinationWarning without lying, and this
 * codebase refuses names describing work an object does not do (see the "NOT
 * Router" note in jump-preview.js).
 *
 * TWO SCOPES, and each entry receives THE OBJECT OF ITS SCOPE. Keeping one
 * `appliesTo` with two different contracts would make two catalogue entries
 * non-interchangeable, and the first generic loop over KINDS would hand over the
 * wrong object.
 *
 * Most warnings stay pure functions of the destination and remain reachable as
 * such (forInstance), which is what lets the options page warn about a
 * destination WHILE IT IS BEING TYPED, without fabricating a throwaway shortcut.
 * One is a function of the nature of the key. The acknowledgement itself has
 * always been carried by the shortcut (see consent.js).
 *
 * There is deliberately NO composite kind. A warning depending on both scopes
 * would belong to neither list, would break forShortcut as a concatenation, and
 * -- because forgettingDestinationAcknowledgements drops any kind whose scope it
 * cannot place -- would be forgotten on every keystroke that parses in the
 * destination field. The composed sentence ("every key-shaped search leaves in
 * clear text") is a UI sentence, assembled from DOM nodes.
 *
 * `severity` is a SET, not a scale: CATCH_ALL at "high" ranks alongside
 * INSECURE_SCHEME, never above it. And nothing subsumes anything.
 */
(function (global) {
  "use strict";

  /**
   * NO ENGLISH SENTENCES HERE ANY MORE.
   *
   * Each warning used to carry a `message` in English beside its `kind`. The UI
   * never showed it -- `WARNING_MESSAGE()[kind]` covers all five, measured -- so
   * the core held a DEAD COPY of interface text that no translator ever saw and
   * nothing kept in step with the real one.
   *
   * The core states a KIND and a SEVERITY; the interface owns the wording. That is
   * already how refusals work (RefusalPresentation indexes on the code), and now
   * warnings work the same way. A test pins that every kind has a sentence, which
   * is the guarantee the dead copy pretended to give.
   */

  const PRIVATE_V4 =
    /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.)/;

  const isLiteralIp = (hostname) =>
    /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.startsWith("[");

  const isInternal = (hostname) =>
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    !hostname.includes(".") ||
    PRIVATE_V4.test(hostname) ||
    hostname === "[::1]";

  /** Pure functions of the destination. appliesTo receives a JiraInstance. */
  const DESTINATION_KINDS = [
    {
      kind: "INSECURE_SCHEME",
      severity: "high",
      appliesTo: (instance) => instance.protocol() === "http:",
    },
    {
      kind: "INTERNAL_HOST",
      severity: "medium",
      appliesTo: (instance) => isInternal(instance.hostname()),
    },
    {
      kind: "LITERAL_IP",
      severity: "medium",
      appliesTo: (instance) => isLiteralIp(instance.hostname()),
    },
    {
      kind: "PUNYCODE",
      severity: "high",
      appliesTo: (instance) => instance.hostname().includes("xn--"),
    },
  ];

  /** Functions of the nature of the key. appliesTo receives a ShortcutKey. */
  const KEY_KINDS = [
    {
      kind: "CATCH_ALL",
      severity: "high",
      appliesTo: (key) => key.isCatchAll(),
    },
  ];

  const SCOPES = { destination: DESTINATION_KINDS, key: KEY_KINDS };

  const shown = ({ kind, severity, message }) => ({ kind, severity, message });

  const ShortcutWarning = {
    KINDS: [...DESTINATION_KINDS, ...KEY_KINDS].map((k) => k.kind),

    /**
     * THE PUBLISHED LANGUAGE OF A CONTEXT BOUNDARY, and that is why it gets a
     * parse rather than a membership test.
     *
     * A `kind` is not an internal convenience: it is PERSISTED (one third of the
     * row key an attestation is filed under), it crosses into the key-scoped
     * consent context, and both sides agree on it through `scopeOf`. Two files
     * validated it with `has(kind)` and moved on with a bare string.
     *
     * `parse` returns the repository's usual refusable shape, so an unknown kind
     * is REFUSED WITH A CODE at the door instead of being filtered away later --
     * which is exactly how one of the two silent losses at the consent airlock
     * happened. `has` stays: a boolean question is legitimate where the caller has
     * no refusal to build.
     */
    parse(kind) {
      if (typeof kind !== "string") {
        return { ok: false, code: "KIND_NOT_A_STRING", message: "A warning kind must be text." };
      }
      if (!ShortcutWarning.KINDS.includes(kind)) {
        return { ok: false, code: "UNKNOWN_KIND", message: "This warning kind is not one this build knows." };
      }
      return { ok: true, value: kind, scope: SCOPES.key.some((k) => k.kind === kind) ? "key" : "destination" };
    },

    has(kind) {
      return ShortcutWarning.KINDS.includes(kind);
    },

    /** Which scope a kind belongs to, or undefined for a kind we do not know. */
    scopeOf(kind) {
      for (const [scope, kinds] of Object.entries(SCOPES)) {
        if (kinds.some((k) => k.kind === kind)) return scope;
      }
      return undefined;
    },

    /** The kinds of one scope, so that Consent never has to learn what a scope is. */
    kindsInScope(scope) {
      return (SCOPES[scope] || []).map((k) => k.kind);
    },

    /** Signature and semantics UNCHANGED: the options page still needs this. */
    forInstance(instance) {
      return DESTINATION_KINDS.filter((k) => k.appliesTo(instance)).map(shown);
    },

    forKey(key) {
      return KEY_KINDS.filter((k) => k.appliesTo(key)).map(shown);
    },

    /**
     * A concatenation, and it can stay one because every entry receives the
     * object of its scope. The entity hands over its PARTS rather than itself.
     * Key first, so the order is stable across renders.
     */
    forShortcut(shortcut) {
      return [
        ...ShortcutWarning.forKey(shortcut.key()),
        ...ShortcutWarning.forInstance(shortcut.instance()),
      ];
    },
  };

  global.ShortcutWarning = ShortcutWarning;
})(globalThis);
