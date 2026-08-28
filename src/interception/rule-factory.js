/**
 * Builds the DNR rules. One rule per binding.
 *
 * It COMPOSES the two sides of the airlock instead of writing a monolithic
 * regex: what an issue reference looks like (core) and how this engine encodes a
 * search (interception). The emitted regex is identical to a hand-written
 * concatenation, but the knowledge has two separately testable homes.
 */
(function (global) {
  "use strict";

  const { ReferencePattern } = global;

  const RuleFactory = {
    buildRules(policy, catalog) {
      const rules = [];
      const skipped = [];

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
        rules.push({
          id: binding.ruleId(),
          priority: 1,
          action: {
            type: "redirect",
            redirect: { regexSubstitution: ReferencePattern.substitutionFor(shortcut.instance(), key) },
          },
          condition: {
            regexFilter: engine.searchUrlPattern(ReferencePattern.patternFor(key)),
            // Case-insensitive so that abc-123 matches; the substitution writes
            // the key in upper case, so the destination stays correct. Not
            // obvious, hence written down.
            isUrlFilterCaseSensitive: false,
            // A SECURITY CONTROL, not a detail. If rules applied to
            // sub-resources, any web page could do:
            //   <img src="https://www.google.com/search?q=ABC-1" onload=... onerror=...>
            // and learn, with no permission and no interaction, that the
            // extension is installed, which project keys are configured (product
            // and customer names), which internal host names exist and answer,
            // and their latency. That is a partial map of the visitor's intranet,
            // exfiltrated in milliseconds. Never widen this, and never use
            // excludedResourceTypes.
            resourceTypes: ["main_frame"],
          },
        });
      }
      return { rules, skipped };
    },
  };

  global.RuleFactory = RuleFactory;
})(globalThis);
