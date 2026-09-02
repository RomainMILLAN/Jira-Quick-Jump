/**
 * What Chrome's RE2 can afford, and the SOLE owner of that measurement.
 *
 * MEASURED, not reasoned about: Chrome 2026-09-01, via
 * chrome.declarativeNetRequest.isRegexSupported, on the COMPLETE RULE.
 *
 *   repetition  : {1,19} REFUSED (memoryLimitExceeded) even as [A-Z] | {1,9} accepted
 *   alternation : cost 211 refused | 107 refused | 70 accepted
 *
 * RE2 UNROLLS BOUNDED REPETITIONS, so [A-Za-z0-9_]{1,19} copies a 63-character
 * class nineteen times. The BOUND decides, not the class -- narrowing the class
 * alone was measured and still refused. And the guard's cost is in the
 * ALTERNATION, not in the parameter prefix: 49 words are refused even without
 * (?:.*&)?. So there is no rewrite that makes it fit; it has to be cut.
 *
 * THE FORMULA lives here, next to the measurements: cost = sum(lengths) + n. The
 * three data points only pin it to within one -- sum + (n-1) would give
 * 210/106/69 -- so it is written rather than left to be guessed by regression.
 *
 * THE BUDGET IS NOT 70. The last measured-good point costs exactly 70 and the
 * real limit lies in (70, 107] -- unknown. At 70 the greedy cut produces a run of
 * SEVENTEEN words, more alternatives than any configuration ever measured good.
 * At 60: four runs of 13/13/13/10, max cost 59. Same number of rules, real
 * margin. The margin is free.
 *
 * AND IT IS A FRAGMENT BUDGET. The measurements are on the complete rule; the
 * post-condition is on the fragment, because this file does not know the engines.
 * The quantity constrained is therefore never the one that was measured, and the
 * ELEVEN units of margin are precisely what pays for the unmeasured envelope.
 * That is a DATED BET, not a proof.
 *   IF GOOGLE REFUSES AT 60: drop to 50 (five runs). Do NOT raise the key bound,
 *   which is a domain decision and not ours.
 *
 * Worst case is not Google either: a CUSTOM engine domain of sixty characters
 * adds sixty units and more to an envelope this scalar was calibrated against
 * Google for. The failure mode is sound -- isRegexSupported refuses, the whole
 * unit falls, nothing leaks -- but it is silent and per engine. It is also the
 * first real client of forEnvelope().
 */
(function (global) {
  "use strict";

  const MAX_ALTERNATION_COST = 60;
  // The quantity that was MEASURED, not a bound offset by one. {1,9} was accepted,
  // and {1,9} claims ten characters.
  const LONGEST_MEASURED_KEY = 10;

  /**
   * The named causes a construction refusal can carry.
   *
   * They live HERE rather than in reference-pattern.js because RUN_OVER_BUDGET is
   * raised by the cut, which is here, and this file is loaded FIRST of the two --
   * so there is exactly one enumeration and no third file. A second enumeration
   * is what a plan that left this "to be settled while writing" would have got.
   *
   * UNKNOWN is not one of the six: an unexpected TypeError must never be reported
   * as "the partition is broken", or someone spends two hours in
   * ReservedPrefix.ALL looking for a bug that is in the code.
   */
  const REASONS = Object.freeze({
    EMPTY_REACH: "EMPTY_REACH",
    PREFIX_NOT_KEY_SHAPED: "PREFIX_NOT_KEY_SHAPED",
    GUARD_HAS_CAPTURE_GROUP: "GUARD_HAS_CAPTURE_GROUP",
    GUARD_DOES_NOT_HOLD: "GUARD_DOES_NOT_HOLD",
    GUARDS_NOT_A_PARTITION: "GUARDS_NOT_A_PARTITION",
    RUN_OVER_BUDGET: "RUN_OVER_BUDGET",
    // The envelope alone leaves nothing to spend. Distinct from RUN_OVER_BUDGET
    // on purpose: that one says a WORD is too long, this one says the budget was
    // never usable -- two different things to fix.
    ENVELOPE_OVER_BUDGET: "ENVELOPE_OVER_BUDGET",
    // The domain claims a key length the measured RE2 ceiling cannot carry.
    KEY_LENGTH_OVER_BUDGET: "KEY_LENGTH_OVER_BUDGET",
    UNKNOWN: "UNKNOWN",
  });

  /**
   * A typed refusal, so the cause survives the throw and reaches `skipped`.
   *
   * `detail` NEVER carries the user's destination or key: today it only ever
   * holds a shipped word, and while refusals land in the service worker console
   * that constraint has to be written rather than assumed. And `cause` is always
   * forwarded -- a catch that swallows destroys the only thing that helps debug,
   * and lets code continue in a state it believes valid.
   *
   * A NAMED DEROGATION from "no inheritance", and the only one in the project.
   * `throw` is a platform contract: a value that is not an Error loses the stack,
   * and every tool that reads a crash -- the console, the browser, node's test
   * runner -- reads Error. Refusing to extend it here would not buy purity, it
   * would buy an unreadable failure at the exact moment a failure has to be read.
   *
   * THE CONSTRUCTOR ASSIGNS AND NOTHING ELSE. It used to normalise the reason and
   * unwrap `detail` -- deciding, in a constructor, in a project whose second rule
   * is that constructors do not decide. Both now happen in the factory below,
   * which is the one door anyone uses.
   */
  class Refusal extends Error {
    constructor(message, reason, detail, options) {
      super(message, options);
      this.name = "Refusal";
      this.reason = reason;
      this.detail = detail;
    }
  }

  /** What may travel: never the user's destination or key, only shipped words and
   *  numbers. The constraint is written rather than assumed, because refusals land
   *  in the service worker console. */
  const detailOf = (detail) => {
    if (!detail || typeof detail !== "object") return undefined;
    const kept = {};
    for (const field of ["word", "claimed", "envelopeCost"]) {
      if (detail[field] !== undefined) kept[field] = detail[field];
    }
    return Object.keys(kept).length > 0 ? kept : undefined;
  };

  /** The single door. It decides; the constructor stores. */
  const refusal = (reason, detail) =>
    new Refusal(
      "construction refused: " + reason,
      REASONS[reason] || REASONS.UNKNOWN,
      // THE WHOLE DETAIL, minus the cause. Keeping `word` alone silently threw
      // away `{ claimed }` and `{ envelopeCost }` -- two of the three call sites --
      // so a refusal reached `skipped` with nothing to say about itself.
      detailOf(detail),
      detail && detail.cause ? { cause: detail.cause } : undefined
    );

  class Re2Budget {
    constructor(maxAlternationCost, longestKey) {
      this._maxAlternationCost = maxAlternationCost;
      this._longestKey = longestKey;
    }

    /** BOTH axes are carried by the instance. Half a Strategy is not a Strategy:
     *  a custom engine's envelope shortens the key axis too, so a per-engine
     *  budget must be able to answer both by instance. */
    affordsKeyOfLength(n) {
      return n <= this._longestKey;
    }

    costOfAlternation(words) {
      return words.reduce((total, word) => total + word.length + 1, 0);
    }

    affordsAlternation(words) {
      return this.costOfAlternation(words) <= this._maxAlternationCost;
    }

    /**
     * The cut, DERIVED from the budget -- no counting constant to keep in sync.
     *
     * IT CHECKS ITS OWN OUTPUT and FREEZES each run. The cutter that checks its
     * own output is the sealed blister; an airlock that re-checks the cutter's
     * output is the note stuck on it. And the freeze: hoisting the call out of
     * the per-engine loop removed the cache, NOT the sharing -- one run is
     * referenced by the rules of every engine and by the label the journal
     * strips. A shared value object is frozen, not watched.
     *
     * A word that nothing can pay for alone would loop forever, so it refuses.
     * The caller's shaped.test() makes that unreachable (a key-shaped word costs
     * at most 21 < 60), but an invariant held by another file breaks the day the
     * cut is called from elsewhere.
     */
    cutIntoAffordableRuns(words) {
      const runs = [];
      let run = [];
      for (const word of words) {
        if (run.length === 0 && !this.affordsAlternation([word])) {
          throw refusal("RUN_OVER_BUDGET", { word });
        }
        if (run.length > 0 && !this.affordsAlternation([...run, word])) {
          runs.push(Object.freeze(run));
          run = [];
        }
        run.push(word);
      }
      if (run.length > 0) runs.push(Object.freeze(run));
      for (const produced of runs) {
        if (!this.affordsAlternation(produced)) throw refusal("RUN_OVER_BUDGET");
      }
      return Object.freeze(runs);
    }
  }

  /** The measured budget, conservative for every engine because the longest
   *  path is the worst case. */
  Re2Budget.conservative = () => new Re2Budget(MAX_ALTERNATION_COST, LONGEST_MEASURED_KEY);

  /**
   * The per-engine budget, the day the envelope stops being ignorable. Named now
   * so that `if (engineId === "duckduckgo.com")` stays unwritable.
   *
   * IT REFUSES AN UNUSABLE BUDGET RATHER THAN MINTING ONE. Subtracting an
   * envelope was unguarded, so the first real client the header names -- a custom
   * domain of sixty-odd characters -- produced a budget of zero or less. The
   * cutter then threw RUN_OVER_BUDGET on the FIRST word, which rule-installer
   * turns into a global INSTALL_FAILED: one long domain name, and nothing
   * installs at all. A budget that cannot pay for a single shortest word is not a
   * tight budget, it is an arithmetic error, and it must be named where the
   * arithmetic happens.
   *
   * The floor is the cheapest word this cutter can ever be handed: a two-letter
   * key plus its separator.
   */
  const CHEAPEST_WORD_COST = 3;
  Re2Budget.forEnvelope = (envelopeCost) => {
    const remaining = MAX_ALTERNATION_COST - envelopeCost;
    if (!Number.isFinite(remaining) || remaining < CHEAPEST_WORD_COST) {
      throw refusal("ENVELOPE_OVER_BUDGET", { envelopeCost });
    }
    return new Re2Budget(remaining, LONGEST_MEASURED_KEY);
  };

  Re2Budget.CHEAPEST_WORD_COST = CHEAPEST_WORD_COST;
  Re2Budget.MAX_ALTERNATION_COST = MAX_ALTERNATION_COST;
  Re2Budget.LONGEST_MEASURED_KEY = LONGEST_MEASURED_KEY;
  Re2Budget.REASONS = REASONS;
  Re2Budget.refusal = refusal;
  Re2Budget.Refusal = Refusal;

  global.Re2Budget = Re2Budget;
})(globalThis);
