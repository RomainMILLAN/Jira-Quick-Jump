/**
 * A search domain the user added themselves.
 *
 * Only the HOST is user-supplied. The path and the query parameter — the parts
 * the regex is actually built from — come from a closed set of shapes in the
 * interception catalogue, because a user-supplied path or parameter means a
 * user-supplied regex, and that is a validation surface this project refuses.
 *
 * The shape is carried here as an opaque string. The core does not know what
 * shapes exist; the airlock filters an unknown one exactly as it filters an
 * unknown engine id.
 */
(function (global) {
  "use strict";

  // A plain host name. No scheme, no path, no port, no wildcard, no credentials:
  // this value is concatenated into a regex and turned into a permission origin,
  // so anything clever in it is a bug or an attack.
  // The last label must be alphabetic, which is what a real public suffix looks
  // like — and what refuses a bare IP address. A search engine is never reached
  // at 1.2.3.4, so accepting one would only ever be an attempt at something else.
  const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/;

  // See the paragraph in parse below: this is an RE2 budget expressed as an input
  // bound, not a cosmetic limit. Exported so a test can pin it against
  // Re2Budget.MAX_ALTERNATION_COST rather than restating the number.
  const MAX_HOST_LENGTH = 40;

  class CustomEngine {
    constructor(host, shape) {
      this._host = host;
      this._shape = shape;
    }
    /** THE PREFIX IS NOT SPELLED HERE. It used to be, and the catalogue read it
     *  back by hand -- two files that could drift on a colon. EngineId owns the
     *  identity; this hands it the host it has already validated. */
    id() { return global.EngineId.forCustomHost(this._host).toString(); }
    host() { return this._host; }
    shape() { return this._shape; }
    label() { return this._host; }
    toJSON() { return { host: this._host, shape: this._shape }; }
  }

  CustomEngine.parse = function (raw) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return { ok: false, code: "ENGINE_NOT_AN_OBJECT", message: "A search domain must be an object." };
    }
    for (const field of Object.keys(raw)) {
      if (field !== "host" && field !== "shape") {
        return { ok: false, code: "UNKNOWN_FIELD", message: `Unknown field "${field}" on a search domain.` };
      }
    }
    if (typeof raw.host !== "string") {
      return { ok: false, code: "HOST_NOT_A_STRING", message: "Enter a domain such as google.it." };
    }
    // `www.` IS STRIPPED, because the emitted pattern already carries `(?:www\.)?`.
    //
    // Kept, it produced `(?:www\.)?www\.google\.com` -- a DIFFERENT signature
    // from the built-in `(?:www\.)?google\.com`, so the catalogue's
    // deduplication saw two entries where the two regexes match the same URLs.
    // Two rules for one engine burn budget and rule ids, and the one the user
    // ticked is not the one that fires. Normalising here rather than at the
    // catalogue means the identity `custom:<host>` is normalised too, so the same
    // domain typed twice cannot enter twice.
    // REPEATEDLY, and the single pass defeated the very deduplication this strip
    // exists for. `www.www.google.com` came out as `www.google.com`, whose
    // emitted host pattern is `(?:www\.)?www\.google\.com` -- a DIFFERENT
    // signature from the built-in `(?:www\.)?google\.com` that matches the same
    // `www.google.com`, so the catalogue kept both and two rules shipped for one
    // engine. Measured. That is exactly the "two rules for one engine burn budget
    // and rule ids" the paragraph above refuses.
    const host = raw.host.trim().toLowerCase().replace(/^(?:www\.)+/, "");
    /**
     * FORTY, AND THE BOUND IS AN RE2 BUDGET RATHER THAN A TIDINESS RULE.
     *
     * It was 100, and interception/re2-budget.js had already named the
     * consequence: "a CUSTOM engine domain of sixty characters adds sixty units
     * and more to an envelope this scalar was calibrated against Google for [...]
     * It is also the first real client of forEnvelope()." That client now EXISTS:
     * rule-installer.js builds a per-engine provider and the guards are cut once
     * per engine.
     *
     * What that costs, precisely: isRegexSupported refuses a reserved-prefix
     * guard, its unit falls with it, and the catch-all of THAT engine is not
     * installed. Sound (RuleSet's per-unit atomicity means a catch-all can never
     * outlive its guards, so nothing leaks) but silent and per engine.
     *
     * SO WHY KEEP THE BOUND AT ALL, now that the budget is per engine? Because the
     * two answer different questions, and only one of them can be answered while
     * the user is typing. The per-engine budget makes a long domain WORK -- more,
     * smaller runs -- and, past a point, makes it FAIL BY NAME rather than through
     * an opaque REGEX_UNSUPPORTED. This bound is what keeps a domain from reaching
     * that point at all: it is refused at the door the user is standing at, with a
     * sentence they can act on, instead of being accepted and then explaining
     * itself in a diagnostics panel.
     *
     * Measured, on this catalogue: at 40 the costliest parseable host produces an
     * envelope that exhausts the budget, so the two bounds meet almost exactly --
     * which is the argument for keeping both rather than for choosing one.
     *
     * Forty is not a guess about RE2, it is a fact about search engines: the
     * longest this build ships is `duckduckgo.com`, fourteen characters. Forty
     * leaves room for a long intranet domain and still removes the worst case.
     *
     * AND THE SENTENCE ABOVE IT WAS FALSIFIED BY MEASUREMENT, so it is corrected
     * here rather than left to be believed. It read: "at 40 the costliest parseable
     * host produces an envelope that exhausts the budget, so the two bounds meet
     * almost exactly". They do not meet, and the bound they were compared on is not
     * the one that binds.
     *
     * Measured 2026-09-07, Chrome 152.0.7977.82, via isRegexSupported on the rules
     * this build actually emits:
     *
     *   the catch-all's REDIRECT, per custom host length:  28 accepted, 29 refused
     *   a 20-character named key's redirect:               34 accepted, 35 refused
     *   the reserved-prefix GUARDS, even at host 40:       all accepted
     *
     * Both redirect numbers were TWO LOWER (26/27 and 32/33) before the case
     * repair landed: going case-SENSITIVE on the redirects, with the named key
     * spelling its own two cases, stopped RE2 folding the path, the parameter name
     * and the host, and the folding cost more program than the explicit class that
     * replaced it. Re-measured at a step of 1, on the rules RuleFactory emits.
     *
     * The guards -- the thing the per-engine budget was invented for -- are the
     * CHEAP rules. What blows is the catch-all's redirect, which carries the
     * unrolled `{1,5}` repetition and two capture groups and has no budget of any
     * kind. Firefox 154 accepts all of it.
     *
     * WHAT THAT MEANS FOR A USER TODAY, stated rather than discovered: a custom
     * domain of 29 to 40 characters keeps its named shortcuts and LOSES ITS
     * CATCH-ALL on Chrome. Per-unit atomicity means the guards fall with it, so
     * nothing leaks; the loss is reported -- `coverageSatisfied` comes out false,
     * the status line says the catch-all could not be installed, and `skipped`
     * carries REGEX_UNSUPPORTED and UNIT_INCOMPLETE. Fail-closed and visible, on
     * one engine, not silent.
     *
     * THE BOUND IS DELIBERATELY LEFT AT 40, and this is the argument rather than
     * an omission. Lowering it to 28 would refuse the domain AT THE DOOR -- this
     * project's usual preference -- but it would also take away the named
     * shortcuts, which work perfectly on those hosts. The excess is over-budget
     * for ONE FEATURE, not for the domain, and a per-feature refusal is what
     * already happens. A test pins both measured boundaries against this constant,
     * so the gap is a number somebody chose and not a number nobody knows.
     *
     * A stored engine longer than this is REFUSED at the admission door and
     * reported in `refused`, like any other unreadable entry -- it is not silently
     * dropped.
     */
    if (host.length > MAX_HOST_LENGTH) {
      return { ok: false, code: "HOST_TOO_LONG", message: "That domain is too long." };
    }
    if (!HOST.test(host)) {
      return {
        ok: false,
        code: "HOST_SHAPE",
        message: "Enter the domain alone, like google.it — no https://, no path, no wildcard.",
      };
    }
    if (typeof raw.shape !== "string" || !/^[a-z-]{1,32}$/.test(raw.shape)) {
      return { ok: false, code: "SHAPE_SHAPE", message: "Pick how that engine builds its search URL." };
    }
    return { ok: true, value: new CustomEngine(host, raw.shape) };
  };

  CustomEngine.MAX_HOST_LENGTH = MAX_HOST_LENGTH;
  global.CustomEngine = CustomEngine;
})(globalThis);
