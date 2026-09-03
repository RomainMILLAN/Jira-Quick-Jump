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
