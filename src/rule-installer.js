/**
 * Installs the policy as DNR rules, and reports the INSTALLED REALITY rather
 * than the intention.
 */
(function (global) {
  "use strict";

  const { Platform, RuleFactory, SearchEngineCatalog, OriginRequirements, Re2Budget } = global;
  const dnr = () => Platform.api.declarativeNetRequest;

  /**
   * THE SINGLE-SLOT QUEUE, and the three bugs it used to carry.
   *
   * (a) `quarantinedCount` WAS LOST ON REPLAY: the slot held the policy alone and
   *     the replay called install(next) with one argument, so a re-run silently
   *     re-defaulted the count to 0 and PARTIAL_POLICY could not fire. The slot
   *     therefore holds the PAIR.
   *
   * (b) THE COALESCED CALLER RECEIVED THE PREVIOUS REPORT: `return pending` hands
   *     back the run ALREADY IN FLIGHT, which does not include the request just
   *     made. A naive `return pending.then(...)` still returns the old one. So a
   *     SHARED DEFERRED, RE-ARMED AT EVERY REPLAY: everyone who coalesced onto the
   *     same slot gets the result of the run that actually reflects it.
   *
   * (c) THE REPLAY PROMISE WAS ABANDONED: `if (next) this.install(next)` dropped
   *     its promise on the floor, so a rejection there surfaced nowhere. With a
   *     single driver draining the slot, every outcome reaches a waiter -- which is
   *     also what makes a throw from report()'s own getDynamicRules OBSERVABLE
   *     instead of mute.
   *
   * The slot is a TAGGED UNION -- a pair for the install, a replacement for the
   * purge -- because THE PURGE PRIMES: it does not coalesce, it replaces and
   * empties the slot. Otherwise the fail-closed gesture would be cancelled by the
   * very queue meant to protect it.
   */
  let pending = null;
  let queued = null;
  let deferred = null;

  const defer = () => {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };

  const RuleInstaller = {
    /**
     * storage.onChanged and permissions.onAdded can fire almost simultaneously,
     * and two interleaved wholesale replacements would transiently empty the
     * rules -- precisely when the user has just granted access and is testing.
     */
    async install(policy, quarantinedCount = 0) {
      return this._enqueue({ kind: "INSTALL", policy, quarantinedCount });
    },

    /**
     * FAIL CLOSED, through the SAME queue, and it returns NOTHING.
     *
     * It used to live in background.js, which is why the single-writer pin was
     * green while the violation shipped: that pin only ever read this file.
     *
     * No report, no policy, no permission probe. An earlier design had it produce
     * one so that "lastReport keeps a single shape" -- but lastReport is gone, and
     * following the fibres afterwards showed the purge's report had NO READER LEFT:
     * not sync() (the early return precedes the guard), not the badge (which ASKS
     * for the count), not the UI. So nothing here builds a JumpPolicy.empty(), and
     * "nothing leaks" becomes STRUCTURAL rather than measured.
     */
    async purge() {
      await this._enqueue({ kind: "PURGE" });
    },

    /**
     * What is REALLY installed, asked at the moment the answer is needed.
     *
     * Not `appliedCount()`: `applied` is the past tense of the last installation,
     * and a name must say WHEN it answers. This one answers about the present, and
     * it is what lets a failed purge stop saying `off`.
     *
     * It THROWS when the platform refuses, and the badge's guard turns that into
     * "never off" rather than into a reassuring zero.
     */
    async installedRuleCount() {
      const rules = await dnr().getDynamicRules();
      return rules.length;
    },

    _enqueue(slot) {
      // LAST REQUEST WINS, the purge included -- and the purge arriving last is
      // exactly the case that must not be coalesced away.
      queued = slot;
      if (!deferred) deferred = defer();
      const waiting = deferred.promise;
      if (!pending) {
        pending = this._drain().finally(() => {
          pending = null;
        });
      }
      return waiting;
    },

    /**
     * The single driver. One slot in flight at a time, and every slot's outcome --
     * value or throw -- handed to the callers who coalesced onto it.
     */
    async _drain() {
      while (queued) {
        const slot = queued;
        const waiters = deferred;
        queued = null;
        deferred = null;
        try {
          const outcome = slot.kind === "PURGE"
            ? await this._purge()
            : await this._install(slot.policy, slot.quarantinedCount);
          waiters.resolve(outcome);
        } catch (error) {
          waiters.reject(error);
        }
      }
    },

    async _purge() {
      const existing = await dnr().getDynamicRules();
      await dnr().updateDynamicRules({ removeRuleIds: existing.map((r) => r.id), addRules: [] });
    },

    async _install(policy, quarantinedCount = 0) {
      // `skipped` is declared BEFORE the try, because on a refusal `installable`
      // does not exist and the report below reads it. Otherwise the fix for a mute
      // throw is a mute TypeError at the same place.
      let skipped = [];
      let installed = true;
      let coverageSatisfied = true;
      try {
        const catalog = SearchEngineCatalog.forPolicy(policy);
        // The budget is RECEIVED here and handed down: only this file knows the
        // platform ENVELOPE -- rule-set.js now owns the payload SHAPE -- and the day
        // the envelope stops being ignorable it is
        // Re2Budget.forEnvelope() that has to reach the factory. Letting the
        // factory pick its own measurement would leave that Strategy without a
        // path.
        const set = RuleFactory.buildRules(policy, catalog, Re2Budget.conservative());
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
        // withoutRules replays the post-condition through the constructor, so the
        // explicit call that used to sit here is gone: two notes stuck on a
        // blister are still notes.
        const installable = set.withoutRules(unsupported);
        skipped = installable.skipped();
        coverageSatisfied = installable.coverageSatisfied();

        // Wholesale replacement: an Idempotent Receiver. Syncing three times gives
        // the same state, and deleting the last shortcut cleans up for free.
        //
        // AND THE BUILD IS INSIDE THIS try, which it was not: buildRules now
        // raises six named refusals, and outside the try they left sync() with no
        // report, no badge and no journal -- old rules still firing under an
        // unchanged badge. Safe (the previous set was sealed) but MUTE, and a
        // refusal has to be readable. INSTALL_FAILED is first in DIAGNOSES.
        //
        // A rejection leaves the call atomic: nothing changes, THE PREVIOUS RULES
        // STAY ALIVE, and the promise would otherwise surface in a listener where
        // nobody catches it. After this feature that is the KILL SWITCH breaking.
        const existing = await dnr().getDynamicRules();
        await dnr().updateDynamicRules({
          removeRuleIds: existing.map((r) => r.id),
          // THE SOLE COUNTER. The nominative deny-list that used to live here is gone
          // with its risk: an allowlist derived from the DNR spec cannot miss a label
          // the way a hand-maintained list of three could. This file keeps the
          // ENVELOPE; rule-set.js owns the payload shape.
          addRules: installable.platformRules(),
        });
      } catch (error) {
        installed = false;
        // A refusal carries its named cause; anything else is UNKNOWN rather than
        // being blamed on one of the six.
        const reason = error instanceof Re2Budget.Refusal
          ? error.reason
          : Re2Budget.REASONS.UNKNOWN;
        skipped = [...skipped, { code: "CONSTRUCTION_REFUSED", reason }];
        coverageSatisfied = false;
      }
      return this.report(policy, skipped, quarantinedCount, { installed, coverageSatisfied }, "INSTALL");
    },

    /**
     * Rules are installed even when the required origins are missing: a redirect
     * rule without host access simply never fires, and becomes active on its own
     * the moment permission is granted, with no further sync.
     */
    /**
     * `source` is a FIFTH NAMED PARAMETER WITH NO DEFAULT.
     *
     * With a default, the two call sites that forget it leave `undefined` -- the
     * MEANINGFUL ABSENCE the discriminant exists to abolish -- and a default of
     * "INSTALL" would have the options page declare an installation it never
     * performed. Today the two sites are _install and section-host.js; "PURGE" is
     * UNREACHABLE, since purge() produces no report at all. What the field buys is
     * therefore a CHANGELOCK, not the closing of a fail-open: no caller can reach
     * the projection guard with another source, and the factorisation that would
     * make it possible goes RED.
     *
     * NO SPREAD, AT EITHER END. An earlier version closed the spread on the way
     * OUT and reprinted it on the way IN, two lines above -- with `...reality`
     * AFTER rulesInstalled, therefore overwriting THE ONLY NON-FORGEABLE FACT of
     * the four, the one the INSTALL_STATE_UNKNOWN guard rests on. Measured:
     *
     *   { installedRuleCount: 3, ...{ installedRuleCount: 99 } }  ->  99
     *   { applied, rules, ...reality }  ->  {"applied":99,"rules":["FORGED RULE"]}
     *
     * And report.rules HAS A CONSUMER THAT PAINTS: the preview section hands it to
     * JumpPreview and displays url.origin. So { installed: true, rules: [forged] }
     * would paint an arbitrary destination in the preview -- the organ built to be
     * faithful, and the only place the user can check where ABC-1 goes. The
     * verifiable control would become the channel of the lie, with the preview's
     * authority behind it.
     */
    async report(policy, skipped = [], quarantinedCount = 0, reality = {}, source) {
      const origins = OriginRequirements.requiredOrigins(policy, SearchEngineCatalog.forPolicy(policy));
      const originsGranted = await Platform.grantedOrigins(origins);
      const rules = await dnr().getDynamicRules();
      const applied = rules.length;
      // The quarantine count has to travel all the way here, or PARTIAL_POLICY
      // can never fire and the parameter is decoration: a configuration missing
      // entries would report itself as merely lacking permissions.
      const diagnosis = policy.diagnose({
        originsGranted,
        quarantinedCount,
        // The facts of installed reality enter AS THEY ARE. Naming introduces no
        // default -- reality.installed is undefined when the fact is missing, and
        // `typeof f.installed !== "boolean"` reads exactly that.
        installed: reality.installed,
        coverageSatisfied: reality.coverageSatisfied,
        // A FOURTH FACT comes through the door, the only NON-FORGEABLE one of the
        // four -- computed three lines above, under the name `applied`. It serves
        // the INSTALL_STATE_UNKNOWN guard.
        //
        // AND IT ENTERS AS A BOOLEAN, NOT A NUMBER. quarantinedCount counts things
        // OF THE DOMAIN, which the catalogue does COMMENSURABLE arithmetic with. A
        // count of DNR rules is commensurable with NOTHING the domain owns:
        // activeBindings().length is not the number of installed rules, since the
        // reserved-prefix allows add one per engine and pruned regexes remove
        // some. The only honest test is `> 0`, forever -- so the counting
        // convention stays IN THE AIRLOCK and the domain receives a yes/no.
        //
        // LAST, and therefore not overwritable by anything above it.
        rulesInstalled: applied > 0,
      });
      return {
        // The DISCRIMINANT, always present.
        source,
        // The aggregate root travels, licit because immutable -- but the derogation
        // is named: the day a setter appears, this field becomes a handle on live
        // state.
        policy,
        applied,
        // The rules AS INSTALLED, so the preview simulates the delivered
        // programme rather than the intended one -- and so the badge and the
        // preview share one owner of "what is really installed".
        rules,
        installed: reality.installed,
        coverageSatisfied: reality.coverageSatisfied,
        diagnosis,
        skipped,
        missingOrigins: originsGranted ? [] : origins,
      };
    },
  };

  global.RuleInstaller = RuleInstaller;
})(globalThis);
