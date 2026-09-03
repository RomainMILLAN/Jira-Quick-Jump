/**
 * The catch-all key: the one that claims every reference SHORT ENOUGH for it --
 * see claimsKeysUpTo. It used to claim them all; a measured RE2 memory limit and a
 * domain choice about outbound flow narrowed it.
 *
 * A SEPARATE FILE ON PURPOSE. project-shortcut.js declares itself the home of
 * the project's security functions and its only way in; putting the permissive
 * type there would dilute the review. This boundary is visible instead: the
 * whole widening of the model fits in this file.
 *
 * ProjectKey.parse is NOT relaxed by a single character. `*` is never a valid
 * ProjectKey value, which is also why the persisted format needs no new field
 * and no tagged union -- the plain string in `key` carries it.
 */
(function (global) {
  "use strict";

  const WRITTEN_FORM = "*";

  /**
   * The three verdicts, FROZEN AND READ.
   *
   * DIAGNOSES has a real reader -- it drives diagnose(). A frozen constant whose
   * members nobody reads is exactly the MEMBERS bug of shortcut-key.js: promised
   * by a comment, dead in fact. So verdictFor returns VERDICTS.X, jump-policy.js
   * compares against VERDICTS.X, and the agreement test asserts that every value
   * verdictFor can return is in Object.values(VERDICTS).
   */
  const VERDICTS = Object.freeze({
    CLAIMED: "CLAIMED",
    OUT_OF_REACH: "OUT_OF_REACH",
    RESERVED_PREFIX: "RESERVED_PREFIX",
  });

  class CatchAllKey {
    /** The SOLE owner of the written form. No exported MARKER constant: it would
     *  invite `key.toString() === MARKER` in the UI instead of isCatchAll(). */
    toString() {
      return WRITTEN_FORM;
    }
    equals(other) {
      return other instanceof CatchAllKey;
    }
    isCatchAll() {
      return true;
    }

    /** See ProjectKey.nature. */
    nature() {
      return "catch-all";
    }
    /**
     * NOT part of the key protocol, and false on purpose -- an acknowledgeable,
     * arming-blocking CATCH_ALL warning is strictly stronger than a piece of
     * non-blocking advice, and answering true would show two messages for one
     * risk.
     */
    collidesWithOrdinarySearches() {
      return false;
    }

    /**
     * SIX CHARACTERS AT MOST.
     *
     * A catch-all claims LESS than a named key may be, and that is a domain
     * choice: fewer ordinary searches leave the engines for the Jira instance. A
     * key of 7 to 20 characters stays perfectly usable -- DECLARED BY NAME, where
     * its rule is a literal and costs nothing. Same gesture as separators()
     * below, and the same reason: a finite list cannot cover the infinite space
     * of human queries, so the shape is narrowed instead.
     *
     * What RE2 thinks of it is NOT written here. Re2Budget owns that measurement
     * and a changelock checks this number against it: the domain proposes, the
     * foreign system says whether it can carry.
     *
     * NOT part of the ShortcutKey protocol, and deliberately carried by
     * CatchAllKey ALONE. On a ProjectKey the honest answer to "your key length
     * ceiling" would be its own length, not 20 -- two contracts under one name,
     * a substitution violation a typeof test would never see. Its only reader is
     * claim() below; see shortcut-key.js for why it stays outside.
     */
    claimsKeysUpTo() {
      return 6;
    }

    /**
     * ONE question, THREE answers -- never a `false` with two causes.
     *
     * jump-policy.js used to recombine two facts in the right order from the
     * outside (`reaches(...) && ReservedPrefix.has(...)`): a convention between
     * two files. The refusal code is born where the reason is known.
     *
     * THIS VERDICT IS ABOUT THE KEY, NEVER ABOUT THE POLICY. `RESERVED_PREFIX` is
     * also the code claimantFor and JumpPreview return, which is good shared
     * language -- but there it means "the catch-all WOULD have claimed it and a
     * prefix held it back", a policy result that presupposes armed, acknowledged,
     * unshadowed and the right separator. Promoting this verdict to a diagnosis
     * requires eligibility.
     *
     * LENGTH IS TESTED BEFORE THE LIST, and that order is what keeps the domain
     * and the simulator in agreement: a reserved prefix beyond the bound must
     * read NO_MATCH, not RESERVED_PREFIX, because neither the prio 1 rule nor the
     * prio 2 guard can fire on it. The order has no teeth today -- every one of
     * the 49 prefixes is within reach, IPHONE at exactly six -- so it is written
     * here rather than left to be "simplified" by inversion.
     */
    verdictFor(projectKey) {
      // The header of captures() has always promised "a ProjectKey, never a
      // string", and nothing held it: "HTTP".toString() works. Now that EVERY
      // "does this leave for the Jira instance" decision funnels through this one
      // method, the line is worth its line.
      if (!(projectKey instanceof global.ProjectKey)) {
        throw new TypeError("verdictFor takes a ProjectKey, never a string");
      }
      const written = projectKey.toString();
      if (written.length > this.claimsKeysUpTo()) return VERDICTS.OUT_OF_REACH;
      // THE SECURITY QUESTION, by its own name. Reading `has` here made this
      // refusal and the options page's polite warning look like one rule; removing
      // a word for a UI reason would silently widen an outbound flow.
      if (global.ReservedPrefix.neverClaimedByCatchAll(written)) return VERDICTS.RESERVED_PREFIX;
      return VERDICTS.CLAIMED;
    }

    /**
     * Takes a ProjectKey, never a string. So a catch-all can only ever claim
     * what ProjectKey.parse has already accepted: the closed character set still
     * governs it. It was reused, not widened -- and since this batch, A LENGTH
     * governs it too, and it is CatchAllKey's length, not ProjectKey's.
     */
    captures(projectKey) {
      return this.verdictFor(projectKey) === VERDICTS.CLAIMED;
    }

    /**
     * The reserved prefixes THIS catch-all would reach if they were not reserved.
     *
     * "claim" and "reach" are the SAME idea on purpose: the key claims up to a
     * length, and the prefixes are within reach of that claim. One concept, two
     * points of view -- the key's and the list's.
     *
     * IT GAINS NOTHING TODAY: the longest reserved prefix is six characters, so
     * this returns all 49. It exists so that LOWERING the bound tomorrow stays
     * safe without touching the catalogue. One does not bill the fire one
     * prevented.
     */
    prefixesWithinReach() {
      return global.ReservedPrefix.withinLength(this.claimsKeysUpTo());
    }

    /**
     * THE HYPHEN ONLY, and this is a security decision rather than a detail.
     *
     * With the space and %20 separators a catch-all would claim "anything I type
     * as two tokens whose second is a number": SALARY 2024, BUDGET 2026, LOI
     * 2024, WINDOWS 11. Those leave for the Jira instance and land in its access
     * logs as /browse/SALARY-2024 -- an outbound data flow, not an availability
     * nuisance. A finite list cannot cover the infinite space of human queries,
     * so the separator is narrowed instead.
     *
     * Named keys keep all three: they are declared one by one, hence consented
     * to one by one.
     */
    separators() {
      return ["-"];
    }

    /** exampleKey(), never the key itself -- and SIX characters, because "EXAMPLE"
     *  was seven: the line showed as an example a key its own rule no longer
     *  claims. A changelock in the tests forbids the recurrence generically:
     *  captures(exampleKey()) must hold. */
    exampleKey() {
      return global.ProjectKey.parse("SAMPLE").value;
    }

    /**
     * WHAT THIS KEY CLAIMS: any key up to a length, and no literal of its own.
     *
     * NOT a regex fragment. The first attempt had this method emit one -- and, to
     * honour "the domain proposes, the foreign system says whether it can carry",
     * call Re2Budget from `core/`. That created the project's only live
     * core -> interception dependency, in the batch that removed the other one.
     * The proposal belongs here; the asking belongs on the other side, where the
     * refusal already has a channel (`skipped`).
     */
    claim() {
      return { anyKeyUpTo: this.claimsKeysUpTo() };
    }

    toJSON() {
      return WRITTEN_FORM;
    }
  }

  const only = new CatchAllKey();

  /** A value object with no state has exactly one instance. */
  CatchAllKey.only = function () {
    return only;
  };

  /**
   * The bound, READABLE WITHOUT MINTING A KEY.
   *
   * The options page needs it to write its own sentence, and it may not call
   * CatchAllKey.only(): a structure test forbids that file from turning anything
   * into a catch-all key, because the single door that does so must stay out of
   * the surface where the user types. A frozen number crosses that line safely
   * where an instance would not.
   */
  Object.defineProperty(CatchAllKey, "CLAIMS_KEYS_UP_TO", {
    value: only.claimsKeysUpTo(), writable: false, configurable: false, enumerable: true,
  });

  Object.defineProperty(CatchAllKey, "VERDICTS", {
    value: VERDICTS, writable: false, configurable: false, enumerable: true,
  });

  global.CatchAllKey = CatchAllKey;
})(globalThis);
