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
     * ASSIGNMENTS ONLY -- see InstalledRule.of below for the reading.
     *
     * It used to take the raw DNR rule and do six computations before five
     * assignments: a PARSER wearing a constructor. And it could not refuse, so
     * three of its accessors answered `undefined` and every caller had to ask
     * whether the object it held was usable. An object valid by halves is a form,
     * not an object.
     *
     * Named fields rather than six positional parameters: `of()` is the only
     * caller, and a six-argument call is a line nobody can read at the call site.
     */
    constructor({ band, id, actionType, regexFilter, caseSensitive, substitution }) {
      this._band = band;
      this._id = id;
      this._actionType = actionType;
      this._regexFilter = regexFilter;
      this._caseSensitive = caseSensitive;
      this._substitution = substitution;
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

  /**
   * THE DOOR, and it may answer "nothing".
   *
   * The DNR store is a foreign system -- jump-preview.js says so in its own
   * header -- and it is this project's own past. Two shapes DNR allows and this
   * build never writes:
   *
   *   a condition with `urlFilter` and no `regexFilter`
   *     -> `new RegExp(undefined)` is `/(?:)/`, which MATCHES EVERY URL.
   *        Measured: new RegExp(undefined).test("http://anything/") === true.
   *        On a redirect rule carrying a substitution, the preview would then
   *        affirm a destination for ANY input -- the organ built to be faithful,
   *        and the only place a user can check where ABC-1 goes. A FAIL-OPEN.
   *   a rule with no `action` or no `condition` at all
   *     -> a TypeError out of the constructor, which the preview renders as
   *        "could not read the installed rules": honest, but a crash wearing a
   *        sentence rather than a reading.
   *
   * So a rule this build cannot simulate is not half a rule: it is an ABSENCE,
   * and the door says so once instead of three accessors saying it separately.
   * `jump-preview.js` skips what it gets nothing for, exactly as it already skips
   * an action it cannot simulate.
   *
   * THE BAND IS NORMALISED RATHER THAN REFUSED, and that asymmetry is the point.
   * Priority absent => the DNR default (1) => the catch-all band, the MOST
   * alarming label; and the `>= 1` is not decoration, since without it 0 and -3
   * would answer MATCHED_SHORTCUT, the LEAST alarming one. A missing band is a
   * question we can still answer safely; a missing regex is not.
   */
  InstalledRule.of = function (raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const condition = source.condition && typeof source.condition === "object" ? source.condition : {};
    const action = source.action && typeof source.action === "object" ? source.action : {};
    if (typeof condition.regexFilter !== "string") return undefined;
    if (typeof action.type !== "string") return undefined;
    const readable = Number.isInteger(source.priority) && source.priority >= DNR_MINIMUM_PRIORITY;
    const redirect = action.redirect;
    return new InstalledRule({
      band: readable ? source.priority : DNR_DEFAULT_PRIORITY,
      id: source.id,
      actionType: action.type,
      regexFilter: condition.regexFilter,
      // DNR's default is TRUE, so absent means case-SENSITIVE. Normalised here
      // rather than at the point of use, where it used to be spelled
      // `=== false ? "i" : ""` -- a default sitting next to the only reader.
      caseSensitive: condition.isUrlFilterCaseSensitive !== false,
      substitution:
        redirect && typeof redirect.regexSubstitution === "string"
          ? redirect.regexSubstitution
          : undefined,
    });
  };

  InstalledRule.DNR_DEFAULT_PRIORITY = DNR_DEFAULT_PRIORITY;
  InstalledRule.DNR_MINIMUM_PRIORITY = DNR_MINIMUM_PRIORITY;
  global.InstalledRule = InstalledRule;
})(globalThis);
