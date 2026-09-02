/**
 * Where would I land if I typed this?
 *
 * NOT `Router`: DNR routes, this SIMULATES. A name describing work an object does
 * not do eventually attracts that work, and the regression net would quietly
 * become a production path.
 *
 * It takes RULES, not a policy. rule-installer.js promises in its own header to
 * report "the INSTALLED REALITY rather than the intention", so it is the single
 * owner of what is actually installed, and this simulates exactly the programme
 * that was delivered. Building the rules here would have simulated a DIFFERENT
 * programme -- a stage set, not a regression net -- and consuming the filtered
 * set directly would have made the preview asynchronous on every keystroke.
 *
 * TWO NAMED DOORS, never one door that sniffs its input (see admission.js). The
 * UI arbitrates, because it is the one that knows the user's intention.
 */
(function (global) {
  "use strict";

  const { RuleRanking, InstalledRule } = global;

  // Real search URLs are under 500 characters. The cap runs BEFORE any
  // compilation: the JS RegExp behind (?:.*&)? is quadratic on a non-matching
  // input, and a pasted megabyte of ampersands would freeze the page.
  const MAX_INPUT = 2048;
  // What a person types in an address bar. Applied before encoding.
  const MAX_TYPED = 120;
  // The rules come from the DNR store, hence from an earlier version of this
  // code, hence FROM A FOREIGN SYSTEM. The project's own doctrine, applied to its
  // own output.
  const MAX_RULES = 2048;

  // THEIR default, not OUR band. Both are 1 today, but by a COINCIDENCE OF TWO
  // INDEPENDENT SPECIFICATIONS -- ours, written in rule-ranking.js, and Chrome's. And
  // that coincidence is exactly what makes a v1.0.0 profile unreadable (see the
  // reservation on isCatchAllRule): the airlock cannot tell "the foreign system said
  // nothing" from "it said catch-all". Written under ONE name the collision hides;
  // under two names that happen to be equal it is EXPOSED.
  //
  // THE NORMALISATION HAS MOVED to interception/installed-rule.js, which owns the
  // two DNR constants and applies them ONCE, in a total constructor -- instead of a
  // default applied at every read site.
  const has_scheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

  const refuse = (code) => ({ ok: false, code });

  /**
   * Two result shapes, each entirely determined by `ok` -- which is the real
   * lesson of mutation-result.js. It does not have ONE uniform shape; it has two,
   * and no field's presence varies at constant `ok`.
   */
  const matched = (match) => ({
    ok: true,
    // THE BAND, never the label: _install strips isCatchAll before the platform and
    // report() hands back the rules READ BACK from the store, so this used to test a
    // field that no longer exists -- MATCHED_CATCH_ALL was unreachable in production.
    code: match.rule.isCatchAll() ? "MATCHED_CATCH_ALL" : "MATCHED_SHORTCUT",
    destination: match.destination,
    ruleId: match.rule.id(),
    subject: match.subject,
  });

  const evaluate = (url, rules) => {
    if (!Array.isArray(rules) || rules.length > MAX_RULES) return refuse("INPUT_TOO_LONG");
    const matches = [];
    for (const raw of rules) {
      // The airlock does not invent a datum, it finishes reading a sentence whose
      // neighbour agreed that silence was a word. WE REBUILD THE RECORD rather than
      // computing a band beside it: winner() sorts on the rule and matched() reads
      // match.rule, so a local `band` would be DEAD and both would go on reading the
      // original.
      //
      // Rebuilding also moves the WINNER, not just the label: on a fully stripped set
      // everything becomes band 1 and the tie-break falls to action-type precedence,
      // which rule-ranking.js says it is careful never to depend on. It plays in our
      // favour (the allow wins, the guard holds) but it becomes DECISIVE instead of
      // occasional.
      const rule = new InstalledRule(raw);
      // Flags are DERIVED FROM THE RULE, never hand-written: otherwise the
      // regression net would validate a different regex from the one shipped.
      const flags = rule.caseSensitive() ? "" : "i";
      const found = new RegExp(rule.regexFilter(), flags).exec(url);
      if (!found) continue;
      if (rule.actionType() === "allow") {
        matches.push({ rule, destination: undefined, subject: found[1] });
        continue;
      }
      const destination = rule.substitution().replace(
        /\\([1-9])/g,
        (_, group) => found[Number(group)] ?? ""
      );
      matches.push({ rule, destination, subject: found[0] });
    }

    const outcome = RuleRanking.winner(matches);
    if (outcome.code === "NO_MATCH") return refuse("NO_MATCH");
    if (outcome.code === "NON_DETERMINISTIC") return refuse("NON_DETERMINISTIC");
    if (outcome.match.rule.actionType() === "allow") return refuse("RESERVED_PREFIX");
    return matched(outcome.match);
  };

  const JumpPreview = {
    MAX_INPUT,
    MAX_TYPED,
    MAX_RULES,

    /** A full search URL, as the browser would build it. */
    forSearchUrl(input, rules) {
      if (typeof input !== "string" || input.length > MAX_INPUT) return refuse("INPUT_TOO_LONG");
      let url;
      try {
        url = new URL(input.trim());
      } catch {
        return refuse("NOT_A_URL");
      }
      if (url.protocol !== "https:" && url.protocol !== "http:") return refuse("NOT_A_SEARCH_URL");
      return evaluate(input.trim(), rules);
    },

    /**
     * The text the user would type. This is what makes "is COVID-19 caught?"
     * answerable.
     *
     * The previous gate was "no whitespace", which was wrong for exactly the
     * forms that justify this screen: `covid 19` and `iso 9001` contain a space,
     * so the reserved prefixes were unverifiable, and a control the user cannot
     * verify is not a control. The gate is a SCHEME test instead.
     *
     * Nothing user-supplied reaches a regex -- only a URL. MAX_INPUT is reapplied
     * to the BUILT url, because encodeURIComponent can quadruple the length.
     */
    forTypedText(text, rules, engine) {
      if (typeof text !== "string" || text.trim().length === 0) return refuse("NOT_A_URL");
      const trimmed = text.trim();
      if (trimmed.length > MAX_TYPED) return refuse("INPUT_TOO_LONG");
      if (has_scheme.test(trimmed)) return refuse("NOT_A_SEARCH_URL");
      if (!engine) return refuse("NOT_A_SEARCH_URL");
      const url = engine.searchUrlFor(trimmed);
      if (url.length > MAX_INPUT) return refuse("INPUT_TOO_LONG");
      return evaluate(url, rules);
    },
  };

  global.JumpPreview = JumpPreview;
})(globalThis);
