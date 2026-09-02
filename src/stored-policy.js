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

  /**
   * A quarantined entry is addressed BY WHAT IT IS, never by where it sits.
   *
   * Both gestures took an index, captured from a rendered snapshot -- and
   * VersionedEntry REPLAYS intentions against a re-read folder. If the winner
   * promoted or deleted another entry first, the loser's replay landed on a
   * DIFFERENT ROW: the user deletes something they never pointed at. That is the
   * exact contradiction of the rule the registry states for everything else --
   * "EVERY mutation is addressed BY IDENTITY, never by key".
   *
   * The content is the identity here, because a quarantined entry has no trusted
   * id to offer -- that is why it is in quarantine. Two byte-identical entries
   * share a fingerprint, and picking either is correct: they are the same entry
   * twice.
   */
  const fingerprintOf = (entry) => {
    try {
      return JSON.stringify(entry) ?? "undefined";
    } catch {
      // A cyclic or unserialisable entry cannot have come from storage, but the
      // folder must not throw on the way to refusing it.
      return "unserialisable";
    }
  };

  class StoredPolicy {
    constructor(policy, quarantine) {
      this._policy = policy;
      this._quarantine = quarantine;
    }

    /**
     * THE INVARIANT THIS FOLDER EXISTS FOR, asked out loud.
     *
     * The header states it -- "an entry is in the policy OR in quarantine, never
     * both, never neither" -- and nothing checked it. PolicyRepository then
     * concatenated two sources of quarantine without deduplicating, so an entry
     * repaired on one device and re-quarantined by another reader existed TWICE.
     * An object that holds an invariant has to be able to say whether it holds.
     *
     * A QUESTION, not a throw: this is reconstituted from a foreign shape, and
     * refusing to exist would lose the very configuration quarantine protects.
     * The answer belongs to whoever can act on it.
     */
    duplicatedIds() {
      const held = new Set(this._policy.orderedIds());
      const seen = new Set();
      const duplicated = [];
      for (const raw of this._quarantine) {
        const id = raw && typeof raw.id === "string" ? raw.id : undefined;
        if (id === undefined) continue;
        if (held.has(id) && !seen.has(id)) {
          seen.add(id);
          duplicated.push(id);
        }
      }
      return duplicated;
    }

    policy() { return this._policy; }
    /** Each entry with the handle the caller must give back to act on it. */
    quarantined() {
      return this._quarantine.map((entry) => ({ entry, fingerprint: fingerprintOf(entry) }));
    }
    quarantinedCount() { return this._quarantine.length; }

    _indexOf(fingerprint) {
      return this._quarantine.findIndex((entry) => fingerprintOf(entry) === fingerprint);
    }

    withPolicy(policy) {
      return new StoredPolicy(policy, this._quarantine);
    }

    /**
     * TWO NAMED DOORS, where there was one method and an optional argument.
     *
     * `promote(index, key, instance)` carried the whole difference in `key ===
     * undefined` -- a parameter whose ABSENCE meant "readmit the entry's own
     * key". That is the meaningful absence this project bans, and it hid a dead
     * path: the only caller parsed the key first with ProjectKey.parse, which
     * REFUSES `*`, so a legitimately quarantined catch-all could never reach the
     * branch written to save it. The header promised it was repairable; it was
     * only deletable.
     */
    promoteAs(fingerprint, key, instance, freshId) {
      return this._readmit(fingerprint, { ok: true, value: key }, instance, freshId);
    }

    /** Readmits the entry under the key it already carries -- the only way back
     *  for a quarantined catch-all, whose key no interface may type. */
    readmit(fingerprint, instance, freshId) {
      const at = this._indexOf(fingerprint);
      if (at === -1) {
        return MutationResult.refused("UNKNOWN_QUARANTINED", "This entry is no longer in quarantine.");
      }
      return this._readmit(fingerprint, global.ShortcutKey.parse(this._quarantine[at]?.key), instance, freshId);
    }

    /**
     * `freshId` IS STRUCK BY THE CALLER, and that is what makes this replayable.
     *
     * It used to call crypto.randomUUID() in here -- inside an intention that
     * VersionedEntry re-runs up to three times, so each attempt invented a
     * different identity. The outcome happened to be one entry (the losing values
     * are thrown away), but the letter of the contract every other intention
     * keeps was broken, and the same reasoning that makes `register` idempotent
     * says why: the id comes from OUTSIDE, so a retry is a no-op rather than a
     * second creation.
     *
     * It also removes the last unin­jected source of entropy in a domain method.
     */
    _readmit(fingerprint, readmitted, instance, freshId) {
      const at = this._indexOf(fingerprint);
      if (at === -1) {
        return MutationResult.refused("UNKNOWN_QUARANTINED", "This entry is no longer in quarantine.");
      }
      const raw = this._quarantine[at];
      // ADOPTED, not passed through: this is a PARSE refusal, and it is leaving
      // through a mutation channel that promises `events`.
      if (!readmitted.ok) return MutationResult.adopting(readmitted);
      // A FRESH IDENTITY on two conditions, not one.
      //
      // Malformed was already handled here, with the reason that still applies:
      // this entry comes from quarantine, hence by hypothesis from an attacker.
      // ALREADY HELD falls under exactly the same hypothesis, and leaving it out
      // was a LOSS OF DATA rather than a refusal: a quarantined entry carrying a
      // living id, with the same key and the same instance, landed on register's
      // replay no-op -- so it left quarantine WITHOUT ANYTHING BEING ADDED, a
      // silent merge into someone else's shortcut.
      //
      // Striking a new id costs nothing the user can miss: register is called
      // WITHOUT a consent, so the entry is readmitted disarmed, and its fresh
      // (id, baseUrl, nature) triple holds no attestation -- the destination
      // warnings must be acknowledged again, while looking at the destination.
      const held = global.ShortcutId.isWellFormed(raw?.id) && this._policy.shortcutFor(raw.id) !== undefined;
      const keepsItsOwn = global.ShortcutId.isWellFormed(raw?.id) && !held;
      if (!keepsItsOwn && !global.ShortcutId.isWellFormed(freshId)) {
        return MutationResult.refused(
          "MISSING_FRESH_ID",
          "This entry needs a new identifier before it can be readmitted."
        );
      }
      const id = keepsItsOwn ? raw.id : freshId;
      const registered = this._policy.register(id, readmitted.value, instance);
      if (!registered.ok) return registered;
      const quarantine = this._quarantine.filter((_, i) => i !== at);
      return MutationResult.ok(new StoredPolicy(registered.value, quarantine), [
        // The readmitted entry is NOT the shortcut the user lost: fresh identity,
        // fresh consent. Saying so is the difference between recovering a
        // shortcut and being handed a new one that looks like it.
        { type: "QuarantinedReadmitted", key: readmitted.value.toString(), renamed: id !== raw?.id },
      ]);
    }

    /** Deleting is a deliberate gesture by the user, never a side effect. */
    dropQuarantined(fingerprint) {
      const at = this._indexOf(fingerprint);
      if (at === -1) {
        return MutationResult.refused("UNKNOWN_QUARANTINED", "This entry is no longer in quarantine.");
      }
      return MutationResult.ok(new StoredPolicy(this._policy, this._quarantine.filter((_, i) => i !== at)));
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
