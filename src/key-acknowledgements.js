/**
 * Where a key-scoped acknowledgement lives: storage.local, ALWAYS.
 *
 * A CONTROL THAT TRAVELS BY THE CHANNEL IT IS MEANT TO WATCH IS WORTHLESS. The
 * journal already says that about itself; the same argument applies here, and it
 * is why this is a separate entry rather than a field of Consent.
 *
 * Without it, a compromised sync account writes
 *   { key: <the catch-all form>, consent: { armed: true, acknowledged: ["CATCH_ALL"] } }
 * against a host the user has already granted, and the extension installs a
 * universal redirector with no screen, no click and no banner. Consent.toJSON
 * therefore projects destination-scoped acknowledgements only, and Consent.parse
 * silently drops the rest.
 *
 * THE KEY OF AN ENTRY IS id + baseUrl + nature, not the id alone. An
 * acknowledgement bound to the id recycles: delete the catch-all, reuse its id
 * for one pointing elsewhere, and the old consent survives. Consent given to a
 * catch-all towards catchall.atlassian.net is not consent towards
 * evil-already-granted.net.
 *
 * ABSENT OR CORRUPT MEANS NOT ACKNOWLEDGED. Fail closed, never "we assume so".
 * Which also means: turning sync on loses the acknowledgements on the other
 * devices, so the catch-all disarms itself there. That is the right sense of
 * failure -- every machine sees the warning once, exactly like everything
 * imported arriving disarmed.
 *
 * The limit, stated rather than hidden: a LOCAL attacker writes this entry too.
 * This control does not separate the local attacker, it separates the SYNC
 * CHANNEL -- the same argument, and the same limit, as the journal.
 *
 * READ ONCE BEFORE the compare-and-set and passed in as a snapshot; WRITTEN AFTER
 * the winning commit. PolicyRepository._restore is synchronous and runs inside a
 * mutate closure that VersionedEntry replays up to three times, so it can neither
 * await a read nor perform a write.
 */
(function (global) {
  "use strict";

  const { Platform, VersionedEntry } = global;
  const ENTRY = "keyAcknowledgements";
  // Bounded, because the one entry whose job is to say "no" must not grow
  // unwatched -- and bounded AT THE READING DOOR. What this project writes back
  // holds AT MOST ONE row (one key-scoped kind, one catch-all per policy), so
  // this number does not govern us: it governs what a local writer may have put
  // there before we read. See Acknowledgements.admitting.
  const MAX_ENTRIES = 400;

  /**
   * The row key is INJECTIVE, and a join was not.
   *
   * `[id, baseUrl, nature].join(" ")` reads as a key and is not one: the parts
   * are pasted with a separator that a part could contain, so two different
   * triples can spell the same row. A base URL cannot hold a space today -- the
   * parse refuses whitespace -- which makes this a latent flaw rather than a live
   * one, and latent flaws in a table that decides whether a universal redirector
   * may arm itself are exactly the ones to close early.
   *
   * JSON, because it escapes what it contains: the round trip is total, and the
   * shape is legible to whoever reads the stored entry.
   */
  const rowKey = (shortcut) =>
    JSON.stringify([
      shortcut.id(),
      shortcut.instance().baseUrl(),
      shortcut.key().nature(),
    ]);

  /**
   * The attestations, as a value rather than a bag of rows.
   *
   * IT USED TO BE TWO GESTURES UNDER ONE NAME, with contradictory needs: record()
   * both recorded the living attestations AND pruned the orphans by omission. The
   * second required overwriting, the first required merging -- so no write could
   * be correct, and the one that shipped lost attestations. Measured: a tab
   * acknowledges the catch-all while another commits an unrelated edit, the
   * commit rebuilds the whole table from its own policy, and the click is gone.
   * The user is asked to accept the warning again, which is how a security
   * control teaches people to click it without reading.
   *
   * So: `merged` is additive, associative and idempotent -- safe under the
   * compare-and-set replay -- and `forgetLapsed` is the other gesture, named for
   * what it is. An attestation whose (id, baseUrl, nature) triple no longer
   * exists has NO OBJECT any more; it cannot authorise anything. That is a
   * lapse, not housekeeping.
   *
   * A Map, never an object literal: the rows are keyed by strings from storage,
   * and ShortcutRegistry already argues at length why `obj[key]` is unsafe there.
   */
  class Acknowledgements {
    constructor(rows) {
      this._rows = rows;
    }

    /**
     * The reading door, and the only place the bound is applied.
     *
     * Hostile size only ever arrives HERE: what gets WRITTEN back is pruned by
     * forgetLapsed first, and the honest ceiling there is ONE -- the key scope
     * holds a single kind (CATCH_ALL) and a policy holds a single catch-all. So
     * the bound never governs our own writes; it governs an entry any local
     * writer can inflate before we read it.
     *
     * Excess is REFUSED AT THE DOOR rather than evicted after the fact -- but be
     * precise about what that buys: the `break` below drops whatever sits past the
     * bound, and a LIVE attestation sitting at position 401 is dropped with the
     * rest. It is fail-closed (the shortcut disarms and the user is asked again),
     * never a hole, and it is the same direction this file already states: ABSENT
     * OR CORRUPT MEANS NOT ACKNOWLEDGED. What refusing at the door does buy is
     * that we never un-acknowledge something we had already accepted in the same
     * breath -- which is what evicting after a merge would do.
     */
    static admitting(raw) {
      const rows = new Map();
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return new Acknowledgements(rows);
      for (const [key, kinds] of Object.entries(raw)) {
        if (rows.size >= MAX_ENTRIES) break;
        if (typeof key !== "string" || !Array.isArray(kinds)) continue;
        const kept = kinds.filter(
          (kind) => typeof kind === "string" && global.ShortcutWarning.scopeOf(kind) === "key"
        );
        if (kept.length > 0) rows.set(key, [...new Set(kept)]);
      }
      return new Acknowledgements(rows);
    }

    /** The attestations a policy carries, as an Acknowledgements. */
    static attestedBy(policy) {
      const rows = new Map();
      for (const shortcut of policy.shortcuts()) {
        const kinds = shortcut
          .consent()
          .acknowledgedKinds()
          .filter((kind) => global.ShortcutWarning.scopeOf(kind) === "key");
        if (kinds.length > 0) rows.set(rowKey(shortcut), [...kinds]);
      }
      return new Acknowledgements(rows);
    }

    /** Union. Associative and idempotent, hence safe to replay. */
    merged(other) {
      const rows = new Map(this._rows);
      for (const [key, kinds] of other._rows) {
        rows.set(key, [...new Set([...(rows.get(key) ?? []), ...kinds])]);
      }
      return new Acknowledgements(rows);
    }

    /** Drops what no longer has an object. Never call it with a stale policy. */
    forgetLapsed(policy) {
      const live = new Set(policy.shortcuts().map(rowKey));
      const rows = new Map();
      for (const [key, kinds] of this._rows) {
        if (live.has(key)) rows.set(key, [...kinds]);
      }
      return new Acknowledgements(rows);
    }

    kindsFor(shortcut) {
      // A COPY. Handing the stored array out made this object mutable from the
      // outside -- `ack.kindsFor(s).push("INJECTED")` reached toJSON, i.e. the
      // written entry. An immutable value that lends its insides is not one.
      return [...(this._rows.get(rowKey(shortcut)) ?? [])];
    }

    toJSON() {
      return Object.fromEntries(this._rows);
    }
  }

  const KeyAcknowledgements = {
    ENTRY,
    MAX_ENTRIES,
    // rowKey is NOT exported. Its last outside caller was PolicyRepository._merge,
    // which now asks kindsFor(shortcut); leaving the spelling of a row key on the
    // public surface reopens the string-indexed access this class closed.
    Acknowledgements,

    /** A snapshot, read once, before any compare-and-set. */
    async read() {
      try {
        const { value } = await VersionedEntry.read(Platform.api.storage.local, ENTRY);
        return Acknowledgements.admitting(value);
      } catch {
        // Corrupt reads the same as absent: nothing is acknowledged.
        return Acknowledgements.admitting(undefined);
      }
    },

    /**
     * Records what this commit attests, WITHOUT forgetting what it never saw.
     *
     * The mutate argument is used -- it was ignored, which turned a compare-and-set
     * into a blind overwrite. `policy` must be the WINNING commit, never the
     * snapshot: forgetLapsed is only safe against a policy that already carries
     * whatever the other surface created.
     */
    async record(policy) {
      return VersionedEntry.update(Platform.api.storage.local, ENTRY, (raw) => ({
        ok: true,
        // FORGET FIRST, THEN MERGE -- and the honest reason, measured: with the
        // bound applied in admitting() and merged() uncapped, SWAPPING THESE TWO
        // GIVES THE SAME BYTES. The order is not what saves the click; an uncapped
        // merge is. It is written this way because pruning before adding is the
        // order that keeps the intermediate table small and stays correct if a
        // bound is ever put back on the merge -- not because it is load-bearing
        // today. Saying otherwise would send the next reader to protect the wrong
        // line.
        value: Acknowledgements.admitting(raw)
          .forgetLapsed(policy)
          .merged(Acknowledgements.attestedBy(policy))
          .toJSON(),
        events: [],
      }));
    },
  };

  global.KeyAcknowledgements = KeyAcknowledgements;
})(globalThis);
