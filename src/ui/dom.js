/**
 * The only way this project builds DOM.
 *
 * There is deliberately NO html`` helper and no string templating: if one
 * existed, someone would eventually pass an unescaped value through it and the
 * review would not catch it. Everything here goes through createElement and
 * textContent, and attributes are set from a closed list.
 *
 * An extension page runs with the extension's own privileges, so an injection
 * here is not a defaced page — it is full access to the configuration and to the
 * rule API. `test/structure.test.js` fails the build if a dangerous sink appears
 * anywhere under src/.
 */
(function (global) {
  "use strict";

  const ATTRS = new Set([
    "class", "id", "type", "for", "dir", "lang", "role", "title", "value",
    "placeholder", "disabled", "checked", "hidden", "tabindex", "name",
    "aria-label", "aria-checked", "aria-pressed", "aria-invalid", "aria-live",
    "aria-hidden", "aria-describedby", "data-id", "data-kind", "data-field",
    // aria-disabled, never disabled, at the ends of a reorderable list: a
    // disabled button is not focusable, so a keyboard user who moves a row to
    // position one loses focus to <body>. aria-atomic goes with the live region
    // that announces the move.
    //
    // Still deliberately absent, and for two different kinds of reason:
    //   readonly -- unconditionally. A read-only field is focusable and useless;
    //     static text is more honest, and no condition can change that.
    //   draggable -- its one legitimate use has its own reviewed exit, see
    //     Dom.dragHandle below. Keeping it out of the list is what stops a
    //     <li draggable> from hijacking text selection inside a field.
    "aria-disabled", "aria-atomic",
    "width", "height", "viewBox", "fill", "stroke", "stroke-width",
    "stroke-linecap", "stroke-linejoin", "d",
  ]);

  const SVG_NS = "http://www.w3.org/2000/svg";
  // ONLY what ATTRS can actually furnish. `circle`, `rect` and `g` were listed
  // here while cx/cy/r/x/y were absent from the whitelist above, so building one
  // THREW on its first attribute -- a trap that read as an offer. A tag belongs
  // in this set when the attributes that make it a shape are in ATTRS, and not
  // before.
  const SVG_TAGS = new Set(["svg", "path"]);

  const Dom = {
    el(tag, props = {}, children = []) {
      const node = SVG_TAGS.has(tag)
        ? document.createElementNS(SVG_NS, tag)
        : document.createElement(tag);

      for (const [name, value] of Object.entries(props)) {
        if (value === undefined || value === null || value === false) continue;
        if (name === "text") {
          node.textContent = String(value);
          continue;
        }
        if (name.startsWith("on") && typeof value === "function") {
          node.addEventListener(name.slice(2).toLowerCase(), value);
          continue;
        }
        if (!ATTRS.has(name)) {
          throw new Error(`refusing to set attribute "${name}"`);
        }
        node.setAttribute(name, value === true ? "" : String(value));
      }

      for (const child of [].concat(children)) {
        if (child === null || child === undefined || child === false) continue;
        node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
      }
      return node;
    },

    /**
     * The one place that builds a download. `href` and `download` are deliberately
     * absent from the attribute whitelist above, so an object URL cannot be
     * attached to an element from anywhere else — a single reviewed exit rather
     * than a widened rule.
     */
    downloadFile(filename, text) {
      const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    },

    /**
     * The one place that builds a drag handle. The THIRD reviewed exit of this
     * file, after downloadFile and link -- `draggable` stays OUT of the whitelist
     * above for the same reason `href` does: a single reviewed exit rather than a
     * widened rule.
     *
     * Three things this buys that a whitelist entry cannot:
     *
     * 1. `draggable` is an ENUMERATED attribute, not a boolean. Dom.el turns
     *    `true` into setAttribute(name, ""), and draggable="" means `auto`, which
     *    for a <span> means NOT draggable. A whitelist entry would therefore let
     *    someone write a silently inert handle, and the obvious repair is to move
     *    the attribute onto the <li> -- which hijacks text selection inside the
     *    Destination field and starts a row drag from inside an input. Here the
     *    string is written literally, once.
     * 2. It is a <span> and not a <button>: a focusable control that does nothing
     *    on Enter is a worse outcome than an aria-hidden affordance whose
     *    accessible twin -- the two move buttons, two cells away -- sits next to
     *    it. Which is also why the handle is aria-hidden: assistive technology
     *    sees the buttons, never this.
     * 3. Remove those buttons and this becomes a WCAG 2.2 failure (2.1.1
     *    Keyboard, 2.5.7 Dragging Movements), not a style question. A structure
     *    test holds that line.
     *
     * The signature takes CHILDREN ONLY, never a props bag. The day it forwards
     * props, the whitelist becomes bypassable by parameter, in the very file that
     * owns it. Everything that is not `draggable` goes through Dom.el -- which is
     * why the class name and the tooltip live here rather than at the call site.
     */
    dragHandle(children) {
      const node = Dom.el("span", {
        class: "f-grip",
        "aria-hidden": "true",
        title: global.Platform.t("dragToReorder", "Drag to reorder"),
      }, children);
      node.setAttribute("draggable", "true");
      return node;
    },

    /**
     * Refuses a file or a link dropped anywhere on this document.
     *
     * The default action of an un-prevented drop is TO NAVIGATE THE DOCUMENT. A
     * dropped file sends the tab to a local file; a dropped link sends it
     * off-origin. Neither executes anything -- browsers refuse navigation-by-drop
     * towards a scripting scheme, and this file's own grep refuses to spell that
     * scheme even in a comment -- so the impact is a loss of context, not code.
     *
     * But in this project that loss is not harmless: `pagehide` triggers
     * flush(), which calls commit() WITHOUT awaiting it. A navigation therefore
     * kills the document mid-write, and the last intention is lost in silence --
     * a reordering included.
     *
     * Narrow on purpose: a drag of selected TEXT into the Destination field must
     * keep working, and a row drag carries its own private type. Only the two
     * formats that navigate are refused.
     *
     * Note the asymmetry in casing, because the two rules look contradictory
     * three lines apart: DataTransfer.setData LOWERCASES the format it is given,
     * which is why the row type is written in lower case -- but `types` reports
     * the file entry as "Files", with the capital the specification mandates, and
     * that one is NOT normalised. Harmonise them and this guard silently stops
     * matching.
     */
    refuseFileDrops(target) {
      const navigates = (event) => {
        const types = event.dataTransfer ? event.dataTransfer.types : [];
        return types.includes("Files") || types.includes("text/uri-list");
      };
      const refuse = (event) => {
        if (navigates(event)) event.preventDefault();
      };
      target.addEventListener("dragover", refuse);
      target.addEventListener("drop", refuse);
      return () => {
        target.removeEventListener("dragover", refuse);
        target.removeEventListener("drop", refuse);
      };
    },

    clear(node) {
      while (node.firstChild) node.removeChild(node.firstChild);
    },

    /** Idempotent: never writes a value the field already has, so the caret stays put. */
    setValue(input, value) {
      if (input.value !== value) input.value = value;
    },
  };

  global.Dom = Dom;
})(globalThis);
