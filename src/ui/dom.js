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
    // aria-expanded, and it was MISSING while a caller already relied on it:
    // the "Add a domain" disclosure in sections/engines.js sets it on EVERY
    // render, so Dom.el threw `refusing to set attribute "aria-expanded"` and
    // the whole Engines section went inert for every user, always -- no engine
    // tickable, no domain addable. The allow-list did its job (it refused what
    // it did not know, which is the right direction); what was wrong is that a
    // legitimate ARIA STATE had never been added to it.
    //
    // It is admitted on the same ground as its neighbours above: this list
    // exists to keep URL-bearing and handler-bearing attributes out (href,
    // src, on*), never to ration ARIA. aria-expanded carries a boolean token
    // and nothing a scheme could hide in -- and a disclosure that does not
    // announce whether it is open is a WCAG 4.1.2 failure, not a nicety.
    "aria-expanded",
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

  /**
   * THE BIDI CONTROLS, REMOVED RATHER THAN ISOLATED -- and this replaces a
   * control that did not work.
   *
   * sections.css carried `.ltr-isolate { unicode-bidi: isolate }` under eighteen
   * lines calling itself "a security control, not a typographic nicety: an RTL
   * override inside a host name makes the displayed destination read backwards".
   * The sentence is right about the danger and wrong about the remedy.
   * `unicode-bidi` decides how a sequence relates to its NEIGHBOURS; it does not
   * annul the explicit formatting characters INSIDE it. Measured in Chromium, on
   * the stored string `"https://jira." + U+202E + "moc.live/"`, by reading glyph
   * positions back with Range.getBoundingClientRect:
   *
   *   no rule at all        ->  https://jira./evil.com
   *   unicode-bidi: isolate ->  https://jira./evil.com      <- what shipped
   *   unicode-bidi: bidi-override -> https://jira./evil.com
   *   U+202E removed        ->  https://jira.<U+FFFD>moc.live/
   *
   * NO value of `unicode-bidi` fixes it. Only removing the character does, so
   * that is what this does -- and it REPLACES the character rather than deleting
   * it, because a silent deletion makes the field the user is asked to repair
   * differ from the bytes that are stored, which is the gap the two parsers spend
   * their headers refusing. U+FFFD says "something was here".
   *
   * WHERE IT IS NEEDED, and it is TWO places, not one. The docstring used to say
   * "exactly one place: the quarantine rows", on the argument that "a host on any
   * other screen has survived JiraInstance.parse, hence /^[\x21-\x7e]+$/, so no
   * override can be in it". That sentence is false for the CHANGE BANNER: the
   * facts it prints come back from `storage.local` through
   * DestinationJournal.entryOf, which bounds their LENGTH and nothing else -- they
   * are not re-parsed at render time. So the two surfaces are:
   *
   *   the quarantine rows   a value the parser REFUSED, shown to be repaired
   *   the change banner     a value read back from the journal, shown to be checked
   *
   * Both display a string to be VERIFIED by eye, which is the only property that
   * matters here. `.ltr-isolate` STAYS on the quarantine fields -- isolating the
   * value from the labels around it is still worth having, it was simply never
   * the control the comment claimed.
   *
   * THE SET IS NOT SPELLED HERE, and it is not compiled here either.
   *
   * This file listed the bidi controls alone, while the parsers refuse a wider
   * class -- so a zero-width space (U+200B), a soft hyphen (U+00AD), a NBSP or a
   * U+FEFF reached the repair field intact and hid part of a host name in a field
   * the user is asked to read. Two regexes for one rule, and the narrower one was
   * the one on screen.
   *
   * The first fix made the domain EXPORT its class as a source string, which this
   * file then wrapped in brackets and compiled with `g`. It closed the
   * duplication and opened something worse: a control whose correctness depended
   * on the caller remembering three things, one of which -- the `g` -- silently
   * halves it. `ProjectKey.withoutDeceptiveCharacters` now owns the rule AND its
   * application, and this method is the door to it.
   */
  const Dom = {
    /**
     * A string safe to SHOW, for the two surfaces that display a value to be
     * read rather than trusted. See the note above for why CSS could not do
     * this, and why the class has one author in the domain.
     *
     * It is `Dom`'s and not the section's for the usual reason: the next surface
     * to display untrusted text must find a door, not a recipe -- the same
     * argument as downloadFile and dragHandle below.
     */
    visibleText(raw) {
      // Resolved at CALL TIME, never destructured at the top of the file: the
      // load order must not decide whether a security control exists -- the same
      // reason shortcut-key.js resolves CatchAllKey lazily.
      return global.ProjectKey.withoutDeceptiveCharacters(raw);
    },

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
      // REVOKED ON THE NEXT TURN, never in this one. `click()` SCHEDULES the
      // download; revoking in the same task can cancel it before the browser has
      // read the blob, and the export then silently does nothing -- on the only
      // path by which a user gets their configuration out of here.
      //
      // The leak this used to avoid is bounded and pays for itself: one object URL
      // per export, released a task later, on a page the user closes.
      setTimeout(() => URL.revokeObjectURL(url), 0);
    },

    /**
     * The one place that builds a drag handle. The SECOND reviewed exit of this
     * file, after downloadFile -- `draggable` stays OUT of the whitelist above for
     * the same reason `href` does: a single reviewed exit rather than a widened
     * rule.
     *
     * It said THIRD, "after downloadFile and link". There is no `Dom.link` and
     * there never was: the only external link in the project is written literally
     * in options.html, outside this file. A comment that invokes a door nobody
     * built sends the next reader looking for it -- the same fault rule-set.js
     * names about an assertion cited before it existed.
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
  };

  global.Dom = Dom;
})(globalThis);
