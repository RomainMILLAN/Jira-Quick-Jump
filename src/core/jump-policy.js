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

  const SCHEMA_VERSION = 1;

  // DNR caps dynamic rules; a binding is one rule, and bindings are
  // shortcuts x engines. Deliberately well below MAX_NUMBER_OF_DYNAMIC_RULES.
  const MAX_BINDINGS = 300;

  class Binding {
    constructor(shortcut, engineId, index) {
      this._shortcut = shortcut;
      this._engineId = engineId;
      this._index = index;
    }
    shortcut() { return this._shortcut; }
    engineId() { return this._engineId; }
    /** Rules are replaced wholesale on every sync, so ids are positional. */
    ruleId() { return this._index + 1; }
    describe() {
      return `${this._shortcut.key()} on ${this._engineId}`;
    }
  }

  class JumpPolicy {
    constructor(registry, engineIds, armed) {
      this._registry = registry;
      this._engineIds = engineIds;
      this._armed = armed;
    }

    shortcuts() { return this._registry.shortcuts(); }
    registry() { return this._registry; }
    engineIds() { return [...this._engineIds]; }
    armed() { return this._armed; }

    /** The global kill switch. Distinct from armShortcut(id): sharing the name
     *  silently overwrote one of the two. */
    arm() { return new JumpPolicy(this._registry, this._engineIds, true); }
    disarm() { return new JumpPolicy(this._registry, this._engineIds, false); }

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
      const bindings = [];
      let index = 0;
      for (const shortcut of this._registry.shortcuts()) {
        if (!shortcut.armed()) continue;
        if (shortcut.unacknowledgedWarnings().length > 0) continue;
        for (const engineId of this._engineIds) {
          bindings.push(new Binding(shortcut, engineId, index));
          index += 1;
        }
      }
      return bindings;
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
    diagnose({ originsGranted, quarantinedCount = 0 }) {
      if (!this._armed) return "DISARMED";
      if (this._registry.size() === 0) return "NO_SHORTCUTS";
      if (this._engineIds.length === 0) return "NO_ENGINES";
      if (this.activeBindings().length === 0) return "ALL_SHORTCUTS_DISARMED";
      if (quarantinedCount > 0) return "PARTIAL_POLICY";
      if (!originsGranted) return "MISSING_ORIGINS";
      return "READY";
    }

    _rebuilt(registry) {
      return new JumpPolicy(registry, this._engineIds, this._armed);
    }

    /**
     * Every mutation that can grow activeBindings().length validates the cap with
     * the same code. Guarding only register would let 100 disarmed shortcuts be
     * created and then blow past the DNR limit by ticking a fourth engine.
     */
    _guarded(result, projected) {
      if (!result.ok) return result;
      if (projected().length > MAX_BINDINGS) {
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
      const policy = this._rebuilt(result.value);
      return this._guarded(MutationResult.ok(policy, result.events), () => policy.activeBindings());
    }

    armShortcut(id) {
      const result = this._registry.arm(id);
      if (!result.ok) return result;
      const policy = this._rebuilt(result.value);
      return this._guarded(MutationResult.ok(policy, result.events), () => policy.activeBindings());
    }

    disarmShortcut(id) {
      const result = this._registry.disarm(id);
      return result.ok ? MutationResult.ok(this._rebuilt(result.value), result.events) : result;
    }

    withBaseUrlFor(id, instance) {
      const result = this._registry.withBaseUrlFor(id, instance);
      return result.ok ? MutationResult.ok(this._rebuilt(result.value), result.events) : result;
    }

    withKeyFor(id, key) {
      const result = this._registry.withKeyFor(id, key);
      return result.ok ? MutationResult.ok(this._rebuilt(result.value), result.events) : result;
    }

    acknowledge(id, kind) {
      const result = this._registry.acknowledge(id, kind);
      return result.ok ? MutationResult.ok(this._rebuilt(result.value), result.events) : result;
    }

    remove(id) {
      const result = this._registry.remove(id);
      return result.ok ? MutationResult.ok(this._rebuilt(result.value), result.events) : result;
    }

    withEngines(engineIds) {
      const policy = new JumpPolicy(this._registry, [...engineIds], this._armed);
      return this._guarded(MutationResult.ok(policy), () => policy.activeBindings());
    }

    /** Projection for persistence: a faithful mirror. */
    toJSON() {
      return {
        schemaVersion: SCHEMA_VERSION,
        armed: this._armed,
        engines: this.engineIds(),
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
        shortcuts: this._registry.shortcuts().map((s) => ({
          id: s.id(),
          key: s.key().toString(),
          baseUrl: s.instance().baseUrl(),
        })),
      };
    }
  }

  JumpPolicy.SCHEMA_VERSION = SCHEMA_VERSION;
  JumpPolicy.MAX_BINDINGS = MAX_BINDINGS;

  JumpPolicy.empty = function () {
    return new JumpPolicy(ShortcutRegistry.empty(), [], true);
  };

  global.Binding = Binding;
  global.JumpPolicy = JumpPolicy;
})(globalThis);
