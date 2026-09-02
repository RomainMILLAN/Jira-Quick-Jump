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
