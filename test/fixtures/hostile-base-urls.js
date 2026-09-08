/** Base URLs that must be refused, each with its own distinct code. */
export const HOSTILE_BASE_URLS = [
  ["https://evil.example/x?a=", "BASE_QUERY"],
  ["https://evil.example/fake-jira#", "BASE_FRAGMENT"],
  ["https://example.atlassian.net@evil.example", "BASE_USERINFO"],
  ["https://user:pass@evil.example", "BASE_USERINFO"],
  ["javascript:alert(1)", "BASE_SCHEME"],
  ["data:text/html,<script>alert(1)</script>", "BASE_SCHEME"],
  ["blob:https://evil.example/x", "BASE_SCHEME"],
  ["file:///etc/passwd", "BASE_SCHEME"],
  ["ftp://example.org", "BASE_SCHEME"],
  ["chrome-extension://abcdef", "BASE_SCHEME"],
  ["http://169.254.169.254", "BASE_FORBIDDEN_HOST"],
  ["https://metadata.google.internal", "BASE_FORBIDDEN_HOST"],
  ["http://0.0.0.0", "BASE_FORBIDDEN_HOST"],
  ["http://100.100.100.200", "BASE_FORBIDDEN_HOST"],
  // THE SAME ENDPOINTS UNDER A SPELLING THE LIST DID NOT RECOGNISE.
  //
  // `new URL()` canonises the decimal, octal and hexadecimal forms of an IPv4
  // literal back to the dotted one, so those were already refused. What it does
  // NOT do is unwrap an IPv4-MAPPED IPv6 address: `[::ffff:169.254.169.254]`
  // comes out as `[::ffff:a9fe:a9fe]`, in hexadecimal, matching neither
  // FORBIDDEN_HOSTS nor LINK_LOCAL -- and the readable spelling was caught only
  // by the canonicality post-condition, not by the list that claims to "remove
  // the whole class". `[::ffff:a9fe:a9fe]` is what an attacker would actually
  // write in a shared configuration file, and it is unreadable to any reviewer.
  // See JiraInstance.address.
  ["http://[::ffff:a9fe:a9fe]", "BASE_FORBIDDEN_HOST"],
  ["https://[::ffff:a9fe:a9fe]", "BASE_FORBIDDEN_HOST"],
  // 100.100.100.200 (Alibaba Cloud metadata), mapped.
  ["http://[::ffff:6464:64c8]", "BASE_FORBIDDEN_HOST"],
  // 0.0.0.0, mapped. Refused by the list rather than by the shape.
  ["http://[::ffff:0:0]", "BASE_FORBIDDEN_HOST"],
  // AND THE OTHER EMBEDDING, which the `ffff:` in the pattern above used to
  // require. `::a9fe:a9fe` is the IPv4-COMPATIBLE form (RFC 4291 section 2.5.5.1,
  // deprecated) of the same 169.254.169.254, and it was ACCEPTED while its mapped
  // twin two lines up was refused -- the same shape of hole, one notation
  // further, under a spelling no reviewer reads. See JiraInstance.address.
  ["http://[::a9fe:a9fe]", "BASE_FORBIDDEN_HOST"],
  ["https://[::a9fe:a9fe]", "BASE_FORBIDDEN_HOST"],
  // 100.100.100.200 and 0.0.0.0, compatible form.
  ["http://[::6464:64c8]", "BASE_FORBIDDEN_HOST"],
  ["http://[::0:0]", "BASE_FORBIDDEN_HOST"],
  // AND THE THIRD EMBEDDING, which is the one the paragraphs above did not
  // account for BECAUSE IT IS NOT IN ::/96 AT ALL. `::ffff:0:0/96` is the
  // IPv4-TRANSLATED block (RFC 2765, deprecated with SIIT), a third spelling of
  // the same endpoint -- and the only one of the three that `new URL()` does not
  // fold onto a form already listed here:
  //
  //   [::ffff:169.254.169.254]    -> [::ffff:a9fe:a9fe]      mapped, listed above
  //   [::169.254.169.254]         -> [::a9fe:a9fe]           compatible, listed above
  //   [::0:169.254.169.254]       -> [::a9fe:a9fe]           collapses onto it
  //   [::ffff:0:169.254.169.254]  -> [::ffff:0:a9fe:a9fe]    SURVIVES, and was accepted
  //
  // NO ROUTE WAS OPEN, and saying so is what keeps this line honest: no browser
  // translates that block, so a connection there goes to the IPv6 literal and not
  // to 169.254.169.254. What was wrong is the SENTENCE -- JiraInstance.address
  // claims the list judges an address and not a spelling, and one spelling sat
  // outside it. See the note there for why `0:` is admitted behind `ffff:` only.
  ["http://[::ffff:0:a9fe:a9fe]", "BASE_FORBIDDEN_HOST"],
  ["https://[::ffff:0:a9fe:a9fe]", "BASE_FORBIDDEN_HOST"],
  ["http://[::ffff:0:6464:64c8]", "BASE_FORBIDDEN_HOST"],
  /**
   * EVERY OTHER BRACKETED HOST, AND THE REASON IS THE PERMISSION -- not the
   * address. These sit in this corpus rather than beside the entries above
   * because they are refused by a DIFFERENT control, and the ordering between the
   * two is deliberate: the forbidden-host list is consulted first, on the ADDRESS
   * the hostname denotes, so the three spellings of the metadata endpoint keep
   * their own more specific and more alarming sentence.
   *
   * A WebExtensions match pattern has no syntax for a bracketed host, so
   * `permissionOrigin()` produced `http://[::1]/*` and the browser refused to even
   * ask. That was believed contained -- "the failure is visible and fail-closed
   * [...] and no rule fires" -- and it was not: origins are requested in ONE call,
   * so one such row made the grant fail for the search engines and for every other
   * shortcut. Identical blast radius to the port that permissionOrigin() drops,
   * one notation further, and the destination could never have fired anyway.
   *
   * The whole corpus is walked by the typed field, the storage door and the import
   * door alike, which is why the entries live here rather than in one test.
   */
  ["http://[::1]", "BASE_IPV6_LITERAL"],
  ["http://[::1]:8080", "BASE_IPV6_LITERAL"],
  ["https://[2001:db8::1]", "BASE_IPV6_LITERAL"],
  ["https://[fd12:3456:789a::1]/jira", "BASE_IPV6_LITERAL"],
  // A ULA is a warning-worthy address, not a forbidden one, so it reaches the
  // bracket rather than the list -- unlike fd00:ec2, which is AWS's IMDS.
  ["http://[fd00:ec2::254]", "BASE_FORBIDDEN_HOST"],
  ["https://example.org/%2e%2e", "BASE_PERCENT"],
  ["https://example.org/%00", "BASE_PERCENT"],
  ["https://example.org/a%20b", "BASE_PERCENT"],
  ["https://example.org/a\\1", "BASE_BACKSLASH"],
  ["https://example.org/a\\0", "BASE_BACKSLASH"],
  ["https://example.org/a/../b", "BASE_NOT_CANONICAL"],
  ["https://example.org//a", "BASE_NOT_CANONICAL"],
  ["https://example.org/a/./b", "BASE_NOT_CANONICAL"],
  ["https://example.org/a/b/c/d/e", "BASE_PATH_DEPTH"],
  ["https://exa\tmple.org", "BASE_CONTROL_CHARS"],
  ["https://exa\nmple.org", "BASE_CONTROL_CHARS"],
  ["https://example.org‮", "BASE_CONTROL_CHARS"],
  ["https://example.org:22", "BASE_UNSAFE_PORT"],
  ["", "BASE_EMPTY"],
  [`https://${"a".repeat(300)}.org`, "BASE_TOO_LONG"],
  /**
   * A HOST A MATCH PATTERN CANNOT NAME, and the first two are the ones that were
   * ACCEPTED -- which is the whole reason this block exists.
   *
   * `new URL()` admits `*` as a host code point, so `https://*` had no forbidden
   * host, no bracket, no port, a canonical form and pure ASCII: it parsed, and
   * `permissionOrigin()` produced the ALL-HTTPS-HOSTS pattern -- word for word one
   * of the two `optional_host_permissions` this manifest declares, so the browser
   * grants it rather than refusing it. (Not spelled out here: its last two
   * characters would close this comment. The inputs below are the verbatim half.)
   * `https://*.corp.example` is the quieter half: it carries no warning at all
   * (a dot, no internal suffix, not an IP, not
   * punycode), reads as an ordinary destination on the import review screen, and
   * hands over every subdomain of a domain the file's author picked. Measured
   * from a configuration file shaped exactly as `toTransfer()` writes one, both
   * rows disarmed -- which protects nothing, because OriginRequirements
   * deliberately collects the origins of disarmed shortcuts too.
   *
   * The rest is the port's and the bracket's blast radius one notation further,
   * and it is MEASURED rather than reasoned about. Chrome 152.0.7977.82,
   * 2026-09-07: `permissions.contains` was asked about the pattern that
   * `permissionOrigin()` derives from `https://a.*` -- not spelled here, because
   * its last two characters would close this comment -- and answered by name:
   *
   *     Invalid value for origin pattern [...]: Invalid host wildcard.
   *
   * It THROWS. `Platform.grantedOrigins` catches that and answers `false`, so the
   * badge reads `off` for ever; and `permissions.request` throws the same way, so
   * "Grant access" reports a refusal -- and origins are requested in ONE call, so
   * one such row made the grant fail for the search engines and for every other
   * shortcut too. `*` is legal in a match pattern only as the whole host or as a
   * leading `*.`, which is why the wildcard forms above WIDEN and these BREAK.
   *
   * The trailing dot, the trailing hyphen, the empty label and the underscore are
   * refused on the same rule rather than on four: a host that is not a plain
   * sequence of LDH labels either widens the pattern or breaks it. See the
   * paragraph on HOST_LDH for the one judgement call among them.
   */
  ["https://*", "BASE_HOST_SHAPE"],
  ["https://*.corp.example", "BASE_HOST_SHAPE"],
  ["https://a.*", "BASE_HOST_SHAPE"],
  ["https://ex*ample.com", "BASE_HOST_SHAPE"],
  ["http://*/jira", "BASE_HOST_SHAPE"],
  ["https://a_b.example", "BASE_HOST_SHAPE"],
  ["https://a(b.example", "BASE_HOST_SHAPE"],
  ["https://a;b.example", "BASE_HOST_SHAPE"],
  ["https://a$b.example", "BASE_HOST_SHAPE"],
  ["https://a~b.example", "BASE_HOST_SHAPE"],
  ["https://a..example", "BASE_HOST_SHAPE"],
  ["https://a-.example", "BASE_HOST_SHAPE"],
  ["https://example.org.", "BASE_HOST_SHAPE"],
];

/** Legitimate base URLs, including the self-hosted cases the plan requires. */
export const VALID_BASE_URLS = [
  ["example.atlassian.net", "https://example.atlassian.net"],
  ["https://example.atlassian.net", "https://example.atlassian.net"],
  ["https://example.atlassian.net/", "https://example.atlassian.net"],
  ["https://intra.example.org/jira", "https://intra.example.org/jira"],
  ["http://jira:8080", "http://jira:8080"],
  ["https://jira.example.org:8443/tickets", "https://jira.example.org:8443/tickets"],
];
