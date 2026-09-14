/**
 * Keys that must be refused BY ProjectKey.parse -- not by isRegexSupported,
 * which happily accepts `A|` and `.*` because they are valid regexes.
 */
export const HOSTILE_KEYS = [
  ".*", ".+", "A|", "A|B", "(x)", "(?:x)", "[", "]", "\\d", "\\w", "A{9999}",
  "A{1,2}", "^", "$", "A\\", "ABC.*", "A.B", "A*", "A+", "A?", "%2e", "a b",
  "A-B", "A/B", "A#B", "A@B", "A'B", 'A"B', "A;B", "A(B", "A)B",
  "АВС", "ＡＢＣ", "AB​C", "AB\tC", "AB‮C",
  "AB C", "", " ", "A", "1AB", "_AB", "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  // The bare asterisk was missing: it was hostile to nobody until a catch-all
  // existed. ProjectKey.parse must still refuse it, and ShortcutKey.parse is now
  // the ONLY door that turns it into a key.
  "*", "**", "*A", "A*B", "\uff0a",
];

/** Legitimate keys that must be accepted, with their normalised form. */
export const VALID_KEYS = [
  ["abc", "ABC"],
  ["ABC", "ABC"],
  ["  dev  ", "DEV"],
  ["OPS_2", "OPS_2"],
  ["A1", "A1"],
];
