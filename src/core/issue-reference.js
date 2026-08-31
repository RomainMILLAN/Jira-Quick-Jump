/**
 * An issue reference: the value the user is actually trying to reach.
 *
 * It cannot be an opaque string assembled by concatenation in the
 * infrastructure, so it lives here, in the core, and it owns the format.
 *
 * NO REGEX NOTATION IN THIS FILE. A backreference such as \1 designates the
 * capture group of an expression the core does not assemble; keeping it here
 * would be an unverifiable promise about group numbering, broken the day an
 * engine's searchUrlPattern introduces a group before it. The notation lives in
 * interception/reference-pattern.js, which calls render(key, "\\1").
 */
(function (global) {
  "use strict";

  // How humans write the gap between key and number. Domain knowledge, named
  // once, tested directly -- not buried in a regexFilter alternation.
  const SEPARATORS = ["-", " ", "%20"];

  // Any run of digits after the separator is an issue number. So ABC-2024 is an
  // issue, not a year. Undecidable, decided, and written as a domain decision
  // rather than as a regex quantifier.
  const NUMBER = /^[0-9]+$/;

  class IssueReference {
    constructor(key, number, separator) {
      this._key = key;
      this._number = number;
      this._separator = separator;
    }

    toString() {
      return IssueReference.render(this._key, this._number);
    }

    key() {
      return this._key;
    }

    number() {
      return this._number;
    }

    /**
     * The separator this reference was READ with -- carried because the domain
     * now decides which separators a key accepts (a catch-all takes the hyphen
     * only), and the information used to be lost at the door.
     */
    separator() {
      return this._separator;
    }

    /**
     * The reference AS THE USER TYPED IT, separator included.
     *
     * render() always emits "-" and must keep doing so: that is the canonical
     * form Jira wants. Without this second member the first implementer would put
     * the raw match text into a preview result and the KEY<sep>N format would
     * have two homes.
     */
    asTyped() {
      return `${this._key.toString()}${this._separator}${this._number}`;
    }
  }

  IssueReference.SEPARATORS = SEPARATORS;

  /**
   * The format, with a single owner.
   *
   * Both arguments are TOKENS: the airlock passes a backreference as the key
   * token when it emits a catch-all substitution, so neither is guaranteed to be
   * a domain object. The notation itself still lives in interception (see the
   * header above); this function only owns the shape KEY-N.
   */
  IssueReference.render = function (keyToken, numberToken) {
    return `${keyToken.toString()}-${numberToken}`;
  };

  IssueReference.of = function (projectKey, number, separator = "-") {
    if (!NUMBER.test(number)) {
      return { ok: false, code: "NOT_AN_ISSUE_NUMBER", message: `"${number}" is not an issue number.` };
    }
    return { ok: true, value: new IssueReference(projectKey, number, separator) };
  };

  IssueReference.parse = function (input, parseKey) {
    if (typeof input !== "string") {
      return { ok: false, code: "NOT_A_STRING", message: "An issue reference must be a string." };
    }
    const trimmed = input.trim();
    for (const separator of SEPARATORS) {
      const at = trimmed.indexOf(separator);
      if (at <= 0) continue;
      const rawKey = trimmed.slice(0, at);
      const number = trimmed.slice(at + separator.length);
      const key = parseKey(rawKey);
      if (!key.ok) continue;
      const reference = IssueReference.of(key.value, number, separator);
      if (reference.ok) return reference;
    }
    return {
      ok: false,
      code: "NOT_AN_ISSUE_REFERENCE",
      message: `"${input}" does not look like an issue reference.`,
    };
  };

  global.IssueReference = IssueReference;
})(globalThis);
