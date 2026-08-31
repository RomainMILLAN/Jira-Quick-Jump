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

    /**
     * "Fix": goes back through the ONE door and may legitimately fail.
     *
     * `key` is OPTIONAL. A quarantined catch-all cannot be repaired by a typed
     * key -- the options page has no right to type `*` -- so when the raw entry's
     * own key still parses, it is READMITTED as it stands. That is a named door
     * on the same side of the membrane, and it is what keeps a legitimately
     * quarantined catch-all (a device that stayed on an older build wrote it)
     * from being unrepairable except by deletion.
     *
     * The id goes through ShortcutId inside register, so a fresh UUID replaces
     * anything malformed: this entry comes from quarantine, hence by hypothesis
     * from an attacker.
     */
    promote(index, key, instance) {
      const raw = this._quarantine[index];
      if (raw === undefined) {
        return MutationResult.refused("UNKNOWN_QUARANTINED", "This entry is no longer in quarantine.");
      }
      const readmitted = key === undefined ? global.ShortcutKey.parse(raw?.key) : { ok: true, value: key };
      if (!readmitted.ok) return readmitted;
      const id = global.ShortcutId.isWellFormed(raw?.id) ? raw.id : global.crypto.randomUUID();
      const registered = this._policy.register(id, readmitted.value, instance);
      if (!registered.ok) return registered;
      const quarantine = this._quarantine.filter((_, i) => i !== index);
      return MutationResult.ok(new StoredPolicy(registered.value, quarantine));
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
