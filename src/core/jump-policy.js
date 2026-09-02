/**
 * JumpPolicy -- the aggregate root, and the rule of the game: which keys we
 * intercept, on which engines, and whether we are armed.
 *
 * Not `Configuration`: the emptiest word available, the word of the generic
 * subdomain. Read the signatures aloud -- policy.activeBindings(),
 * policy.diagnose(...) -- they are sentences.
 */
(function (global) {
  "use strict";

  const { MutationResult, ShortcutRegistry, ProjectKey, JiraInstance, Consent } = global;

  // STAYS AT 1, deliberately. Bumping it would make an older device answer
  // SCHEMA_TOO_NEW and refuse the WHOLE policy -- on a machine the user never
  // touched, merely because a search engine was ticked on another one. Whereas a
  // v1 reader meeting a catch-all key quarantines that ONE entry, keeps the
  // quarantine, and diagnoses PARTIAL_POLICY, which the UI shows. Losing one
  // entry loudly beats losing everything.
  //
  // And the deeper reason: schemaVersion is a contract about HOW TO READ the
  // document, not a description of what it contains. A reader must decide "can I
  // understand this?" BEFORE looking at the content, so a version that depended
  // on the content would make the check circular. The way to read `key` has not
  // changed; the value domain of a field widened, and that field already had a
  // fail-closed validator and a designated channel for what it refuses.
  const SCHEMA_VERSION = 1;

  // DNR caps dynamic rules; a binding is one rule, and bindings are
  // shortcuts x engines. Deliberately well below MAX_NUMBER_OF_DYNAMIC_RULES.
  const MAX_BINDINGS = 300;

  // A DOMAIN limit, and the reason is written as one: a policy of two hundred
  // shortcuts is no longer a policy anybody maintains. It used to be enforced at
  // the admission door only, on the length of the incoming array, so the UI could
  // legally create three hundred of them. admission.js now reads it from here --
  // two constants that are equal today are two different constants tomorrow.
  const MAX_SHORTCUTS = 200;

  class Binding {
    constructor(shortcut, engineId, ruleIndex) {
      this._shortcut = shortcut;
      this._engineId = engineId;
      this._ruleIndex = ruleIndex;
    }
    shortcut() { return this._shortcut; }
    engineId() { return this._engineId; }
    /** Rules are replaced wholesale on every sync, so ids are positional.
     *  There is deliberately NO second positional number here: priority comes
     *  from three constant bands, not from the shortcut's position. */
    ruleId() { return this._ruleIndex + 1; }
    describe() {
      const key = this._shortcut.key();
      const shown = key.isCatchAll() ? "the catch-all" : key.toString();
      return `${shown} on ${this._engineId}`;
    }
  }

  class JumpPolicy {
    constructor(registry, engineIds, armed, customEngines = []) {
      this._registry = registry;
      this._engineIds = engineIds;
      this._armed = armed;
      this._customEngines = customEngines;
    }

    shortcuts() { return this._registry.shortcuts(); }
    registry() { return this._registry; }
    engineIds() { return [...this._engineIds]; }
    customEngines() { return [...this._customEngines]; }
    armed() { return this._armed; }

    /** The global kill switch. Distinct from armShortcut(id): sharing the name
     *  silently overwrote one of the two. */
    arm() { return new JumpPolicy(this._registry, this._engineIds, true, this._customEngines); }
    disarm() { return new JumpPolicy(this._registry, this._engineIds, false, this._customEngines); }

    /**
     * The keystone. Without it the rule factory would arbitrate the domain rule
     * "disarmed => no rules" inside a DNR rule constructor. With it, buildRules
     * is a .map(). Tell, don't ask.
     *
     * It also excludes shortcuts with unacknowledged warnings, which closes a
     * real hole: arm() guards the front door, but withBaseUrlFor clears
     * acknowledgements WITHOUT disarming. Excluding them here makes the invariant
     * true by construction rather than guarded at the entrance -- and it does not
     * destroy the user's intent: the shortcut becomes active again on the
     * acknowledgement click, with no need to press "arm" a second time.
     */
    activeBindings() {
      if (!this._armed) return [];
      const shadowed = new Set(this._registry.shadowedIds());
      const bindings = [];
      let index = 0;
      for (const shortcut of this._registry.shortcuts()) {
        if (!shortcut.armed()) continue;
        if (shortcut.unacknowledgedWarnings().length > 0) continue;
        // A shadowed shortcut produces NO RULE AT ALL rather than a low-priority
        // one. Both express "dead", but excluding it saves rule budget, saves
        // isRegexSupported round trips, and matches exactly what the UI says.
        // Reversible: removing the catch-all brings it back, since everything is
        // derived.
        if (shadowed.has(shortcut.id())) continue;
        for (const engineId of this._engineIds) {
          bindings.push(new Binding(shortcut, engineId, index));
          index += 1;
        }
      }
      return bindings;
    }

    /**
     * The evaluation order, and one shortcut by identity.
     *
     * Two delegations that CLOSE A PAIR rather than serve a view. This aggregate
     * accepts withOrder(ids) -- an absolute intention about the order, so it claims
     * the order as its own datum -- but could not tell you the current one: reading
     * it meant leaving through registry(). And it was doing exactly that itself,
     * through the back door, in registerAboveCatchAll below and in admission.js.
     *
     * shortcutFor is the twin of statusOf: answering "what is the state of row id"
     * on the root and "what IS row id" on the registry offers two counters for two
     * halves of one question, which is what invites the traversal.
     *
     * It hands an internal entity to an outer layer, and that is licit for one
     * reason only: ProjectShortcut is IMMUTABLE (withConsent/withKey/withInstance
     * each return a new object) and the caller keeps it for the length of a render.
     * The day a setter appears, this stops being safe.
     */
    orderedIds() {
      return this._registry.orderedIds();
    }

    shortcutFor(id) {
      return this._registry.find(id);
    }

    /** The shortcuts a catch-all placed before them makes unreachable. */
    shadowedShortcuts() {
      return this._registry.shadowedIds().map((id) => this.shortcutFor(id));
    }

    catchAllShortcut() {
      return this._registry.catchAll();
    }

    /**
     * "Does any engine WANT a catch-all?" -- the wanted half of the
     * CoverageContract, re-derived here.
     *
     * THIS IS A NAMED DEROGATION from "one owner per question", and it is FORCED:
     * section-host.js calls RuleInstaller.report() WITHOUT building a RuleSet, so
     * without a contract, so the fact is not computable there.
     *
     * The two DIVERGE on UNKNOWN_ENGINE: rule-factory does `continue` BEFORE
     * pushing into catchAll.engineIds, so a catch-all on an unknown engine is in
     * activeBindings() and not in the contract -- wantsCatchAll() says YES where
     * coverage was true by vacuity. OVER-SIGNALLING ONLY, never the reverse.
     * Written down, because otherwise someone "tightens" it by pulling the engine
     * catalogue into the core, which rule-factory.js declares impossible: "the
     * core only holds opaque engine ids".
     *
     * It derives from activeBindings() -- the very predicate DIAGNOSES condemns
     * above for excluding the disarmed policy. That is HARMLESS, but ONLY BECAUSE
     * DISARMED sits above COVERAGE_STATE_UNKNOWN: written here, or the next reader
     * "fixes the inconsistency" by lifting that code up the catalogue, and EVERY
     * DISARMED PROFILE STARTS SHOUTING.
     *
     * NOT `catchAllShortcut()`, which rule-factory.js already argues against: it
     * "is true as soon as the LINE EXISTS, while this is filled from
     * activeBindings() -- armed, acknowledged, unshadowed". A freshly registered
     * catch-all carries unacknowledgedWarnings: ["CATCH_ALL"], so it is excluded --
     * and the WAITING state is the one every catch-all passes through. The residual
     * silence there is CORRECT: rule-factory excludes the same binding, so the
     * contract comes out empty() and satisfiedBy is true by vacuity.
     */
    wantsCatchAll() {
      return this.activeBindings().some((binding) => binding.shortcut().key().isCatchAll());
    }

    /**
     * Who claims this reference, HERE AND NOW.
     *
     * On the aggregate rather than the registry, because the answer depends on
     * arming, on pending acknowledgements and on the ticked engines -- three
     * things the registry knows nothing about, while JumpPreview answers from the
     * DELIVERED RULES. Asked of the registry, the agreement test between the two
     * would fail for a reason that is not a disagreement.
     *
     * ONE PUBLISHED LANGUAGE: the same `code` values JumpPreview returns, so the
     * agreement test needs no translation layer between the project and itself.
     * RESERVED_PREFIX carries no `shortcut`: a field with a meaningful absence is
     * what mutation-result.js bans.
     */
    claimantFor(reference) {
      if (!this._armed || this._engineIds.length === 0) return { code: "NO_MATCH" };
      const shadowed = new Set(this._registry.shadowedIds());
      const eligible = (shortcut) =>
        shortcut.armed() &&
        shortcut.unacknowledgedWarnings().length === 0 &&
        !shadowed.has(shortcut.id());
      const claimant = this._registry.claimantFor(reference, eligible);
      if (!claimant) {
        // A catch-all would have claimed it, but a reserved prefix holds it back.
        const catchAll = this._registry.catchAll();
        if (
          catchAll &&
          eligible(catchAll) &&
          catchAll.key().separators().includes(reference.separator()) &&
          // ONE hop, and the verdict is the key's own. Recombining two facts in
          // the right order from here was a convention between two files: the
          // length has to be tested BEFORE the list, or a reserved prefix beyond
          // the bound would read RESERVED_PREFIX while no rule can fire on it.
          catchAll.key().verdictFor(reference.key()) === global.CatchAllKey.VERDICTS.RESERVED_PREFIX
        ) {
          return { code: "RESERVED_PREFIX" };
        }
        return { code: "NO_MATCH" };
      }
      return {
        code: claimant.key().isCatchAll() ? "MATCHED_CATCH_ALL" : "MATCHED_SHORTCUT",
        shortcut: claimant,
      };
    }

    /**
     * The SOLE judge of a row's state, so that the options page stops deciding
     * on its own and the row's vocabulary is the one diagnose() speaks.
     *
     * Order matters and is written: shadowed beats disarmed, because a shadowed
     * row does not jump even when armed.
     */
    statusOf(id) {
      const shortcut = this._registry.find(id);
      if (!shortcut) return undefined;
      if (this._registry.isShadowed(id)) return "SHADOWED";
      if (shortcut.unacknowledgedWarnings().length > 0) return "AWAITING_ACKNOWLEDGEMENT";
      if (!shortcut.armed()) return "DISARMED";
      return "ACTIVE";
    }

    /**
     * Answers the question the user is actually asking -- "will typing ABC-1
     * work?" -- rather than the one the rule counter answers.
     *
     * The facts come in THROUGH THE DOOR: answering MISSING_ORIGINS needs the
     * engine catalogue and the platform, neither of which the core may know.
     * The order of priority is written because several states coexist and a
     * single return value forces an arbitration; unwritten, it would be
     * arbitrated twice differently.
     */
    diagnose(facts) {
      // NO DEFAULT. A fact of installed reality that is ABSENT is not `true`:
      // background.js's detector header says a detector must fail by over-signalling,
      // never by under-signalling. Defaulting here would put the domain's thumb back on
      // the scale behind whatever the caller failed to supply.
      for (const { code, applies } of DIAGNOSES) {
        if (applies(this, facts)) return code;
      }
      return "READY";
    }

    _rebuilt(registry) {
      return new JumpPolicy(registry, this._engineIds, this._armed, this._customEngines);
    }

    /**
     * Every mutation that can grow a bounded projection validates the cap with
     * the same code. Guarding only register would let 100 disarmed shortcuts be
     * created and then blow past the DNR limit by ticking a fourth engine.
     *
     * A LIST of caps, not one: the number of shortcuts is not a projection of the
     * bindings, and an inline `if` for the second cap would be exactly the
     * duplication this method exists to prevent.
     */
    _guarded(result) {
      if (!result.ok) return result;
      const policy = result.value;
      const caps = [
        [MAX_BINDINGS, () => policy.activeBindings().length, "BINDING_LIMIT",
          `This would create more than ${MAX_BINDINGS} redirect rules.`],
        [MAX_SHORTCUTS, () => policy.shortcuts().length, "SHORTCUT_LIMIT",
          `This would create more than ${MAX_SHORTCUTS} shortcuts.`],
      ];
      for (const [limit, project, code, message] of caps) {
        if (project() > limit) return MutationResult.refused(code, message);
      }
      return result;
    }

    register(id, key, instance, consent) {
      const result = this._registry.register(id, key, instance, consent);
      if (!result.ok) return result;
      return this._guarded(MutationResult.ok(this._rebuilt(result.value)));
    }

    /**
     * The gesture the UI expresses. The CORE forges the key, so the options page
     * never calls ShortcutKey.parse and never mints a CatchAllKey -- and the
     * claim "the only place where a string becomes a catch-all key" stays true.
     *
     * It DELEGATES to register, so "the single way in" remains true and the
     * uniqueness of the catch-all does not get a second guardian.
     */
    registerCatchAll(id, instance, consent) {
      return this.register(id, global.CatchAllKey.only(), instance, consent);
    }

    /**
     * A SECOND NAMED DOOR, on the same side of the membrane.
     *
     * "A named shortcut is useless below the catch-all" is domain knowledge, so
     * it does not belong in options-sections.js -- but it must not sit in
     * register either, because restore replays register entry by entry and would
     * rewrite the persisted order. So: its own door, which composes register then
     * withOrder INSIDE, deriving the ids from the policy it has just built.
     * restore never borrows it.
     *
     * Composing the two from the UI instead would have been fragile: a concurrent
     * addition yields ORDER_STALE, hence the refusal of the WHOLE addition, and
     * options-sections.js has already dropped the draft by then -- the typing
     * would vanish.
     */
    registerAboveCatchAll(id, key, instance, consent) {
      const registered = this.register(id, key, instance, consent);
      if (!registered.ok) return registered;
      const policy = registered.value;
      const catchAll = policy.catchAllShortcut();
      if (!catchAll || catchAll.id() === id) return registered;
      const ids = policy.orderedIds().filter((other) => other !== id);
      const at = ids.indexOf(catchAll.id());
      ids.splice(at, 0, id);
      return policy.withOrder(ids);
    }

    /** Reordering, absolute and idempotent. See ShortcutRegistry.withOrder. */
    withOrder(ids) {
      const result = this._registry.withOrder(ids);
      if (!result.ok) return result;
      // Pulling a shortcut above the catch-all GROWS activeBindings, so this is a
      // growth path like any other.
      return this._guarded(MutationResult.ok(this._rebuilt(result.value)));
    }

    armShortcut(id) {
      const result = this._registry.arm(id);
      if (!result.ok) return result;
      return this._guarded(MutationResult.ok(this._rebuilt(result.value)));
    }

    disarmShortcut(id) {
      const result = this._registry.disarm(id);
      return result.ok ? MutationResult.ok(this._rebuilt(result.value)) : result;
    }

    withBaseUrlFor(id, instance) {
      const result = this._registry.withBaseUrlFor(id, instance);
      return result.ok ? MutationResult.ok(this._rebuilt(result.value)) : result;
    }

    withKeyFor(id, key) {
      const result = this._registry.withKeyFor(id, key);
      return result.ok ? MutationResult.ok(this._rebuilt(result.value)) : result;
    }

    acknowledge(id, kind) {
      const result = this._registry.acknowledge(id, kind);
      return result.ok ? MutationResult.ok(this._rebuilt(result.value)) : result;
    }

    remove(id) {
      const result = this._registry.remove(id);
      return result.ok ? MutationResult.ok(this._rebuilt(result.value)) : result;
    }

    withEngines(engineIds) {
      const policy = new JumpPolicy(this._registry, [...engineIds], this._armed, this._customEngines);
      return this._guarded(MutationResult.ok(policy));
    }

    /** Adding a domain is additive and idempotent: the id derives from the host. */
    withCustomEngine(engine) {
      if (this._customEngines.some((e) => e.id() === engine.id())) {
        return MutationResult.refused("DUPLICATE_ENGINE", `${engine.host()} is already listed.`);
      }
      const policy = new JumpPolicy(this._registry, this._engineIds, this._armed,
        [...this._customEngines, engine]);
      return this._guarded(MutationResult.ok(policy));
    }

    withoutCustomEngine(id) {
      return MutationResult.ok(new JumpPolicy(
        this._registry,
        this._engineIds.filter((e) => e !== id),
        this._armed,
        this._customEngines.filter((e) => e.id() !== id),
      ));
    }

    /** Projection for persistence: a faithful mirror. */
    toJSON() {
      return {
        schemaVersion: SCHEMA_VERSION,
        armed: this._armed,
        engines: this.engineIds(),
        customEngines: this._customEngines.map((e) => e.toJSON()),
        shortcuts: this._registry.toJSON(),
      };
    }

    /**
     * Projection for export. Defined by what it REMOVES: no acknowledgements
     * (a file cannot pre-approve its own warnings) and no quarantine (one does
     * not mail a colleague unvalidated strings, some of which are by hypothesis
     * attacker-controlled).
     */
    toTransfer() {
      return {
        schemaVersion: SCHEMA_VERSION,
        engines: this.engineIds(),
        customEngines: this._customEngines.map((e) => e.toJSON()),
        shortcuts: this._registry.shortcuts().map((s) => ({
          id: s.id(),
          key: s.key().toString(),
          baseUrl: s.instance().baseUrl(),
        })),
      };
    }
  }

  /**
   * The order of priority, AS A CATALOGUE rather than a chain of ifs -- so that
   * the order is DATA, exactly as it is for the shortcuts themselves. Read top
   * to bottom, FIRST MATCH WINS, so the order written here IS the order of the
   * code and no annotation may contradict it.
   *
   * The axis: a state meaning "no jump will happen at all" always outranks a
   * state meaning "some jumps will not happen". Which is why MISSING_ORIGINS now
   * sits ABOVE PARTIAL_POLICY -- a DELIBERATE INVERSION of the previous order,
   * written as such so nobody "fixes" it back: telling someone that some rows are
   * shadowed, while never telling them that nothing will fire at all, is the
   * fourth product principle broken by a sort order.
   *
   * INSTALL_FAILED comes FIRST, and that is an EXCEPTION to the axis:
   * DISARMED means "no jump" IN INTENTION, INSTALL_FAILED means "the installed
   * reality contradicts the intention". The naive axis would call them equal; the
   * second sense wins, because an emergency stop that reports "stopped" without
   * having stopped is worse than no emergency stop.
   */
  const DIAGNOSES = [
    // TWO codes, and the PARTITION is what makes them honest. `!== true` folded
    // "it failed" and "I do not know" into one sentence: it over-signalled on a
    // healthy profile whose receipt was merely absent, and it named the wrong
    // cause. `=== false` alone would be the fail-open -- an ABSENT fact is
    // indistinguishable from a true one -- so the pair must be DISJOINT and
    // TOTAL, which is what the two predicates below are.
    { code: "INSTALL_FAILED", applies: (p, f) => f.installed === false },
    // `typeof !== "boolean"`, NOT `=== undefined`: null, "false" and 0 would fall
    // through the hole and drop all the way to READY. diagnose() is PUBLIC and the
    // tests call it directly, so InstallOutcome.read does not protect this hole.
    //
    // AND THE GUARD IS ON REALITY, NOT ON INTENTION. Three drafts got this wrong.
    // `activeBindings().length > 0` excluded the DISARMED policy -- measured:
    // armed()=false | activeBindings=0 | registry=1 -- so it fell to DISARMED, i.e.
    // "no jump will fire" said without knowing whether the purge happened. Then
    // `registry().size() > 0` alone opened a NEW fail-open -- measured:
    // registry=0, quarantinedCount=2, fact absent  ->  PARTIAL_POLICY, a
    // SUB-signalling, where the old `!== true` said INSTALL_FAILED.
    //
    // The name of the disjunction is "IS THERE ANYTHING TO LOSE?", not "are there
    // rules installed?" -- that second wording justifies only ONE of the three
    // terms (registry is intention, quarantinedCount a failed read), and someone
    // would "simplify" towards it and reopen the fail-open. Disarming, deleting
    // one's last shortcut, seeing everything quarantined: that is three ways of
    // installing the void, and ignorance about the void is the kill switch's
    // question. A blank profile (0/0/0) stays silent and falls to NO_SHORTCUTS.
    //
    // ABOVE DISARMED, or the measurement above falls back onto it.
    {
      code: "INSTALL_STATE_UNKNOWN",
      applies: (p, f) =>
        typeof f.installed !== "boolean" &&
        (f.rulesInstalled === true || p.registry().size() > 0 || f.quarantinedCount > 0),
    },
    { code: "DISARMED", applies: (p) => !p.armed() },
    // Before NO_SHORTCUTS: with everything quarantined there are not *no*
    // shortcuts, there are UNREADABLE ones -- and saying "no shortcut yet" is the
    // one answer that hides a partial read.
    { code: "PARTIAL_POLICY", applies: (p, f) => p.registry().size() === 0 && f.quarantinedCount > 0 },
    { code: "NO_SHORTCUTS", applies: (p) => p.registry().size() === 0 },
    { code: "NO_ENGINES", applies: (p) => p.engineIds().length === 0 },
    {
      code: "ALL_SHORTCUTS_DISARMED",
      applies: (p) => p.activeBindings().length === 0 && p.shortcuts().every((s) => !s.armed()),
    },
    {
      code: "ALL_SHORTCUTS_AWAITING_ACKNOWLEDGEMENT",
      applies: (p) =>
        p.activeBindings().length === 0 &&
        p.shortcuts().some((s) => s.armed()) &&
        p.shortcuts().filter((s) => s.armed()).every((s) => s.unacknowledgedWarnings().length > 0),
    },
    { code: "ALL_SHORTCUTS_SHADOWED", applies: (p) => p.activeBindings().length === 0 },
    // The FACT is named for what it asserts -- every engine that wanted a catch-all got
    // one -- while the CODE stays the user's sentence. Renaming the reader without the
    // writers, or the writers without this reader, makes the fact arrive ABSENT --
    // which no longer fires THIS code, since it now tests `=== false`, but its twin
    // below, guarded on wantsCatchAll(). The masking moved with the subject.
    { code: "CATCH_ALL_NOT_INSTALLED", applies: (p, f) => f.coverageSatisfied === false },
    // JUST AFTER ITS TWIN, therefore ABOVE MISSING_ORIGINS -- prescribed, not left
    // to the implementation: slid below MISSING_ORIGINS, the wantsCatchAll() guard
    // becomes an ornament and this code masks nothing it was meant to yield to.
    //
    // The GUARD is what keeps it quiet on the profiles that never wanted a
    // catch-all: without it, COVERAGE_STATE_UNKNOWN would mask MISSING_ORIGINS,
    // PARTIAL_POLICY and SOME_SHADOWED on EVERY profile with an absent receipt.
    {
      code: "COVERAGE_STATE_UNKNOWN",
      applies: (p, f) => typeof f.coverageSatisfied !== "boolean" && p.wantsCatchAll(),
    },
    { code: "MISSING_ORIGINS", applies: (p, f) => !f.originsGranted },
    { code: "PARTIAL_POLICY", applies: (p, f) => f.quarantinedCount > 0 },
    { code: "SOME_SHADOWED", applies: (p) => p.shadowedShortcuts().length > 0 },
  ];

  JumpPolicy.DIAGNOSES = DIAGNOSES.map((d) => d.code);
  JumpPolicy.SCHEMA_VERSION = SCHEMA_VERSION;
  JumpPolicy.MAX_BINDINGS = MAX_BINDINGS;
  JumpPolicy.MAX_SHORTCUTS = MAX_SHORTCUTS;

  JumpPolicy.empty = function () {
    return new JumpPolicy(ShortcutRegistry.empty(), [], true, []);
  };

  global.Binding = Binding;
  global.JumpPolicy = JumpPolicy;
})(globalThis);
