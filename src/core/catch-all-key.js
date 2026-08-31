/**
 * The catch-all key: the one that claims every reference.
 *
 * A SEPARATE FILE ON PURPOSE. project-shortcut.js declares itself the home of
 * the project's security functions and its only way in; putting the permissive
 * type there would dilute the review. This boundary is visible instead: the
 * whole widening of the model fits in this file.
 *
 * ProjectKey.parse is NOT relaxed by a single character. `*` is never a valid
 * ProjectKey value, which is also why the persisted format needs no new field
 * and no tagged union -- the plain string in `key` carries it.
 */
(function (global) {
  "use strict";

  const WRITTEN_FORM = "*";

  class CatchAllKey {
    /** The SOLE owner of the written form. No exported MARKER constant: it would
     *  invite `key.toString() === MARKER` in the UI instead of isCatchAll(). */
    toString() {
      return WRITTEN_FORM;
    }
    equals(other) {
      return other instanceof CatchAllKey;
    }
    isCatchAll() {
      return true;
    }
    /**
     * NOT part of the key protocol, and false on purpose -- an acknowledgeable,
     * arming-blocking CATCH_ALL warning is strictly stronger than a piece of
     * non-blocking advice, and answering true would show two messages for one
     * risk.
     */
    collidesWithOrdinarySearches() {
      return false;
    }

    /**
     * Takes a ProjectKey, never a string. So a catch-all can only ever claim
     * what ProjectKey.parse has already accepted: the closed character set still
     * governs it. It was reused, not widened.
     */
    captures(projectKey) {
      return !global.ReservedPrefix.has(projectKey.toString());
    }

    /**
     * THE HYPHEN ONLY, and this is a security decision rather than a detail.
     *
     * With the space and %20 separators a catch-all would claim "anything I type
     * as two tokens whose second is a number": SALARY 2024, BUDGET 2026, LOI
     * 2024, WINDOWS 11. Those leave for the Jira instance and land in its access
     * logs as /browse/SALARY-2024 -- an outbound data flow, not an availability
     * nuisance. A finite list cannot cover the infinite space of human queries,
     * so the separator is narrowed instead.
     *
     * Named keys keep all three: they are declared one by one, hence consented
     * to one by one.
     */
    separators() {
      return ["-"];
    }

    exampleKey() {
      return global.ProjectKey.parse("EXAMPLE").value;
    }

    toJSON() {
      return WRITTEN_FORM;
    }
  }

  const only = new CatchAllKey();

  /** A value object with no state has exactly one instance. */
  CatchAllKey.only = function () {
    return only;
  };

  global.CatchAllKey = CatchAllKey;
})(globalThis);
