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
            shortcut.isCatchAll()
              ? { type: "CatchAllAppeared", shortcutId: id, baseUrl: shortcut.destination() }
              : {
                  type: "ShortcutAppeared",
                  shortcutId: id,
                  key: shortcut.keyText(),
                  baseUrl: shortcut.destination(),
                }
          );
          continue;
        }
        // The whole baseUrl, never the origin: with a path allowed in the base
        // URL, .../jira -> .../jira-fake shares an origin and would be a
        // non-event.
        const oldBaseUrl = old.destination();
        const newBaseUrl = shortcut.destination();
        if (oldBaseUrl !== newBaseUrl) {
          facts.push({
            type: "DestinationChanged",
            shortcutId: id,
            key: shortcut.keyText(),
            oldBaseUrl,
            newBaseUrl,
          });
        }
        // THE KEY IS A DESTINATION TOO -- for everything typed through it.
        //
        // At constant id, ABC -> ABD changes WHAT IS INTERCEPTED while the base
        // URL stays put, so the diff saw nothing and the banner said nothing. The
        // trust model promises to surface a change of destination before the next
        // jump; a key silently repointed sends a different set of references to
        // the same host, which is the same promise broken from the other side.
        const oldKey = old.keyText();
        const newKey = shortcut.keyText();
        if (oldKey !== newKey) {
          facts.push({ type: "KeyChanged", shortcutId: id, oldKey, newKey, baseUrl: newBaseUrl });
        }
        // ARMING IS THE GESTURE THE ATTACKER NEEDS LAST.
        //
        // key-acknowledgements.js describes the whole attack -- a sync account
        // writing `armed: true` against a host already granted -- and the diff
        // was blind to exactly that transition. Only false -> true is a fact:
        // disarming installs nothing, and reporting it would make the kill switch
        // raise the alarm it exists to silence.
        if (!old.armed() && shortcut.armed()) {
          facts.push({ type: "ShortcutArmed", shortcutId: id, key: newKey, baseUrl: newBaseUrl });
        }
      }

      for (const [id, shortcut] of was) {
        if (is.has(id)) continue;
        facts.push(
          shortcut.isCatchAll()
            ? { type: "CatchAllRemoved", shortcutId: id, baseUrl: shortcut.destination() }
            : {
                type: "ShortcutRemoved",
                shortcutId: id,
                key: shortcut.keyText(),
                baseUrl: shortcut.destination(),
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
      const shadowedBefore = new Set(before.shadowedIds());
      const shadowedAfter = after.shadowedIds();
      const newlyShadowed = shadowedAfter.filter((id) => !shadowedBefore.has(id));
      const catchAll = after.catchAllShortcut();
      if (newlyShadowed.length > 0 && catchAll) {
        facts.push({
          type: "ShadowingChanged",
          catchAllId: catchAll.id(),
          catchAllBaseUrl: catchAll.destination(),
          affectedKeys: newlyShadowed
            .map((id) => after.shortcutFor(id))
            .filter((shortcut) => shortcut !== undefined)
            .map((shortcut) => shortcut.keyText()),
        });
      }

      // THE KILL SWITCH ITSELF, and it was the angle the other three left open.
      //
      // `armed` names TWO scopes in this model -- the policy and the shortcut --
      // and only the shortcut was compared. So: the user presses the emergency
      // stop, a compromised sync writes `armed: true` back, EVERY rule returns,
      // and the diff emitted nothing at all. ShortcutArmed was added citing the
      // attack described in key-acknowledgements.js; this is the cheapest variant
      // of that same attack.
      //
      // `false -> true` only, for the same reason as its per-shortcut twin:
      // reporting a disarm would make the emergency stop raise the alarm it
      // exists to silence.
      if (!before.armed() && after.armed()) {
        facts.push({ type: "PolicyArmed", shortcutCount: after.shortcuts().length });
      }

      // THE INTERCEPTION SURFACE IS PART OF THE DESTINATION.
      //
      // Adding an engine means a whole new set of navigations starts being
      // rewritten. No baseUrl moves, no shortcut appears -- and the detector saw
      // nothing, though the reach of every rule just grew. One fact for the
      // gesture, never one per engine, for the same reason ShadowingChanged is
      // one fact: an ordinary change must not be able to flush the journal.
      const enginesBefore = new Set(before.engineIds());
      const added = after.engineIds().filter((engineId) => !enginesBefore.has(engineId));
      if (added.length > 0) {
        // THE COUNT, not the raw ids. An engine id is a technical handle, and for
        // a custom domain it is TEXT CHOSEN BY WHOEVER WROTE THE POLICY -- so the
        // alarm sentence would have been partly written by the attacker. Harmless
        // for injection (textContent everywhere), corrosive for a surface whose
        // whole job is to be believed. The Access section already lists the
        // origins, in full, where they belong.
        facts.push({ type: "EnginesAdded", engineCount: added.length });
      }

      // AND THE SYMMETRIC HALF, which was missing. A removal shrinks the
      // interception surface, so its direction is reassuring -- but the surface is
      // part of the destination, and this file says so at the top. An adversary
      // who REMOVES the engine you watch and ADDS another produced exactly one
      // fact for two gestures; now it produces two.
      //
      // The count, not the ids, for the reason argued just above.
      const enginesAfter = new Set(after.engineIds());
      const removed = before.engineIds().filter((engineId) => !enginesAfter.has(engineId));
      if (removed.length > 0) {
        facts.push({ type: "EnginesRemoved", engineCount: removed.length });
      }

      if (facts.length > MAX_FACTS_PER_COMMIT) {
        // THE KINDS SURVIVE THE COLLAPSE, and this is a detection property, not a
        // nicety. Moving ONE destination produced DestinationChanged naming the old
        // and the new host; moving SIX produced "8 things changed" -- so making
        // MORE noise made the alarm LESS specific, and the optimal move for the
        // adversary was to be louder. A control whose specificity falls as the
        // attack grows has its gradient backwards.
        //
        // WHY THIS DOES NOT REOPEN THE OBJECTION ABOVE: engine ids are refused two
        // dozen lines up because they are TEXT CHOSEN BY WHOEVER WROTE THE POLICY.
        // Fact TYPES are the opposite -- a closed vocabulary this file writes, so
        // nothing here is authored by the attacker. Sorted, so the sentence does
        // not depend on the order the diff happened to run in.
        const kinds = [...new Set(facts.map((fact) => fact.type))].sort();
        return [{ type: "PolicyReplaced", changedCount: facts.length, kinds }];
      }
      return facts;
    },
  };

  global.PolicyDiff = PolicyDiff;
})(globalThis);
