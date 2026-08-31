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
      message: "Traffic and your Jira session cookie travel in clear text.",
      appliesTo: (instance) => instance.protocol() === "http:",
    },
    {
      kind: "INTERNAL_HOST",
      severity: "medium",
      message: "This destination is on a private or non-public network.",
      appliesTo: (instance) => isInternal(instance.hostname()),
    },
    {
      kind: "LITERAL_IP",
      severity: "medium",
      message: "This destination is an IP address rather than a host name.",
      appliesTo: (instance) => isLiteralIp(instance.hostname()),
    },
    {
      kind: "PUNYCODE",
      severity: "high",
      message: "This host name uses non-ASCII characters and may imitate another one.",
      appliesTo: (instance) => instance.hostname().includes("xn--"),
    },
  ];

  /** Functions of the nature of the key. appliesTo receives a ShortcutKey. */
  const KEY_KINDS = [
    {
      kind: "CATCH_ALL",
      severity: "high",
      message: "Every key-shaped search on your engines will leave for this destination.",
      appliesTo: (key) => key.isCatchAll(),
    },
  ];

  const SCOPES = { destination: DESTINATION_KINDS, key: KEY_KINDS };

  const shown = ({ kind, severity, message }) => ({ kind, severity, message });

  const ShortcutWarning = {
    KINDS: [...DESTINATION_KINDS, ...KEY_KINDS].map((k) => k.kind),

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
