/**
 * The closed list of prefixes a catch-all never claims.
 *
 * THIS LIST REFUSES NOTHING. A shortcut named ISO keeps working -- it is merely
 * warned about. Excluding a word here means "declare that one explicitly",
 * never "that one is forbidden". Which is why being generous costs almost
 * nothing, and why the list is shipped in a release rather than edited by the
 * user: it is a catalogue, like the search engines.
 *
 * The separator matters as much as the word. IssueReference.SEPARATORS holds
 * "-", " " and "%20", so a catch-all accepting all three would claim "tout ce
 * que je tape en deux tokens dont le second est un nombre" -- SALARY 2024, LOI
 * 2024, WINDOWS 11. That is a data flow leaving for the Jira instance, not an
 * availability nuisance. A catch-all therefore accepts the hyphen ONLY (see
 * CatchAllKey.separators), and this list handles what remains.
 *
 * Rule for adding a word: it belongs here if an ordinary person types it
 * followed by a number, AND that number is a version, a year, a standard
 * reference or a code point -- never an issue number.
 */
(function (global) {
  "use strict";

  // Deliberately left OUT, so nobody "fixes" the apparent inconsistency:
  //   SP, MD, BS, UL -- too plausible as a real project key for the gain
  //     (SP 800-53, MD5). The user who searches SP 800 loses; the user whose
  //     project is called SP wins. Arbitrated, and assumed.
  //   GHSA -- the identifier continues with letters (GHSA-xxxx-xxxx), so (\d+)
  //     never matches. Adding it would be noise that guards nothing.
  //   T1 -- MITRE ATT&CK T1059 collides, but T1-123 must be claimed. A product
  //     decision, and the reason PS/MP/WD/F1 are here while T1 is not.
  const ALL = Object.freeze([
    // Vulnerability identifiers: canonical PREFIX-NUMBER form.
    "CAPEC", "CVE", "CVSS", "CWE",
    // Standards and standards bodies, cited as name + number: ISO 27001,
    // NF EN 1090, DIN 933, RFC 7231, PEP 8. EN/NF/DIN are the francophone and
    // European requirement of the actual audience.
    "ANSI", "DIN", "ECMA", "EN", "FIPS", "IEC", "IEEE", "ISO", "JSR", "NF",
    "NIST", "PEP", "RFC",
    // Encodings and document identifiers: UTF-8, ASCII 65, ISBN-13.
    "ASCII", "ISBN", "ISSN", "UTF",
    // Protocols and versioned technology: TLS 1.3, SHA-256, USB 3.
    "API", "CSS", "HTTP", "HTTPS", "PCI", "SHA", "SQL", "SSL", "TLS", "USB",
    // Regulations: SOC 2, NIS 2.
    "GDPR", "NIS", "SOC",
    // Cloud and AI: AWS 4 (signature v4), GPT-4.
    "AWS", "GPT",
    // Consumer products whose number is a version. This is the archetypal
    // "the extension broke my Google" family, and it protects the address
    // bar's availability rather than security.
    "COVID", "F1", "GTA", "IPHONE", "MP", "PS", "WD",
    // Developer tooling noise: PR 1234, MR 42.
    "CI", "FIXME", "MR", "PR", "TODO",
    // Formats: PDF 2.0.
    "PDF",
  ]);

  const SET = new Set(ALL);

  const ReservedPrefix = {
    ALL,

    /** Membership, and nothing else. The two-character rule lives elsewhere. */
    has(value) {
      return SET.has(value);
    },
  };

  global.ReservedPrefix = ReservedPrefix;
})(globalThis);
