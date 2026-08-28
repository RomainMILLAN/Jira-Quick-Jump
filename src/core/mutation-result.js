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
  };

  global.MutationResult = MutationResult;
})(globalThis);
