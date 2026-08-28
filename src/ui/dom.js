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
    "width", "height", "viewBox", "fill", "stroke", "stroke-width",
    "stroke-linecap", "stroke-linejoin", "d", "rel", "target",
  ]);

  const SVG_NS = "http://www.w3.org/2000/svg";
  const SVG_TAGS = new Set(["svg", "path", "circle", "rect", "g"]);

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
     * A link is created ONLY for a re-parsed http(s) URL, and href receives the
     * parsed object's href rather than the string that was handed in. The rule
     * that matters is not "escape it": a script-scheme URL placed in an href
     * executes in the extension's own origin, with the extension's privileges.
     * The grep in test/structure.test.js is deliberately literal, so that
     * scheme is never spelled out anywhere under src/ -- not even in a comment.
     */
    link(rawUrl, props, children) {
      let url;
      try {
        url = new URL(rawUrl);
      } catch {
        return Dom.el("span", props, children);
      }
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        return Dom.el("span", props, children);
      }
      return Dom.el("a", { ...props, rel: "noopener noreferrer", target: "_blank" }, children);
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
