/**
 * How the policy is stored. Nothing more -- in particular, NOT the journal:
 * that has its own lifecycle and its own reason to change, and background.js is
 * already the single writer.
 */
(function (global) {
  "use strict";

  const { Platform, VersionedEntry, StoredPolicy, JumpPolicy, MutationResult } = global;
  const ENTRY = "policy";

  const PolicyRepository = {
    async load() {
      const area = await Platform.storageArea();
      const { value } = await VersionedEntry.read(area, ENTRY);
      return this._restore(value);
    },

    _restore(value) {
      if (value === undefined) return { ok: true, stored: StoredPolicy.empty(), dropped: [] };
      const restored = JumpPolicy.restore(value.policy ?? value);
      if (!restored.ok) return restored;
      const quarantine = [...(Array.isArray(value.quarantine) ? value.quarantine : []), ...restored.quarantine];
      return { ok: true, stored: new StoredPolicy(restored.policy, quarantine), dropped: restored.dropped };
    },

    /**
     * `apply` is not a `save` -- it is a command handler. Calling it `save` would
     * invite the next person to add save(policy) and reopen the lost-update bug.
     *
     * The intention is REPLAYED on conflict, so it must be idempotent; and the
     * whole folder -- policy AND quarantine -- is re-read on every attempt, never
     * memorised at load time, or the surface holding the older snapshot would
     * resurrect the entry the other one just deleted.
     */
    async apply(intention) {
      const area = await Platform.storageArea();
      return VersionedEntry.update(area, ENTRY, (value) => {
        const restored = this._restore(value);
        if (!restored.ok) return restored;
        const result = intention(restored.stored);
        if (!result.ok) return result;
        return { ok: true, value: result.value.toJSON(), events: result.events ?? [] };
      });
    },

    onPolicyChanged(listener) {
      Platform.api.storage.onChanged.addListener((changes, areaName) => {
        if (changes[ENTRY]) listener(areaName);
      });
    },
  };

  global.PolicyRepository = PolicyRepository;
})(globalThis);
