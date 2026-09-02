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
    /**
     * A LABEL FOR A LOG LINE, and deliberately not `nature()`.
     *
     * `nature()` is a PERSISTED DISCRIMINANT: it is one third of the row key under
     * which an attestation is filed, so renaming the word to read better on screen
     * would silently revoke every acknowledgement ever given. Fail-closed -- the
     * catch-all disarms and the user is asked again -- but silent, and for a
     * cosmetic edit.
     *
     * Two contracts under one word is what this project spends a protocol
     * avoiding. The discriminant stays a value; what a human reads is written
     * here, where nothing is filed under it.
     */
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

    /**
     * HOW MANY, and WHETHER ANY -- asked of the root rather than through it.
     *
     * Diagnosis reached `policy.registry().size()` four times, which is the
     * traversal this file argues against a hundred lines below ("reading it meant
     * leaving through registry()"). Moving the catalogue into its own module made
     * that traversal cross a file boundary, which is where it stops being a habit
     * and becomes a coupling.
     */
    shortcutCount() { return this._registry.size(); }
    hasShortcuts() { return this._registry.size() > 0; }
    registry() { return this._registry; }
    engineIds() { return [...this._engineIds]; }
    customEngines() { return [...this._customEngines]; }
    armed() { return this._armed; }

    /** The global kill switch. Distinct from armShortcut(id): sharing the name
     *  silently overwrote one of the two. */
    arm() { return new JumpPolicy(this._registry, this._engineIds, true, this._customEngines); }
    disarm() { return new JumpPolicy(this._registry, this._engineIds, false, this._customEngines); }

    /**
     * WHICH SHORTCUTS ARE LIVE, written ONCE.
     *
     * The same three conditions were spelled twice in this file, a hundred lines
     * apart -- here and inside claimantFor -- so a fourth condition would have had
     * to be noticed in two places. They are the same question, and it has one
     * answer.
     *
     * A shadowed shortcut is EXCLUDED, not demoted: producing no rule at all
     * saves rule budget, saves isRegexSupported round trips, and matches exactly
     * what the UI says. Reversible -- removing the catch-all brings it back, since
     * everything here is derived.
     */
    _isLive(shortcut) {
      return (
        shortcut.armed() &&
        shortcut.unacknowledgedWarnings().length === 0 &&
        !this._registry.isShadowed(shortcut.id())
      );
    }

    /**
     * The keystone. Without it the rule factory would arbitrate the domain rule
     * "disarmed => no rules" inside a DNR rule constructor. With it, buildRules is
     * a .map(). Tell, don't ask.
     *
     * It also excludes shortcuts with unacknowledged warnings, which closes a real
     * hole: arm() guards the front door, but withBaseUrlFor clears acknowledgements
     * WITHOUT disarming. Excluding them here makes the invariant true by
     * construction rather than guarded at the entrance -- and it does not destroy
     * the user's intent: the shortcut becomes active again on the acknowledgement
     * click, with no need to press "arm" a second time.
     */
    activeBindings() {
      if (!this._armed) return [];
      const bindings = [];
      let index = 0;
      for (const shortcut of this._registry.shortcuts()) {
        if (!this._isLive(shortcut)) continue;
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
     * IT HAS NO PRODUCTION CALLER, AND THAT IS ITS JOB. An audit called it dead
     * code -- a second matching engine maintained beside the live one -- and the
     * grep is right: nothing in src/ calls it. Reading it as dead would be the
     * mistake, so the status is written here rather than left to be rediscovered.
     *
     * This is the ORACLE. The rules actually delivered are a REGEX, produced by
     * translating this domain rule into RE2; the agreement test walks a corpus
     * through both and requires the same verdict. That comparison is a SECURITY
     * CONTROL, not an elegance: a regex that claims MORE than the domain does is
     * a universal redirector, and nothing else in this project could notice.
     *
     * Delete this and the domain can no longer state, in its own terms, what it
     * intercepts -- only the regex would know, and a regex cannot be reviewed the
     * way a sentence can. The right move if it ever becomes a burden is to make it
     * the single engine, never to drop the oracle and keep the translation.
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
      const eligible = (shortcut) => this._isLive(shortcut);
      const claimant = this._registry.claimantFor(reference, eligible);
      if (!claimant) {
        // A catch-all would have claimed it, but a reserved prefix holds it back.
        const catchAll = this._registry.catchAll();
        if (
          catchAll &&
          this._isLive(catchAll) &&
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
      return global.Diagnosis.of(this, facts);
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
      // TWO IFS, and they read as what they are. A table of four-tuples
      // destructured in a loop -- for two entries -- put the most expensive
      // computation in the file behind a thunk nobody could see was being called,
      // and cost a reader two passes to learn there were only two caps.
      //
      // The shortcut count first: it is O(1), and refusing on it avoids computing
      // the bindings at all on the path that grows the registry.
      if (policy.shortcuts().length > MAX_SHORTCUTS) {
        return MutationResult.refused(
          "SHORTCUT_LIMIT",
          `This would create more than ${MAX_SHORTCUTS} shortcuts.`
        );
      }
      if (policy.activeBindings().length > MAX_BINDINGS) {
        return MutationResult.refused(
          "BINDING_LIMIT",
          `This would create more than ${MAX_BINDINGS} redirect rules.`
        );
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

    /**
     * WHAT A CHANGE DETECTOR WOULD SEE, as one string.
     *
     * Everything PolicyDiff compares, and nothing else: which shortcut holds which
     * key and which destination, whether it is armed, the evaluation order, the
     * ticked engines and the global switch. Two policies with the same fingerprint
     * produce no facts between them, by construction.
     *
     * IT CARRIES NOTHING OF THE STORAGE ENVELOPE -- no revision, no writer token.
     * That is the whole point: a claim built on this cannot be forged by copying
     * an envelope, because there is no envelope in it.
     */
    fingerprint() {
      return JSON.stringify([
        this._armed,
        [...this._engineIds].sort(),
        this._registry.shortcuts().map((s) => [
          s.id(),
          s.key().toString(),
          s.instance().baseUrl(),
          s.armed(),
        ]),
      ]);
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

  // Still exported from here: it is the policy that callers hold, and the
  // catalogue's owner is one module away.
  Object.defineProperty(JumpPolicy, "DIAGNOSES", {
    get: () => global.Diagnosis.CODES,
    enumerable: true,
  });
  JumpPolicy.SCHEMA_VERSION = SCHEMA_VERSION;
  JumpPolicy.MAX_BINDINGS = MAX_BINDINGS;
  JumpPolicy.MAX_SHORTCUTS = MAX_SHORTCUTS;

  JumpPolicy.empty = function () {
    return new JumpPolicy(ShortcutRegistry.empty(), [], true, []);
  };

  global.Binding = Binding;
  global.JumpPolicy = JumpPolicy;
})(globalThis);
