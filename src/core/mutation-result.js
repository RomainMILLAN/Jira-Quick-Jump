/**
 * The single shape every mutation returns.
 *
 * There are exactly three return shapes in this project: a mutation result, an
 * admission report (see jump-policy.js) and an installation report (see
 * rule-installer.js). Nothing else half-imitates the shape of a neighbour.
 *
 * `events` is ALWAYS present, defaulting to []. A field that shows up only on
 * some operations is a meaningful absence -- the cousin of the null we ban
 * everywhere else -- and would force every caller to write `r.events ?? []`,
 * which is a presence test, which is the mistake.
 *
 * THE INVARIANT WAS FALSE, AND THE PRESENCE TESTS IT FORBIDS WERE IN THE CODE.
 *
 * Every parse in the project -- ProjectKey, JiraInstance, Consent, ShortcutId,
 * CustomEngine, ShortcutKey -- returns `{ ok: false, code, message }` with NO
 * events, and mutators USED TO hand those refusals straight back to their
 * callers -- `register` returned the parse's refusal verbatim. So `versioned-entry.js` wrote
 * `result.events ?? []` and `section-host.js` wrote `result.events && …` -- the
 * two presence tests this paragraph bans, for exactly the reason it describes.
 *
 * `adopting()` is the fix, and it is deliberately not a rewrite of the parses: a
 * parse answers "can this string become a value", which is a different question
 * from "did this mutation happen", and merging the two vocabularies would make
 * ProjectKey.parse depend on the aggregate's result type. The mutator that passes
 * a refusal ON is the one that owes the shape, so that is where it is added.
 */
(function (global) {
  "use strict";

  /**
   * THE VOCABULARY OF WHAT WE DID NOT TAKE -- written once, here, because it used
   * to have FIVE words for what turned out to be two questions.
   *
   * `refused`, `dropped`, `quarantine`, `skipped` and `unreadable` were spread over
   * forty files, and that is precisely why a cause could travel from the worker to
   * the page under three different names and be read by nobody at the far end.
   *
   * Two axes, and they do NOT exclude each other -- an entry can be refused AND put
   * in quarantine:
   *
   *   WHO DECIDED          refused    the domain said no, with a code
   *                        unreadable nobody could decide: the bytes made no sense
   *   WHERE IT WENT        quarantine kept, repairable, shown to the user
   *                        (nowhere)  the default: it is simply not in the policy
   *
   * `dropped` is gone as a synonym of `refused`. It survives in exactly two places,
   * and in neither does it mean "the domain said no":
   *   - `orderDropped`, a reordering ABANDONED because the list moved underneath;
   *   - `skipUnitIncomplete`, a rule dropped WITH THE GROUP it belongs to.
   *
   * `skipped` is FROZEN, and not because it is the best word: it is a key written
   * into storage.local by install-outcome.js and read back from receipts written by
   * earlier builds. Renaming it would need a migration, and a migration for a word
   * is not worth its risk. It means "not installed, and here is why".
   *
   * ------------------------------------------------------------------------
   *
   * WHICH SHAPE A LOOKUP TABLE TAKES -- the second convention this file owns,
   * here for the same reason as the first: it was decided eight times, in two
   * notations, and a file where one table is hardened and its neighbour is not
   * teaches the next reader that the rule is optional.
   *
   *   A KEY THAT CROSSES A FRONTIER      ->  `new Map([...])`, read with `.get()`
   *   A KEY THAT IS A LITERAL OF OURS    ->  `Object.assign(Object.create(null), {...})`
   *
   * The frontier is the configuration, the journal, the DNR store, an imported
   * file -- anywhere the key is authored by somebody else.
   *
   * WHY A MAP AND NOT A HARDENED OBJECT, on that side. Both stop the prototype
   * walk; only one stops the MISTAKE. `Object.create(null)` keeps `table[key]`
   * writable and working, so the day somebody drops the `Object.create(null)` in
   * a refactor nothing goes red -- the guard is a habit. A Map makes the bracket
   * INEXPRESSIBLE: the error stops being possible instead of being caught.
   *
   * MEASURED, and this is why the rule exists rather than being taste.
   * interception/search-engine-catalog.js held its shapes in an object literal
   * read as `SHAPES[shape]`, with `shape` validated only as `/^[a-z-]{1,32}$/`.
   * `constructor` matches that pattern AND lives on Object.prototype, so the
   * lookup answered the Object function -- truthy -- and the guard whose whole job
   * was "an unknown shape is filtered here" let it through. A TypeError left the
   * rule factory from inside a loop nothing catches, the installer purged
   * everything, and NOT ONE RULE was installed: no catch-all, no named shortcut,
   * on every device the synchronisation reached.
   *
   * The seven object literals that remain are keyed by words this repository
   * writes -- a diagnosis code, a warning kind, a priority band, a separator --
   * and they are hardened as defence in depth, not as the control.
   */

  const MutationResult = {
    ok(value, events = []) {
      return { ok: true, value, events };
    },

    refused(code, message) {
      return { ok: false, code, message, events: [] };
    },

    /**
     * Takes a refusal from a PARSE and gives it the mutation shape.
     *
     * The parses live upstream of this vocabulary on purpose -- they answer about
     * a string, not about a mutation -- so they are not rewritten. What was wrong
     * is that mutators returned their refusals UNCHANGED, letting a shape without
     * `events` escape into a channel that promises one.
     */
    adopting(refusal) {
      return MutationResult.refused(refusal.code, refusal.message);
    },
  };

  global.MutationResult = MutationResult;
})(globalThis);
