/**
 * Builds the DNR rules. One rule per binding, plus one reserved-prefix rule per
 * engine that carries a catch-all.
 *
 * It COMPOSES the two sides of the airlock instead of writing a monolithic
 * regex: what an issue reference looks like (core) and how this engine encodes a
 * search (interception). The emitted regex is identical to a hand-written
 * concatenation, but the knowledge has two separately testable homes.
 *
 * It stays a projection: the ONLY branch on the nature of a key lives in
 * ReferencePattern.forKey, which reports its own arity. This file never asks
 * whether a key is a catch-all in order to build a pattern -- it only labels the
 * rule so RuleSet can hold its invariant.
 */
(function (global) {
  "use strict";

  const { ReferencePattern, RuleRanking, RuleSet } = global;

  // Rule ids in bands, so a collision is impossible by construction and the
  // debugging stays readable. Rules are replaced wholesale on every sync, so the
  // ids are free.
  //
  // THE BAND MATTERS FOUR TIMES MORE SINCE THE GUARD WAS CUT. Bindings run
  // 1..MAX_BINDINGS (300), because binding.ruleId() is _ruleIndex + 1; guards now
  // number engines x runs -- at most 24 x 4 = 96 -- so they occupy [1001, 1096].
  // No overlap, and RuleSet asserts that all ids are distinct, which covers the
  // monotonic counter that nothing else keeps inside its band.
  const RESERVED_RULE_ID_BASE = 1001;

  const condition = (regexFilter) => ({
    regexFilter,
    // Case-insensitive so that abc-123 matches. For a named key the substitution
    // writes the key in upper case, so the destination stays correct. For the
    // catch-all the key is a backreference, so the typed case is forwarded and
    // Jira canonicalises it -- pinned by a test rather than left silent.
    isUrlFilterCaseSensitive: false,
    // A SECURITY CONTROL, not a detail. If rules applied to sub-resources, any
    // web page could do:
    //   <img src="https://www.google.com/search?q=ABC-1" onload=... onerror=...>
    // and learn, with no permission and no interaction, that the extension is
    // installed, which project keys are configured (product and customer names),
    // which internal host names exist and answer, and their latency. That is a
    // partial map of the visitor's intranet, exfiltrated in milliseconds. Never
    // widen this, and never use excludedResourceTypes.
    resourceTypes: ["main_frame"],
  });

  const RuleFactory = {
    buildRules(policy, catalog, budget) {
      const units = [];
      const skipped = [];
      // ONE source of truth for "is there an active catch-all". policy
      // .catchAllShortcut() is true as soon as the LINE EXISTS, while this is
      // filled from activeBindings() -- armed, acknowledged, unshadowed. A
      // disarmed catch-all is the state every catch-all passes through, since
      // warnCatchAll is the text one acknowledges IN ORDER to arm; letting the
      // refusals run there would purge the user's named shortcuts because of a
      // line they never armed.
      //
      // { key, engineIds } rather than a Map<engineId, key>: catchAll() is
      // SINGULAR, so a map would carry the same value once per engine with a
      // uniformity invariant asserted nowhere.
      let catchAll = null;

      for (const binding of policy.activeBindings()) {
        const engine = catalog.find(binding.engineId());
        if (!engine) {
          // The core only holds opaque engine ids, so it cannot check that one
          // exists. Filtering is the airlock's job: translate AND filter.
          skipped.push({ binding, code: "UNKNOWN_ENGINE" });
          continue;
        }
        const shortcut = binding.shortcut();
        const key = shortcut.key();
        const shape = ReferencePattern.forKey(key);
        const rule = {
          id: binding.ruleId(),
          priority: RuleRanking.forKey(key),
          action: {
            type: "redirect",
            redirect: { regexSubstitution: shape.substitutionFor(shortcut.instance()) },
          },
          condition: condition(engine.searchUrlPattern(shape.pattern)),
          // Labels, for RuleSet's invariant and for the journal. Stripped before the
          // rules reach the platform.
          //
          // NOT "for the preview" any more: the preview reads the BAND through
          // RuleRanking.isCatchAllRule, because it is fed the rules READ BACK from the
          // store, where no label survives. Leaving that word here would justify a
          // field by a reader who no longer exists -- the exact exit this file warns
          // about below.
          engineId: binding.engineId(),
          isCatchAll: key.isCatchAll(),
        };
        if (key.isCatchAll()) {
          if (catchAll === null) catchAll = { key, engineIds: [] };
          catchAll.engineIds.push(binding.engineId());
        }
        units.push([rule]);
      }

      // Only where a catch-all is actually active: without one, these would kill
      // a shortcut legitimately named API for nothing. The guards are cut ONCE --
      // the runs do not depend on the engine, only the envelope does.
      const guards = catchAll
        ? ReferencePattern.reservedPrefixGuards(catchAll.key, budget)
        : [];
      let nextGuardId = RESERVED_RULE_ID_BASE;
      for (const engineId of catchAll ? catchAll.engineIds : []) {
        const engine = catalog.find(engineId);
        if (!engine) continue;
        // engineIds is only filled after the binding loop's own `if (!engine)
        // continue`, so the unit exists. Written down because it is one edit away
        // from being an undefined.push.
        const unit = units.find((u) => u[0].isCatchAll && u[0].engineId === engineId);
        // The catch-all of THIS engine and its guards form one unit: none can be
        // installed without the others. THE UNIT IS NOW FIVE RULES INSTEAD OF TWO,
        // so a single over-budget run kills the catch-all OF THAT ENGINE -- still
        // graceful per engine, but the per-engine chance of falling quadruples.
        unit.push(...guards.map((guard) => ({
          id: nextGuardId++,
          priority: RuleRanking.forReservedPrefixes(),
          action: { type: "allow" },
          condition: condition(engine.searchUrlPattern(guard.pattern)),
          engineId,
          isCatchAll: false,
          // WHY THIS LABEL ESCAPES THE OBJECTION MADE TO CARRYING A KEY HERE: it
          // is not a domain ENTITY, it is an array of shipped strings, and the
          // final set's post-condition NEEDS it -- a sealed blister is checked
          // sealed. Without this sentence someone applies the objection uniformly,
          // removes the field, and the coverage check goes quietly green.
          guardedPrefixes: guard.prefixes,
        })));
      }

      // THE CONTRACT COMES FROM THE DOMAIN, and the empty truck still gets a
      // docket: without empty(), a null catch-all would throw a TypeError on the
      // MAJORITY path -- every profile without a catch-all, on every sync.
      const contract = catchAll
        ? new global.CoverageContract(catchAll.key.prefixesWithinReach(), catchAll.engineIds)
        : global.CoverageContract.empty();
      const set = RuleSet.sealed({ units, skipped, contract });

      // THE BAND POST-CONDITION, both ways, where the two facts still coexist.
      //
      // `isCatchAll => band CATCH_ALL` is the natural direction to write; it is the
      // OTHER one the simulator infers, so both are asserted. Asked through
      // RuleRanking.isCatchAllRule and never by reading `priority` here: this file must
      // not start reading the field whose sole owner is the ranking module.
      //
      // TOTAL -- every rule of the set -- because since platformRules() derives from
      // PLATFORM_FIELDS, the emitted object always carries the four keys and the test's
      // `k in r` can no longer catch a rule forged without a band. This throw is what
      // guards the CONTENT, upstream of the counter.
      //
      // THIS IS A CHANGELOCK, NOT A PROOF: on redirect rules `priority` and `isCatchAll`
      // derive from the same expression, so the equivalence is true by construction and
      // green forever. It has real content on the GUARDS -- two independent literals --
      // and on the day a fourth band appears.
      for (const rule of set.rules()) {
        if (RuleRanking.isCatchAllRule(rule) !== rule.isCatchAll) {
          throw new Error("a rule's band and its catch-all label disagree: " + rule.id);
        }
      }
      return set;
    },

  };

  global.RuleFactory = RuleFactory;
})(globalThis);
