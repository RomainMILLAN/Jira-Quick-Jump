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
          // Labels, for RuleSet's invariant and for the preview. Stripped before
          // the rules reach the platform.
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
      return RuleSet.sealed({ units, skipped, contract });
    },

  };

  global.RuleFactory = RuleFactory;
})(globalThis);
