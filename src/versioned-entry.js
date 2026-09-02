/**
 * A compare-and-set over one storage entry.
 *
 * Two clients: the policy and the destination journal. The journal must not be
 * the only unprotected write path in the project -- especially since it is the
 * one carrying the evidence. Two interleaved read-modify-writes lose an entry,
 * and losing a journal entry is not losing a log line: it is losing the only
 * signal the change detector exists to produce.
 */
(function (global) {
  "use strict";

  const ATTEMPTS = 3;

  const VersionedEntry = {
    async read(area, name) {
      const stored = await area.get(name);
      const envelope = stored[name];
      return envelope && typeof envelope === "object"
        ? { rev: Number(envelope.rev) || 0, value: envelope.value }
        : { rev: 0, value: undefined };
    },

    /**
     * A BARE set of the same envelope, for an entry that has nothing to
     * compare-and-set.
     *
     * It exists so the envelope literal `{ rev, value }` stays with its only
     * author. A client that wrote it by hand would pierce this membrane from one
     * side while believing in it from the other -- and the format would then have
     * two owners, which is how the two of them drift.
     *
     * It THROWS when the area refuses, where update() converts a rejection into
     * { ok: false, code: "QUOTA_EXCEEDED" }. That difference is load-bearing:
     * a caller with no compare-and-set has no !ok branch to reach, so an
     * invented one would be dead code with a live-looking guard over it.
     *
     * The `rev` policy belongs to the CALLER: this entry has no accumulation to
     * protect, so `rev` here exists for one reason only -- to guarantee that
     * storage.onChanged fires. See install-outcome.js.
     */
    async put(area, name, value, rev) {
      await area.set({ [name]: { rev, value } });
    },

    /**
     * `mutate` receives the freshly re-read value and returns
     * { ok, value, events } | { ok: false, code, message }. It is REPLAYED on
     * conflict, which is why every intention must be idempotent and absolute.
     */
    async update(area, name, mutate) {
      for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
        const current = await this.read(area, name);
        const result = mutate(current.value);
        if (!result.ok) return result;
        try {
          await area.set({ [name]: { rev: current.rev + 1, value: result.value } });
        } catch (error) {
          return { ok: false, code: "QUOTA_EXCEEDED", message: String(error), events: [] };
        }
        const after = await this.read(area, name);
        if (after.rev === current.rev + 1) {
          // Only the WINNING attempt's events are kept, never the accumulation
          // of all three.
          return { ok: true, value: result.value, events: result.events ?? [], rev: after.rev };
        }
      }
      return {
        ok: false,
        code: "CONFLICT_EXHAUSTED",
        message: "Another window changed the configuration at the same time.",
        events: [],
      };
    },
  };

  VersionedEntry.ATTEMPTS = ATTEMPTS;
  global.VersionedEntry = VersionedEntry;
})(globalThis);
