/**
 * Installs the policy as DNR rules, and reports the INSTALLED REALITY rather
 * than the intention.
 */
(function (global) {
  "use strict";

  const { Platform, RuleFactory, SearchEngineCatalog, OriginRequirements } = global;
  const dnr = () => Platform.api.declarativeNetRequest;

  let pending = null;
  let queued = null;

  const RuleInstaller = {
    /**
     * Single-slot queue, last request wins. storage.onChanged and
     * permissions.onAdded can fire almost simultaneously, and two interleaved
     * wholesale replacements would transiently empty the rules -- precisely when
     * the user has just granted access and is testing.
     */
    async install(policy) {
      if (pending) {
        queued = policy;
        return pending;
      }
      pending = this._install(policy).finally(() => {
        pending = null;
        const next = queued;
        queued = null;
        if (next) this.install(next);
      });
      return pending;
    },

    async _install(policy) {
      const { rules, skipped } = RuleFactory.buildRules(policy, SearchEngineCatalog);
      const supported = [];
      for (const rule of rules) {
        const check = await dnr().isRegexSupported({ regex: rule.condition.regexFilter });
        if (check.isSupported) supported.push(rule);
        else skipped.push({ binding: rule.id, code: "REGEX_UNSUPPORTED" });
      }
      // Wholesale replacement: an Idempotent Receiver. Syncing three times gives
      // the same state, and deleting the last shortcut cleans up for free.
      const existing = await dnr().getDynamicRules();
      await dnr().updateDynamicRules({
        removeRuleIds: existing.map((r) => r.id),
        addRules: supported,
      });
      return this.report(policy, skipped);
    },

    /**
     * Rules are installed even when the required origins are missing: a redirect
     * rule without host access simply never fires, and becomes active on its own
     * the moment permission is granted, with no further sync.
     */
    async report(policy, skipped = []) {
      const origins = OriginRequirements.requiredOrigins(policy, SearchEngineCatalog);
      const originsGranted = await Platform.grantedOrigins(origins);
      const applied = (await dnr().getDynamicRules()).length;
      return {
        applied,
        diagnosis: policy.diagnose({ originsGranted }),
        skipped,
        missingOrigins: originsGranted ? [] : origins,
      };
    },
  };

  global.RuleInstaller = RuleInstaller;
})(globalThis);
