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

/*
 * `Dom.setValue` USED TO BE TESTED HERE, and it never had a caller.
 *
 * It skipped writing a field whose value had not changed, so the caret would not
 * jump. A real concern -- but the render REBUILDS its subtree (Dom.clear, then
 * fresh nodes), so there is no surviving input for it to spare. The caret is kept
 * by FocusMemory instead, which is the mechanism that actually runs.
 *
 * A tested function with no caller is worse than an untested one: the test makes
 * it look load-bearing. Both are gone; the day an in-place field update appears,
 * this comment says what to bring back.
 */

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
  // THE WHOLE SURFACE THE HOST OFFERS, so a section can read it without a guard.
  // A `typeof ctx.unreadable === "function"` in the section would be a defence
  // that exists only for this harness -- and the lifecycle test next door already
  // insists a wrapped section answers the whole contract, not most of it.
  unreadable: () => [],
  };
};

/**
 * SECTIONS BY NAME, NOT BY INDEX.
 *
 * Two tests written against `[7]` believed they were exercising Transfer and were
 * exercising Storage -- whose render happens to throw nothing, so the mistake read
 * as a failing assertion about the section under test rather than as the wrong
 * section. Indexing a list whose order is a product decision is a trap that only
 * springs when somebody inserts a section.
 */
const sectionNamed = async (name) => {
  const found = (await loadSections()).find((s) => s === g[name]);
  assert.ok(found, `no section registered as ${name}`);
  return found;
};

const shortcutsSection = async () => sectionNamed("SectionShortcuts");

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
    await import("../src/ui/section.js");
    let released = 0;
    // A Section, not a raw section: `root` is a question the wrapper answers now,
    // because the host no longer grafts the node onto the section object.
    const node = doc.createElement("div");
    const section = new g.Section({ mount() {} });
    section.mount(node, {});
    const field = doc.createElement("input");
    node.appendChild(field);
    doc.body.appendChild(node);

    const holds = new g.HoldWatch([section], () => { released += 1; });
    holds.watch(section.root());

    assert.equal(holds.holding(section), false, "nothing is held to begin with");

    // The caret lands in the field: repainting would rebuild the node mid-word.
    field.focus();
    assert.equal(holds.editing(section.root()), true);
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
    await import("../src/ui/section.js");
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

/**
 * A CAUSE NAMED `constructor` MUST PRINT ITSELF, NOT Object.
 *
 * The Lot-3 fix turns this render path from dead to live: `report.skipped` used to
 * be `[]` on the page, so preview.js:158-183 had never run with data. It reads its
 * sentences out of a table indexed by `cause.code` and `cause.subject`, and those
 * come back from the receipt where install-outcome.js checks `typeof === "string"`
 * and nothing more.
 *
 * With an ordinary object literal, `table["constructor"]` returns the `Object`
 * function -- TRUTHY, so the `|| cause.code` fallback never fires -- and the panel
 * that exists to explain why a security control fell would print
 * `function Object() { [native code] }`. `subject` is the likelier vector of the
 * two: `code` is a closed vocabulary this repository writes, `subject` is free text
 * derived from the policy, i.e. from the sync channel.
 */
test("a skipped cause cannot borrow a sentence from Object.prototype", async () => {
  await withDocument(async (doc) => {
    const section = (await loadSections()).find((s) => typeof s.preview === "function");
    const root = doc.createElement("div");
    const stored = new g.StoredPolicy(g.JumpPolicy.empty().withEngines(["google.com"]).value, []);
    section.mount(root, contextFor(stored, []));

    const table = globalThis.SectionSentences.SKIPPED_SENTENCE();
    assert.equal(Object.getPrototypeOf(table), null, "the table must carry no prototype");
    for (const borrowed of ["constructor", "toString", "valueOf", "__proto__", "hasOwnProperty"]) {
      assert.equal(table[borrowed], undefined,
        `${borrowed} resolves through the prototype chain, so the || fallback stays asleep`);
    }
    assert.equal(typeof table.UNKNOWN_ENGINE, "string", "and the real keys still answer");
  });
});

/**
 * ONE CATCH-ALL MEANS ONE, DRAFTS INCLUDED.
 *
 * The guard only asked the policy, so a second catch-all DRAFT could always be
 * opened. Two draft rows meant two nodes carrying id="catch-all-note": invalid
 * HTML, and the second field's aria-describedby resolving to the FIRST note --
 * so the explanation a screen-reader user heard belonged to another row.
 */
test("a second catch-all draft cannot be opened", async () => {
  await withDocument(async (doc) => {
    const section = await shortcutsSection();
    const root = doc.createElement("div");
    const stored = new g.StoredPolicy(g.JumpPolicy.empty().withEngines(["google.com"]).value, []);
    const ctx = contextFor(stored, []);
    section.mount(root, ctx);
    section.render(stored, ctx);

    const addCatchAll = () => [...root.querySelectorAll("button")]
      .find((b) => (b.textContent || "").toLowerCase().includes("catch-all"));

    addCatchAll().dispatch("click");
    assert.equal(section.drafts.filter((d) => d.catchAll).length, 1);

    addCatchAll().dispatch("click");
    assert.equal(section.drafts.filter((d) => d.catchAll).length, 1,
      "a second draft was opened, so two nodes would carry id=catch-all-note");

    const notes = root.querySelectorAll("#catch-all-note");
    assert.ok(notes.length <= 1, `${notes.length} nodes share id="catch-all-note"`);
  });
});

/**
 * ORDER_STALE IS THE ONE REFUSAL THAT REDRAWS -- and nothing exercised it.
 *
 * Every other refusal deliberately leaves the screen alone: redrawing would throw
 * away the correction the user is mid-way through typing. ORDER_STALE is the
 * exception, because the section is holding an OPTIMISTIC order the storage does
 * not have, and showFailure alone would leave that wrong order on screen for good.
 *
 * The domain half is tested; this branch of the host is not, and it has already
 * been a bug once (announce-then-reload erased its own message in the same turn).
 */
test("a stale order reloads the screen, unlike every other refusal", async () => {
  const { installPlatform, reset } = await import("./fake-platform.js");
  await withDocument(async (doc) => {
    await loadSections();
    await import("../src/ui/write-queue.js");
    await import("../src/ui/hold-watch.js");
    await import("../src/ui/section.js");
    await import("../src/ui/section-host.js");

    const previous = g.Platform.api;
    installPlatform();
    g.Platform.api = globalThis.chrome;
    reset();
    try {
      const banner = doc.createElement("div");
      banner.setAttribute("id", "host-banner");
      banner.hidden = true;
      doc.body.appendChild(banner);
      const root = doc.createElement("div");
      doc.body.appendChild(root);

      const painted = [];
      const section = {
        mount(node, ctx) { this.node = node; this.ctx = ctx; },
        render() { painted.push("render"); },
      };
      const host = await g.SectionHost.start({ root, sections: [section] });
      const before = painted.length;

      // An order naming ids the policy does not hold: the domain answers ORDER_STALE.
      const result = await section.ctx.applyToPolicy((policy) =>
        policy.withOrder(["cccccccc-3333-4333-8333-333333333333"]));

      assert.equal(result.ok, false);
      assert.equal(result.code, "ORDER_STALE", "the domain must still name this refusal");
      assert.ok(painted.length > before,
        "ORDER_STALE must REDRAW: the section is holding an order storage never took, " +
        "and leaving it on screen is the one thing worse than losing a keystroke");
      assert.equal(banner.hidden, false, "and it still says why");

      await host.stop();
    } finally {
      g.Platform.api = previous;
    }
  });
});

/**
 * THE VERDICT AND ITS REASON STAND TOGETHER.
 *
 * "The catch-all could not be installed" was printed by Status while the reasons --
 * RUN_OVER_BUDGET, REGEX_UNSUPPORTED, UNKNOWN_ENGINE -- were rendered only in the
 * preview, three sections further down, and only once the user had typed something
 * into it. Nobody reading a failure goes and types a URL to find out why.
 */
test("the status section names the causes behind a failed verdict", async () => {
  await withDocument(async (doc) => {
    const section = (await loadSections())[0];
    const root = doc.createElement("div");
    const stored = new g.StoredPolicy(g.JumpPolicy.empty().withEngines(["google.com"]).value, []);

    const ctx = {
      ...contextFor(stored, []),
      report: async () => ({
        diagnosis: "CATCH_ALL_NOT_INSTALLED",
        skipped: [
          { code: "REGEX_UNSUPPORTED", subject: "rule 42" },
          { code: "UNKNOWN_ENGINE", subject: "the catch-all on custom:google.fr" },
        ],
        rules: [], installed: true, coverageSatisfied: false, missingOrigins: [],
      }),
    };
    section.mount(root, ctx);
    await section.render(stored, ctx);

    const shown = root.querySelector(".causes");
    assert.ok(shown, "the status section must have somewhere to put the reasons");
    assert.equal(shown.hidden, false, "with causes in the receipt, they must be visible");
    assert.equal(shown.children.length, 2, "one line per cause");
    assert.ok((shown.textContent || "").includes("custom:google.fr"),
      `the subject must be named: ${shown.textContent}`);

    // And a healthy receipt costs no space at all.
    const healthy = { ...ctx, report: async () => ({
      diagnosis: "READY", skipped: [], rules: [], installed: true,
      coverageSatisfied: true, missingOrigins: [] }) };
    await section.render(stored, healthy);
    assert.equal(root.querySelector(".causes").hidden, true);
  });
});

/**
 * THE ENGINES SECTION, PAINTED FOR REAL -- and it did not paint at all.
 *
 * Two defects were stacked here, and the suite was green through both because
 * nothing had ever mounted this section.
 *
 * (1) `aria-expanded` was missing from Dom.el's attribute whitelist while the
 *     "Add a domain" disclosure sets it on EVERY render. Dom.el threw `refusing to
 *     set attribute "aria-expanded"`, renderOnce caught it, section.fail() painted
 *     the alarming state -- so the section was inert for EVERY user, ALWAYS: no
 *     engine tickable, no domain addable. The whitelist was right to refuse what it
 *     did not know; what was wrong is that a legitimate ARIA state had never been
 *     added to it.
 *
 * (2) `TRASH` was used but never destructured from SectionParts, so the bin beside
 *     a custom domain threw `ReferenceError: TRASH is not defined` -- reached only
 *     once a user had added one, which is why (1) masked it.
 *
 * Both are scope mistakes, not design mistakes, and both were invisible to a suite
 * that tested this file with regular expressions over its own source.
 */
test("the engines section paints, with and without a custom domain", async () => {
  await withDocument(async (doc) => {
    const sections = await loadSections();
    const section = sections.find((s) => s === g.SectionEngines);
    assert.ok(section, "the engines section is one of the declared sections");

    // WITHOUT a custom domain first: this is the case every user is in, and the
    // one the aria-expanded defect broke.
    const plain = new g.StoredPolicy(g.JumpPolicy.empty().withEngines(["google.com"]).value, []);
    const root = doc.createElement("div");
    const ctx = contextFor(plain, []);
    section.mount(root, ctx);
    section.render(plain, ctx);

    const chips = root.querySelectorAll(".chip");
    assert.ok(chips.length > 1, `the catalogue is painted, got ${chips.length} chips`);
    // The disclosure ANNOUNCES whether it is open. That is the attribute whose
    // absence from the whitelist took the whole section down.
    const disclosure = chips[chips.length - 1];
    assert.equal(disclosure.getAttribute("aria-expanded"), "false",
      "the Add-a-domain button says it is closed");

    // WITH a custom domain: the branch that reaches the bin, hence TRASH.
    const engine = g.CustomEngine.parse({ host: "intra.example.org", shape: "search-q" });
    assert.equal(engine.ok, true, "precondition: the domain parses");
    let withCustom = g.JumpPolicy.empty().withCustomEngine(engine.value).value;
    withCustom = withCustom.withEngines([engine.value.id()]).value;
    const stored = new g.StoredPolicy(withCustom, []);

    const root2 = doc.createElement("div");
    const ctx2 = contextFor(stored, []);
    section.mount(root2, ctx2);
    section.render(stored, ctx2);

    assert.ok(
      root2.querySelectorAll(".chip").length > chips.length,
      "the custom domain adds a chip of its own"
    );
    // The bin is what needed TRASH. Its presence IS the regression net.
    const bins = root2.querySelectorAll(".btn");
    assert.ok(bins.length > 0, "the custom domain carries a remove button");
  });
});

/**
 * OPENING THE FORM DOES NOT THROW EITHER, and it flips the announcement.
 *
 * The disclosure's own branch: `this.adding` toggles and the section re-renders
 * itself, which is a second pass through the same attribute.
 */
test("opening the add-a-domain form flips aria-expanded instead of throwing", async () => {
  await withDocument(async (doc) => {
    const sections = await loadSections();
    const section = sections.find((s) => s === g.SectionEngines);
    const stored = new g.StoredPolicy(g.JumpPolicy.empty().withEngines(["google.com"]).value, []);
    const root = doc.createElement("div");
    const ctx = contextFor(stored, []);
    section.mount(root, ctx);
    section.render(stored, ctx);

    const chips = root.querySelectorAll(".chip");
    chips[chips.length - 1].dispatch("click");

    const reopened = root.querySelectorAll(".chip");
    // The shape chips of the form join the row, so the disclosure is no longer
    // last: it is found by the attribute it owns.
    const disclosure = reopened.find((chip) => chip.getAttribute("aria-expanded") !== null);
    assert.ok(disclosure, "the disclosure is still on screen");
    assert.equal(disclosure.getAttribute("aria-expanded"), "true", "and it says it is open");
    // Restore the module-level flag: these sections are singletons on globalThis.
    section.adding = false;
  });
});

/**
 * EVERY DECLARED SECTION MOUNTS AND RENDERS, against a policy that reaches its
 * branches. This is the CHANGELOCK the aria-expanded defect needed.
 *
 * Neither of the two scope mistakes fixed above was a design mistake, and neither
 * was catchable by a test of the module they lived in: one was an attribute absent
 * from a whitelist in ANOTHER file, the other an identifier absent from a
 * destructuring. What they have in common is that they only exist WHEN THE CODE
 * RUNS -- and section-host.js catches per-section throws by design, so in the
 * browser they degrade into a section that paints an alarming state instead of
 * crashing. Silent, per section, and invisible to a suite that never mounted them.
 *
 * A per-section unit test would not have caught either: nothing had mounted
 * `engines` at all, and the next such omission will be a different section. So the
 * net is TOTAL over the declared list -- add a section and it is covered, forget to
 * test it and this still goes red.
 *
 * The policy is built to reach the branches that only exist on some data: a custom
 * engine (the bin, hence TRASH), a catch-all (the static key cell, no arrows, no
 * grip), a named shortcut with a pending warning (the acknowledgement boxes), and a
 * quarantined entry (a section that is hidden when empty).
 *
 * Platform is safe in a bare process: every one of its methods wraps the browser
 * handle in a try/catch with a written fallback, so `access` reads "not granted"
 * and `storage` reads "local" rather than throwing.
 */
test("every declared section mounts and renders without throwing", async () => {
  await withDocument(async (doc) => {
    const sections = await loadSections();
    assert.ok(sections.length >= 8, `the declared list is present, got ${sections.length}`);

    const engine = g.CustomEngine.parse({ host: "intra.example.org", shape: "search-q" });
    let policy = g.JumpPolicy.empty().withCustomEngine(engine.value).value;
    policy = policy.withEngines(["google.com", engine.value.id()]).value;
    // Insecure scheme => a pending, arming-blocking acknowledgement on this row.
    policy = policy.register("id-named", g.ProjectKey.parse("ABC").value,
      instance("http://jira:8080")).value;
    policy = policy.registerCatchAll("id-catch-all",
      instance("https://catchall.atlassian.net")).value;
    // An entry that could not be read back: the quarantine section is hidden when
    // this list is empty, so an empty one would leave that render unvisited.
    const stored = new g.StoredPolicy(policy, [{ id: "bad", key: "!!", baseUrl: "nope" }]);

    // THROUGH THE WRAPPER, exactly as section-host.js does. `render` and
    // `reconcile` are OPTIONAL on a section -- the preview declares no render at
    // all, its output being driven by its own input handler -- and ui/section.js
    // supplies the neutral halves. Calling the raw object would test a protocol
    // this project deliberately does not have.
    const painted = [];
    for (const declared of sections) {
      const section = new g.Section(declared);
      const node = doc.createElement("div");
      const ctx = contextFor(stored, []);
      // NOT wrapped in a try that reports: the assertion IS that nothing throws.
      // A throw here fails the test with the real stack, which names the file.
      section.mount(node, ctx);
      section.reconcile(stored, ctx);
      await section.render(stored, ctx);
      painted.push(node);
    }
    // AND SOMETHING WAS ACTUALLY PAINTED. A loop that renders eight no-ops would
    // pass the no-throw assertion above while proving nothing; this is what makes
    // the net a net. Not asserted per section: `quarantine` legitimately hides
    // itself when there is nothing to say, and the count is what cannot be faked.
    const total = painted.reduce((n, node) => n + node.children.length, 0);
    assert.ok(total > sections.length,
      `the sections painted almost nothing: ${total} nodes for ${sections.length} sections`);
  });
});

/**
 * THE CHANGE BANNER SANITISES WHAT IT PRINTS.
 *
 * Dom.visibleText's docstring used to bound itself to "exactly one place: the
 * quarantine rows", on the argument that "a host on any other screen has survived
 * JiraInstance.parse". That is false here: a fact comes back from storage.local
 * through DestinationJournal.entryOf, which bounds the LENGTH of a text field and
 * validates nothing else -- it is not re-parsed at render time. So an RTL override
 * in a journalled baseUrl printed the destination BACKWARDS, on the one surface
 * whose entire job is to have a destination checked by eye.
 *
 * Only a local writer can put one there, so this is defence in depth in a zone
 * SECURITY.md declares out of scope -- and the falsified sentence is what would
 * have stopped the next reader from looking.
 */
test("a journalled destination is printed with its deceptive characters removed", async () => {
  await withDocument(async () => {
    await loadSections();
    const override = "‮";
    const zeroWidth = "​";
    const nodes = g.SectionSentences.FACT_SENTENCE({
      type: "DestinationChanged",
      key: "ABC" + zeroWidth,
      oldBaseUrl: "https://jira.corp.example",
      newBaseUrl: "https://jira." + override + "moc.live",
    });
    const printed = nodes
      .map((node) => (typeof node === "string" ? node : node.textContent))
      .join("");
    assert.equal(printed.includes(override), false, "the override reaches the banner");
    assert.equal(printed.includes(zeroWidth), false, "a zero-width space reaches the banner");
    assert.ok(printed.includes("�"), "something must say a character was there");
    assert.ok(printed.includes("jira."), "and the rest of the host is still readable");
  });
});

test("every fact type the journal can hand over has a sentence, and none is empty", async () => {
  await withDocument(async () => {
    await loadSections();
    // The journal's door coerces an unknown type to UnknownFact, so the set of
    // types that can REACH this function is exactly FACT_TYPES. A missing case
    // falls through to `default:` -- the DestinationChanged sentence -- which
    // prints fields the fact does not carry: " now points to  ."
    // Every field any fact carries, so a sentence is judged on what it SAYS and
    // never on a field its own type was not given.
    const everyField = {
      key: "ABC", oldKey: "ABC", newKey: "XYZ",
      baseUrl: "https://jira.corp.example",
      oldBaseUrl: "https://was.corp.example",
      newBaseUrl: "https://now.corp.example",
      catchAllBaseUrl: "https://catchall.corp.example",
      affectedKeys: ["ABC", "OPS"], affectedHosts: ["intra.example.org"],
      kinds: ["DestinationChanged"],
      changedCount: 3, engineCount: 2, shortcutCount: 4,
    };
    const render = (fact) =>
      g.SectionSentences.FACT_SENTENCE(fact)
        .map((node) => (typeof node === "string" ? node : node.textContent))
        .join("")
        .trim();

    for (const type of g.DestinationJournal.FACT_TYPES) {
      const printed = render({ type, ...everyField });
      assert.ok(printed.length > 0, `${type} renders nothing`);
      assert.equal(printed.includes("undefined"), false, `${type} prints "undefined"`);
    }

    /**
     * THE REGRESSION, NAMED. An unknown type used to fall through to `default:`,
     * which IS the DestinationChanged sentence -- so the banner announced a
     * destination change, with the destinations missing, from an entry that never
     * said so. Both halves are asserted: it has a sentence OF ITS OWN, and that
     * sentence is not the neighbour's.
     */
    const unknown = render({ type: g.DestinationJournal.UNKNOWN_FACT });
    const destinationChanged = render({ type: "DestinationChanged", ...everyField });
    assert.notEqual(unknown, destinationChanged, "an unnameable change borrows a claim");
    assert.equal(unknown.includes("points to"), false, "it must claim no destination");
    assert.ok(unknown.length > 0, "and it must still say something: it is evidence");

    // A fact with NO fields at all is the shape a hostile local store writes most
    // cheaply, and it must not render a sentence with holes where hosts go.
    assert.equal(
      /points to\s*\.\s*$/.test(render({ type: g.DestinationJournal.UNKNOWN_FACT })),
      false,
    );
  });
});

test("a search domain added elsewhere is named in the banner", async () => {
  await withDocument(async () => {
    await loadSections();
    const printed = g.SectionSentences
      .FACT_SENTENCE({ type: "DomainsAdded", affectedHosts: ["intra.example.org", "google.com"] })
      .map((node) => (typeof node === "string" ? node : node.textContent))
      .join("");
    // EnginesAdded can only count -- an engine id is opaque at that layer. A custom
    // domain IS a host the user can recognise, and the one that matters is the one
    // duplicating an engine they already granted.
    assert.ok(printed.includes("intra.example.org"), "the domain must be named");
    assert.ok(printed.includes("google.com"));
  });
});

test("the export releases its object URL on the next turn, not in this one", async () => {
  await withDocument(async () => {
    await loadUi();
    // `click()` SCHEDULES the download; revoking in the same task can cancel it
    // before the browser has read the blob, and the export then silently does
    // nothing -- on the only path by which a user gets their configuration out.
    const revoked = [];
    const previous = { create: global.URL.createObjectURL, revoke: global.URL.revokeObjectURL };
    global.URL.createObjectURL = () => "blob:fake";
    global.URL.revokeObjectURL = (url) => revoked.push(url);
    try {
      g.Dom.downloadFile("quick-jump-for-jira.json", "{}");
      assert.deepEqual(revoked, [], "revoking in the same task can cancel the download");
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.deepEqual(revoked, ["blob:fake"], "and it must still be released");
    } finally {
      global.URL.createObjectURL = previous.create;
      global.URL.revokeObjectURL = previous.revoke;
    }
  });
});

/**
 * A FACT NOBODY READS IS A CONTROL THAT DOES NOT EXIST.
 *
 * PolicyRepository.load returns `unreadable` beside `stored` -- one entry per field
 * of the saved document the admission door could not make sense of. admission.js
 * called the absent reader "named debt, not an oversight", and it stayed absent
 * while the producers grew to three: an arming state that is not a boolean, a
 * ticked engine id that is not an identity, a selection longer than anything
 * selectable. A signal about the integrity of the stored configuration, computed
 * and thrown away.
 */
test("a field of the configuration that could not be read is said, in the section named for it", async () => {
  await withDocument(async (doc) => {
    const section = await sectionNamed("SectionQuarantine");
    const stored = new g.StoredPolicy(g.JumpPolicy.empty(), []);
    const root = doc.createElement("div");
    const ctx = {
      ...contextFor(stored, []),
      unreadable: () => [
        { code: "ENGINES_TRUNCATED", message: "raw english from the domain" },
        { code: "ARMING_STATE_UNREADABLE", message: "raw english from the domain" },
        { code: "SOMETHING_A_LATER_BUILD_INVENTED", message: "raw english from the domain" },
      ],
    };
    section.mount(root, ctx);
    section.render(stored, ctx);

    assert.equal(root.hidden, false, "the section hides itself when there is nothing to say, and there is");
    // TWO NATURES, TWO LABELS. "Kept, never deleted on your behalf" is true of a
    // quarantined ENTRY and FALSE of an unreadable FIELD, which is recomputed at
    // every read. With no entry to keep, that sentence must not be on screen.
    const labels = root.querySelectorAll(".lbl").map((l) => l.textContent);
    assert.equal(labels.length, 1, "one label, for the one nature present");
    assert.ok(labels[0].includes("could not be read"), `got ${labels[0]}`);
    assert.equal(
      labels[0].includes("Kept, never deleted"),
      false,
      "the persistence note must not cover facts that do not persist",
    );
    // `.row-msg` rather than ".causes li": the fake DOM implements simple
    // selectors only, and this root holds no quarantine row, so the class is exact.
    const said = root.querySelectorAll(".row-msg").map((li) => li.textContent);
    assert.equal(said.length, 3, "one line per fact, not a summary");
    assert.ok(said[0].includes("longer than"), `the truncation is explained, got ${said[0]}`);
    assert.ok(said[1].includes("nothing is armed"), `the arming state is explained, got ${said[1]}`);
    // A code this build has no sentence for still SAYS something rather than
    // vanishing: over-signalling is the direction, exactly as for an unknown fact.
    assert.equal(said[2], "SOMETHING_A_LATER_BUILD_INVENTED");
    // NEVER the message that travelled with the fact: it is English written in the
    // domain, on a surface that is translated.
    for (const line of said) {
      assert.equal(line.includes("raw english from the domain"), false, "the domain's English reached the screen");
    }
  });
});

test("the section stays hidden when nothing was set aside and nothing was unreadable", async () => {
  await withDocument(async (doc) => {
    const section = await sectionNamed("SectionQuarantine");
    const stored = new g.StoredPolicy(g.JumpPolicy.empty(), []);
    const root = doc.createElement("div");
    const ctx = contextFor(stored, []);
    section.mount(root, ctx);
    section.render(stored, ctx);
    assert.equal(root.hidden, true, "a section with nothing to say says nothing");
  });
});

test("every code the admission door can put in `unreadable` has a sentence", async () => {
  await withDocument(async () => {
    await loadSections();
    // The producers are three files, and a code invented in one of them without a
    // sentence here renders as a bare identifier. Scanned rather than listed, so a
    // fourth producer cannot appear unnoticed.
    const { readFileSync } = await import("node:fs");
    const table = g.SectionSentences.UNREADABLE_SENTENCE();
    const produced = new Set();
    for (const file of ["src/core/admission.js", "src/core/engine-id.js"]) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      for (const m of source.matchAll(/code:\s*"([A-Z_]+)"/g)) produced.add(m[1]);
      for (const m of source.matchAll(/refuse\("(ENGINE_ID_[A-Z_]+)"/g)) produced.add(m[1]);
    }
    // Only the ones that actually travel in `unreadable`: readDocument pushes the
    // arming state and the engine facts, and EngineId.parse's codes reach it through
    // `unreadableEngines`.
    for (const code of ["ARMING_STATE_UNREADABLE", "ENGINES_TRUNCATED",
                        "ENGINE_ID_SHAPE", "ENGINE_ID_NOT_A_STRING"]) {
      assert.ok(produced.has(code), `${code} is no longer produced: the table has a dead row`);
      assert.equal(typeof table[code], "string", `${code} has no sentence`);
      assert.ok(table[code].length > 0);
    }
    // And no row is maintained for a code nothing produces.
    for (const code of Object.keys(table)) {
      assert.ok(produced.has(code), `${code} has a sentence but nothing produces it`);
    }
  });
});

/**
 * THE REVIEW SCREEN SHOWS THE SURFACE, NOT ONLY THE DESTINATIONS.
 *
 * `toTransfer()` carries `engines` and `customEngines` beside the shortcuts, and
 * this screen built its rows from shortcuts alone while its lede promised "check
 * where each key would send you". Measured before the fix: a file adding
 * `intra.attacker.example` and ticking it showed ONE row, and once the user armed
 * that shortcut it emitted TWO rules -- the second on a host that had never
 * appeared on screen.
 *
 * The Access section and the browser prompt caught it one step later, which is why
 * this was consent to the surface rather than a breach. The screen is now
 * complete at the first step.
 */
test("the import review names the engines and domains the file selects", async () => {
  await withDocument(async (doc) => {
    const section = await sectionNamed("SectionTransfer");
    const stored = new g.StoredPolicy(g.JumpPolicy.empty(), []);
    const root = doc.createElement("div");
    const ctx = contextFor(stored, []);
    section.mount(root, ctx);

    section.proposal = g.JumpPolicy.proposeImport({
      schemaVersion: 1,
      engines: ["google.com", "custom:intra.attacker.example"],
      customEngines: [{ host: "intra.attacker.example", shape: "root-q" }],
      shortcuts: [{ id: "11111111-1111-4111-8111-111111111111", key: "ABC", baseUrl: "https://example.atlassian.net" }],
    });
    assert.equal(section.proposal.ok, true);
    section.render(stored, ctx);

    const shown = root.textContent;
    assert.ok(shown.includes("example.atlassian.net"), "the destination is still shown");
    assert.ok(shown.includes("google.com"), "the ticked engines must be named");
    assert.ok(
      shown.includes("intra.attacker.example"),
      "a domain the file adds must appear before the user confirms",
    );
    assert.ok(shown.includes("where searches are intercepted"), "and it must say what that list is");
  });
});

test("a file that carries only shortcuts adds no surface line", async () => {
  await withDocument(async (doc) => {
    const section = await sectionNamed("SectionTransfer");
    const stored = new g.StoredPolicy(g.JumpPolicy.empty(), []);
    const root = doc.createElement("div");
    const ctx = contextFor(stored, []);
    section.mount(root, ctx);
    section.proposal = g.JumpPolicy.proposeImport({
      schemaVersion: 1,
      shortcuts: [{ id: "11111111-1111-4111-8111-111111111111", key: "ABC", baseUrl: "https://example.atlassian.net" }],
    });
    section.render(stored, ctx);
    // A section that has nothing to say says nothing -- the same rule as the
    // quarantine's two labels.
    assert.equal(
      root.textContent.includes("where searches are intercepted"),
      false,
      "no engines and no domains means no line",
    );
  });
});
