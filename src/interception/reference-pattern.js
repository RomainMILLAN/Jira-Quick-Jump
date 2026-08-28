/**
 * The regex notation of the reference format, and the SOLE owner of group
 * indices.
 *
 * IssueReference owns the FORMAT; this file owns the NOTATION. Keeping \1 in the
 * core would have been an unverifiable promise about the group numbering of an
 * expression the core does not assemble -- broken the day an engine's
 * searchUrlPattern introduces a capture group before it.
 */
(function (global) {
  "use strict";

  const { IssueReference } = global;

  // How each domain separator appears inside a URL query string. URL knowledge,
  // hence interception, not core.
  const IN_URL = { "-": "-", " ": "\\+", "%20": "%20" };

  /**
   * Backslashes are escaped at emission even though JiraInstance.parse already
   * refuses them: validation protects the user, escaping protects against the day
   * another source (a migration, a future importer) bypasses validation.
   */
  const escapeSubstitution = (text) => text.replace(/\\/g, "\\\\");

  const ReferencePattern = {
    /** UNANCHORED: the engine wraps it and places the anchors. */
    patternFor(key) {
      const separators = IssueReference.SEPARATORS.map((s) => IN_URL[s]).join("|");
      const pattern = key.toString() + "(?:" + separators + ")(\\d+)";
      // Defence in depth: even with the closed character set on ProjectKey, the
      // emitted pattern must contain EXACTLY ONE capture group. This is the test
      // that catches the regression the day someone relaxes the character set.
      const groups = pattern.replace(/\(\?:/g, "").match(/\((?!\?)/g) || [];
      if (groups.length !== 1) {
        throw new Error("reference pattern must contain exactly one capture group");
      }
      return pattern;
    },

    /** The full destination, with the backreference. */
    substitutionFor(instance, key) {
      const token = { toString: () => IssueReference.render(key, "\\1") };
      const substitution = escapeSubstitution(instance.baseUrl()) + "/browse/" + token.toString();
      const backreferences = substitution.match(/\\[0-9]/g) || [];
      if (backreferences.length !== 1 || backreferences[0] !== "\\1") {
        throw new Error("substitution must contain exactly one backreference, \\1");
      }
      return substitution;
    },
  };

  global.ReferencePattern = ReferencePattern;
})(globalThis);
