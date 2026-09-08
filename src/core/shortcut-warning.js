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

  // `0.` and `192.0.2.` JOINED THE LIST, and they were the two gaps that mattered
  // on this axis: 0.0.0.0/8 is "this network" (and 0.0.0.0 itself is a hard
  // refusal in JiraInstance.parse, but 0.1.2.3 was not even warned about), and
  // 192.0.2.0/24 is TEST-NET-1. The rest was already here: RFC 1918, loopback and
  // the carrier-grade NAT range.
  /**
   * The non-public IPv4 space, WRITTEN AS A LIST OF RFCs rather than as one
   * unreadable alternation -- because the omissions were only findable by reading
   * it against the registry, and three of them were there.
   *
   * `192.0.2.0/24` was present while its two twins from the SAME RFC were not, so
   * `198.51.100.7` and `203.0.113.7` got LITERAL_IP (an IP address) and never
   * INTERNAL_HOST (a private network) -- the less specific of the two sentences,
   * on the screen where the user decides whether to trust a destination. Same for
   * the RFC 2544 benchmark range, which is the one an appliance actually answers
   * on, and the dead 6to4 relay anycast block.
   *
   * IPv6 is covered next door, and DELIBERATELY not here: isInternal tests
   * `!hostname.includes(".")`, which catches every bracketed literal -- ULA
   * (`[fc00::1]`), link-local and loopback alike. That works, and it works for a
   * reason worth writing down rather than leaving as luck: a bracketed IPv6
   * literal has no dot, so the "a host with no dot is not on the public internet"
   * rule already owns it.
   */
  const PRIVATE_V4 = new RegExp("^(" + [
    "0\\.",                                             // RFC 1122 "this network"
    "10\\.",                                            // RFC 1918
    "172\\.(1[6-9]|2[0-9]|3[01])\\.",                   // RFC 1918
    "192\\.168\\.",                                     // RFC 1918
    "127\\.",                                           // RFC 1122 loopback
    "100\\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\\.",  // RFC 6598 CGNAT
    "198\\.1[89]\\.",                                   // RFC 2544 benchmarking
    "192\\.88\\.99\\.",                                 // RFC 7526 dead 6to4 relay
    "192\\.0\\.2\\.",                                   // RFC 5737 documentation
    "198\\.51\\.100\\.",                                // RFC 5737 documentation
    "203\\.0\\.113\\.",                                 // RFC 5737 documentation
  ].join("|") + ")");

  /**
   * THE SUFFIXES A PRIVATE NETWORK ACTUALLY USES, as a named list.
   *
   * It was two `endsWith` calls buried in a boolean chain -- `.local` and
   * `.internal` -- so `https://jira.lan` produced NO warning at all: not
   * INTERNAL_HOST (the name was not recognised), not LITERAL_IP, not
   * INSECURE_SCHEME (it is https), not PUNYCODE. The row then armed on the first
   * click with no screen to read, and `.lan`, `.corp` and `.home.arpa` are what
   * an actual intranet is called.
   *
   * `.home.arpa` is RFC 8375; the others are the de-facto set (Active Directory's
   * `.corp`, and what home routers hand out). The direction of failure stays the
   * safe one: this list can only ever produce MORE warnings, never fewer -- and a
   * warning blocks arming until it is acknowledged.
   *
   * WHAT THIS IS NOT. It is not the control that protects the user: nothing leaves
   * for `jira.lan` without a browser prompt naming `https://jira.lan/*`. And the
   * genuinely dangerous targets -- cloud metadata, link-local -- are a HARD
   * REFUSAL in JiraInstance.parse, not a warning. This list buys the sentence
   * "that host is private", nothing more, which is why it is generous rather than
   * exhaustive.
   *
   * IT LIVES HERE and not on JiraInstance, deliberately: "does this host look
   * internal" is a judgement of the domain about a destination, while
   * project-shortcut.js answers "will a URL parser take this". Two questions, two
   * reasons to change -- see the note on hasInvisibleCharacter over there.
   */
  const INTERNAL_SUFFIXES = [
    ".local", ".internal", ".intranet", ".lan", ".corp", ".home.arpa", ".home", ".priv",
  ];

  /**
   * THE BRACKETED CLAUSES ARE CHANGELOCKS, not live checks -- said here so the
   * next reader neither deletes them as dead nor trusts them as a rampart.
   *
   * `JiraInstance.parse` refuses a bracketed host outright (BASE_IPV6_LITERAL: a
   * match pattern has no syntax for one, so the permission could never be
   * obtained and the shortcut could never fire). No instance reaching this
   * catalogue can carry one, so `startsWith("[")` and `=== "[::1]"` answer for
   * nothing today.
   *
   * They stay because the direction of failure is the safe one and the cost is
   * two comparisons: this list can only ever produce MORE warnings, never fewer,
   * and a warning blocks arming until it is acknowledged. The day that refusal is
   * relaxed -- which is a permission question, not a privacy one, so it may
   * legitimately move -- these are what keep a loopback and a bracketed address
   * from arriving unwarned on the screen where the user decides whether to trust
   * a destination.
   *
   * `!hostname.includes(".")` is NOT one of them: it is live, and it is what
   * catches the single-label intranet name (`http://jira`). It used to catch every
   * bracketed literal as a side effect too, which is the accident the note on
   * INTERNAL_HOST below unpicks.
   */
  const isLiteralIp = (hostname) =>
    /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.startsWith("[");

  const isInternal = (hostname) =>
    hostname === "localhost" ||
    INTERNAL_SUFFIXES.some((suffix) => hostname.endsWith(suffix)) ||
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
      // `address()`, NOT `hostname()`, AND THE GAIN IS NOT WHAT IT LOOKS LIKE.
      //
      // PRIVATE_V4 is written in dotted notation, so `[::ffff:a00:1]` -- which
      // IS 10.0.0.1 -- never matched it. The warning fired anyway, and measured:
      // it fired through `!hostname.includes(".")`, because a bracketed IPv6
      // literal contains no dot. So this is NOT a missing warning being added;
      // it is a warning that was reaching the user for a reason unrelated to
      // privacy.
      //
      // Why that is worth a line of code: the no-dot rule is about single-label
      // intranet names (`http://jira`), and it catches every bracketed address as
      // a side effect. Narrow it one day -- which is a reasonable thing to
      // want -- and every mapped RFC 1918 address silently stops being called
      // private. Reading the ADDRESS makes PRIVATE_V4 the reason, so the rule
      // that answers is the rule that means it.
      //
      // The entity owns the unwrapping (see JiraInstance.address) so this file
      // keeps only the judgement.
      appliesTo: (instance) => isInternal(instance.address()),
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

  // Null-prototyped, like its siblings: `kindsInScope(scope)` indexes it, and a
  // lookup that reaches Object.prototype would call `.map` on a function.
  const SCOPES = Object.assign(Object.create(null),
    { destination: DESTINATION_KINDS, key: KEY_KINDS });

  /**
   * NO `message` FIELD. It was `({ kind, severity, message })` over catalogue
   * entries that declare only `kind`, `severity` and `appliesTo` -- so every
   * warning shipped `message: undefined`, the meaningful absence
   * mutation-result.js bans in its own header ("no field whose presence varies").
   *
   * The sentence has an owner, and it is not this file: ui/sections/sentences.js
   * holds WARNING_MESSAGE, keyed by kind and translated. A domain catalogue that
   * also carried English would be the second owner.
   */
  const shown = ({ kind, severity }) => ({ kind, severity });

  const ShortcutWarning = {
    // FROZEN, like INTERNAL_SUFFIXES below and for the same reason: this list is
    // PUBLISHED on a shared `globalThis`, and it is what `parse` and `has` answer
    // from. Measured, before the freeze: one `KINDS.push("FORGED")` made
    // `Consent.parse({ armed: true, acknowledged: ["FORGED"] })` come back ok, so
    // the hard refusal this file argues for -- "a misspelled acknowledgement stays
    // a silent failure of a security control" -- was bypassable in process.
    // Nothing downstream is authorised by an unknown kind (it matches no warning),
    // which is exactly when the guard is free.
    KINDS: Object.freeze([...DESTINATION_KINDS, ...KEY_KINDS].map((k) => k.kind)),

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

  // Exported so a test can walk the real list instead of restating it: a second
  // copy of a security-adjacent catalogue is what drifts.
  ShortcutWarning.INTERNAL_SUFFIXES = Object.freeze([...INTERNAL_SUFFIXES]);

  global.ShortcutWarning = ShortcutWarning;
})(globalThis);
