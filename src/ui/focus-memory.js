/**
 * Where the focus was, and how to put it back after the list is rebuilt.
 *
 * `Dom.clear` removes every node, so the focus falls to `<body>`. Only the
 * reorder arrows used to be restored -- so a change arriving from the other
 * surface while the user was on the arm switch, the bin or a text field dropped
 * them out of the list entirely, mid-task, with no way back but the Tab key.
 *
 * IT REMEMBERS TWO STRINGS, never a node. The node is about to be destroyed, so
 * holding a reference would restore focus to a detached element -- which reads as
 * "focus lost" to a screen reader while looking fine in a debugger.
 *
 * And it never builds a selector by interpolation. `querySelector` with an
 * attacker-influenced id would be a selector injection in a page running with the
 * extension's own privileges, which is why the lookup walks the rows and compares
 * attribute values instead.
 */
(function (global) {
  "use strict";

  const FocusMemory = {
    /** The row and the control the user is on, if any. */
    capture(container) {
      const active = document.activeElement;
      if (!active || !container || !container.contains(active)) return undefined;
      const field = active.getAttribute("data-field");
      if (!field) return undefined;
      const row = active.closest(".row");
      const rowId = row ? row.getAttribute("data-id") : null;
      return rowId ? { rowId, field } : undefined;
    },

    /** Puts it back on the freshly built node that plays the same part. */
    restore(container, held) {
      if (!container || !held) return;
      for (const row of container.querySelectorAll(".row")) {
        if (row.getAttribute("data-id") !== held.rowId) continue;
        for (const selector of [".btn", ".f", ".sw"]) {
          for (const control of row.querySelectorAll(selector)) {
            if (control.getAttribute("data-field") === held.field) {
              control.focus();
              return;
            }
          }
        }
      }
    },
  };

  global.FocusMemory = FocusMemory;
})(globalThis);
