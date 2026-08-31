/**
 * Pointer reordering for a list of rows -- an ANTICORRUPTION LAYER against the
 * HTML5 drag-and-drop API, whose model really is corrupt:
 *
 *   - `dragenter` must be accepted separately or Chrome never offers a drop;
 *   - `dragleave` fires on every child crossed, because the listeners are
 *     delegated on the list rather than the rows;
 *   - the ABSENCE of preventDefault on `dragover` means "refuse", and its absence
 *     on `drop` means "navigate away from this page";
 *   - Firefox lowercases the format handed to setData, so a capital letter in the
 *     private type makes types.includes() false for ever, on one browser, with no
 *     console error.
 *
 * Its job description follows from that framing: EVERYTHING THE SPECIFICATION
 * MAKES STRANGE LIVES IN HERE, AND NOTHING ELSE COMES IN. No word of the domain
 * crosses this boundary -- not `shortcut`, not `catch-all`, not `shadowed`. It
 * speaks ids and indices, and it asks its host two questions.
 *
 * It also has NO notion of a row that cannot be dragged. A row without a handle
 * simply never starts a gesture, while still carrying a data-id and therefore
 * still being a target -- the mechanism is the absence of a handle, not a rule.
 * That is what keeps the catch-all's pinning on the affordance side.
 *
 * The gesture state is healed by `pointerdown`/`dragstart` REASSIGNING it rather
 * than by anyone releasing it: `dragend` can go missing (Escape, a drop outside
 * the window), and the same cure the host applies to its own latch applies here.
 * The residual risk is covered twice over, because the drop also demands that the
 * id still be present in the freshly read order: a stale id is refused at the
 * door, not by memory.
 */
(function (global) {
  "use strict";

  /**
   * A private format, never text/plain: a plain-text payload can be dropped into
   * any field on the page -- including the Destination input two columns away --
   * and into any other page.
   *
   * Lower case throughout, because setData normalises the format and a capital
   * would make the check below permanently false.
   *
   * NEUTRAL, and carrying a CONSTANT rather than an id. The authority is the
   * local gesture, which only exists in the document where dragstart happened, so
   * the payload is decorative -- but it TRAVELS: a drop released outside the
   * surface hands whatever it carries to whatever is listening. Naming the
   * product there, or shipping an internal identifier, would give something away
   * for no benefit. Removing data from a flow is always cheaper than defending it.
   */
  const DRAG_TYPE = "application/x-row-reorder";

  /** Which half of the row the pointer is in. Three numbers, no DOM: the one
   *  piece of this file's arithmetic that a test can reach. */
  const dropsBefore = (top, height, y) => y < top + height / 2;

  const RowReorder = {
    DRAG_TYPE,
    dropsBefore,

    /**
     * @param list      the <ol> that owns the rows. Created once by the section
     *                  and only ever emptied of its children, so listeners
     *                  delegated here survive every redraw -- per-row listeners
     *                  created in render() would be exactly what breaks if a
     *                  render ever did slip through.
     * @param orderedIds () => the ids in display order. NOT counted from the DOM:
     *                  drafts are appended after the saved rows, so an index read
     *                  off the list's children would be wrong.
     * @param moveTo    (id, toIndex) => void. The single write path, shared with
     *                  the keyboard arrows.
     */
    on(list, { orderedIds, moveTo }) {
      let draggedId = null;
      let draggedRow = null;
      let mark = null;

      const unmark = () => {
        if (mark) mark.classList.remove("is-drop-before", "is-drop-after");
        mark = null;
      };

      const clear = () => {
        unmark();
        if (draggedRow) draggedRow.classList.remove("is-dragging");
        draggedRow = null;
        draggedId = null;
      };

      const rowAt = (node) => (node && node.closest ? node.closest(".row") : null);

      list.addEventListener("dragstart", (event) => {
        const handle = event.target.closest ? event.target.closest(".f-grip") : null;
        // No handle means this is something else entirely -- a native text drag
        // out of an input, which must stay untouched. Never preventDefault here:
        // that would cancel the gesture instead of shaping it.
        if (!handle) return;
        const row = rowAt(handle);
        const id = row && row.getAttribute("data-id");
        if (!id) return;
        draggedId = id;
        draggedRow = row;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(DRAG_TYPE, "row");
        // The whole row as the drag image, so the gesture reads without a CSS
        // clone. Captured AT THIS CALL, hence before is-dragging is added: the
        // image shows the row as it looked at rest.
        if (event.dataTransfer.setDragImage) event.dataTransfer.setDragImage(row, 12, 12);
        row.classList.add("is-dragging");
      });

      const over = (event) => {
        if (!draggedId) return;
        // A dragged file, a URL or selected text can never reorder anything.
        if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
        const row = rowAt(event.target);
        const id = row && row.getAttribute("data-id");
        // No data-id (a draft row, the 7px gutter, the list's padding) or the
        // source itself: drop the mark and return WITHOUT preventing. The refusal
        // is the default, and the browser draws the "no drop" cursor for free.
        if (!id || id === draggedId) {
          unmark();
          return;
        }
        // MANDATORY. Without it the drop is refused and no drop event is ever
        // dispatched.
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const box = row.getBoundingClientRect();
        const before = dropsBefore(box.top, box.height, event.clientY);
        if (mark !== row) unmark();
        mark = row;
        row.classList.remove(before ? "is-drop-after" : "is-drop-before");
        row.classList.add(before ? "is-drop-before" : "is-drop-after");
      };

      // dragenter needs the same body: Chrome only offers a drop if the first
      // entry into the target was accepted.
      list.addEventListener("dragenter", over);
      list.addEventListener("dragover", over);

      list.addEventListener("dragleave", (event) => {
        // Delegation makes a leave fire on every child crossed, so only a pointer
        // that actually left the list clears the indicator.
        if (!list.contains(event.relatedTarget)) unmark();
      });

      list.addEventListener("drop", (event) => {
        // MANDATORY, and first: an un-prevented drop is treated as a navigation
        // of this page. And the event must keep bubbling: the host listens for the
        // drop too, and that is what resumes its deferred render. A structure test
        // holds that line, and it greps literally -- which is why the call that
        // would break it is not even named here.
        event.preventDefault();
        const payload = event.dataTransfer.getData(DRAG_TYPE);
        const row = rowAt(event.target);
        const targetId = row && row.getAttribute("data-id");
        const before = mark === row && row && row.classList.contains("is-drop-before");
        const movedId = draggedId;
        // Released BEFORE the reorder: moveTo re-renders, so keeping the reference
        // would hold a detached node until dragend.
        clear();

        // Five checks, capability first and payload second -- the cloakroom hands
        // the coat back against its own token, not against the name the customer
        // announces.
        if (!movedId) return;                                  // no gesture in THIS document
        if (payload !== "row") return;                         // not our sentinel
        const shown = orderedIds();                            // read FRESH
        if (shown.indexOf(movedId) === -1) return;             // removed elsewhere mid-gesture
        if (!targetId || targetId === movedId) return;         // a draft, the gutter, or itself
        const without = shown.filter((id) => id !== movedId);
        const at = without.indexOf(targetId);
        if (at === -1) return;                                 // stale target

        moveTo(movedId, at + (before ? 0 : 1));
      });

      // The only event guaranteed on a cancelled gesture (Escape, a drop outside),
      // so ALL cleanup lives here and drop merely does the work.
      list.addEventListener("dragend", clear);

      // Same cure as the host's latch: reassigning beats accumulating, so the next
      // press heals a gesture whose dragend never arrived.
      list.addEventListener("pointerdown", clear);

      return { release: clear };
    },
  };

  global.RowReorder = RowReorder;
})(globalThis);
