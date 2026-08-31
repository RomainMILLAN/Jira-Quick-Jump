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
    async install(policy, quarantinedCount = 0) {
      if (pending) {
        queued = policy;
        return pending;
      }
      pending = this._install(policy, quarantinedCount).finally(() => {
        pending = null;
        const next = queued;
        queued = null;
        if (next) this.install(next);
      });
      return pending;
    },

    async _install(policy, quarantinedCount = 0) {
      const catalog = SearchEngineCatalog.forPolicy(policy);
      const set = RuleFactory.buildRules(policy, catalog);
      // The awaits happen HERE, and the atomicity decision is a synchronous
      // property of the set: a value object must not need a platform fake to be
      // tested.
      const unsupported = [];
      for (const rule of set.rules()) {
        const check = await dnr().isRegexSupported({ regex: rule.condition.regexFilter });
        if (!check.isSupported) unsupported.push(rule.id);
      }
      const installable = set.withoutRules(unsupported).assertReservedPrefixesCoverEveryCatchAll();

      // Wholesale replacement: an Idempotent Receiver. Syncing three times gives
      // the same state, and deleting the last shortcut cleans up for free.
      //
      // WRAPPED, because a rejection leaves the call atomic: nothing changes, THE
      // PREVIOUS RULES STAY ALIVE, and the promise would otherwise surface in a
      // listener where nobody catches it. After this feature that is the KILL
      // SWITCH breaking -- disarm-all builds an empty set, and a failed apply
      // would leave the catch-all claiming every search while the UI says off.
      let installed = true;
      try {
        const existing = await dnr().getDynamicRules();
        await dnr().updateDynamicRules({
          removeRuleIds: existing.map((r) => r.id),
          // The labels RuleSet needs are stripped before the platform sees them.
          addRules: installable.rules().map(({ engineId, isCatchAll, ...rule }) => rule),
        });
      } catch {
        installed = false;
      }
      return this.report(policy, installable.skipped(), quarantinedCount, {
        installed,
        catchAllInstalled: installable.catchAllInstalled(policy.catchAllShortcut() !== undefined),
      });
    },

    /**
     * Rules are installed even when the required origins are missing: a redirect
     * rule without host access simply never fires, and becomes active on its own
     * the moment permission is granted, with no further sync.
     */
    async report(policy, skipped = [], quarantinedCount = 0, reality = {}) {
      const origins = OriginRequirements.requiredOrigins(policy, SearchEngineCatalog.forPolicy(policy));
      const originsGranted = await Platform.grantedOrigins(origins);
      const rules = await dnr().getDynamicRules();
      const applied = rules.length;
      // The quarantine count has to travel all the way here, or PARTIAL_POLICY
      // can never fire and the parameter is decoration: a configuration missing
      // entries would report itself as merely lacking permissions.
      return {
        applied,
        // The rules AS INSTALLED, so the preview simulates the delivered
        // programme rather than the intended one -- and so the badge and the
        // preview share one owner of "what is really installed".
        rules,
        diagnosis: policy.diagnose({
          originsGranted,
          quarantinedCount,
          // The third fact through the door, and the only one that speaks of the
          // INSTALLED REALITY rather than the intention. Which is exactly why it
          // outranks everything, DISARMED included.
          installed: reality.installed === undefined ? true : reality.installed,
          catchAllInstalled: reality.catchAllInstalled === undefined ? true : reality.catchAllInstalled,
        }),
        skipped,
        missingOrigins: originsGranted ? [] : origins,
      };
    },
  };

  global.RuleInstaller = RuleInstaller;
})(globalThis);
