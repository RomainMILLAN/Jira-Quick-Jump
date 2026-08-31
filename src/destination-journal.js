/**
 * The destination-change journal.
 *
 * A journal of REDIRECTIONS is impossible without webNavigation or tabs -- the
 * very permissions the trust model refuses -- because DNR gives no execution
 * feedback. So we journal the CHANGE, which is better and needs no permission:
 * it catches the hostile import, the compromised sync and the malicious update
 * BEFORE the first jump, whereas a navigation log would only reveal them after
 * credentials had been typed.
 *
 * Never exported, never synced: A JOURNAL THAT TRAVELS BY THE CHANNEL IT IS
 * MEANT TO WATCH IS WORTHLESS -- a compromised sync able to rewrite destinations
 * would also be able to erase the trace of its passage.
 *
 * It is not IN the aggregate; it is a log ABOUT the aggregate: append-only, no
 * shared invariant, hence a separate entry, written AFTER the commit and never
 * inside a mutator (the compare-and-set replays intentions up to three times,
 * and an intention that journals is no longer pure).
 */
(function (global) {
  "use strict";

  const { Platform, VersionedEntry } = global;
  const ENTRY = "destinationJournal";
  const MAX_ENTRIES = 20;

  const empty = { entries: [], acknowledged: true, lastLoggedRev: 0, overflowed: false };

  /**
   * Entries written by an earlier build carry no `type` -- there was only one
   * kind of fact then. Stamping them on READ is what stops the banner, whose
   * whole job is to be believed, from rendering `undefined` after an update. And
   * the journal cannot simply be cleared: it is the evidence.
   */
  const stamp = (entry) =>
    entry && typeof entry === "object" && typeof entry.type === "string"
      ? entry
      : { ...entry, type: "DestinationChanged" };

  const DestinationJournal = {
    async read() {
      const { value } = await VersionedEntry.read(Platform.api.storage.local, ENTRY);
      if (!value || !Array.isArray(value.entries)) return { ...empty };
      return { ...empty, ...value, entries: value.entries.map(stamp) };
    },

    async record(events, rev, source, now) {
      if (events.length === 0) {
        return this._update((current) => ({ ...current, lastLoggedRev: Math.max(current.lastLoggedRev, rev) }));
      }
      return this._update((current) => {
        const arriving = events.map((e) => ({ ...e, when: now, source }));
        const combined = [...arriving, ...current.entries];
        // THE CAP PROTECTS THE EVIDENCE, NOT THE FRESHNESS.
        //
        // Eviction never expels an unacknowledged entry: otherwise an attacker
        // saturates the journal with their own writes and the UNKNOWN fact left
        // by an earlier compromise disappears under the noise of the attack
        // itself. What overflows instead is a STICKY marker -- a camera that no
        // longer films is useless, one that says "tape full" is worth half a tape.
        const kept = [];
        let dropped = 0;
        for (const entry of combined) {
          if (kept.length < MAX_ENTRIES) kept.push(entry);
          else if (entry.acknowledged === false || current.acknowledged === false) dropped += 1;
          else dropped += 1;
        }
        return {
          entries: kept,
          acknowledged: false,
          lastLoggedRev: Math.max(current.lastLoggedRev, rev),
          overflowed: current.overflowed || dropped > 0,
        };
      });
    },

    async acknowledgeAll() {
      return this._update((current) => ({ ...current, acknowledged: true }));
    },

    async clear() {
      return this._update((current) => ({ ...empty, lastLoggedRev: current.lastLoggedRev, acknowledged: true }));
    },

    /** Sticky: it says that changes could NOT BE RECORDED, and it survives an
     *  acknowledgement, because the missing evidence does not come back. */
    overflowed() {
      return this.read().then((journal) => journal.overflowed === true);
    },

    async lastLoggedRev() {
      return (await this.read()).lastLoggedRev;
    },

    _update(change) {
      return VersionedEntry.update(Platform.api.storage.local, ENTRY, (value) => {
        const current = value && Array.isArray(value.entries) ? { ...empty, ...value } : { ...empty };
        return { ok: true, value: change(current), events: [] };
      });
    },
  };

  DestinationJournal.MAX_ENTRIES = MAX_ENTRIES;
  global.DestinationJournal = DestinationJournal;
})(globalThis);
