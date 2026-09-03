/**
 * Whether the user is physically holding part of the screen, and what happens
 * when they let go.
 *
 * NOT named "grip": a structure test forbids that word in the host, because it is
 * what a row's DRAG HANDLE is called -- and the host must not learn that rows have
 * handles. Two senses under one word is how a rule stops being checkable.
 *
 * Extracted from the 442-line closure in section-host.js. This was five inner
 * functions, one captured variable and six DOM listeners tangled among the
 * render loop -- so the rule "never repaint under someone's fingers" could not be
 * read in one place, nor tested at all.
 *
 * TWO WAYS TO HOLD, and they are not the same:
 *
 *   POINTER / DRAG -- repainting does not merely look wrong, it DESTROYS the
 *                     gesture: removing the source node can suppress `dragend`
 *                     entirely, leaving the page in a dragging state for good.
 *   EDITING        -- the caret is in a field. Repainting rebuilds the node and
 *                     the user loses what they were typing, mid-word.
 *
 * DERIVED FROM THE DOM, never from a flag a section sets. That is what keeps this
 * host ignorant of what any section contains: it asks which subtree the event
 * landed in, and sections stay unaware they are being watched.
 */
(function (global) {
  "use strict";

  class HoldWatch {
    /**
     * `sections` is read lazily, because a section's `root` is grafted after
     * mount; `onRelease` is called when the last hold ends.
     */
    constructor(sections, onRelease) {
      this._sections = sections;
      this._onRelease = onRelease;
      this._held = undefined;
      this._listeners = [];
    }

    /** The section whose subtree this node belongs to, if any. */
    sectionAt(node) {
      return this._sections.find((section) => section.root() && section.root().contains(node));
    }

    /** Is this section held -- by a pointer, a drag, or a caret inside it? */
    holding(section) {
      // ASKED, not read. The host used to graft `root` onto the section object;
      // it now lives on the Section wrapper, which answers root() instead.
      return Boolean(section.root()) && (section === this._held || this.editing(section.root()));
    }

    /** Is the caret inside this subtree? */
    editing(root) {
      const active = document.activeElement;
      if (!active || !root.contains(active)) return false;
      const tag = active.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || active.isContentEditable;
    }

    /**
     * Releases the latch and replays whatever was deferred.
     *
     * A blur handler alone cannot do this: pointerdown on a row's grip does not
     * blur anything, so the hold would never end.
     */
    release() {
      this._held = undefined;
      this._onRelease();
    }

    /**
     * Starts watching. Every listener is remembered so `stop()` can take them all
     * back -- a host torn down while its listeners survive is a leak that repaints
     * a detached tree.
     */
    watch(root) {
      const on = (target, type, handler) => {
        target.addEventListener(type, handler);
        this._listeners.push([target, type, handler]);
      };
      const grab = (event) => { this._held = this.sectionAt(event.target); };

      on(document, "pointerdown", grab);
      on(document, "pointerup", () => this.release());
      on(document, "dragstart", grab);
      on(document, "dragend", () => this.release());
      // focusin/focusout, never blur: they bubble, and the caret can move between
      // two fields of the same section without the hold ever ending.
      on(root, "focusin", () => this.release());
      on(root, "focusout", () => { if (!this._held) this.release(); });
    }

    stop() {
      for (const [target, type, handler] of this._listeners) {
        target.removeEventListener(type, handler);
      }
      this._listeners = [];
      this._held = undefined;
    }
  }

  global.HoldWatch = HoldWatch;
})(globalThis);
