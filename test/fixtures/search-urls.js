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
