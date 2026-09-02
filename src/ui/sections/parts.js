/**
 * The bricks every section builds with.
 *
 * Extracted from options-sections.js, which had grown to 1667 lines holding
 * eight sections, four sentence catalogues, two policy comparators, the
 * validation, the persistence and the SVG rendering. Nothing could be loaded
 * alone, nothing could be reused, and every merge on that screen was a merge on
 * all of it.
 *
 * These are the pieces with no opinion about the domain: a node, an icon, a
 * switch, a label. A section that needs a sentence asks sentences.js; a section
 * that needs a decision asks the core.
 */
(function (global) {
  "use strict";

  const { Dom, Platform } = global;

  const t = (k, f) => Platform.t(k, f);
  const el = Dom.el;

  const icon = (d, size = 14) =>
    el("svg", {
      width: size, height: size, viewBox: "0 0 24 24", fill: "none",
      stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round",
      "stroke-linejoin": "round", "aria-hidden": "true",
    }, [].concat(d).map((path) => el("path", { d: path })));

  const TRASH = "M4 6h16M9 6V4h6v2M18 6l-1 14H7L6 6";
  const CHEVRON_UP = "M6 15l6-6 6 6";
  /**
   * Six dots without widening the attribute whitelist: a zero-length subpath with
   * a round cap renders as a disc, so cx/cy/r never have to be allowed. icon() is
   * not reused -- it hardcodes stroke-width 2 on a 24-unit box, which would draw
   * 1.2px dots.
   */
  const GRIP_DOTS = ["M6 4h.01", "M6 8h.01", "M6 12h.01", "M10 4h.01", "M10 8h.01", "M10 12h.01"];
  const gripIcon = () =>
    el("svg", {
      width: 16, height: 16, viewBox: "0 0 16 16", fill: "none",
      stroke: "currentColor", "stroke-width": 2.5, "stroke-linecap": "round",
      "stroke-linejoin": "round", "aria-hidden": "true",
    }, GRIP_DOTS.map((d) => el("path", { d })));
  const CHEVRON_DOWN = "M6 9l6 6 6-6";

  /** Host in weight, path dimmed -- but the path is ALWAYS rendered. */
  const destination = (instance, className = "dest") => {
    const { origin, path } = instance.parts();
    return el("span", { class: className }, [
      el("span", { class: "host", text: origin }),
      path ? el("span", { class: "path", text: path }) : null,
    ]);
  };

  const label = (text, note) =>
    el("div", { class: "lbl" }, [text, note ? el("span", { class: "note", text: note }) : null]);

  /** `field` names the control so the focus can be put back on it after a
   *  repaint: the node the user was on no longer exists. */
  const toggle = (checked, onToggle, ariaLabel, disabled, field) =>
    el("button", {
      class: "sw", role: "switch", "aria-checked": String(checked),
      "aria-label": ariaLabel, disabled, "data-field": field, onClick: onToggle,
    });

  global.SectionParts = {
    t, el, icon, gripIcon, destination, label, toggle,
    TRASH, CHEVRON_UP, CHEVRON_DOWN,
  };
})(globalThis);
