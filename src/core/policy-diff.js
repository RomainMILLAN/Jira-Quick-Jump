/**
 * What changed between two policies, as facts.
 *
 * A comparison between two states is the work of NEITHER state, hence its own
 * file, its own corpus, and two callers: PolicyRepository.apply (the door) and
 * background.reconcile (the window). One implementation, so both paths of the
 * trust model are covered by the same code.
 *
 * THESE ARE NOT DOMAIN EVENTS in the Evans sense: they are not born of a
 * decision, they are born of a DIFF OF PHOTOGRAPHS. Which matters twice. They
 * structurally cannot carry the INTENTION ("the user moved the catch-all") --
 * that signal is `source`, stamped by the writer, and shortcut-registry.js has
 * already written why an inferred source would be worse. And without this
 * paragraph the next reader sees past-tense names, concludes they are emitted at
 * the decision, and puts them back into the mutators, which is where we came
 * from.
 *
 * Computed INSIDE the mutate closure, from the re-read value, hence up to three
 * times -- and only the winning attempt survives (versioned-entry.js). That is
 * safe because it is PURE: calculating is not journaling.
 *
 * `type` is MANDATORY on every fact. A field that shows up only on some of them
 * is a meaningful absence -- the cousin of the null we ban -- so no fact here has
 * an optional field.
 */
(function (global) {
  "use strict";

  // Beyond this many facts in a single commit, one PolicyReplaced stands for all
  // of them. Owned HERE rather than next to the journal's MAX_ENTRIES, because it
  // is a property of the diff and not of the storage: an import of twenty-five
  // destinations must not be able to flush the journal, and above all must not be
  // able to evict an unacknowledged UNKNOWN. The cap protects the EVIDENCE, not
  // the freshness.
  const MAX_FACTS_PER_COMMIT = 5;

  const baseUrlsOf = (policy) => {
    const byId = new Map();
    for (const shortcut of policy.shortcuts()) {
      byId.set(shortcut.id(), shortcut);
    }
    return byId;
  };

  const PolicyDiff = {
    MAX_FACTS_PER_COMMIT,

    /**
     * The three sets, not one. The previous design compared "every id present in
     * both", which is structurally blind to a shortcut that APPEARS -- and an
     * appearance is the most useful gesture available to an attacker, since it
     * needs no existing entry to tamper with.
     */
    between(before, after) {
      if (!before) return [];
      const was = baseUrlsOf(before);
      const is = baseUrlsOf(after);
      const facts = [];

      for (const [id, shortcut] of is) {
        const old = was.get(id);
        if (!old) {
          facts.push(
            shortcut.key().isCatchAll()
              ? { type: "CatchAllAppeared", shortcutId: id, baseUrl: shortcut.instance().baseUrl() }
              : {
                  type: "ShortcutAppeared",
                  shortcutId: id,
                  key: shortcut.key().toString(),
                  baseUrl: shortcut.instance().baseUrl(),
                }
          );
          continue;
        }
        // The whole baseUrl, never the origin: with a path allowed in the base
        // URL, .../jira -> .../jira-fake shares an origin and would be a
        // non-event.
        const oldBaseUrl = old.instance().baseUrl();
        const newBaseUrl = shortcut.instance().baseUrl();
        if (oldBaseUrl !== newBaseUrl) {
          facts.push({
            type: "DestinationChanged",
            shortcutId: id,
            key: shortcut.key().toString(),
            oldBaseUrl,
            newBaseUrl,
          });
        }
      }

      for (const [id, shortcut] of was) {
        if (is.has(id)) continue;
        facts.push(
          shortcut.key().isCatchAll()
            ? { type: "CatchAllRemoved", shortcutId: id, baseUrl: shortcut.instance().baseUrl() }
            : {
                type: "ShortcutRemoved",
                shortcutId: id,
                key: shortcut.key().toString(),
                baseUrl: shortcut.instance().baseUrl(),
              }
        );
      }

      /**
       * ONE GESTURE, ONE FACT.
       *
       * Moving the catch-all changes the effective destination of everything it
       * now shadows, and emitting one fact per affected shortcut would let a
       * single ordinary gesture flush a twenty-entry journal -- including an
       * unacknowledged UNKNOWN from an earlier compromise. So the shadowing is
       * one fact carrying a count.
       *
       * And it NAMES THE HOST. The cheapest sync attack changes no baseUrl at
       * all: it moves the existing catch-all to position zero, and all the
       * traffic leaves for its destination. A fact saying only how many rows
       * changed fate would not tell the user WHERE their traffic goes, while the
       * trust model promises "naming the old and new host". A catch-all always has
       * a destination, so no optional field is introduced.
       */
      const shadowedBefore = new Set(before.registry().shadowedIds());
      const shadowedAfter = after.registry().shadowedIds();
      const newlyShadowed = shadowedAfter.filter((id) => !shadowedBefore.has(id));
      const catchAll = after.catchAllShortcut();
      if (newlyShadowed.length > 0 && catchAll) {
        facts.push({
          type: "ShadowingChanged",
          catchAllId: catchAll.id(),
          catchAllBaseUrl: catchAll.instance().baseUrl(),
          affectedKeys: newlyShadowed
            .map((id) => after.registry().find(id))
            .filter((shortcut) => shortcut !== undefined)
            .map((shortcut) => shortcut.key().toString()),
        });
      }

      if (facts.length > MAX_FACTS_PER_COMMIT) {
        return [{ type: "PolicyReplaced", changedCount: facts.length }];
      }
      return facts;
    },
  };

  global.PolicyDiff = PolicyDiff;
})(globalThis);
