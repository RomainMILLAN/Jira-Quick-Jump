/**
 * The closed catalogue of destination warnings.
 *
 * This is a SET, not a scale: punycode is neither above nor below http. Adding a
 * warning is a catalogue entry, never a migration of the entity plus the schema
 * plus the import whitelist plus the UI.
 *
 * Every kind is acknowledgeable. A hard refusal is not a warning -- there is
 * nobody to warn, because JiraInstance.parse failed and no instance exists.
 *
 * A warning is a PURE FUNCTION OF THE DESTINATION and is never stored. Only the
 * acknowledgement is state (see consent.js).
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

  const KINDS = [
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

  const DestinationWarning = {
    KINDS: KINDS.map((k) => k.kind),

    has(kind) {
      return KINDS.some((k) => k.kind === kind);
    },

    /** Every warning that applies to this destination, derived, never stored. */
    forInstance(instance) {
      return KINDS.filter((k) => k.appliesTo(instance)).map(({ kind, severity, message }) => ({
        kind,
        severity,
        message,
      }));
    },
  };

  global.DestinationWarning = DestinationWarning;
})(globalThis);
