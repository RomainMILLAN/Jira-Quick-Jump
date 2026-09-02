/**
 * A DOM small enough to read, large enough to MOUNT THE REAL UI.
 *
 * The audit's heaviest finding on the test side: `options-sections.js`,
 * `section-host.js` and `ui/dom.js` -- 2070 lines -- were exercised by NOTHING
 * but regular expressions over their own source. No test ever proved a section
 * mounts, renders, or survives a repaint, which is why every user-visible defect
 * in that code was invisible to a green suite.
 *
 * NOT a browser, and it does not pretend to be one. It implements exactly the
 * surface this project uses -- measured, not guessed: createElement,
 * createElementNS, appendChild/removeChild, textContent, setAttribute, hidden,
 * value, disabled, classList, addEventListener plus a dispatch, querySelector
 * limited to the two forms the code writes, focus and activeElement.
 *
 * NODES ARE SEALED, so writing a property this fake does not implement throws in
 * strict mode instead of being quietly kept. Reading an unimplemented property
 * still answers `undefined` -- that is JavaScript, and pretending otherwise would
 * be the second lie. What is implemented is implemented FAITHFULLY: `hidden`
 * agrees between the attribute and the property, `textContent` includes the
 * node's own text as well as its children. Both got that wrong at first, and the
 * second bug made a witness pass before the gesture it was testing.
 */
const SIMPLE = /^[.#]?[\w-]+$/;

class FakeClassList {
  constructor(node) {
    this._node = node;
  }
  _set() {
    return new Set(String(this._node._attrs.class || "").split(/\s+/).filter(Boolean));
  }
  _write(set) {
    this._node._attrs.class = [...set].join(" ");
  }
  add(...names) {
    const set = this._set();
    for (const name of names) set.add(name);
    this._write(set);
  }
  remove(...names) {
    const set = this._set();
    for (const name of names) set.delete(name);
    this._write(set);
  }
  contains(name) {
    return this._set().has(name);
  }
  toggle(name, force) {
    const on = force === undefined ? !this.contains(name) : Boolean(force);
    if (on) this.add(name);
    else this.remove(name);
    return on;
  }
}

class FakeNode {
  constructor(tag, ownerDocument) {
    this.tagName = String(tag).toUpperCase();
    this.childNodes = [];
    this.parentNode = undefined;
    this._attrs = {};
    this._listeners = new Map();
    this._text = "";
    this._doc = ownerDocument;
    this.classList = new FakeClassList(this);
    this._value = "";
    // COUNTED, because "does not write an unchanged value" is a real contract --
    // writing it again moves the caret to the end of the field -- and a test
    // cannot observe it without the fake keeping score.
    this.valueWrites = 0;
    Object.defineProperty(this, "value", {
      get: () => this._value,
      set: (v) => { this._value = String(v); this.valueWrites += 1; },
      enumerable: true,
    });
    // Attribute-backed, like a browser: `disabled` and `checked` answered
    // `undefined` where a real element answers a boolean.
    Object.defineProperty(this, "disabled", {
      get: () => "disabled" in this._attrs,
      set: (v) => { if (v) this._attrs.disabled = true; else delete this._attrs.disabled; },
      enumerable: false,
    });
  }

  get children() {
    return this.childNodes.filter((n) => n instanceof FakeNode);
  }
  get firstChild() {
    return this.childNodes[0];
  }

  get className() {
    return this._attrs.class || "";
  }
  set className(value) {
    this._attrs.class = String(value);
  }

  /**
   * THE ATTRIBUTE AND THE PROPERTY AGREE, as they do in a browser.
   *
   * Dom.el sets `hidden` through setAttribute, which stores "" -- and this getter
   * tested `=== true`, so `.hidden` read FALSE on every element the real DOM
   * hides. A witness asserting `message.hidden === false` then passed before the
   * gesture it was testing, and blessed the very regression it was written to
   * catch.
   */
  get hidden() {
    return "hidden" in this._attrs && this._attrs.hidden !== false && this._attrs.hidden !== "false";
  }
  set hidden(value) {
    if (value) this._attrs.hidden = true;
    else delete this._attrs.hidden;
  }

  get textContent() {
    // The node's own text comes FIRST, then its children: `el(tag, {text}, [kids])`
    // renders both in a browser, and dropping the text made a witness read the
    // children alone.
    return this._text + this.childNodes.map((n) => (n instanceof FakeNode ? n.textContent : String(n))).join("");
  }
  set textContent(value) {
    this.childNodes = [];
    this._text = String(value);
  }

  appendChild(child) {
    if (child === undefined || child === null) throw new TypeError("appendChild received nothing");
    if (child instanceof FakeNode) child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }
  removeChild(child) {
    const at = this.childNodes.indexOf(child);
    if (at === -1) throw new Error("removeChild: not a child");
    this.childNodes.splice(at, 1);
    if (child instanceof FakeNode) child.parentNode = undefined;
    return child;
  }

  setAttribute(name, value) {
    this._attrs[name] = String(value);
    // A real DOM reflects the `value` ATTRIBUTE into the `value` PROPERTY as the
    // field's initial content -- and Dom.el sets it through the attribute
    // whitelist. A fake that skipped this would render every field empty and let
    // a test assert on nothing.
    if (name === "value") this.value = String(value);
  }
  getAttribute(name) {
    return name in this._attrs ? this._attrs[name] : null;
  }

  addEventListener(type, handler) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(handler);
  }
  removeEventListener(type, handler) {
    if (this._listeners.has(type)) this._listeners.get(type).delete(handler);
  }

  /** Fires a listener the way a user gesture would, bubbling to the root. */
  dispatch(type, event = {}) {
    const payload = { type, target: this, preventDefault() {}, stopPropagation() {}, ...event };
    let node = this;
    while (node) {
      for (const handler of node._listeners.get(type) ?? []) handler(payload);
      if (!node.parentNode) {
        // The document is the last link: Dom.refuseFileDrops listens THERE, and a
        // dispatch that stopped at the root could never reach it.
        for (const handler of this._doc._listeners.get(type) ?? []) handler(payload);
      }
      node = node.parentNode;
    }
  }

  focus() {
    this._doc.activeElement = this;
  }

  /**
   * Is this node inside that subtree? Self included, as in a browser.
   *
   * The production code calls it on every pointer and focus event -- it is how the
   * host answers "which section is the user holding" -- and this fake did not
   * implement it at all. Nothing noticed, because no test exercised that path:
   * an omission in a fake is invisible until the first witness walks into it.
   */
  contains(node) {
    if (node === this) return true;
    for (const child of this.children) {
      if (child.contains(node)) return true;
    }
    return false;
  }

  closest(selector) {
    let node = this;
    while (node) {
      if (node._matches(selector)) return node;
      node = node.parentNode;
    }
    return null;
  }

  _matches(selector) {
    if (!SIMPLE.test(selector)) throw new Error(`fake-dom: unsupported selector ${selector}`);
    if (selector.startsWith(".")) return this.classList.contains(selector.slice(1));
    if (selector.startsWith("#")) return this._attrs.id === selector.slice(1);
    return this.tagName === selector.toUpperCase();
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0];
  }
  querySelectorAll(selector) {
    const found = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (child._matches(selector)) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }
}

/**
 * WHAT THE FAKE REFUSES TO ANSWER.
 *
 * The header promised "anything else throws loudly rather than answering
 * undefined", and a plain class does the opposite: it accepts any assignment and
 * returns undefined for any read. That is literally the fake that silently says
 * "sure". Sealing after construction makes the promise true for writes; reads of
 * an unknown property still answer undefined, and that is stated rather than
 * claimed otherwise.
 */
const sealed = (node) => Object.seal(node);

export const makeDocument = () => {
  const doc = {
    activeElement: undefined,
    visibilityState: "visible",
    _listeners: new Map(),
    createElement(tag) {
      return sealed(new FakeNode(tag, doc));
    },
    createElementNS(_ns, tag) {
      return sealed(new FakeNode(tag, doc));
    },
    createTextNode(text) {
      return String(text);
    },
    addEventListener(type, handler) {
      if (!doc._listeners.has(type)) doc._listeners.set(type, new Set());
      doc._listeners.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      if (doc._listeners.has(type)) doc._listeners.get(type).delete(handler);
    },
    getElementById(id) {
      return doc.body.querySelector(`#${id}`);
    },
    querySelector(selector) {
      return doc.body.querySelector(selector);
    },
  };
  doc.body = new FakeNode("body", doc);
  doc.documentElement = new FakeNode("html", doc);
  return doc;
};

/** Installs the document globally for the length of `body`, and takes it away
 *  afterwards -- a leaked global is how one test starts depending on another. */
export const withDocument = async (body) => {
  const previousDoc = globalThis.document;
  const previousWin = globalThis.window;
  const doc = makeDocument();
  globalThis.document = doc;
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  try {
    return await body(doc);
  } finally {
    globalThis.document = previousDoc;
    globalThis.window = previousWin;
  }
};
