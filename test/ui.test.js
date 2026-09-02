import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCore } from "./load-core.js";
import { withDocument } from "./fake-dom.js";

const g = await loadCore();

/**
 * The UI, EXECUTED.
 *
 * `options-sections.js`, `section-host.js` and `ui/dom.js` -- 2070 lines -- were
 * exercised by nothing but regular expressions over their own source. No test
 * proved a section mounts, renders, or survives a repaint, which is why every
 * user-visible defect in that code was invisible to a green suite: the lost
 * draft, the error message that vanished on repaint, the preview blaming the
 * user's text for a missing engine.
 */
const loadUi = async () => {
  if (!g.Dom) {
    await import("../src/ui/dom.js");
  }
  return g;
};

const instance = (url) => g.JiraInstance.parse(url).value;

test("Dom.el builds a node, its attributes and its text", async () => {
  await withDocument(async () => {
    await loadUi();
    const node = g.Dom.el("div", { class: "row", text: "hello", "aria-label": "x" });
    assert.equal(node.tagName, "DIV");
    assert.equal(node.textContent, "hello");
    assert.equal(node.getAttribute("class"), "row");
    assert.equal(node.getAttribute("aria-label"), "x");
  });
});

test("Dom.el refuses an attribute outside the whitelist", async () => {
  await withDocument(async () => {
    await loadUi();
    // The whitelist IS the control: href is absent from it, which is what stops a
    // script-scheme URL from ever reaching an element in the extension's origin.
    assert.throws(() => g.Dom.el("a", { href: "https://example.org" }), /href/);
    assert.throws(() => g.Dom.el("div", { onclick: "alert(1)" }), /onclick/);
  });
});

test("Dom.el skips an absent child instead of appending nothing", async () => {
  await withDocument(async () => {
    await loadUi();
    // Sections build children with `condition ? el(...) : undefined`, so a falsy
    // child is the normal case and must not reach appendChild.
    const node = g.Dom.el("div", {}, [g.Dom.el("span", { text: "a" }), undefined, null, false]);
    assert.equal(node.children.length, 1);
  });
});

test("a click handler passed to Dom.el actually fires", async () => {
  await withDocument(async () => {
    await loadUi();
    let clicked = 0;
    const button = g.Dom.el("button", { text: "go", onClick: () => { clicked += 1; } });
    button.dispatch("click");
    assert.equal(clicked, 1, "the handler is wired, not merely stored");
  });
});

test("Dom.clear empties a node completely", async () => {
  await withDocument(async () => {
    await loadUi();
    const node = g.Dom.el("div", {}, [g.Dom.el("span"), g.Dom.el("span")]);
    g.Dom.clear(node);
    assert.equal(node.children.length, 0);
    assert.equal(node.firstChild, undefined);
  });
});

test("Dom.setValue leaves an unchanged field alone, so the caret survives", async () => {
  await withDocument(async () => {
    await loadUi();
    const input = g.Dom.el("input", { value: "ABC" });
    const before = input.valueWrites;
    g.Dom.setValue(input, "ABC");
    assert.equal(input.valueWrites, before, "writing the same value would move the caret to the end");
    g.Dom.setValue(input, "ABD");
    assert.equal(input.valueWrites, before + 1, "and a real change is written once");
  });
});

test("the SVG tags offered are the ones that can actually be built", async () => {
  await withDocument(async () => {
    await loadUi();
    // `circle`, `rect` and `g` were listed while cx/cy/r/x/y were absent from the
    // whitelist, so building one THREW on its first attribute -- a trap that read
    // as an offer.
    assert.doesNotThrow(() => g.Dom.el("svg", { viewBox: "0 0 24 24" }));
    assert.doesNotThrow(() => g.Dom.el("path", { d: "M0 0" }));
    assert.throws(() => g.Dom.el("circle", { cx: "1", cy: "1", r: "1" }), /cx/);
  });
});

/**
 * Mounting a real section against a real policy.
 *
 * Loading options-sections.js needs the DOM in place at import time, so the
 * import happens INSIDE withDocument -- and once only, since a module is
 * evaluated once per process.
 */
let sections;
const loadSections = async () => {
  if (!sections) {
    await import("../src/ui/dom.js");
    // NOT swallowed: if the module under test throws at load, the suite must say
    // so rather than continue silently.
    await import("../src/ui/section-host.js");
    for (const file of [
      "sections/parts", "sections/sentences", "sections/status", "sections/shortcuts",
      "sections/engines", "sections/access", "sections/preview", "sections/transfer",
      "sections/quarantine", "sections/storage",
    ]) {
      await import(`../src/ui/${file}.js`);
    }
    await import("../src/options-sections.js");
    sections = g.OptionsSections;
  }
  return sections;
};

const contextFor = (stored, applied) => ({
  stored: () => stored,
  apply: async (intention) => {
    const result = intention(stored);
    applied.push(result);
    return result.ok ? { ok: true, events: [] } : result;
  },
  applyToPolicy: async (mutate) => {
    const next = mutate(stored.policy());
    applied.push(next);
    return next.ok ? { ok: true, events: [] } : next;
  },
  cancel() {},
  report: async () => ({ diagnosis: "READY", rules: [], skipped: [], missingOrigins: [] }),
  journal: { read: async () => ({ entries: [], unseen: [], acknowledged: true, overflowed: false }) },
  refresh: async () => {},
  condemned: () => false,
});

const shortcutsSection = async () => (await loadSections())[1];

test("the shortcuts section mounts and paints one row per shortcut", async () => {
  await withDocument(async (doc) => {
    const section = await shortcutsSection();
    let policy = g.JumpPolicy.empty().withEngines(["google.com"]).value;
    policy = policy.register("id-a", g.ProjectKey.parse("ABC").value, instance("https://a.atlassian.net")).value;
    policy = policy.register("id-b", g.ProjectKey.parse("DEV").value, instance("https://b.atlassian.net")).value;
    const stored = new g.StoredPolicy(policy, []);

    const root = doc.createElement("div");
    const ctx = contextFor(stored, []);
    section.mount(root, ctx);
    section.render(stored, ctx);

    const rows = root.querySelectorAll(".row");
    assert.equal(rows.length, 2, "one row per shortcut, painted for real");
    // The key and the destination are FIELD VALUES, not text: an editable row is
    // what this section paints, and that is worth pinning too.
    const values = root.querySelectorAll(".f").map((f) => f.value);
    assert.ok(values.includes("ABC"), `the key is on screen, got ${JSON.stringify(values)}`);
    assert.ok(values.some((v) => v.includes("a.atlassian.net")), "with its destination");
  });
});

test("a refused draft KEEPS what was typed, and says why on the row", async () => {
  // THE LOST DRAFT. The row was removed from `drafts` BEFORE the write, and the
  // promise was not awaited: on a refusal the row stayed on screen while no longer
  // being in the model, so the user went on typing into a dead object and the row
  // vanished at the next repaint, taking everything with it.
  await withDocument(async (doc) => {
    const section = await shortcutsSection();
    let policy = g.JumpPolicy.empty().withEngines(["google.com"]).value;
    policy = policy.register("taken", g.ProjectKey.parse("ABC").value, instance("https://a.atlassian.net")).value;
    const stored = new g.StoredPolicy(policy, []);
    const ctx = contextFor(stored, []);

    const root = doc.createElement("div");
    section.mount(root, ctx);
    section.drafts = [{ rowId: "draft-1", key: "ABC", url: "https://b.atlassian.net", catchAll: false, error: "" }];
    section.render(stored, ctx);

    const draft = section.drafts[0];
    const row = doc.createElement("li");
    const message = g.Dom.el("div", { class: "row-msg refused", hidden: true });
    await section.tryRegister(draft, row, message, ctx);

    assert.equal(section.drafts.length, 1, "the draft survives a refusal");
    assert.equal(draft.key, "ABC", "and everything typed is still there");
    assert.equal(draft.error === "", false, "with the reason attached to it");
    // The ATTRIBUTE, and the message text: asserting `.hidden === false` alone
    // passed before the gesture was even performed, because the fake read the
    // attribute wrongly. A witness that holds before the act proves nothing.
    assert.equal(message.hidden, false, "and shown on the row, where the correction happens");
    assert.ok(message.textContent.length > 0, "with something in it");
  });
});

test("an accepted draft is dropped, once the write is known to have landed", async () => {
  await withDocument(async (doc) => {
    const section = await shortcutsSection();
    const stored = new g.StoredPolicy(g.JumpPolicy.empty().withEngines(["google.com"]).value, []);
    const ctx = contextFor(stored, []);

    const root = doc.createElement("div");
    section.mount(root, ctx);
    const draft = { rowId: "11111111-1111-4111-8111-111111111111", key: "NEW", url: "https://n.atlassian.net", catchAll: false, error: "" };
    section.drafts = [draft];
    await section.tryRegister(draft, doc.createElement("li"), g.Dom.el("div", {}), ctx);

    assert.equal(section.drafts.length, 0, "accepted, so the draft row gives way to the saved one");
  });
});

test("a draft with nothing wrong yet is not painted as refused", async () => {
  // THE NEGATIVE CASE, which is the one that broke. Replacing a null-producing
  // ternary with a `??` chain left two `=== null` comparisons standing, so
  // `failure` was never null and EVERY draft row wore the red refusal border from
  // the first keystroke -- including when nothing was wrong.
  await withDocument(async (doc) => {
    const section = await shortcutsSection();
    const stored = new g.StoredPolicy(g.JumpPolicy.empty().withEngines(["google.com"]).value, []);
    const ctx = contextFor(stored, []);
    const root = doc.createElement("div");
    section.mount(root, ctx);

    const draft = { rowId: "22222222-1111-4111-8111-111111111111", key: "AB", url: "", catchAll: false, error: "" };
    const row = doc.createElement("li");
    const message = g.Dom.el("div", { class: "row-msg refused", hidden: true });
    await section.tryRegister(draft, row, message, ctx);

    assert.equal(row.classList.contains("is-refused"), false, "a half-typed row is not a refused one");
    assert.equal(message.hidden, true, "and nothing is said yet");
  });
});

test("a refusal is shown in the reader's language, never the domain's English", async () => {
  // Every refusal sentence in the domain is hard-coded English, and the surfaces
  // printed `result.message` straight into the DOM -- so the French build showed
  // English on EVERY validation error, at the one moment the user is being told
  // something went wrong. structure.test.js could not see it: it scans calls to
  // the translation helper, and these sentences never went through one.
  await withDocument(async () => {
    await import("../src/ui/refusal-presentation.js");
    const refusal = g.JumpPolicy.empty()
      .register("id-a", g.ProjectKey.parse("ABC").value, instance("https://a.atlassian.net")).value
      .register("id-b", g.ProjectKey.parse("ABC").value, instance("https://b.atlassian.net"));

    assert.equal(refusal.ok, false);
    assert.equal(refusal.code, "DUPLICATE_KEY");
    // The English fallback, since the fake catalogue is empty by default.
    assert.match(g.RefusalPresentation.sentence(refusal), /already used/);

    // And an unknown code degrades to the domain's own sentence rather than
    // showing the user a bare identifier: an omission must degrade, not break.
    assert.equal(
      g.RefusalPresentation.sentence({ ok: false, code: "SOMETHING_NEW", message: "a developer sentence" }),
      "a developer sentence"
    );
    assert.equal(g.RefusalPresentation.sentence({ ok: true }), "", "a success says nothing");
  });
});

test("a section that throws mid-render leaves an ANSWER on screen, never a stale verdict", async () => {
  // structure.test.js used to assert this with a regex over the SOURCE's
  // typography -- `/async preview\(ctx\) \{\s*try \{/` -- which a blank line broke
  // and an empty `try {} catch {}` satisfied. What the rule means is a behaviour,
  // and the UI is executable now, so it is pinned as one.
  await withDocument(async (doc) => {
    const section = (await loadSections()).find((s) => typeof s.preview === "function");
    assert.ok(section, "the preview section is still there");

    const root = doc.createElement("div");
    const stored = new g.StoredPolicy(g.JumpPolicy.empty().withEngines(["google.com"]).value, []);
    const ctx = contextFor(stored, []);
    section.mount(root, ctx);

    // A store the page cannot read: report() throws, exactly as a hostile or
    // future rule shape would make it.
    const exploding = { ...ctx, report: async () => { throw new Error("unreadable store"); } };
    section.input.value = "ABC-1";
    await section.preview(exploding);

    assert.equal(root.textContent.includes("ABC-1"), false, "no stale verdict is left behind");
    // THE POSITIVE HALF. Asserting only an absence passes on an empty panel, which
    // is exactly the state a stale verdict would be indistinguishable from.
    assert.ok(section.out.textContent.length > 0, "and the panel says something rather than nothing");
    assert.ok(section.out.classList.contains("empty"), "in the shape of an unavailable answer");
  });
});

test("an empty preview field says nothing yet, instead of blaming the text", async () => {
  await withDocument(async (doc) => {
    const section = (await loadSections()).find((s) => typeof s.preview === "function");
    const root = doc.createElement("div");
    const stored = new g.StoredPolicy(g.JumpPolicy.empty().withEngines(["google.com"]).value, []);
    const ctx = contextFor(stored, []);
    section.mount(root, ctx);

    section.input.value = "";
    await section.preview(ctx);
    assert.equal(section.out.textContent.includes("not a URL"), false,
      "clearing the field is not a failed answer");
    assert.ok(section.out.textContent.length > 0, "and it says what an empty field means");
  });
});

test("with no engine ticked the preview blames the configuration, not the input", async () => {
  // `catalog.find(undefined)` handed forTypedText an absent engine, which answered
  // NOT_A_SEARCH_URL -- so the screen blamed the user's text for a configuration
  // problem, on the one organ built to be believed.
  await withDocument(async (doc) => {
    const section = (await loadSections()).find((s) => typeof s.preview === "function");
    const root = doc.createElement("div");
    const stored = new g.StoredPolicy(g.JumpPolicy.empty(), []);
    const ctx = contextFor(stored, []);
    section.mount(root, ctx);

    section.input.value = "ABC-1";
    await section.preview(ctx);
    assert.equal(section.out.textContent.includes("search URL"), false,
      "the text is not the problem when nothing is intercepted");
    // The sentence that SHOULD be there, not merely the one that should not.
    assert.ok(section.out.textContent.toLowerCase().includes("search engine"),
      `it must point at the configuration, got ${JSON.stringify(section.out.textContent)}`);
  });
});

test("every refusal a user can provoke BY TYPING has a sentence of its own", () => {
  // Nine were missing -- BASE_NOT_A_URL, BASE_PERCENT, BASE_TRAVERSAL, BASE_PORT,
  // KEY_NOT_A_STRING among them -- and those are the LIKELIEST of all: they are
  // what you get from typing in the destination field. Meanwhile the file's own
  // header claimed the French build no longer showed English "on EVERY validation
  // error". A comment asserting a coverage the table did not have, in the file
  // written to end exactly that.
  //
  // The source of truth is the DOMAIN, not a hand-kept list: every code the three
  // typed-input parsers can produce must be presentable.
  const keys = ["", "  ", "a", "1AB", "A-B", "ABCDEFGHIJKLMNOPQRSTU", " AB", 42, null];
  const urls = ["", "   ", "ftp://x.example.org", "http://user:pw@x.example.org",
    "https://x.example.org?q=1", "https://x.example.org#f", "https://x.example.org/a/../b",
    "https://x.example.org:99999", "https://x.example.org:22", "https://x.example.org/a/b/c/d/e",
    "x".repeat(300), "https://x.example.org/%41", "not a url at all", 42, null];
  const engines = [{ host: 42 }, { host: "" }, { host: "x".repeat(200) },
    { host: "ok.example.org", shape: "nope" }, null];

  const refused = [
    ...keys.map((raw) => g.ProjectKey.parse(raw)),
    ...urls.map((raw) => g.JiraInstance.parse(raw)),
    ...engines.map((raw) => g.CustomEngine.parse(raw)),
  ].filter((result) => result && result.ok === false);

  assert.ok(refused.length > 20, "the corpus really provokes refusals");

  const bare = new Set();
  for (const refusal of refused) {
    const sentence = g.RefusalPresentation.sentence(refusal);
    // A code leaking through AS the sentence is the failure: the table had no
    // entry and the domain's message was empty.
    if (sentence === refusal.code) bare.add(refusal.code);
    assert.ok(sentence.length > 0, refusal.code + " says nothing at all");
  }
  assert.deepEqual([...bare], [], "these codes reach the user as a bare identifier");
});
