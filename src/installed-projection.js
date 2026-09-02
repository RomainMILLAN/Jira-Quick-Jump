/**
 * The projection of the LAST POLICY INSTALLED, so that a change can be detected
 * across a service worker restart.
 *
 * background.js kept `lastKnown` in memory, and reconcile returned dry on null.
 * In MV3 the worker is killed after about thirty seconds of inactivity, so a
 * write pushed by storage.sync almost always lands on a COLD worker: it starts,
 * lastKnown is null, reconcile exits, and lastKnown is then initialised WITH THE
 * ATTACKER S VALUE. No event, no badge, ever. A camera that resets to "nothing
 * unusual" at every power cut, and the attacker cuts the power.
 *
 * The `lastLoggedRev` field of the journal proves the design had anticipated a
 * persistent detector. It was never wired. We wire it rather than cite it.
 *
 * IT IS A PROJECTION, NOT A DIGEST. PolicyDiff must be able to NAME the old and
 * the new host -- the trust model promises exactly that -- and a hash could only
 * ever say that something changed. So the entry holds the previous policy own
 * JSON, read back through JumpPolicy.restore, because your own storage is a
 * foreign system.
 *
 * storage.local, NEVER sync, via VersionedEntry: this is the second entry that
 * carries evidence. A local attacker writes it too -- same limit as the journal,
 * and it is stated rather than implied.
 */
(function (global) {
  "use strict";

  const { Platform, VersionedEntry, JumpPolicy } = global;
  const ENTRY = "installedProjection";

  const InstalledProjection = {
    ENTRY,

    /**
     * The policy as last installed, or undefined.
     *
     * A read that fails is treated exactly like an absent one, and the caller
     * turns that into an UNKNOWN fact rather than into silence -- otherwise the
     * lastKnown hole is moved thirty lines, not closed.
     */
    async read() {
      try {
        const { value, rev } = await VersionedEntry.read(Platform.api.storage.local, ENTRY);
        if (!value || typeof value !== "object") return { policy: undefined, rev: rev || 0 };
        const restored = JumpPolicy.restore(value.policy === undefined ? value : value.policy);
        return { policy: restored.ok ? restored.policy : undefined, rev: rev || 0 };
      } catch {
        return { policy: undefined, rev: 0 };
      }
    },

    /**
     * Written AFTER reconciliation and only when the rules were actually applied.
     *
     * Writing it after a failed install would leave the comparison base stale, so
     * every wake-up would re-diff the same gap and re-journal it -- filling a
     * twenty-entry journal with duplicates and evicting the very UNKNOWN a
     * compromise left behind.
     *
     * NO `loggedRev` HERE ANY MORE. The field claimed, in writing, to make the
     * write idempotent -- "the same policy revision is never journalled twice" --
     * and nothing read it to decide anything. reconcile took it from the
     * projection and handed it straight back to the journal, which did
     * Math.max(x, x): a self-referential loop that could not progress, on a field
     * carrying two different meanings depending on the writer.
     *
     * The waterline belongs to the journal, which is the only object that can
     * both raise it and consult it -- and it now does, inside its own
     * compare-and-set. A field whose writer and reader are two different modules
     * goes decorative again; a question asked of its owner does not.
     */
    async record(policy) {
      return VersionedEntry.update(Platform.api.storage.local, ENTRY, () => ({
        ok: true,
        value: { policy: policy.toJSON() },
        events: [],
      }));
    },
  };

  global.InstalledProjection = InstalledProjection;
})(globalThis);
