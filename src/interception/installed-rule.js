/**
 * ONE DNR rule READ BACK FROM THE STORE, as a value object with a total
 * constructor.
 *
 * WHY IT EXISTS. jump-preview.js declares in its own header that the rules "come
 * from a foreign system", and then read `raw.priority`, `raw.condition.regexFilter`
 * and `raw.action.redirect.regexSubstitution` in the clear, each with its own
 * default applied AT THE POINT OF USE. A default applied at every read site
 * instead of once is the drift this file removes.
 *
 * WHAT IT BUYS, EXACTLY: ONE PLACE OF NORMALISATION and a band() that cannot be
 * forgotten. NOT the closing of the v1.0.0 reservation -- a profile coming up from
 * v1.0.0 wrote `priority: 1` on every rule and had no catch-all at all, so it
 * reads its named rules as the catch-all band. What closes that is the
 * installation replacing the whole set; what makes it VISIBLE when it fails is the
 * status line. And it is precisely because that reservation exists that coverage is
 * NOT recomputed from a band.
 *
 * NO condition() AND NO action(). An earlier design listed them: they would hand
 * back the RAW DNR objects, so evaluate() would go on reading
 * rule.condition.regexFilter, rule.condition.isUrlFilterCaseSensitive and
 * rule.action.redirect.regexSubstitution in the clear. A value object two of whose
 * accessors hand back its own entrails is not a membrane, it is a wrapper -- word
 * for word the fault this file reproaches `.priority` with. With the three named
 * accessors, structure.test.js can forbid `.condition.` and `.action.` in
 * jump-preview.js the way it forbids `.rule.priority`: SYMMETRIC instead of partial.
 */
(function (global) {
  "use strict";

  const { RuleRanking } = global;

  // The day the bands are renumbered, it is this 1 that must stay. "The most
  // alarming label" and "the DNR default" are two intentions that DIVERGE under a
  // renumbering, and it is the second one we encode.
  const DNR_DEFAULT_PRIORITY = 1;
  // DNR refuses priority < 1, so a smaller integer did not come from it.
  const DNR_MINIMUM_PRIORITY = 1;

  class InstalledRule {
    /**
     * The band is normalised HERE, once.
     *
     * A foreign store: priority absent => the DNR default (1) => the catch-all
     * band, the MOST alarming label. And the `>= 1` is NOT decoration: without it
     * the door validates the TYPE and not the DOMAIN, so 0 and -3 would sail
     * through and answer MATCHED_SHORTCUT, the LEAST alarming label. One assumption
     * remains, deliberately: any integer >= 1 is presumed to be one of our three
     * bands, for want of a band registry.
     *
     * `condition` and `action` are read bare because DNR makes them MANDATORY --
     * that is a rule rather than a case, and priority is exactly the optional one.
     */
    constructor(raw) {
      const readable = Number.isInteger(raw.priority) && raw.priority >= DNR_MINIMUM_PRIORITY;
      this._band = readable ? raw.priority : DNR_DEFAULT_PRIORITY;
      this._id = raw.id;
      this._actionType = raw.action.type;
      this._regexFilter = raw.condition.regexFilter;
      // NOT normalised elsewhere: the old code read this WITH A DEFAULT AT THE
      // POINT OF USE (`=== false ? "i" : ""`), so there was no second
      // normalisation to keep together -- the risk was the opposite, and worse.
      // DNR's default is TRUE, so absent means case-SENSITIVE.
      this._caseSensitive = raw.condition.isUrlFilterCaseSensitive !== false;
      const redirect = raw.action.redirect;
      this._substitution = redirect ? redirect.regexSubstitution : undefined;
    }

    id() { return this._id; }
    band() { return this._band; }
    actionType() { return this._actionType; }
    regexFilter() { return this._regexFilter; }
    caseSensitive() { return this._caseSensitive; }
    substitution() { return this._substitution; }

    /**
     * DELEGATES to the forge's predicate, passing a SYNTHESISED band.
     *
     * `isCatchAllBand` stays TOTAL -- rule-set.js designates it as
     * THE content check, and rule-factory.js keeps its changelock on the raw rule.
     *
     * It used to forge `{ priority: this._band }` -- a dummy of the OTHER shape --
     * because the predicate took a rule and read `.priority`, which an
     * InstalledRule does not have. Asking about the BAND lets both shapes answer
     * with what they hold, and the guard inside the predicate stays live for both.
     */
    isCatchAll() {
      return RuleRanking.isCatchAllBand(this._band);
    }
  }

  InstalledRule.DNR_DEFAULT_PRIORITY = DNR_DEFAULT_PRIORITY;
  InstalledRule.DNR_MINIMUM_PRIORITY = DNR_MINIMUM_PRIORITY;
  global.InstalledRule = InstalledRule;
})(globalThis);
