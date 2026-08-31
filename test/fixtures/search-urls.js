/** Real search URLs, as the browsers actually build them. */
export const POSITIVE = [
  "https://www.google.com/search?q=ABC-1234&oq=ABC-1234&sourceid=chrome&ie=UTF-8",
  "https://www.google.fr/search?client=firefox-b-d&q=ABC-1234",
  "https://www.google.co.uk/search?q=ABC-1234",
  "https://google.com/search?q=ABC-1234",
  "https://www.google.com/search?q=abc-1234",
  "https://www.google.com/search?q=ABC+1234",
  "https://www.google.com/search?q=ABC%201234",
  "https://www.bing.com/search?q=ABC-1234&form=QBLH",
  "https://duckduckgo.com/?q=ABC-1234&t=h_&ia=web",
  "https://www.google.com/search?q=ABC-123456",
];

/** Searches that must go through untouched. */
export const NEGATIVE = [
  "https://www.google.com/search?q=how+to+rebase+in+git",
  "https://www.google.com/search?q=ABC-1234+status",
  "https://www.google.com/search?q=CVE-2024-1234",
  "https://www.google.com/search?q=ISO-9001",
  "https://www.google.com/search?q=ABCD-1234",
  "https://www.google.com/search?q=XABC-1234",
  "https://www.google.com/search?q=ABC-",
  "https://www.google.com/search?q=ABC",
  "https://example.org/search?q=ABC-1234",
  "https://www.google.com/maps?q=ABC-1234",
];

/**
 * Searches that must go through untouched EVEN WITH AN ARMED CATCH-ALL.
 *
 * The plain NEGATIVE corpus cannot be reused as it stands: ABCD-1234 and
 * XABC-1234 are well-formed keys, so a catch-all claims them LEGITIMATELY. Making
 * the old corpus pass with a catch-all would mean weakening it, which is why this
 * is a separate list rather than an edit.
 */
export const NEGATIVE_WITH_CATCH_ALL = [
  "https://www.google.com/search?q=how+to+rebase+in+git",
  "https://www.google.com/search?q=ABC-1234+status",
  // Naturally safe: the pattern demands (?:&|$) right after the digits, and
  // "-1234" remains.
  "https://www.google.com/search?q=CVE-2024-1234",
  // Safe ONLY because of the reserved prefixes. The most telling regression test
  // of the whole feature.
  "https://www.google.com/search?q=ISO-9001",
  "https://www.google.com/search?q=COVID-19",
  "https://www.google.com/search?q=WD-40",
  "https://www.google.com/search?q=HTTPS-1",
  // Safe because a catch-all accepts the HYPHEN ONLY. Otherwise "two tokens whose
  // second is a number" would leave for the Jira instance and land in its access
  // logs -- an outbound data flow, not an availability nuisance.
  "https://www.google.com/search?q=SALARY+2024",
  "https://www.google.com/search?q=BUDGET%202026",
  "https://www.google.com/search?q=WINDOWS+11",
  "https://www.google.com/search?q=ABC-",
  "https://www.google.com/search?q=ABC",
  "https://example.org/search?q=ABC-1234",
  "https://www.google.com/maps?q=ABC-1234",
];
