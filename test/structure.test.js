import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const manifest = JSON.parse(read("src/manifest.json"));
// The manifest's own strings are localised, so a store listing or a test that
// wants the real name has to resolve __MSG_ through the default locale.
const resolveMessage = (value) => {
  const match = /^__MSG_([A-Za-z0-9_]+)__$/.exec(value);
  if (!match) return value;
  const messages = JSON.parse(read(`src/_locales/${manifest.default_locale}/messages.json`));
  return messages[match[1]].message;
};
const pkg = JSON.parse(read("package.json"));

const scriptsOf = (html) =>
  [...html.matchAll(/<script\s+src="([^"]+)"/g)].map((m) => m[1]);

test("the permissions are exactly the ones we justify, and no forbidden key is present", () => {
  assert.deepEqual(manifest.permissions, ["declarativeNetRequestWithHostAccess", "storage"]);
  // declarativeNetRequest grants an AMBIENT ability to act on traffic;
  // WithHostAccess subordinates it to the origins the user granted, for the same
  // functionality. declarativeNetRequestFeedback would expose browsing to the
  // extension and, once shipped, would stay.
  const forbidden = [
    "content_scripts", "web_accessible_resources", "externally_connectable",
    "devtools_page", "chrome_url_overrides",
  ];
  for (const key of forbidden) assert.equal(key in manifest, false, `${key} must not be in the manifest`);
  const forbiddenPermissions = [
    "declarativeNetRequest", "declarativeNetRequestFeedback", "tabs", "scripting",
    "webRequest", "webRequestBlocking", "webNavigation", "history", "cookies",
    "bookmarks", "downloads", "clipboardRead", "management", "proxy",
    "nativeMessaging", "debugger", "unlimitedStorage", "<all_urls>",
  ];
  for (const p of forbiddenPermissions) {
    assert.equal(manifest.permissions.includes(p), false, `${p} must not be requested`);
  }
});

test("host permissions are optional, scheme-explicit, and never granted at install", () => {
  assert.equal("host_permissions" in manifest, false, "nothing may be granted at install time");
  assert.deepEqual(manifest.optional_host_permissions, ["http://*/*", "https://*/*"]);
});

test("the content security policy is declared, with connect-src none", () => {
  const csp = manifest.content_security_policy.extension_pages;
  // connect-src 'none' is the verifiable proof behind PRIVACY.md: it makes fetch,
  // XHR, WebSocket and sendBeacon impossible from the extension pages, and
  // reduces an XSS from "exfiltration" to "local nuisance".
  for (const directive of [
    "default-src 'none'", "script-src 'self'", "style-src 'self'",
    "connect-src 'none'", "frame-ancestors 'none'", "object-src 'none'",
  ]) {
    assert.ok(csp.includes(directive), `the CSP must contain ${directive}`);
  }
});

test("the static ruleset guard is literally empty", () => {
  // It exists only to work around Firefox bug 1921353. A rule slipped in here
  // would apply with no configuration at all, on every profile, from install.
  assert.deepEqual(JSON.parse(read("src/rules.json")), []);
  assert.equal(manifest.declarative_net_request.rule_resources[0].enabled, true);
});

test("no third-party code ever ships inside the extension", () => {
  // The blast radius of an npm compromise stays "the CI runner", never "the code
  // on the users' machines".
  assert.deepEqual(pkg.dependencies ?? {}, {});
});

test("the background never makes a network request", () => {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name));
      else if (entry.name.endsWith(".js")) files.push(join(dir, entry.name));
    }
  };
  walk("src");
  for (const file of files) {
    const source = read(file);
    for (const forbidden of ["fetch(", "XMLHttpRequest", "new WebSocket", "sendBeacon"]) {
      assert.equal(source.includes(forbidden), false, `${file} contains ${forbidden}`);
    }
  }
});

test("no dangerous DOM sink appears anywhere in src/", () => {
  const walk = (dir, out = []) => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name), out);
      else if (/\.(js|html)$/.test(entry.name)) out.push(join(dir, entry.name));
    }
    return out;
  };
  const sinks = /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function|setHTMLUnsafe|javascript:/;
  for (const file of walk("src")) {
    assert.equal(sinks.test(read(file)), false, `${file} uses a forbidden DOM sink`);
  }
});

test("the script lists share a common prefix in the same order", () => {
  // Not a strict equality: the background needs neither the sections nor the
  // section host. Written naively the test fails on day one and is then relaxed
  // until it checks nothing.
  const background = manifest.background.scripts;
  const shared = background.filter((s) => !s.endsWith("background.js"));
  for (const page of ["src/options.html", "src/popup.html"]) {
    if (!existsSync(join(ROOT, page))) continue;
    const pageScripts = scriptsOf(read(page));
    const prefix = pageScripts.slice(0, shared.length);
    assert.deepEqual(prefix, shared, `${page} must load the shared scripts in the same order`);
  }
});

test("the manifest and importScripts are the SAME list, in the same order", () => {
  // THE FIFTH LOADING LIST, and the only one no test read. A new file forgotten
  // here breaks CHROME ALONE -- the global is undefined at the first call -- while
  // every test stays green and web-ext lint stays clean. That is exactly the class
  // of incident this batch exists to repair, so the batch must not reopen it.
  //
  // A STRICT EQUALITY, with its filter: the manifest carries one entry more, and it
  // is background.js itself, last. Written as two numbers it would go red the first
  // day and then be relaxed until it checks nothing -- the failure mode the test
  // above documents. The filter is what states it, never a count.
  const shared = manifest.background.scripts.filter((s) => !s.endsWith("background.js"));
  // Extracted by regex, because the test cannot execute the file: importScripts is
  // guarded by `typeof importScripts === "function"`, false under Node.
  const source = read("src/background.js");
  const block = /importScripts\(([^)]*)\)/s.exec(source);
  assert.ok(block, "background.js no longer calls importScripts");
  const imported = [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(imported, shared, "the manifest and importScripts have drifted");
});

test("the load order the changelocks depend on is pinned in every list", () => {
  // Two assertions at load time read across modules -- ProjectKey from the airlock,
  // CatchAllKey from Re2Budget's client -- so the relative order is load-bearing,
  // not incidental. And installed-projection.js already shows what a wrong rank
  // costs: it destructures VersionedEntry AT LOAD.
  const before = (list, a, b) => {
    const ia = list.findIndex((s) => s.endsWith(a));
    const ib = list.findIndex((s) => s.endsWith(b));
    assert.ok(ia >= 0 && ib >= 0, `${a} or ${b} is missing`);
    assert.ok(ia < ib, `${a} must load before ${b}`);
  };
  const lists = [manifest.background.scripts];
  for (const page of ["src/options.html", "src/popup.html"]) {
    if (existsSync(join(ROOT, page))) lists.push(scriptsOf(read(page)));
  }
  for (const list of lists) {
    before(list, "core/project-shortcut.js", "core/catch-all-key.js");
    before(list, "core/catch-all-key.js", "interception/reference-pattern.js");
    before(list, "interception/re2-budget.js", "interception/reference-pattern.js");
  }
});

test("both HTML surfaces share the same UI tail", () => {
  if (!existsSync(join(ROOT, "src/options.html")) || !existsSync(join(ROOT, "src/popup.html"))) return;
  const shared = manifest.background.scripts.filter((s) => !s.endsWith("background.js"));
  const tail = (page) => scriptsOf(read(page)).slice(shared.length).filter((s) => !/options\.js|popup\.js/.test(s));
  assert.deepEqual(tail("src/options.html"), tail("src/popup.html"));
});

test("the vendored signature declares its provenance", () => {
  // The project's other supply-chain test only looks at package.json. This one
  // covers what actually ships: where this CSS came from, and under which
  // licence. It needs no clone, which is why CI can stay hermetic.
  const css = read("src/ui/author-signature.css");
  assert.match(css, /Romain-MILLAN-Tag@[0-9a-f]{40}/);
  assert.match(css, /MIT/);
  // The SVG is a frozen manual copy living in options.html; assert its
  // provenance too, as soon as that page exists.
  if (existsSync(join(ROOT, "src/options.html"))) {
    assert.match(read("src/options.html"), /Romain-MILLAN-Tag@[0-9a-f]{40}/);
  }
});

test("no workflow exposes secrets to pull request code", () => {
  // This guard used to live in ci.yml as a grep over ci.yml itself, so it
  // matched its own pattern and failed on every run -- the kind of always-red
  // check that gets relaxed until it verifies nothing. As a test it reads a
  // different file than the one it lives in, and it runs locally.
  const ci = read(".github/workflows/ci.yml");
  assert.equal(/pull_request_target/.test(ci), false, "a fork PR must never run with secrets in scope");
  assert.equal(/secrets\./.test(ci), false, "ci.yml must not reference any secret");
});

test("every resource the pages reference actually exists", () => {
  // A path typo in an HTML page is invisible until the page is opened in a
  // browser; the manifest linter does not follow script or stylesheet paths.
  for (const page of ["src/options.html", "src/popup.html"]) {
    const html = read(page);
    const refs = [
      ...[...html.matchAll(/<script\s+src="([^"]+)"/g)].map((m) => m[1]),
      ...[...html.matchAll(/<link[^>]+href="([^"]+)"/g)].map((m) => m[1]),
    ];
    assert.ok(refs.length > 0, `${page} references nothing`);
    for (const ref of refs) {
      assert.ok(existsSync(join(ROOT, "src", ref)), `${page} references missing ${ref}`);
    }
  }
  // Same for the stylesheets' own url() references, which carry the bundled font.
  for (const sheet of ["src/ui/tokens.css", "src/ui/sections.css"]) {
    for (const m of read(sheet).matchAll(/url\("([^"]+)"\)/g)) {
      assert.ok(existsSync(join(ROOT, "src", "ui", m[1])), `${sheet} references missing ${m[1]}`);
    }
  }
});

test("the background script list matches the files on disk", () => {
  for (const script of manifest.background.scripts) {
    assert.ok(existsSync(join(ROOT, "src", script)), `manifest lists missing ${script}`);
  }
});

test("the store listing justifies exactly the permissions the manifest asks for", () => {
  // A listing that drifts from the manifest is how a review gets refused, and how
  // a permission nobody justified ends up shipped.
  const listing = read("STORE_LISTING.md");
  for (const permission of manifest.permissions) {
    assert.ok(listing.includes(permission), `STORE_LISTING.md does not justify ${permission}`);
  }
  for (const origin of manifest.optional_host_permissions) {
    assert.ok(listing.includes(origin), `STORE_LISTING.md does not mention ${origin}`);
  }
  assert.ok(listing.includes(resolveMessage(manifest.name)), "STORE_LISTING.md does not carry the manifest name");
});

test("the search-suggestion caveat survives", () => {
  // The extension removes the search REQUEST, not the suggestion traffic that the
  // browser sends while you type. Dropping this sentence would make a document
  // published on a store untrue, so it is asserted rather than trusted.
  for (const doc of ["PRIVACY.md", "README.md"]) {
    assert.match(read(doc), /suggestion/i, `${doc} no longer states the suggestion caveat`);
  }
});

test("every origin we could request is inside optional_host_permissions", async () => {
  // Chrome refuses — silently, by throwing — a permission request that is not
  // entirely covered by the manifest's optional patterns. That turns "Grant
  // access" into a button that does nothing, with an empty console. This is the
  // assertion that keeps the two lists from drifting apart.
  const { loadCore } = await import("./load-core.js");
  const g = await loadCore();

  const declared = manifest.optional_host_permissions.map((p) => new URL(p.replace("*://", "https://")).protocol);
  const engines = g.SearchEngineCatalog.all();
  assert.ok(engines.length > 0);

  for (const engine of engines) {
    for (const origin of engine.permissionOrigins) {
      assert.ok(
        origin.startsWith("https://") || origin.startsWith("http://"),
        `${engine.id} asks for ${origin}, whose scheme is not declared`,
      );
      assert.ok(declared.includes(origin.startsWith("https://") ? "https:" : "http:"));
    }
  }
});

test("a rule never matches a host we did not ask permission for", async () => {
  // The host pattern and the permission origins are derived from one list, so a
  // rule cannot match google.fr while permission was only sought for google.com —
  // which installs a rule that can never fire.
  const { loadCore } = await import("./load-core.js");
  const g = await loadCore();

  for (const engine of g.SearchEngineCatalog.all()) {
    const hosts = engine.permissionOrigins.map((o) => o.replace("https://*.", "").replace("/*", ""));
    for (const host of hosts) {
      const pattern = new RegExp("^" + engine.hostPattern + "$");
      assert.ok(pattern.test(host), `${engine.id}: pattern does not match granted host ${host}`);
      assert.ok(pattern.test("www." + host), `${engine.id}: pattern does not match www.${host}`);
    }
  }
});

test("no inline style survives, because the CSP blocks it", () => {
  // `style-src 'self'` blocks style attributes outright — a rule this project
  // states in its own manifest, and then has to obey. A blocked style is silent
  // in production and only shows as a console entry nobody reads, so it is
  // asserted here instead.
  const walk = (dir, out = []) => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name), out);
      else if (/\.(js|html)$/.test(entry.name)) out.push(join(dir, entry.name));
    }
    return out;
  };
  for (const file of walk("src")) {
    const source = read(file);
    assert.equal(/\sstyle="/.test(source), false, `${file} carries an inline style attribute`);
    assert.equal(/\.style\.[a-zA-Z]+\s*=/.test(source), false, `${file} assigns an inline style`);
    assert.equal(/setAttribute\(\s*["']style["']/.test(source), false, `${file} sets a style attribute`);
  }
});

test("every locale carries exactly the keys the code and the manifest ask for", () => {
  // A missing key is invisible in English — Platform.t falls back to the literal
  // written at the call site, so the UI looks right while the French build is
  // silently half-translated. The manifest is worse: Chrome refuses to load an
  // extension whose __MSG_ has no entry in the default locale.
  const walk = (dir, out = []) => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name), out);
      else if (entry.name.endsWith(".js")) out.push(join(dir, entry.name));
    }
    return out;
  };

  const called = new Map();
  for (const file of walk("src")) {
    for (const m of read(file).matchAll(/\bt\(\s*"([A-Za-z0-9_]+)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*\)/g)) {
      const previous = called.get(m[1]);
      // Two call sites under one key must say the same thing, or one of them
      // gets the other's translation.
      assert.ok(previous === undefined || previous === m[2], `${m[1]} is called with two different English texts`);
      called.set(m[1], m[2]);
    }
  }
  assert.ok(called.size > 40, "the t() scan found suspiciously few keys");

  const fromManifest = [...read("src/manifest.json").matchAll(/__MSG_([A-Za-z0-9_]+)__/g)].map((m) => m[1]);
  assert.ok(fromManifest.includes("extensionName"), "the manifest must localise its own name");

  const locales = readdirSync(join(ROOT, "src/_locales"));
  assert.ok(locales.includes(manifest.default_locale), "the default locale must exist");
  assert.ok(locales.length > 1, "a second locale must ship, or the i18n plumbing is untested");

  const reference = JSON.parse(read(`src/_locales/${manifest.default_locale}/messages.json`));
  for (const [key, english] of called) {
    assert.ok(key in reference, `${key} is used in the code but missing from the default locale`);
    // The fallback written at the call site IS the English string. If they drift,
    // the language a reader sees depends on whether i18n happened to answer.
    assert.equal(reference[key].message, english, `${key} says something different in code and in messages.json`);
  }
  for (const key of fromManifest) {
    assert.ok(key in reference, `__MSG_${key}__ has no entry in the default locale`);
  }

  const expected = new Set([...called.keys(), ...fromManifest]);
  for (const locale of locales) {
    const messages = JSON.parse(read(`src/_locales/${locale}/messages.json`));
    assert.deepEqual(
      Object.keys(messages).sort(),
      [...expected].sort(),
      `src/_locales/${locale}/messages.json does not carry exactly the expected keys`,
    );
    for (const [key, entry] of Object.entries(messages)) {
      assert.equal(typeof entry.message, "string", `${locale}/${key} has no message`);
      assert.notEqual(entry.message.trim(), "", `${locale}/${key} is empty`);
      // A placeholder that survives translation into a language we do not read
      // would be silently rendered as literal text.
      assert.equal(/\$[A-Za-z0-9_]+\$/.test(entry.message), false, `${locale}/${key} uses a placeholder`);
    }
  }
});

test("no user-visible sentence is written straight into the HTML", () => {
  // This is the gap the locale-parity test above cannot see: a string that never
  // goes through t() has no key to be missing, so every locale looks complete
  // while the page still shows English. Three of them shipped that way before
  // this assertion existed.
  const allowed = new Set(["Quick Jump", "for Jira", "romainmillan.fr"]);
  for (const page of ["src/options.html", "src/popup.html"]) {
    let html = read(page).replace(/<!--[\s\S]*?-->/g, " ");
    for (const tag of ["script", "style", "title", "svg"]) {
      html = html.replace(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>`, "g"), " ");
    }
    for (const text of html.split(/<[^>]*>/).map((t) => t.trim()).filter(Boolean)) {
      assert.ok(
        allowed.has(text),
        `${page} writes "${text}" as literal text; route it through Platform.t instead`,
      );
    }
  }
});

test("the Firefox add-on id is frozen", () => {
  // Once a signed .xpi is out, this string IS the add-on's identity: Firefox
  // matches updates against it. Changing it does not rename the extension, it
  // creates a different one that installs alongside the old, which keeps
  // running with no way back. AMO also refuses a second add-on under an id
  // already signed, so the mistake is not reversible.
  assert.equal(manifest.browser_specific_settings.gecko.id, "jira-quick-jump@romainmillan");
});

test("the options page never calls the storage door's key parser", () => {
  // ShortcutKey.parse is the ONLY place where a string becomes a catch-all key,
  // and the typed field must never reach it. The UI expresses a gesture
  // (registerCatchAll) and the core forges the key.
  const ui = read("src/options-sections.js");
  assert.equal(/ShortcutKey\.parse/.test(ui), false, "options-sections.js must not parse a shortcut key");
  assert.equal(/CatchAllKey\.only/.test(ui), false, "options-sections.js must not mint a catch-all key");
});

test("the written form of the catch-all key has one owner", () => {
  // Bounded to src/: test/ must legitimately contain "*" for the hostile corpus.
  // And it looks for the QUOTED literal, not the character -- permissionOrigin
  // returns ".../*" and would otherwise fail an innocent line.
  const walk = (dir, out = []) => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name), out);
      else if (entry.name.endsWith(".js")) out.push(join(dir, entry.name));
    }
    return out;
  };
  for (const file of walk("src")) {
    if (file.endsWith("catch-all-key.js")) continue;
    assert.equal(
      /["']\*["']/.test(read(file)),
      false,
      `${file} spells the catch-all's written form; only catch-all-key.js may`
    );
  }
});

const srcFiles = () => {
  const walk = (dir, out = []) => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name), out);
      else if (entry.name.endsWith(".js")) out.push(join(dir, entry.name));
    }
    return out;
  };
  return walk("src");
};

test("the drag attribute has one reviewed exit, and it writes the literal string", () => {
  // `draggable` stays OUT of the whitelist for the same reason `href` does. And it
  // is an ENUMERATED attribute: Dom.el turns `true` into setAttribute(name, ""),
  // and draggable="" means `auto`, which means NOT draggable -- so a whitelist
  // entry would let someone ship a silently inert handle, and the obvious repair
  // is to move the attribute onto the <li>, which hijacks text selection inside a
  // field.
  const writers = srcFiles().filter((f) => /setAttribute\(\s*["']draggable["']/.test(read(f)));
  assert.deepEqual(writers, ["src/ui/dom.js"]);
  assert.match(read("src/ui/dom.js"), /setAttribute\("draggable",\s*"true"\)/);
  const attrs = read("src/ui/dom.js").slice(0, read("src/ui/dom.js").indexOf("const SVG_NS"));
  assert.equal(/"draggable"\s*,/.test(attrs), false, "draggable must stay out of ATTRS");
});

test("a drag handle never ships without the arrows beside it", () => {
  // The pointer gesture is the SECOND way to reorder, never the first: the handle
  // is aria-hidden, so assistive technology only ever sees the two buttons. Delete
  // them and this becomes a WCAG 2.2 failure (2.1.1, 2.5.7), not a style question.
  //
  // Written as an implication rather than a count, so it cannot go vacuous the day
  // the handle moves file.
  const ui = read("src/options-sections.js");
  const handles = ui.match(/Dom\.dragHandle\(/g) || [];
  assert.equal(handles.length, 1, "exactly one drag handle is built");
  assert.match(ui, /"move-up"/);
  assert.match(ui, /"move-down"/);
  assert.match(ui, /t\("moveUp"/);
  assert.match(ui, /t\("moveDown"/);
});

test("the dragged payload carries a constant, never an identifier", () => {
  // The authority is the LOCAL GESTURE, which only exists in the document where
  // dragstart happened -- the cloakroom hands the coat back against its own token,
  // not against the name the customer announces. So the payload is decorative, and
  // it TRAVELS: a drop released outside the surface hands it to whatever listens.
  const reorder = read("src/ui/row-reorder.js");
  const sets = reorder.match(/setData\([^)]*\)/g) || [];
  assert.deepEqual(sets, ['setData(DRAG_TYPE, "row")']);
  const gets = reorder.match(/getData\([^)]*\)/g) || [];
  assert.deepEqual(gets, ["getData(DRAG_TYPE)"]);
  // Lower case throughout: setData normalises the format, so a capital would make
  // types.includes() permanently false on Firefox, with no console error.
  const type = /DRAG_TYPE = "([^"]+)"/.exec(reorder)[1];
  assert.equal(type, type.toLowerCase());
  assert.equal(/jira|quick|jump/i.test(type), false, "the format name must not announce the product");
});

test("whatever accepts a drop cancels the default first", () => {
  // An un-prevented drop navigates the document -- and `pagehide` triggers flush(),
  // which calls commit() WITHOUT awaiting, so a navigation kills the document
  // mid-write and the last intention is lost in silence.
  const reorder = read("src/ui/row-reorder.js");
  const drop = reorder.slice(reorder.indexOf('addEventListener("drop"'));
  // "First" is the invariant, not merely "present": the default must be cancelled
  // before anything reads the payload, because an un-prevented drop navigates.
  const prevents = drop.indexOf("event.preventDefault()");
  const reads = drop.indexOf("getData(");
  assert.ok(prevents > 0, "drop prevents the default");
  assert.ok(prevents < reads, "and it prevents BEFORE reading the payload");
  const over = reorder.slice(reorder.indexOf("const over = (event)"), reorder.indexOf('addEventListener("dragenter"'));
  assert.match(over, /event\.preventDefault\(\)/, "dragover prevents on a valid target");
  // The host's own drop listener is what resumes its deferred render.
  assert.equal(/stopPropagation/.test(reorder), false);
  assert.equal(/stopPropagation/.test(read("src/options-sections.js")), false);
});

test("the host defers a render for whatever the user is holding, and still knows nothing about a shortcut", () => {
  const host = read("src/ui/section-host.js");
  for (const word of ["shortcut", "grip", "data-id", "closest", "dataTransfer"]) {
    assert.equal(new RegExp(word, "i").test(host), false, `section-host.js must not mention ${word}`);
  }
  assert.match(host, /dragstart/, "it does learn that a gesture exists");
  // onBlur is GONE: it replayed the render without consulting the latch, which is
  // what destroyed the row under the pointer between pointerdown and dragstart.
  const handlers = host.match(/addEventListener\("focusout"/g) || [];
  assert.equal(handlers.length, 1, "exactly one focusout handler");
});

test("the host removes every listener it adds", () => {
  const host = read("src/ui/section-host.js");
  assert.equal(
    (host.match(/\.addEventListener\(/g) || []).length,
    (host.match(/\.removeEventListener\(/g) || []).length
  );
});

test("every section declares its own reconcile, none is grafted by the host", () => {
  // mutation-result.js: "a field that shows up only on some operations … would
  // force every caller to write a presence test, which is the mistake". A signed
  // empty body is an implementation; an empty body filled in by the neighbour is a
  // patch -- and a typo would disable the compensation in silence.
  const ui = read("src/options-sections.js");
  const listed = /OptionsSections = \[([^\]]*)\]/.exec(ui)[1].split(",").length;
  const declared = (ui.match(/^\s{4}reconcile\(/gm) || []).length;
  assert.equal(declared, listed, "as many reconcile() as there are sections");
  assert.equal(/section\.reconcile\s*=/.test(read("src/ui/section-host.js")), false);
});

test("reconcile never redraws, and only ever speaks constants", () => {
  // It runs while the view is frozen, so it is the one path the tests cannot see
  // through a render -- the best place for a future string from storage.
  const ui = read("src/options-sections.js");
  const bodies = [...ui.matchAll(/^\s{4}reconcile\([^)]*\)\s*\{([\s\S]*?)^\s{4}\},/gm)].map((m) => m[1]);
  assert.ok(bodies.length > 0);
  for (const body of bodies) {
    for (const sink of ["appendChild", "Dom.clear", "Dom.el"]) {
      assert.equal(body.includes(sink), false, `reconcile must not call ${sink}`);
    }
    for (const call of body.match(/announce\([^;]*\)/g) || []) {
      assert.match(call, /t\("[A-Za-z0-9_]+",\s*"/, "reconcile announces literals only");
    }
  }
});

test("the aggregate is the spokesman: the UI never reaches past it to its collection", () => {
  // statusOf declares itself the SOLE judge of a row. Offering one counter on the
  // root and another on the registry is what invites the traversal, so the two
  // delegations close the pair -- and the aggregate itself was using the back door.
  for (const file of srcFiles()) {
    if (!file.startsWith("src/ui/") && file !== "src/options-sections.js") continue;
    assert.equal(/registry\(/.test(read(file)), false, `${file} must not reach the registry`);
  }
});

test("the section that can be frozen never owns the trust banner", () => {
  // heldSection names ONE section, so a drag freezes Shortcuts alone. The
  // destination-changed banner lives in Status, and the failure banner is a SIBLING
  // of #sections -- which is why the promise "any change of destination raises a
  // banner before your next jump" survives a ten-second gesture.
  for (const page of ["src/options.html", "src/popup.html"]) {
    const markup = read(page);
    const banner = markup.indexOf('id="host-banner"');
    const sections = markup.indexOf('id="sections"');
    assert.ok(banner > 0 && sections > banner, `${page}: the banner precedes #sections as a sibling`);
  }
  const ui = read("src/options-sections.js");
  assert.match(ui, /OptionsSections = \[Status,/, "Status is the first section");
});

test("a spacing class is never silently outranked on the same element", () => {
  // The bug this exists for was invisible, and the FIRST attempt at this test was
  // invisible too: it compared class NAMES, while the conflict is between two
  // DIFFERENT classes on the SAME element. `class="rows rows-spaced"` with
  // `ol.rows { margin: 0 }` (0-1-1) and `.rows-spaced { margin-bottom: 18px }`
  // (0-1-0): both select that element, the element-qualified one wins whatever the
  // source order, and the spacing silently does nothing -- so raising the number
  // changes nothing and absorbs the next attempt to fix the symptom.
  //
  // So the class sets come from the JS, where co-occurrence actually lives.
  const css = read("src/ui/sections.css");
  const ui = read("src/options-sections.js");

  const rules = [...css.matchAll(/^([^@{}\n][^{}\n]*)\{([^}]*)\}/gm)].map(([, selector, body]) => ({
    selector: selector.trim(),
    body,
  }));
  const shorthand = (body) => /(^|[\s;])margin\s*:/.test(body);
  const longhand = (body) => /(^|[\s;])margin-(top|bottom|left|right)\s*:/.test(body);

  // Every set of classes the UI puts on one element, in one attribute.
  const classSets = [...ui.matchAll(/class:\s*"([^"]+)"/g)].map((m) => m[1].trim().split(/\s+/));

  for (const set of classSets) {
    const owned = new Set(set);
    const matching = [];
    for (const { selector, body } of rules) {
      // A simple selector made only of classes from this set, optionally led by an
      // element name: `.a`, `.a.b`, `ol.a`. Anything with a combinator, a
      // pseudo-class or an attribute is out of scope for this check.
      const simple = /^([a-z]*)((?:\.[A-Za-z0-9_-]+)+)$/.exec(selector);
      if (!simple) continue;
      const classes = simple[2].slice(1).split(".");
      if (!classes.every((c) => owned.has(c))) continue;
      if (!shorthand(body) && !longhand(body)) continue;
      matching.push({ selector, body, weight: classes.length * 10 + (simple[1] ? 1 : 0) });
    }
    if (matching.length < 2) continue;
    const strongest = matching.reduce((a, b) => (b.weight > a.weight ? b : a));
    if (!shorthand(strongest.body)) continue;
    for (const rule of matching) {
      if (rule === strongest || rule.weight >= strongest.weight) continue;
      assert.fail(
        `${rule.selector} sets a margin on an element that also matches ${strongest.selector}, ` +
        `which resets margin and outranks it — the spacing silently does nothing`
      );
    }
  }
});
