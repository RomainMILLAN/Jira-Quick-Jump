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
        // THE CHECK MUST ASK THE QUESTION THE RULE ACTUALLY POSES, and both
        // options were left out -- each defaulting to the OPPOSITE of what every
        // rule here does (verified against the API reference):
        //
        //   isCaseSensitive  defaults to TRUE, while every condition sets
        //                    isUrlFilterCaseSensitive: false, so that abc-1 lands
        //                    on /browse/ABC-1;
        //   requireCapturing defaults to FALSE, while every redirect rule carries
        //                    a regexSubstitution with backreferences -- two of
        //                    them for a catch-all.
        //
        // Both cost RE2 memory, so a regex can be supported bare and refused as
        // the rule needs it. Asked bare, the call vouches for an expression we
        // never install, and it FAILS OPEN: the rule reaches updateDynamicRules,
        // which rejects THE WHOLE BATCH. Rules are replaced wholesale, so one
        // over-budget regex would take every other shortcut down with it instead
        // of being the single skipped entry the design promises.
        //
        // Derived from the rule rather than restated, so the two can never drift.
        const substitutes =
          rule.action.type === "redirect" &&
          Boolean(rule.action.redirect && rule.action.redirect.regexSubstitution);
        const check = await dnr().isRegexSupported({
          regex: rule.condition.regexFilter,
          isCaseSensitive: rule.condition.isUrlFilterCaseSensitive,
          requireCapturing: substitutes,
        });
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
