/**
 * Installs the policy as DNR rules, and reports the INSTALLED REALITY rather
 * than the intention.
 */
(function (global) {
  "use strict";

  const { Platform, RuleFactory, SearchEngineCatalog, OriginRequirements, Re2Budget, NotInstalled } = global;
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
   * (b-bis) EXCEPT A REQUEST THE PURGE PRIMED OVER: it is rejected with
   *     SUPERSEDED_BY_PURGE rather than handed the purge's own (empty) result.
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
  const defer = () => {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };

  /**
   * THE SINGLE-SLOT QUEUE, AS AN OBJECT.
   *
   * `pending`, `queued` and `deferred` were three module-level variables, so the
   * mechanism could not be instantiated twice, could not be isolated in a test,
   * and leaked between test cases -- a run that reached the deadlock this class
   * now closes poisoned every case after it.
   *
   * Three attributes, and the run() it is handed: the queue knows how to
   * coalesce and drain, and nothing about DNR.
   */
  class SingleSlot {
    constructor(run) {
      this._run = run;
      this._pending = undefined;
      this._queued = undefined;
      this._waiters = undefined;
    }

    /**
     * LAST REQUEST WINS -- EXCEPT OVER A PURGE.
     *
     * The header has always claimed "THE PURGE PRIMES", and the code did not do
     * it: the slot was overwritten uniformly, so
     *
     *   sync() fails -> purge()      -> slot = PURGE
     *   storage.onChanged -> sync()  -> slot = INSTALL   <- purge gone
     *
     * cancelled the fail-closed gesture with the very queue meant to carry it,
     * and both halves are reachable in one turn of the loop. A pending purge is a
     * decision already taken to install nothing; a later install is a decision
     * taken on older information.
     */
    accept(slot, primes) {
      // A REQUEST THE PURGE PRIMED OVER IS TOLD SO, never handed the purge's
      // result. It used to fall through to the shared waiter, so an install
      // dropped in favour of a queued purge resolved with `undefined` -- and
      // background.js reads `report.installed` one line after the await. The
      // outcome stayed fail-closed (the outer catch purges again), but a named
      // refusal was replaced by an anonymous TypeError, and the header's promise
      // that "everyone who coalesced gets the result of the run that reflects
      // them" was false in exactly this branch.
      if (this._queued && primes(this._queued) && !primes(slot)) {
        return Promise.reject(new Error("SUPERSEDED_BY_PURGE"));
      }
      this._queued = slot;
      if (!this._waiters) this._waiters = defer();
      const waiting = this._waiters.promise;
      this._pump();
      return waiting;
    }

    /**
     * Starts a drain, and GUARANTEES that a slot posted while one was unwinding
     * gets its own.
     *
     * The bug this closes was a DEADLOCK, reachable by the kill switch itself.
     * Clearing `pending` lands in a microtask, while a rejected waiter is resumed
     * BEFORE it: the run rejects, the waiter is rejected and the drain returns,
     * sync()'s catch calls purge() -- and purge() found the slot still busy, so it
     * filled it, returned a fresh promise, and NOBODY DRAINED IT. purge() never
     * settled, sync()'s finally never ran: no receipt, no badge, and THE OLD RULES
     * STILL FIRING.
     *
     * So the re-check happens where the answer is finally knowable.
     */
    _pump() {
      if (this._pending) return;
      this._pending = this._drain().finally(() => {
        this._pending = undefined;
        if (this._queued) this._pump();
      });
    }

    /** One slot in flight at a time, and every outcome -- value or throw -- handed
     *  to the callers who coalesced onto it. */
    async _drain() {
      while (this._queued) {
        const slot = this._queued;
        const waiters = this._waiters;
        this._queued = undefined;
        this._waiters = undefined;
        try {
          waiters.resolve(await this._run(slot));
        } catch (error) {
          waiters.reject(error);
        }
      }
    }
  }

  const isPurge = (slot) => slot.kind === "PURGE";

  /** ONE queue for the extension, created on first use -- but a queue that CAN be
   *  created twice, which is what makes it testable and what module-level
   *  variables made impossible. */
  let theSlot;
  const slot = () => {
    if (!theSlot) {
      theSlot = new SingleSlot((s) =>
        s.kind === "PURGE" ? RuleInstaller._purge() : RuleInstaller._install(s.policy, s.quarantinedCount)
      );
    }
    return theSlot;
  };

  const RuleInstaller = {
    SingleSlot,
    /**
     * storage.onChanged and permissions.onAdded can fire almost simultaneously,
     * and two interleaved wholesale replacements would transiently empty the
     * rules -- precisely when the user has just granted access and is testing.
     */
    async install(policy, quarantinedCount = 0) {
      return slot().accept({ kind: "INSTALL", policy, quarantinedCount }, isPurge);
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
      await slot().accept({ kind: "PURGE" }, isPurge);
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
        //
        // ASKED IN PARALLEL, AND ASKED ONCE PER DISTINCT QUESTION.
        //
        // This was a sequential await per rule, re-run on every sync() -- that is,
        // on every debounced keystroke in the options page. With the reserved
        // prefixes cut into runs and one rule per engine, that is dozens of
        // serialised IPC round trips against a service worker whose whole budget
        // is staying alive long enough to finish. And the reserved-prefix guards
        // are IDENTICAL across engines and CONSTANT between runs, so most of those
        // trips asked the same question twice.
        //
        // The key is the whole question, never just the regex: isCaseSensitive and
        // requireCapturing both cost RE2 memory, so the same expression can be
        // supported bare and refused as the rule needs it.
        const questionFor = (rule) => ({
          regex: rule.condition.regexFilter,
          isCaseSensitive: rule.condition.isUrlFilterCaseSensitive,
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
          // Asked bare, the call vouches for an expression we never install, and it
          // FAILS OPEN: the rule reaches updateDynamicRules, which rejects THE
          // WHOLE BATCH. Rules are replaced wholesale, so one over-budget regex
          // would take every other shortcut down with it instead of being the
          // single skipped entry the design promises.
          //
          // Derived from the rule rather than restated, so the two cannot drift.
          requireCapturing:
            rule.action.type === "redirect" &&
            Boolean(rule.action.redirect && rule.action.redirect.regexSubstitution),
        });

        const asked = new Map();
        for (const rule of set.rules()) {
          const question = questionFor(rule);
          const key = JSON.stringify(question);
          if (!asked.has(key)) asked.set(key, dnr().isRegexSupported(question));
        }
        const answers = new Map();
        await Promise.all(
          [...asked].map(async ([key, pending]) => answers.set(key, await pending))
        );
        const unsupported = set
          .rules()
          .filter((rule) => {
            const answer = answers.get(JSON.stringify(questionFor(rule)));
            // An absent answer cannot happen -- every rule was asked -- but a
            // missing one must read as UNSUPPORTED, never as a silent yes.
            return !(answer && answer.isSupported);
          })
          .map((rule) => rule.id);

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
        // A rejection leaves THIS CALL atomic: the batch is all-or-nothing, so no
        // mixed programme is ever installed. It no longer leaves the previous
        // rules running, though -- the catch below purges. Atomicity protects
        // against a half-written programme; it is not what protects against a
        // stale one, and conflating the two is how the kill switch broke.
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
        skipped = [...skipped, NotInstalled.of("CONSTRUCTION_REFUSED", reason)];
        coverageSatisfied = false;
        // AND THE FAIL-CLOSED HAPPENS HERE, not only in background.js.
        //
        // This catch RESOLVES -- it does not rethrow -- so sync()'s own catch is
        // never reached and never purges. Without this line a refused build left
        // THE PREVIOUS PROGRAMME FIRING while the policy said something else:
        // SECURITY.md's "the dynamic rules are now emptied rather than left
        // running" covered the throw and the unreadable policy, and missed the
        // one path that a custom domain's envelope reaches on its own.
        //
        // A DIRECT CALL, never _enqueue: we are INSIDE the drain, and re-entering
        // the queue from here would fill a slot nobody drains until we return.
        //
        // Its own failure is swallowed on purpose: `installed` is already false,
        // and the badge asks the platform for the real count rather than trusting
        // this frame. A throw here would replace a named refusal with an
        // anonymous one.
        try {
          await this._purge();
        } catch {
          /* the count the badge reads is the platform's, not ours */
        }
      }
      return this.report({
        policy,
        quarantinedCount,
        // THE CAUSES TRAVEL IN `reality`, not beside it. They used to ride a
        // parameter of their own, which made `report()` carry two doors for one
        // fact: the worker filled one, the page filled the other with `[]`, and
        // the return picked the empty one. `reality` now means the same thing on
        // both surfaces -- what THIS surface knows of the installed reality: the
        // present for the worker, the receipt's memory for the page.
        reality: { installed, coverageSatisfied, skipped },
        source: "INSTALL",
      });
    },

    /**
     * Rules are installed even when the required origins are missing: a redirect
     * rule without host access simply never fires, and becomes active on its own
     * the moment permission is granted, with no further sync.
     *
     * A NAMED OBJECT, because the signature needed a paragraph.
     *
     * It was `report(policy, skipped = [], quarantinedCount = 0, reality = {},
     * source)` -- five parameters, four defaults, and the only MANDATORY one
     * last -- defended by twenty-seven lines explaining why. Those lines were
     * right about the danger and wrong about the remedy: the comment itself
     * recounts that a three-argument call had already fabricated an
     * `installed: true`. Defaults that make an omission SILENT are the disease;
     * a fifth positional argument was a splint.
     *
     * Named, an omission is visible at the call site, and there is no order to
     * remember. The original note follows, because its reasoning about `source`
     * is still exactly right:
     *
     * `source` HAS NO DEFAULT.
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
    async report({ policy, quarantinedCount, reality, source }) {
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
        // Named, like the two above -- no spread, and no `?? []`: both factories
        // guarantee an array (rule-installer's own `skipped` is reassigned from
        // `installable.skipped()` and a spread; InstallOutcome.read assigns
        // `out.skipped` on every path, catch included). A hedge on the most
        // constrained of the three fields would call its two neighbours reckless.
        skipped: reality.skipped,
        missingOrigins: originsGranted ? [] : origins,
      };
    },
  };

  global.RuleInstaller = RuleInstaller;
})(globalThis);
