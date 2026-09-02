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
     * The BAND PREDICATE, and it FAILS LOUD.
     *
     * Not "the inverse of forKey": forKey only ever produces NAMED and CATCH_ALL, the
     * RESERVED_PREFIX band coming from forReservedPrefixes(). What founds the predicate
     * is that there is exactly ONE producer of CATCH_ALL -- IN OUR OWN FORGE. See the
     * reservation below, which is the argument for the next batch.
     *
     * Returning `false` on an absent priority would signal MATCHED_SHORTCUT: the LEAST
     * alarming label, against the detector doctrine of background.js. And rankOfAction,
     * in this very file, already throws on an unknown action -- so the gesture is the
     * house's.
     *
     * THE THROW IS A CANARY, AND IT FAILS LOUD WHERE SOMEONE IS LISTENING: inside
     * _install's try, where it yields INSTALL_FAILED. On the PREVIEW path it is MUTE --
     * a floating promise, and there is not one try/catch/unhandledrejection in
     * options-sections.js, options.js or section-host.js: the panel keeps the text of
     * the previous keystroke, typically "Matched a named shortcut". THAT is why the
     * boundary normalises BEFORE calling here; the throw is not the net. (rankOfAction
     * has exactly this defect today, on an unknown action.)
     *
     * RESERVATION -- the invariant is true in the forge and READ on a FOREIGN store.
     * `git grep priority v1.0.0 -- src/` shows the shipped v1.0.0 writing `priority: 1`
     * explicitly on every rule, and it has no catch-all at all. So on a profile coming
     * up from v1.0.0 this answers `true` for 100% of the rules, every one of them a
     * NAMED shortcut -- and the boundary's normalisation is blind to it, 1 being a
     * perfectly valid band. The window survives a failed install, since a rejection
     * leaves the previous rules alive.
     *
     * NOT BLOCKING, for two opposable reasons: it is OVER-signalling (MATCHED_CATCH_ALL
     * is the most alarming label, and destination/ruleId stay CORRECT), and the v1.0.0
     * rule set contains no catch-all, so in that window no ordinary search leaves for
     * the Jira instance. The sentence lies by accusing the extension of a flow it does
     * not have. It is the argument for a total-constructor value object on a rule read
     * back -- not a refactoring bonus.
     */
    isCatchAllRule(rule) {
      if (!Number.isInteger(rule.priority)) throw new Error("a rule has no priority band");
      return rule.priority === CATCH_ALL;
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
      // band() and actionType(), not the raw DNR fields: the signature is
      // UNCHANGED -- it still receives { rule, destination, subject } and arbitrates
      // on m.destination, a datum that is not on the rule -- and InstalledRule
      // replaces the primitive INSIDE each match.
      const ranked = [...matches].sort((a, b) => {
        if (b.rule.band() !== a.rule.band()) return b.rule.band() - a.rule.band();
        return RuleRanking.rankOfAction(b.rule.actionType()) - RuleRanking.rankOfAction(a.rule.actionType());
      });
      const best = ranked[0];
      const tied = ranked.filter(
        (m) =>
          m.rule.band() === best.rule.band() &&
          m.rule.actionType() === best.rule.actionType() &&
          m.destination !== best.destination
      );
      if (tied.length > 0) return { code: "NON_DETERMINISTIC" };
      return { code: "WINNER", match: best };
    },
  };

  global.RuleRanking = RuleRanking;
})(globalThis);
