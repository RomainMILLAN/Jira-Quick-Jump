/**
 * Where would I land if I typed this?
 *
 * NOT `Router`: DNR routes, this SIMULATES. A name describing work an object does
 * not do eventually attracts that work, and the regression net would quietly
 * become a production path.
 */
(function (global) {
  "use strict";

  const { RuleFactory } = global;

  // Real search URLs are under 500 characters. The cap runs BEFORE any
  // compilation: the JS RegExp behind (?:.*&)? is quadratic on a non-matching
  // input, and a pasted megabyte of ampersands would freeze the page.
  const MAX_INPUT = 2048;

  const JumpPreview = {
    forSearchUrl(input, policy, catalog) {
      if (typeof input !== "string" || input.length > MAX_INPUT) {
        return { ok: false, code: "INPUT_TOO_LONG" };
      }
      // Non-regex prefilter: cheap, and a better message than "no destination".
      let url;
      try {
        url = new URL(input.trim());
      } catch {
        return { ok: false, code: "NOT_A_URL" };
      }
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        return { ok: false, code: "NOT_A_SEARCH_URL" };
      }

      const { rules } = RuleFactory.buildRules(policy, catalog);
      for (const rule of rules) {
        // Flags are DERIVED FROM THE RULE, never hand-written: otherwise the
        // regression net would validate a different regex from the one shipped.
        const flags = rule.condition.isUrlFilterCaseSensitive === false ? "i" : "";
        const match = new RegExp(rule.condition.regexFilter, flags).exec(input);
        if (!match) continue;
        const destination = rule.action.redirect.regexSubstitution.replace(
          /\\([1-9])/g,
          (_, group) => match[Number(group)] ?? ""
        );
        return { ok: true, destination, ruleId: rule.id };
      }
      return { ok: false, code: "NO_MATCH" };
    },
  };

  JumpPreview.MAX_INPUT = MAX_INPUT;
  global.JumpPreview = JumpPreview;
})(globalThis);
