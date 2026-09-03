/**
 * What the host holds instead of a section: the section, plus what the HOST knows
 * about it.
 *
 * FIVE AUDIT POINTS WERE ONE MISSING OBJECT. The host used to graft `root` and
 * `dirty` onto the section objects from the outside -- written in one file, read in
 * another, a public mutable field shared between two modules. Encapsulation was not
 * violated there; it had never been placed. And because `blank()` and `reconcile()`
 * had to be TOTAL (a `section.blank?.()` is a presence test, which this repository
 * bans), all eight sections declared them, six of them empty, word for word -- with
 * a structure test COUNTING those empty bodies by their indentation to make sure
 * nobody forgot the ceremony.
 *
 * COMPOSITION, NOT TWO PROTOCOLS. The alternative -- `Renderable` and
 * `Reconcilable`, the host testing membership -- would have brought the presence
 * test back through the front door. Here the wrapper supplies the neutral halves,
 * so a section declares only what it actually does, and the host still calls a
 * total member every time.
 *
 * The host talks to this. Nothing reaches through it to the section: `dirty` and
 * `root` belong to the host's view of the page, which is exactly what they always
 * were.
 */
(function (global) {
  "use strict";

  class Section {
    /**
     * `dirty` starts false and `root` undefined -- neither is a meaningful absence:
     * a section that has not been mounted has no node, and one that has never been
     * rendered owes no redraw.
     */
    constructor(section) {
      this._section = section;
      this._root = undefined;
      this._dirty = false;
    }

    /** Where this section paints. Set once, by mount(). */
    root() {
      return this._root;
    }

    /** WHETHER IT OWES A REDRAW -- the host's own bookkeeping, not the section's. */
    isDirty() {
      return this._dirty;
    }

    mount(node, ctx) {
      this._root = node;
      this._section.mount(node, ctx);
    }

    /**
     * THE TWO NEUTRAL HALVES. A section that has nothing to blank, or no optimistic
     * state to give up, simply does not declare them -- and the host still calls a
     * member that exists.
     */
    blank() {
      if (typeof this._section.blank === "function") this._section.blank();
    }

    reconcile(stored, ctx) {
      if (typeof this._section.reconcile === "function") this._section.reconcile(stored, ctx);
    }

    /** Held by the user: repainting under their hands would steal the caret. */
    hold() {
      this._dirty = true;
    }

    /**
     * TOTAL LIKE THE OTHER TWO. A section with no state to paint -- the preview,
     * whose whole output is driven by its own input handler -- simply does not
     * declare one, and the host's loop still calls a member that exists.
     *
     * The latch clears FIRST, so a section that throws is not left owing a redraw
     * that would replay the same throw on the next pass.
     */
    async render(stored, ctx) {
      this._dirty = false;
      if (typeof this._section.render === "function") await this._section.render(stored, ctx);
    }

    /**
     * The section paints its own alarming state; this only keeps the loop going and
     * makes sure nothing is left owing a redraw, which would replay the same throw.
     */
    fail(error) {
      this._dirty = false;
      if (typeof this._section.fail === "function") this._section.fail(error);
    }

    /** The wrapped object, for the few host checks that ask about the section
     *  itself (an open editor, a drag in progress). */
    inner() {
      return this._section;
    }
  }

  global.Section = Section;
})(globalThis);
