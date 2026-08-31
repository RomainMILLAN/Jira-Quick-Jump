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
  // unwatched. Pruning happens at reconstitution, where the live set is known.
  const MAX_ENTRIES = 400;

  const rowKey = (shortcut) =>
    [shortcut.id(), shortcut.instance().baseUrl(), shortcut.key().isCatchAll() ? "catch-all" : "named"].join(" ");

  const KeyAcknowledgements = {
    ENTRY,
    MAX_ENTRIES,
    rowKey,

    /** A snapshot, read once, before any compare-and-set. */
    async read() {
      try {
        const { value } = await VersionedEntry.read(Platform.api.storage.local, ENTRY);
        if (!value || typeof value !== "object" || Array.isArray(value)) return {};
        const rows = {};
        for (const [key, kinds] of Object.entries(value)) {
          if (!Array.isArray(kinds)) continue;
          rows[key] = kinds.filter(
            (kind) => typeof kind === "string" && global.ShortcutWarning.scopeOf(kind) === "key"
          );
        }
        return rows;
      } catch {
        // Corrupt reads the same as absent: nothing is acknowledged.
        return {};
      }
    },

    /** Written after the commit, by the same single writer as the journal. */
    async record(policy) {
      const rows = {};
      for (const shortcut of policy.shortcuts()) {
        const kinds = shortcut
          .consent()
          .acknowledgedKinds()
          .filter((kind) => global.ShortcutWarning.scopeOf(kind) === "key");
        if (kinds.length > 0) rows[rowKey(shortcut)] = kinds;
      }
      // Pruning is implicit and total: only live (id, baseUrl, nature) triples
      // are written back, so an orphan row cannot outlive its shortcut.
      const bounded = Object.fromEntries(Object.entries(rows).slice(0, MAX_ENTRIES));
      return VersionedEntry.update(Platform.api.storage.local, ENTRY, () => ({
        ok: true,
        value: bounded,
        events: [],
      }));
    },
  };

  global.KeyAcknowledgements = KeyAcknowledgements;
})(globalThis);
