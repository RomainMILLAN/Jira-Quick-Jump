/**
 * The shape of a shortcut identifier, with a SINGLE owner.
 *
 * It used to be checked at the admission door only ("a string of 1 to 64
 * characters"), and StoredPolicy.promote walked straight past that door: it
 * reuses `raw.id` taken FROM QUARANTINE -- attacker-controlled by hypothesis --
 * and calls register directly. Blindly hardening the front door left open the
 * one the suspicious entries actually use.
 *
 * So the shape is owned here and enforced by register, which every door goes
 * through. It is a crypto.randomUUID() by construction, so the constraint costs
 * nothing and closes a class: an id like `a"] , [data-field="del` would either
 * throw a SyntaxError that kills a whole options section, or select a DIFFERENT
 * element, in a page running with the extension's own privileges.
 *
 * Refuse rather than clean, applied to a field that had escaped it.
 */
(function (global) {
  "use strict";

  const ID = /^[A-Za-z0-9_-]{1,64}$/;

  const ShortcutId = {
    isWellFormed(value) {
      return typeof value === "string" && ID.test(value);
    },

    parse(value) {
      if (!ShortcutId.isWellFormed(value)) {
        return {
          ok: false,
          code: "ENTRY_BAD_ID",
          message: "A shortcut needs an identifier.",
        };
      }
      return { ok: true, value };
    },
  };

  global.ShortcutId = ShortcutId;
})(globalThis);
