/**
 * The folder that carries the aggregate: the policy PLUS the quarantine.
 *
 * The envelope is not the aggregate -- but a folder that holds an invariant is an
 * object, not a data structure. The invariant:
 *
 *     an entry is in the policy OR in quarantine, never both, never neither.
 *
 * With a bare literal, "fix this entry" -- which is a register PLUS a removal
 * from quarantine -- could not be atomic: the register succeeds, the removal is
 * lost on a conflict, and the entry exists twice. The very invariant quarantine
 * was invented to hold would have had no owner able to hold it.
 *
 * Lives on the repository side, never in core/: the policy must never hold
 * unvalidated strings.
 */
(function (global) {
  "use strict";

  const { MutationResult, ShortcutAdmission } = global;

  class StoredPolicy {
    constructor(policy, quarantine) {
      this._policy = policy;
      this._quarantine = quarantine;
    }

    policy() { return this._policy; }
    quarantined() { return [...this._quarantine]; }
    quarantinedCount() { return this._quarantine.length; }

    withPolicy(policy) {
      return new StoredPolicy(policy, this._quarantine);
    }

    /** "Fix": goes back through the ONE door and may legitimately fail. */
    promote(index, key, instance) {
      const raw = this._quarantine[index];
      if (raw === undefined) {
        return MutationResult.refused("UNKNOWN_QUARANTINED", "This entry is no longer in quarantine.");
      }
      const id = typeof raw?.id === "string" && raw.id.length > 0 ? raw.id : global.crypto.randomUUID();
      const registered = this._policy.register(id, key, instance);
      if (!registered.ok) return registered;
      const quarantine = this._quarantine.filter((_, i) => i !== index);
      return MutationResult.ok(new StoredPolicy(registered.value, quarantine), registered.events);
    }

    /** Deleting is a deliberate gesture by the user, never a side effect. */
    dropQuarantined(index) {
      if (this._quarantine[index] === undefined) {
        return MutationResult.refused("UNKNOWN_QUARANTINED", "This entry is no longer in quarantine.");
      }
      return MutationResult.ok(new StoredPolicy(this._policy, this._quarantine.filter((_, i) => i !== index)));
    }

    toJSON() {
      return { policy: this._policy.toJSON(), quarantine: this._quarantine };
    }
  }

  StoredPolicy.empty = function () {
    return new StoredPolicy(global.JumpPolicy.empty(), []);
  };

  global.StoredPolicy = StoredPolicy;
})(globalThis);
