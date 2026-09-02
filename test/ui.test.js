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

/**
 * IT PERSISTS, and it did not.
 *
 * `stored` was frozen for the length of a test, so nothing here could exercise
 * the render that follows a commit -- which is where a section reads back what it
 * just wrote, and where a stale snapshot would show. A context that never changes
 * state cannot witness the half of the loop that matters.
 */
const contextFor = (initial, applied) => {
  let stored = initial;
  const commit = (result) => {
    applied.push(result);
    if (result.ok) stored = result.value;
    return result.ok ? { ok: true, events: [], committed: stored } : result;
  };
  return {
  stored: () => stored,
  apply: async (intention) => commit(intention(stored)),
  applyToPolicy: async (mutate) => {
    const next = mutate(stored.policy());
    return commit(next.ok ? { ok: true, value: stored.withPolicy(next.value) } : next);
  },
  cancel() {},
  report: async () => ({ diagnosis: "READY", rules: [], skipped: [], missingOrigins: [] }),
  journal: { read: async () => ({ entries: [], unseen: [], acknowledged: true, overflowed: false }) },
  refresh: async () => {},
  condemned: () => false,
  };
};

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

test("a section renders back what it has just committed", async () => {
  // The test context froze `stored` for the length of a test, so nothing here
  // exercised the render that FOLLOWS a commit -- which is where a section reads
  // back what it just wrote, and where a stale snapshot would show.
  await withDocument(async (doc) => {
    const section = await shortcutsSection();
    const stored = new g.StoredPolicy(g.JumpPolicy.empty().withEngines(["google.com"]).value, []);
    const applied = [];
    const ctx = contextFor(stored, applied);
    const root = doc.createElement("div");
    section.mount(root, ctx);
    section.render(ctx.stored(), ctx);
    assert.equal(root.querySelectorAll(".row").length, 0, "nothing yet");

    const draft = { rowId: "33333333-1111-4111-8111-111111111111", key: "NEW",
                    url: "https://n.atlassian.net", catchAll: false, error: "" };
    section.drafts = [draft];
    await section.tryRegister(draft, doc.createElement("li"), g.Dom.el("div", {}), ctx);

    // The commit landed in the context, so the repaint sees it.
    section.render(ctx.stored(), ctx);
    const values = root.querySelectorAll(".f").map((f) => f.value);
    assert.ok(values.includes("NEW"), "the saved row is painted from the committed state, got " + JSON.stringify(values));
    assert.equal(section.drafts.length, 0, "and the draft has given way to it");
  });
});

test("the write queue tells every waiter the truth, including the ones it drops", async () => {
  // Three inner functions and a Map inside a 442-line closure: unbuildable twice,
  // unreachable from outside, untestable. The debounce used to resolve `{ok:true}`
  // before any write had been attempted -- a success invented for a commit that
  // had not happened.
  const committed = [];
  const queue = new g.WriteQueue(async (intention) => {
    committed.push(intention);
    return { ok: true, events: [], value: intention };
  }, 1);

  // A keystroke replaced in the SAME field learns it was superseded.
  const first = queue.apply("a", "key");
  const second = queue.apply("b", "key");
  assert.deepEqual(await first, { ok: false, code: "SUPERSEDED", message: "", events: [] });
  assert.equal((await second).ok, true, "and the last one really commits");
  assert.deepEqual(committed, ["b"], "only the surviving keystroke reaches storage");

  // A different field is a different slot, never displaced by its neighbour.
  const url = queue.apply("u", "url");
  const toggle = queue.apply("t", "arm");
  assert.equal((await url).ok, true);
  assert.equal((await toggle).ok, true);

  // Cancelling settles rather than leaving a waiter hanging for the page's life.
  const doomed = queue.apply("x", "key");
  queue.cancel("key");
  assert.equal((await doomed).code, "CANCELLED");
  assert.equal(queue.size(), 0);
});

test("the hold watch defers a repaint under a caret, and releases when it moves", async () => {
  await withDocument(async (doc) => {
    await import("../src/ui/hold-watch.js");
    let released = 0;
    const section = { root: doc.createElement("div") };
    const field = doc.createElement("input");
    section.root.appendChild(field);
    doc.body.appendChild(section.root);

    const holds = new g.HoldWatch([section], () => { released += 1; });
    holds.watch(section.root);

    assert.equal(holds.holding(section), false, "nothing is held to begin with");

    // The caret lands in the field: repainting would rebuild the node mid-word.
    field.focus();
    assert.equal(holds.editing(section.root), true);
    assert.equal(holds.holding(section), true);

    // A pointer on the subtree holds it too -- and repainting there does not merely
    // look wrong, it can suppress dragend entirely.
    field.dispatch("pointerdown");
    assert.equal(holds.holding(section), true);
    field.dispatch("pointerup");
    assert.ok(released > 0, "letting go replays what was deferred");

    holds.stop();
    const after = released;
    field.dispatch("pointerup");
    assert.equal(released, after, "and a stopped watch listens to nothing");
  });
});

test("Home and End move a row to an end in ONE press", async () => {
  // The arrows were the only keyboard path and they move by one: taking a row from
  // position 20 to the top cost nineteen presses and nineteen announcements. WCAG
  // 2.5.7 is satisfied by having a path at all; this is about it being usable.
  await withDocument(async (doc) => {
    const section = await shortcutsSection();
    const instance = g.JiraInstance.parse("https://a.atlassian.net").value;
    let policy = g.JumpPolicy.empty().withEngines(["google.com"]).value;
    const ids = ["id-a", "id-b", "id-c"];
    const keys = ["AAA", "BBB", "CCC"];
    ids.forEach((id, i) => { policy = policy.register(id, g.ProjectKey.parse(keys[i]).value, instance).value; });

    const applied = [];
    const ctx = contextFor(new g.StoredPolicy(policy, []), applied);
    const root = doc.createElement("div");
    section.mount(root, ctx);
    section.render(ctx.stored(), ctx);

    // The LAST row, sent to the top by one End-of-list gesture on its up arrow.
    const rows = root.querySelectorAll(".row");
    const lastArrow = rows[rows.length - 1].querySelectorAll(".btn")[0];
    lastArrow.dispatch("keydown", { key: "Home" });
    await new Promise((r) => setTimeout(r, 0));

    assert.deepEqual(ctx.stored().policy().orderedIds(), ["id-c", "id-a", "id-b"],
      "one press, all the way to the top");
  });
});

test("the live region is heard when it says the same thing twice", async () => {
  // A live region announces a MUTATION, not a value: writing the identical string
  // changes nothing, so the reader stays silent. Press "move up" twice at the top
  // and the second press produced no feedback at all -- on the one path a keyboard
  // user has, and exactly when they need to be told nothing happened.
  await withDocument(async () => {
    const section = await shortcutsSection();
    const announcer = g.Dom.el("div", { class: "sr-only" });
    section.announcer = announcer;

    section.announce("Already first.");
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(announcer.textContent, "Already first.");

    section.announce("Already first.");
    // Cleared first: that empty state IS the mutation the reader needs.
    assert.equal(announcer.textContent, "", "the region is emptied before it repeats");
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(announcer.textContent, "Already first.", "and filled again, so it is announced twice");
  });
});

test("every field carries a label that names it", async () => {
  // `.field-label` was a <div>: the accessible name came from a duplicated
  // aria-label, and clicking the visible word focused nothing.
  await withDocument(async (doc) => {
    const section = await shortcutsSection();
    const instance = g.JiraInstance.parse("https://a.atlassian.net").value;
    const policy = g.JumpPolicy.empty().withEngines(["google.com"]).value
      .register("id-a", g.ProjectKey.parse("ABC").value, instance).value;
    const ctx = contextFor(new g.StoredPolicy(policy, []), []);
    const root = doc.createElement("div");
    section.mount(root, ctx);
    section.render(ctx.stored(), ctx);

    const labels = root.querySelectorAll("label");
    assert.ok(labels.length >= 2, "the visible words are labels, not divs");
    for (const label of labels) {
      const target = label.getAttribute("for");
      assert.ok(target, "a label points at a field");
      assert.ok(root.querySelector("#" + target), "and that field exists: " + target);
    }
  });
});

test("the focus survives a repaint, wherever it was in the row", async () => {
  // Dom.clear removes every node, so the focus falls to <body>. Only the ARROWS
  // were restored -- so a change arriving from the other surface while the user
  // was on the arm switch, the bin or a text field dropped them out of the list
  // entirely, mid-task, with no way back but the Tab key.
  await withDocument(async (doc) => {
    const section = await shortcutsSection();
    const instance = g.JiraInstance.parse("https://a.atlassian.net").value;
    const policy = g.JumpPolicy.empty().withEngines(["google.com"]).value
      .register("id-a", g.ProjectKey.parse("ABC").value, instance).value;
    const ctx = contextFor(new g.StoredPolicy(policy, []), []);
    const root = doc.createElement("div");
    doc.body.appendChild(root);
    section.mount(root, ctx);
    section.render(ctx.stored(), ctx);

    for (const field of ["arm", "remove", "url"]) {
      const all = [
        ...root.querySelectorAll(".sw"),
        ...root.querySelectorAll(".btn"),
        ...root.querySelectorAll(".f"),
      ];
      const target = all.find((node) => node.getAttribute("data-field") === field);
      assert.ok(target, "the control names itself: " + field);
      target.focus();
      assert.equal(doc.activeElement.getAttribute("data-field"), field);

      // A repaint, exactly as a change from the other surface would cause.
      section.render(ctx.stored(), ctx);
      assert.equal(
        doc.activeElement && doc.activeElement.getAttribute("data-field"),
        field,
        "the focus comes back to " + field + ", not to <body>"
      );
    }
  });
});

/**
 * THE HOST, STARTED FOR REAL.
 *
 * Nothing ever ran SectionHost.start: the section tests build their own context
 * object, so the lifecycle -- the commit path, the debounce, the reload, the
 * banner -- was exercised by no test at all. That is how `intention(stored())`
 * shipped: in that scope `stored` is the captured VALUE, and calling it threw
 * "stored is not a function" on the FIRST gesture a user made. Every write died
 * there: acknowledging a warning, arming a shortcut, editing a destination.
 */
test("the host starts, commits a real intention, and repaints from what it committed", async () => {
  const { installPlatform, reset } = await import("./fake-platform.js");
  await withDocument(async (doc) => {
    await loadSections();
    await import("../src/ui/write-queue.js");
    await import("../src/ui/hold-watch.js");
    await import("../src/ui/section-host.js");

    const previous = g.Platform.api;
    installPlatform();
    // Platform captures `api` at LOAD, so installing globalThis.chrome afterwards
    // is not enough: the façade has to be pointed at the fake explicitly.
    g.Platform.api = globalThis.chrome;
    reset();
    try {
      const banner = doc.createElement("div");
      banner.setAttribute("id", "host-banner");
      // `hidden` as the markup has it: options.html ships
      // `<div class="alert" id="host-banner" role="alert" hidden>`, and a fixture
      // that starts visible would assert on a state the page never has.
      banner.hidden = true;
      doc.body.appendChild(banner);
      const root = doc.createElement("div");
      doc.body.appendChild(root);

      const painted = [];
      const section = {
        mount(node, ctx) { this.node = node; this.ctx = ctx; },
        render(stored) { painted.push(stored.policy().shortcuts().length); },
        reconcile() {},
        blank() {},
      };

      const host = await g.SectionHost.start({ root, sections: [section] });
      assert.deepEqual(painted, [0], "the first paint went through render()");

      // A REAL commit, through the real path: intention -> claim -> apply -> reload.
      const instance = g.JiraInstance.parse("https://a.atlassian.net").value;
      const result = await section.ctx.applyToPolicy((policy) =>
        policy.register("aaaaaaaa-1111-4111-8111-111111111111",
          g.ProjectKey.parse("ABC").value, instance));

      assert.equal(result.ok, true, "the commit succeeded: " + JSON.stringify(result));
      assert.equal(painted[painted.length - 1], 1, "and the page repainted from storage");
      assert.equal(banner.hidden, true, "with no failure banner");

      await host.stop();
    } finally {
      g.Platform.api = previous;
    }
  });
});

test("a refused commit shows the banner and leaves the screen alone", async () => {
  const { installPlatform, reset } = await import("./fake-platform.js");
  await withDocument(async (doc) => {
    await loadSections();
    await import("../src/ui/section-host.js");

    const previous = g.Platform.api;
    installPlatform();
    // Platform captures `api` at LOAD, so installing globalThis.chrome afterwards
    // is not enough: the façade has to be pointed at the fake explicitly.
    g.Platform.api = globalThis.chrome;
    reset();
    try {
      const banner = doc.createElement("div");
      banner.setAttribute("id", "host-banner");
      // `hidden` as the markup has it: options.html ships
      // `<div class="alert" id="host-banner" role="alert" hidden>`, and a fixture
      // that starts visible would assert on a state the page never has.
      banner.hidden = true;
      doc.body.appendChild(banner);
      const root = doc.createElement("div");
      doc.body.appendChild(root);

      const section = { mount(n, c) { this.ctx = c; }, render() {}, reconcile() {}, blank() {} };
      const host = await g.SectionHost.start({ root, sections: [section] });

      const refused = await section.ctx.applyToPolicy(() =>
        g.MutationResult.refused("DUPLICATE_KEY", "already used"));

      assert.equal(refused.ok, false);
      assert.equal(banner.hidden, false, "the refusal is shown");
      // THROUGH THE PRESENTATION, so a French build reads French.
      assert.ok(banner.textContent.length > 0);
      assert.equal(banner.textContent.includes("DUPLICATE_KEY"), false,
        "a bare code never reaches the user");

      await host.stop();
    } finally {
      g.Platform.api = previous;
    }
  });
});
