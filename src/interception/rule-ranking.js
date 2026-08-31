/**
 * Who wins, and the SOLE owner of the word `priority`.
 *
 * THREE CONSTANT BANDS, not a comb of two hundred slots. The previous design
 * derived a priority from each shortcut's position, which was machinery to
 * arbitrate A CONFLICT THAT CANNOT HAPPEN. Unroll what is actually installed:
 *
 *   - named keys, which can NEVER overlap each other (the regexFilter demands a
 *     separator immediately after the key, and the registry refuses duplicates);
 *   - all of them ABOVE the catch-all, since anything below it is shadowed and
 *     produces no rule at all;
 *   - one reserved-prefix `allow` per engine;
 *   - at most ONE catch-all.
 *
 * So there are exactly two arbitration frontiers, and three integers express
 * them. What that removes is not comfort: it removes an ARITHMETIC whose
 * correctness depended on MAX_SHORTCUTS, i.e. an infrastructure fact that had
 * leaked up into the core. Three constants are checkable by eye.
 *
 * The bands, and why each must beat the next:
 *
 *   NAMED (3)     must beat RESERVED, or a user whose project really is called
 *                 API would lose api-42 to the reserved-prefix rule.
 *   RESERVED (2)  must beat CATCH_ALL, which is the whole point of the allow.
 *   CATCH_ALL (1) is the net.
 *
 * Across bands the documentation is identical in Chrome and Firefox: the higher
 * priority wins REGARDLESS of the action type. Action-type precedence
 * (allow > block > upgradeScheme > redirect) only ever breaks a tie, and we are
 * careful never to depend on it.
 */
(function (global) {
  "use strict";

  const NAMED = 3;
  const RESERVED_PREFIX = 2;
  const CATCH_ALL = 1;

  // DNR requires an integer >= 1, so the floor is asserted rather than assumed.
  for (const band of [NAMED, RESERVED_PREFIX, CATCH_ALL]) {
    if (!Number.isInteger(band) || band < 1) throw new Error("a priority band must be an integer >= 1");
  }
  if (!(NAMED > RESERVED_PREFIX && RESERVED_PREFIX > CATCH_ALL)) {
    throw new Error("the priority bands must be strictly ordered");
  }

  const RuleRanking = {
    NAMED,
    RESERVED_PREFIX,
    CATCH_ALL,

    forKey(key) {
      return key.isCatchAll() ? CATCH_ALL : NAMED;
    },

    forReservedPrefixes() {
      return RESERVED_PREFIX;
    },

    /**
     * The documented same-priority order, restricted to the two action types we
     * emit. An unknown action THROWS rather than sorting as undefined.
     */
    rankOfAction(type) {
      if (type === "allow") return 1;
      if (type === "redirect") return 0;
      throw new Error("unknown action type: " + type);
    },

    /**
     * The winner among matching rules, mirroring the documented algorithm and
     * nothing more.
     *
     * `NON_DETERMINISTIC` is a CANARY, and it must stay unreachable: the
     * predicate is "same priority, same action, AND A DIFFERENT DESTINATION".
     * Without that last clause, a user who ticks google.com and also adds a
     * custom google.com domain would get two identical rules and see their
     * options page break -- a fail-open through the fail-fast door.
     */
    winner(matches) {
      if (matches.length === 0) return { code: "NO_MATCH" };
      const ranked = [...matches].sort((a, b) => {
        if (b.rule.priority !== a.rule.priority) return b.rule.priority - a.rule.priority;
        return RuleRanking.rankOfAction(b.rule.action.type) - RuleRanking.rankOfAction(a.rule.action.type);
      });
      const best = ranked[0];
      const tied = ranked.filter(
        (m) =>
          m.rule.priority === best.rule.priority &&
          m.rule.action.type === best.rule.action.type &&
          m.destination !== best.destination
      );
      if (tied.length > 0) return { code: "NON_DETERMINISTIC" };
      return { code: "WINNER", match: best };
    },
  };

  global.RuleRanking = RuleRanking;
})(globalThis);
