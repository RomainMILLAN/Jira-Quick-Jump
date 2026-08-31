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
      // READ ONCE, BEFORE any compare-and-set. _restore is synchronous and runs
      // inside a replayed mutate closure, so it can never await this itself.
      const acknowledgements = await global.KeyAcknowledgements.read();
      const { value } = await VersionedEntry.read(area, ENTRY);
      return this._restore(value, acknowledgements);
    },

    /**
     * The separate context of key-scoped acknowledgements is CLOSED BACK HERE,
     * before the aggregate exists.
     *
     * Merging them at reconstitution is what lets activeBindings() keep its
     * signature: injecting the store into the keystone instead would make it
     * parameterised, and rule-factory, jump-preview, origin-requirements and the
     * badge could then each pass a different set. A cell whose organelles must be
     * supplied from outside is no longer a cell.
     */
    _restore(value, acknowledgements = {}) {
      if (value === undefined) return { ok: true, stored: StoredPolicy.empty(), dropped: [] };
      const restored = JumpPolicy.restore(value.policy === undefined ? value : value.policy);
      if (!restored.ok) return restored;
      const merged = this._merge(restored.policy, acknowledgements);
      const quarantine = [...(Array.isArray(value.quarantine) ? value.quarantine : []), ...restored.quarantine];
      return { ok: true, stored: new StoredPolicy(merged, quarantine), dropped: restored.dropped };
    },

    _merge(policy, acknowledgements) {
      let merged = policy;
      for (const shortcut of policy.shortcuts()) {
        const kinds = acknowledgements[global.KeyAcknowledgements.rowKey(shortcut)];
        if (!Array.isArray(kinds)) continue;
        for (const kind of kinds) {
          const next = merged.acknowledge(shortcut.id(), kind);
          if (next.ok) merged = next.value;
        }
      }
      return merged;
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
      const acknowledgements = await global.KeyAcknowledgements.read();
      let committed;
      const result = await VersionedEntry.update(area, ENTRY, (value) => {
        const restored = this._restore(value, acknowledgements);
        if (!restored.ok) return restored;
        const outcome = intention(restored.stored);
        if (!outcome.ok) return outcome;
        committed = outcome.value;
        // THE SINGLE PRODUCER, computed here from the RE-READ value -- hence up
        // to three times, and only the winning attempt survives. Safe because it
        // is PURE: calculating is not journaling.
        const facts = global.PolicyDiff.between(restored.stored.policy(), outcome.value.policy());
        return { ok: true, value: outcome.value.toJSON(), events: facts };
      });
      // Written AFTER the winning commit, by the same single writer as the
      // journal: a key-scoped acknowledgement never travels with the policy.
      if (result.ok && committed) await global.KeyAcknowledgements.record(committed.policy());
      return result;
    },

    /**
     * Moving between storage areas is explicit, one direction at a time.
     *
     * Leaving sync REMOVES the entry rather than abandoning it: the point of
     * switching to local is that the host names stop living in the browser
     * account. Copies already replicated to other devices or to the provider's
     * backups may survive, and the UI says so rather than implying otherwise.
     */
    async migrateTo(target) {
      const from = await Platform.storageArea();
      const { value } = await VersionedEntry.read(from, ENTRY);
      await Platform.setStorageArea(target);
      const to = await Platform.storageArea();
      if (to === from) return MutationResult.ok(target);
      try {
        if (value !== undefined) await to.set({ [ENTRY]: { rev: 1, value } });
      } catch (error) {
        await Platform.setStorageArea(target === "sync" ? "local" : "sync");
        return MutationResult.refused("QUOTA_EXCEEDED", String(error));
      }
      if (target === "local") await from.remove(ENTRY);
      return MutationResult.ok(target);
    },

    onPolicyChanged(listener) {
      Platform.api.storage.onChanged.addListener((changes, areaName) => {
        if (changes[ENTRY]) listener(areaName);
      });
    },
  };

  global.PolicyRepository = PolicyRepository;
})(globalThis);
