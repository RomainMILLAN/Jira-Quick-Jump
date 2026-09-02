/**
 * THE RESULT of the last installation: TWO facts, and nothing else.
 *
 * SEPARATE from InstalledProjection -- two lifetimes, two owners of the truth:
 * one is a PROOF consumed by PolicyDiff, the other a RECEIPT consumed by a
 * sentence. Merging them would mean a failed install erased the detector's
 * comparison base.
 *
 * WHY IT EXISTS AT ALL. The options page called RuleInstaller.report() with
 * three arguments, so `reality` was {} and report() re-fabricated
 * `installed: true`. The page therefore owned the labels INSTALL_FAILED and
 * CATCH_ALL_NOT_INSTALLED and could STRUCTURALLY never display either. This
 * entry is the channel that carries the worker's answer to the page.
 *
 * WHAT A LOCAL ATTACKER GETS, and it is not "one more false sentence": the badge
 * cannot structurally report a failed installation (`applied` counts the rules
 * that SURVIVED, and a DNR rejection is atomic). The status line is the ONLY
 * channel for that class, and `installed` the only entry point of a rank
 * sitting ABOVE DISARMED.
 *
 * WHAT FORGING DOES EXACTLY, and no more: forging { installed: true } SILENCES
 * THE STATUS LINE, the only organ able to report a failed install. It touches
 * NEITHER the badge, which counts the rules really installed, NOR the banner,
 * which reads the journal. An earlier draft wrote "it turns the detector off"
 * two lines after writing "the status line is the only channel of that class":
 * the two sentences contradicted each other, and the second one is the true one.
 *
 * WHAT BOUNDS THE RISK: storage.local, NEVER sync. The compromised sync that
 * reconcile() watches for therefore CANNOT write it. Only a LOCAL attacker can,
 * and such an attacker already holds the journal and InstalledProjection: no new
 * capability.
 */
(function (global) {
  "use strict";

  const { Platform, VersionedEntry } = global;
  // Enough to name the causes without turning a receipt into a log.
  const MAX_SKIPPED = 10;
  const ENTRY = "installOutcome";

  /**
   * A `rev` that DIFFERS FROM THE PREVIOUS ENTRY -- which is the property to
   * name, NOT "monotonic".
   *
   * `lastRev` dies with the MV3 worker, so after a restart `rev` is Date.now(),
   * and if the clock has gone BACKWARDS in the meantime the new `rev` is LOWER
   * than the stored one. Nothing depends on that -- storage.onChanged fires as
   * soon as the BYTES change, up or down -- but a name promising a guarantee the
   * mechanism does not provide is a name the next reader will build on.
   *
   * Date.now() alone is not enough: hundreds to thousands of awaited operations
   * fit inside one millisecond, so two consecutive record() calls of the same
   * pair of booleans would write two BYTE-IDENTICAL envelopes and the doorbell
   * would stay silent. Math.max closes that, and keeps the argument against an
   * in-memory counter: reset to 0 by the worker's death, Date.now() takes over.
   *
   * The residual hole -- the clock landing back on the exact millisecond of the
   * stored rev -- is NAMED NEGLIGIBLE rather than hidden behind a strong word.
   */
  let lastRev = 0;
  const nextRev = () => {
    const rev = Math.max(Date.now(), lastRev + 1);
    lastRev = rev;
    return rev;
  };

  const InstallOutcome = {
    /**
     * At most two booleans. NEVER THROWS.
     *
     * It RECONSTRUCTS rather than filters: filtering would let `rules` and
     * `applied` ride along, and report() spreads nothing precisely so that a
     * forgeable entry cannot overwrite a computed field. The preview PAINTS
     * report.rules.
     *
     * VersionedEntry.read validates the ENVELOPE ONLY -- on an absent entry it
     * returns { rev: 0 } with value === undefined, so a naive `value.installed`
     * THROWS, and that is the NORMAL case: fresh profile, first opening.
     *
     * The GUARD below is verbatim InstalledProjection.read's. The RETURN is not:
     * that file returns a FIXED key set. This is therefore the one variable-shape
     * DTO of the batch, which is ASSUMED, not ignored -- its single reader,
     * report(), closes it back into named fields in the same function, and
     * JumpPolicy.diagnose tests `typeof !== "boolean"`. The day it gains a second
     * reader, it goes to fixed keys.
     */
    async read() {
      try {
        const { value } = await VersionedEntry.read(Platform.api.storage.local, ENTRY);
        // `skipped` is ALWAYS an array, on every path: the page maps over it, and
        // a shape that varies is exactly what this file is criticised for. The two
        // BOOLEANS keep their variable presence, deliberately -- absent is the
        // third term there, and collapsing it to false is the fail-open this whole
        // module exists to avoid.
        if (!value || typeof value !== "object") return { skipped: [] };
        const out = {};
        if (typeof value.installed === "boolean") out.installed = value.installed;
        if (typeof value.coverageSatisfied === "boolean") out.coverageSatisfied = value.coverageSatisfied;
        // THE CAUSES TRAVEL WITH THE RECEIPT. They were produced by the worker,
        // returned by _install, and then dropped on the floor -- so every named
        // reason in Re2Budget.REASONS (RUN_OVER_BUDGET, GUARDS_NOT_A_PARTITION,
        // PREFIX_NOT_KEY_SHAPED...) existed only in a value nobody kept, and the
        // options page rendered `skipped.length` from an array it always built
        // empty. Six named causes for a counter that read zero.
        //
        // ALWAYS AN ARRAY, never absent: the page maps over it.
        out.skipped = Array.isArray(value.skipped)
          ? value.skipped
              .filter((s) => s && typeof s.code === "string" && typeof s.subject === "string")
              .slice(0, MAX_SKIPPED)
          : [];
        return out;
      } catch {
        return { skipped: [] };
      }
    },

    /**
     * RECONSTRUCTS ON WRITE as read() does on read: at most two keys, never a
     * rest.
     *
     * It THROWS if storage.local refuses; it does not return { ok: false }. This
     * is a BARE set -- no compare-and-set, so CONFLICT_EXHAUSTED does not exist
     * for this entry -- and it is sync()'s catch that turns a refusal into
     * forget(). A compare-and-set would buy nothing here: the receipt is
     * ABSOLUTE, non-accumulative and single-writer, unlike the journal whose
     * concatenation the CAS protects.
     */
    async record({ installed, coverageSatisfied, skipped }) {
      const value = {};
      if (typeof installed === "boolean") value.installed = installed;
      if (typeof coverageSatisfied === "boolean") value.coverageSatisfied = coverageSatisfied;
      // Bounded: a receipt is a receipt, not a log. What matters to the reader is
      // that something was refused and why, not the exhaustive list.
      if (Array.isArray(skipped) && skipped.length > 0) value.skipped = skipped.slice(0, MAX_SKIPPED);
      await VersionedEntry.put(Platform.api.storage.local, ENTRY, value, nextRev());
    },

    /**
     * Erases ITS OWN entry, keeps ENTRY private, and NEVER THROWS. It RETURNS
     * NOTHING -- "it never throws" is its whole contract.
     *
     * `remove` consumes no quota and is no compare-and-set: it goes through in
     * exactly the two worlds where record() fails. And it fires
     * storage.onChanged, so the erasure reaches open pages, which fall back to
     * INSTALL_STATE_UNKNOWN -- EXCEPT if the key is absent: on a quota that was
     * dead from the start, record() never wrote, remove notifies nothing, and
     * open pages learn nothing. That residue -- set dead, remove dead, get alive
     * -- leaves the reassuring receipt standing, and it is the batch's assumed
     * hole.
     */
    async forget() {
      try {
        await Platform.api.storage.local.remove(ENTRY);
      } catch {
        /* the receipt stays as it is; the caller has nothing better to try */
      }
    },

    /**
     * The doorbell. It FILTERS THE AREA, which onPolicyChanged deliberately does
     * not -- the policy may live in sync. Without the filter, any writer of
     * storage.sync would wake every open page.
     */
    onRecorded(listener) {
      Platform.api.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === "local" && changes[ENTRY]) listener();
      });
    },
  };

  global.InstallOutcome = InstallOutcome;
})(globalThis);
