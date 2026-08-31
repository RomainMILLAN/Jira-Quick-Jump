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
  // ids are free and `engineIndex` indexing policy.engineIds() has no
  // consequence beyond being stable within one build.
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
    buildRules(policy, catalog) {
      const units = [];
      const skipped = [];
      const engineIndex = new Map(policy.engineIds().map((id, i) => [id, i]));
      const catchAllEngines = new Set();

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
          catchAllEngines.add(binding.engineId());
          units.push([rule]);
        } else {
          units.push([rule]);
        }
      }

      // Only where a catch-all is actually active: without one, these would kill
      // a shortcut legitimately named API for nothing.
      for (const engineId of catchAllEngines) {
        const engine = catalog.find(engineId);
        if (!engine) continue;
        const guard = {
          id: RESERVED_RULE_ID_BASE + (engineIndex.get(engineId) ?? 0),
          priority: RuleRanking.forReservedPrefixes(),
          action: { type: "allow" },
          condition: condition(engine.searchUrlPattern(ReferencePattern.reservedPrefixPattern())),
          engineId,
          isCatchAll: false,
        };
        // The catch-all of THIS engine and its guard form one unit: neither can
        // be installed without the other.
        const unit = units.find((u) => u.length === 1 && u[0].isCatchAll && u[0].engineId === engineId);
        if (unit) unit.push(guard);
        else units.push([guard]);
      }

      return new RuleSet(units, skipped).assertReservedPrefixesCoverEveryCatchAll();
    },

    RESERVED_RULE_ID_BASE,
  };

  global.RuleFactory = RuleFactory;
})(globalThis);
