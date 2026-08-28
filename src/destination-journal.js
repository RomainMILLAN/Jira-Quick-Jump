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

  const empty = { entries: [], acknowledged: true, lastLoggedRev: 0 };

  const DestinationJournal = {
    async read() {
      const { value } = await VersionedEntry.read(Platform.api.storage.local, ENTRY);
      return value && Array.isArray(value.entries) ? { ...empty, ...value } : { ...empty };
    },

    async record(events, rev, source, now) {
      if (events.length === 0) {
        return this._update((current) => ({ ...current, lastLoggedRev: Math.max(current.lastLoggedRev, rev) }));
      }
      return this._update((current) => ({
        entries: [...events.map((e) => ({ ...e, when: now, source })), ...current.entries].slice(0, MAX_ENTRIES),
        acknowledged: false,
        lastLoggedRev: Math.max(current.lastLoggedRev, rev),
      }));
    },

    async acknowledgeAll() {
      return this._update((current) => ({ ...current, acknowledged: true }));
    },

    async clear() {
      return this._update((current) => ({ ...empty, lastLoggedRev: current.lastLoggedRev, acknowledged: true }));
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
