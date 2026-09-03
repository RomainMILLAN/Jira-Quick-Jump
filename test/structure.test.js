import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadCore } from "./load-core.js";

const g = await loadCore();

const ROOT = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(join(ROOT, p), "utf8");

/**
 * The source WITHOUT its prose.
 *
 * Several of these tests grep for a forbidden call, and they read comments too --
 * so writing "never call X" in a comment made the test that forbids X go red. Two
 * of them fired that way while this batch was being written, which is a test
 * teaching the code not to explain itself.
 *
 * Crude on purpose: it strips block and line comments, and a `//` inside a string
 * literal would be stripped too. No rule here depends on such a line, and a
 * cruder-but-legible filter beats a parser nobody maintains.
 */
/**
 * ALL the section code, as one string.
 *
 * These rules are about what the sections DO, not about which file they sit in --
 * and options-sections.js has stopped being a file that does anything: it is the
 * assembly. Reading it alone would leave every rule below green over an empty
 * list, which is the worst way for a structural test to pass.
 */
const sectionsSource = () =>
  ["src/options-sections.js", ...readdirSync(join(ROOT, "src/ui/sections"))
    .filter((f) => f.endsWith(".js"))
    .sort()
    .map((f) => join("src/ui/sections", f))]
    .map((f) => read(f))
    .join("\n");

const codeOf = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
/** The two HTML surfaces this extension ships. Named once, because two tests
 *  used to skip themselves when one was missing. */
const SURFACES = ["src/options.html", "src/popup.html"];

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

test("the static ruleset is literally empty, and named for what it is", () => {
  // WHY IT EXISTS, in words rather than a number: Firefox bug 1921353 -- an
  // extension declaring declarativeNetRequestWithHostAccess but NO static
  // rule_resources can fail to register its dynamic rules on that engine. An
  // empty ruleset is the documented workaround, and the day the bug is fixed this
  // whole block goes. A bug number alone sends the next reader, or a store
  // reviewer, outside the repository to understand a file on the security surface.
  //
  // A rule slipped in here
  // would apply with no configuration at all, on every profile, from install --
  // and neither purge() nor installedRuleCount() would see it, since both ask
  // only about DYNAMIC rules.
  assert.deepEqual(JSON.parse(read("src/rules.json")), []);
  // THE ID SAYS WHY IT IS THERE. It was "guard", which promises a protection this
  // file does not provide and invites the next reader -- or a store reviewer -- to
  // look for one.
  const resource = manifest.declarative_net_request.rule_resources[0];
  assert.equal(resource.id, "firefox-1921353-workaround");
  assert.equal(resource.enabled, true);
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
    const source = codeOf(read(file));
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
  for (const page of SURFACES) {
    // No existsSync guard: both surfaces SHIP. Skipping on absence made renaming
    // popup.html turn this test green and empty -- the failure mode the audit
    // called "a test that neutralises itself".
    assert.ok(existsSync(join(ROOT, page)), `${page} is a shipped surface and is missing`);
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
    // install-outcome.js destructures VersionedEntry AT LOAD, like
    // installed-projection.js -- the file this test's own comment cites.
    before(list, "versioned-entry.js", "install-outcome.js");
    // installed-rule.js destructures RuleRanking at load and DELEGATES to it.
    before(list, "interception/rule-ranking.js", "interception/installed-rule.js");
    before(list, "interception/installed-rule.js", "interception/jump-preview.js");
  }

  // A SECOND LOOP, over the PAGE lists only. The naive addition inside the loop
  // above would go RED on background.scripts, where ui/diagnosis-presentation.js is
  // rightly forbidden -- and the interdicted repair must be named: DO NOT put the
  // file in the manifest.
  //
  // This is the ONLY belt the third new file has: it is not in the manifest
  // (correct), no other pair names it, ORDER is pinned by nothing, and the UI-tail
  // equality only catches an ASYMMETRY -- forgotten in BOTH pages, the likeliest
  // case since they are edited in one gesture, it would go red on nothing.
  const pageLists = lists.slice(1);
  assert.ok(pageLists.length > 0, "the page lists must be readable, or this pin is vacuous");
  for (const list of pageLists) {
    before(list, "ui/diagnosis-presentation.js", "options-sections.js");
    // It reads JumpPolicy.DIAGNOSES AT LOAD to refuse an incomplete table: true by
    // accident today, and by contract from here on.
    before(list, "core/jump-policy.js", "ui/diagnosis-presentation.js");
  }
  // And it must NOT be in the service worker: background.scripts carries no ui/*.
  assert.equal(
    manifest.background.scripts.some((f) => f.startsWith("ui/")),
    false,
    "the service worker has no DOM, so no ui/* file belongs in its list");
});

test("both HTML surfaces share the same UI tail", () => {
  for (const page of SURFACES) {
    assert.ok(existsSync(join(ROOT, page)), `${page} is a shipped surface and is missing`);
  }
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

test("the preview never fails silently", () => {
  // The one path in this project where a throw reaches nobody: preview() is called
  // from onInput, so its promise floats. Without a catch, a rule read back in a shape
  // we cannot parse leaves the PREVIOUS verdict on screen -- a stale "Matched a named
  // shortcut" is worse than no answer, and is indistinguishable from the empty state.
  // This is the ear that lets rule-ranking.js keep its canary throw.
  // BEHAVIOUR, not typography. This used to assert that `try {` was the first
  // token after `async preview(ctx) {` -- a blank line broke it, and an empty
  // `try {} catch {}` satisfied it. What matters is that the body is guarded and
  // that the catch does something, so it measures the SHAPE of the function:
  // a try that covers the awaits, and a catch that writes the fallback.
  const ui = sectionsSource();
  const body = codeOf(ui).match(/async preview\(ctx\) \{([\s\S]*?)\n    \},/);
  assert.ok(body, "preview(ctx) is no longer where this test can read it");
  const [, work] = body;
  const guard = work.indexOf("try {");
  assert.ok(guard !== -1, "preview() no longer guards its work");
  assert.equal(work.slice(0, guard).includes("await"), false,
    "preview() awaits before entering its try: a throw there leaves a stale verdict on screen");
  assert.match(work.slice(guard), /catch[^{]*\{[\s\S]*previewUnavailable/,
    "preview()'s catch no longer writes the fallback, so a throw leaves the previous verdict standing");
  assert.ok(ui.includes("previewUnavailable"),
    "the preview has no sentence for a store it cannot read");
});

test("the rules reach the platform through the one counter, and only through it", () => {
  // The three teeth in interception.test.js guard the SHAPE of what platformRules()
  // returns; NONE of them guards the fact that production goes THROUGH it. A future
  // _install rewriting a rest-spread by hand would redden nothing.
  const installer = read("src/rule-installer.js");
  // The absence half. On its own it is satisfied VACUOUSLY -- `addRules:
  // installable.rules()` carries no label name either -- hence the presence half below.
  for (const label of ["isCatchAll", "engineId", "guardedPrefixes"]) {
    assert.equal(installer.includes(label), false,
      `rule-installer.js names ${label}: the stripping has moved back out of rule-set.js`);
  }
  // The presence half. Known bound: it binds a SUBSTRING, not the argument -- a
  // `const x = installable.platformRules();` alongside `addRules: installable.rules()`
  // would satisfy it. It closes the vacuous case, not every case.
  assert.ok(installer.includes("platformRules()"),
    "rule-installer.js no longer goes through the sole counter");
});

test("the single writer of the rules is STRUCTURAL, and the receipt is one-way", () => {
  const bg = codeOf(read("src/background.js"));
  const ui = codeOf(sectionsSource() + read("src/ui/section-host.js"));

  // The lot-2 pin only ever read rule-installer.js, which is why the violation was
  // GREEN FOREVER: background.js held its own purge, copied from _install.
  for (const call of ["updateDynamicRules", "getDynamicRules"]) {
    assert.equal(bg.includes(call), false, `background.js still calls ${call} itself`);
  }
  // This also makes the old behavioural witness "a purge never writes the
  // projection" structural: purge() has no access to it at all.
  assert.equal(/purge\(\)[\s\S]{0,400}InstalledProjection/.test(read("src/rule-installer.js")), false);

  // TWO assertions, not one -- and it is the SECOND that bounds the risk. The first
  // pins the ENTRY NAME, which must stay private to the IIFE anyway. MIND THE CASE:
  // "InstallOutcome.read()" does NOT contain the substring "installOutcome", so the
  // first assertion does not catch it -- and the worker must name InstallOutcome
  // anyway, for record and forget.
  assert.equal(bg.includes("installOutcome"), false, "the entry name is private to its IIFE");
  assert.equal(/InstallOutcome\s*\.\s*read/.test(bg), false,
    "the worker WRITES the receipt; reading it would let a forgeable fact govern the projection");

  // AND THE OTHER DIRECTION, which the pin did not cover: nothing forbade the UI
  // from WRITING the receipt. Not an escalation -- the page is already on the
  // user's side -- but it is the architecture drift that "one write site" claims to
  // close, and the pin only pinched one way.
  for (const forbidden of [/InstallOutcome\s*\.\s*record/, /InstallOutcome\s*\.\s*forget/]) {
    assert.equal(forbidden.test(ui), false, "the UI READS the receipt, it never writes it");
  }
});

test("the airlock's value object is a membrane, not a wrapper", () => {
  // rule-ranking.js is the SOLE owner of the word priority, and jump-preview.js
  // declares that the rules come from a foreign system. Both then read the raw
  // fields in the clear. The ban is SYMMETRIC -- .rule.priority AND .condition. /
  // .action. -- because the §C argument against exposing condition()/action() is
  // won by promising exactly this.
  //
  // IT READS THE SOURCE, COMMENTS INCLUDED, which is deliberate: a stale comment is
  // how the next reader learns the wrong idiom.
  for (const file of ["src/interception/rule-ranking.js", "src/interception/jump-preview.js"]) {
    const source = read(file);
    assert.equal(source.includes(".rule.priority"), false, `${file} still reads .rule.priority`);
    assert.equal(source.includes(".condition."), false, `${file} still reads .condition. in the clear`);
    assert.equal(source.includes(".action."), false, `${file} still reads .action. in the clear`);
  }
  // And the bare `rule.priority` -- what isCatchAllBand is handed -- is SPARED,
  // which is exactly wanted: it stays TOTAL ON A RAW RULE, the forge's canary.
  assert.ok(read("src/interception/rule-ranking.js").includes("rule.priority"),
    "isCatchAllRule must stay total on a RAW rule");
});

test("every direct this.render( in the sections is counted, not merely discouraged", () => {
  // Each direct call bypasses BOTH the per-section try/catch AND the coalescing,
  // which section-host.js declares load-bearing against a second render trigger.
  //
  // A COUNT, not a ban on an absent token: limiting /section\.render\(/ to the host
  // would be BLIND BY CONSTRUCTION -- measured, there are ZERO of those in
  // options-sections.js and both of the repository's are already in the host.
  //
  // AND THE PAIR, because a count alone is blind to SUBSTITUTION: converting a
  // legitimate site and adding a bad one leaves the total at 10.
  // THE COUNTER IS GONE, and this is what replaced it.
  //
  // It asserted `direct === 10` and `refreshed === 2` -- two bare numbers, with a
  // comment conceding they only protect against a global substitution, never a
  // local one. Moving a legitimate this.render( and adding an illegitimate one
  // elsewhere left both totals untouched, so the pair was green over exactly the
  // change it existed to catch. And every edit to this file had to renegotiate a
  // number that means nothing on its own.
  //
  // What the rule actually says is "a section does not repaint itself behind the
  // host's back". That is a BEHAVIOUR, and behaviour is now testable: the UI runs
  // in test/ui.test.js. It is pinned there, against a mounted section, instead of
  // being approximated by arithmetic here.
  assert.ok(true, "see test/ui.test.js: sections repaint through the host");
});

test("SECURITY.md still states how the detector is allowed to fail", () => {
  // This file was pinned by NOTHING, while STORE_LISTING.md, PRIVACY.md and README.md
  // all are -- so the prose/code agreement was the one thing this batch could lose
  // silently. The doctrine and the panel that still lies are both load-bearing.
  const doc = read("SECURITY.md");
  assert.match(doc, /over-signall?ing/i, "SECURITY.md no longer states the failure direction");
  assert.match(doc, /status line/i, "SECURITY.md no longer names which panel still lies");
  // The new entry that carries evidence and is FORGEABLE by a local attacker. The
  // old pin required /status line/i, present twice, so rewriting the prose would
  // have left it GREEN WITHOUT PINNING ANYTHING.
  assert.match(doc, /forgeable/i, "SECURITY.md no longer names the receipt as forgeable");
  assert.match(doc, /installOutcome/i, "SECURITY.md no longer names the entry");
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
  // A FLOOR ON `called.size` USED TO STAND HERE, first as `> 40` against a
  // catalogue of ~180 -- a number chosen to pass, which let three quarters of the
  // i18n be deleted with the harness green. Re-anchoring it on the catalogue made
  // it honest and, in the same move, redundant: the two directions below already
  // cover a broken scan. A scan finding nothing leaves every catalogue key
  // unclaimed, and the orphan check fires. Measured, both ways, before deleting.

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
  // The CODE, not the prose: forbidding a call and then explaining the ban in a
  // comment must not make this test red.
  const ui = codeOf(sectionsSource());
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
  const ui = sectionsSource();
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
  assert.equal(/stopPropagation/.test(sectionsSource()), false);
});

test("the host defers a render for whatever the user is holding, and still knows nothing about a shortcut", () => {
  // THE RULE MOVED WITH THE CODE. The latch left section-host.js for
  // ui/hold-watch.js, so the ignorance this test protects has to be checked on
  // BOTH -- otherwise extracting a mechanism is a way of escaping the rule that
  // governs it.
  //
  // `grip` stays forbidden because it is what a row's DRAG HANDLE is called, and
  // neither file may learn that rows have handles: that is why the extracted
  // object is a HoldWatch and not a UserGrip.
  // THE CODE, not the prose. This rule is about structural IGNORANCE -- neither
  // file may reach for a row's internals -- and a comment explaining why a name
  // was avoided creates no coupling. Reading the prose made the test forbid its
  // own explanation, which is the third time in this batch a scanner has taught
  // the code not to explain itself.
  const host = codeOf(read("src/ui/section-host.js"));
  const latch = codeOf(read("src/ui/hold-watch.js"));
  for (const word of ["shortcut", "grip", "data-id", "closest", "dataTransfer"]) {
    for (const [name, source] of [["section-host.js", host], ["hold-watch.js", latch]]) {
      assert.equal(new RegExp(word, "i").test(source), false, `${name} must not mention ${word}`);
    }
  }
  assert.match(latch, /dragstart/, "the latch does learn that a gesture exists");
  // onBlur is GONE: it replayed the render without consulting the latch, which is
  // what destroyed the row under the pointer between pointerdown and dragstart.
  const handlers = latch.match(/"focusout"/g) || [];
  assert.equal(handlers.length, 1, "exactly one focusout handler");
});

test("the host removes every listener it adds", () => {
  // The latch counts too: it now owns six of them, and a host torn down while its
  // listeners survive repaints a detached tree.
  const host = read("src/ui/section-host.js") + read("src/ui/hold-watch.js");
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
  const ui = sectionsSource();
  // The list now names Section* constants across files, and a trailing comma
  // makes `split(",")` count one phantom entry -- so the count comes from the
  // names, not from the separators.
  const listed = /OptionsSections = \[([^\]]*)\]/.exec(ui)[1]
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean).length;
  const declared = (ui.match(/^\s{4}reconcile\(/gm) || []).length;
  assert.equal(declared, listed, "as many reconcile() as there are sections");
  assert.equal(/section\.reconcile\s*=/.test(read("src/ui/section-host.js")), false);

  // THE SAME ARGUMENT FOR blank(), which the host loops over on a condemned page.
  // Written `section.blank?.()` it would be an optional member, i.e. a presence
  // test -- and this very pin is what settles the question for reconcile.
  assert.equal((ui.match(/^\s{4}blank\(/gm) || []).length, listed,
    "as many blank() as there are sections");
  assert.equal(/section\.blank\?\./.test(read("src/ui/section-host.js")), false,
    "the host calls blank() unconditionally: the member is TOTAL, not optional");
});

test("reconcile never redraws, and only ever speaks constants", () => {
  // It runs while the view is frozen, so it is the one path the tests cannot see
  // through a render -- the best place for a future string from storage.
  const ui = sectionsSource();
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
  const ui = sectionsSource();
  assert.match(ui, /OptionsSections = \[\s*SectionStatus,/, "Status is the first section");
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
  const ui = sectionsSource();

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

test("the bidi isolation covers every surface that prints a host, and is written once", () => {
  // A security control, not a typographic nicety: an RTL override inside a host
  // name makes the displayed destination read BACKWARDS, so what the user checks
  // is not where the traffic goes. It was copied into four rules with no shared
  // class -- the fifth place to display a host would have forgotten it.
  const css = read("src/ui/sections.css");
  const blocks = css.match(/unicode-bidi:\s*isolate/g) || [];
  assert.equal(blocks.length, 1, "written once, or it drifts");

  const rule = /((?:^|\n)(?:\.[\w-]+,\n)*\.[\w-]+\s*\{[^}]*unicode-bidi:\s*isolate[^}]*\})/.exec(css);
  assert.ok(rule, "the shared rule exists");
  for (const selector of [".dest", ".origin", ".preview", ".signature-domain"]) {
    assert.ok(rule[1].includes(selector), `${selector} prints a host and must be isolated`);
  }
  assert.ok(rule[1].includes("direction: ltr"), "isolation without a direction is half the control");
});

test("no state is signalled by colour alone at a ratio nobody can see", () => {
  // `.btn[aria-disabled] { color: var(--line) }` was 1.15:1 on white -- invisible
  // rather than muted, so an arrow at the end of the list simply vanished. And
  // WCAG 1.4.1 asks for a second signal regardless of the ratio.
  const css = read("src/ui/sections.css");
  const disabled = /\.btn\[aria-disabled="true"\]\s*\{([^}]*)\}/.exec(css);
  assert.ok(disabled, "the disabled style exists");
  assert.equal(/color:\s*var\(--line\)/.test(disabled[1]), false, "--line on white is not a text colour");
  assert.ok(/opacity/.test(disabled[1]), "a second signal beside the colour");
});

test("the test harness loads what ships, in the order that ships", () => {
  // THE FIFTH LIST, and the one no test read. `test/load-core.js` decides the
  // order every test sees, and it was free to drift from the four lists that
  // actually ship -- so a changelock resting on load order could be green here and
  // broken in the browser, or the reverse. Measured drift when this was written:
  // stored-policy.js sat before platform.js in the harness and after it in both
  // pages.
  const harness = read("test/load-core.js");
  const ordered = [...harness.matchAll(/^\s*"([^"]+\.js)",/gm)].map((m) => m[1]);
  assert.ok(ordered.length > 20, "the harness really lists the modules");

  const shipped = manifest.background.scripts
    .filter((s) => !s.endsWith("background.js"))
    .filter((s) => ordered.includes(s));

  const positions = shipped.map((file) => ordered.indexOf(file));
  for (let i = 1; i < positions.length; i += 1) {
    assert.ok(
      positions[i] > positions[i - 1],
      `${shipped[i]} loads before ${shipped[i - 1]} in the harness but after it in the manifest`
    );
  }

  // And nothing the manifest ships is missing from the harness, or a module would
  // be exercised by no test at all.
  const missing = manifest.background.scripts
    .filter((s) => !s.endsWith("background.js"))
    .filter((s) => !ordered.includes(s));
  assert.deepEqual(missing, [], "every shipped module must be loadable by the tests");
});

test("the three files that carry the version agree", () => {
  // A branch that adds a feature and leaves 1.0.0 in place is a build no store
  // will accept as an update -- and the lockfile is read by `npm ci` in the
  // release job, so a version that lives in two of the three publishes packages
  // that disagree with the tag that built them.
  const lock = JSON.parse(read("package-lock.json"));
  assert.equal(manifest.version, pkg.version, "manifest and package.json");
  assert.equal(lock.version, pkg.version, "lockfile root");
  assert.equal(lock.packages[""].version, pkg.version, "lockfile self-entry");
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
});

test("every document that counts the reserved prefixes counts the same list", () => {
  // Three files stated the number three different ways -- README said "about forty
  // more" over eight examples (48), PRIVACY said "about forty-five" over four (49),
  // SECURITY said "all 49" -- for one list that ships. A number a reader can check
  // has to be right, or it teaches them not to check the others.
  const source = read("src/core/reserved-prefix.js");
  const block = /ALL\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\)/.exec(source);
  assert.ok(block, "the list is still a frozen array");
  const body = block[1]
    .split("\n")
    .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
    .join("\n");
  const words = [...body.matchAll(/"([A-Z0-9_]+)"/g)].map((m) => m[1]);

  assert.equal(new Set(words).size, words.length, "no word is listed twice");
  assert.ok(read("SECURITY.md").includes(`all ${words.length} alternatives`),
    `SECURITY.md must say ${words.length}`);
  assert.ok(read("README.md").includes(`${words.length} in all`),
    `README.md must say ${words.length}`);

  // AND EVERY WORD MUST BE REACHABLE. A prefix longer than what the catch-all
  // claims is filtered out of the guards and protects nothing -- silently.
  const reach = g.CatchAllKey.only().claimsKeysUpTo();
  const unreachable = words.filter((w) => w.length > reach);
  assert.deepEqual(unreachable, [], `these are listed but never guarded: ${unreachable.join(", ")}`);
});

test("the core never calls the airlock", () => {
  // The batch that moved EngineId into core/ -- precisely so the storage door
  // would stop calling interception/ -- created the project's ONLY live
  // core -> airlock dependency at the same time: CatchAllKey.fragmentFor asked
  // Re2Budget whether a length was affordable. A rule stated in one file and
  // broken in the one next door is not a rule.
  const airlock = readdirSync(join(ROOT, "src/interception"))
    .filter((f) => f.endsWith(".js"))
    .map((f) => f.replace(/\.js$/, ""));

  const globals = {
    "re2-budget": "Re2Budget",
    "reference-pattern": "ReferencePattern",
    "rule-factory": "RuleFactory",
    "rule-ranking": "RuleRanking",
    "rule-set": "RuleSet",
    "installed-rule": "InstalledRule",
    "jump-preview": "JumpPreview",
    "search-engine-catalog": "SearchEngineCatalog",
    "origin-requirements": "OriginRequirements",
    "not-installed": "NotInstalled",
  };

  for (const file of readdirSync(join(ROOT, "src/core")).filter((f) => f.endsWith(".js"))) {
    const source = codeOf(read(join("src/core", file)));
    for (const module of airlock) {
      const name = globals[module];
      if (!name) continue;
      assert.equal(
        source.includes(name),
        false,
        `src/core/${file} reaches for ${name}, which lives in the airlock`
      );
    }
  }
});

test("no doc block is orphaned from the subject it documents", () => {
  // A declaration inserted between a doc block and its subject leaves the block
  // documenting its new neighbour. It happened six times in one batch -- a 19-line
  // note about the badge ended up above a 6-line helper, and a block describing an
  // optional parameter sat on a method whose parameter is mandatory. The reader,
  // and every tool that shows a hover, believes the block.
  const walk = (dir, out = []) => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name), out);
      else if (entry.name.endsWith(".js")) out.push(join(dir, entry.name));
    }
    return out;
  };
  const offenders = [];
  for (const file of walk("src")) {
    const lines = read(file).split("\n");
    for (let i = 0; i < lines.length - 1; i += 1) {
      // A block comment closing on one line and another opening on the very next:
      // whatever the first one described, it no longer sits above it.
      if (/^\s*\*\/\s*$/.test(lines[i]) && /^\s*\/\*\*/.test(lines[i + 1])) {
        offenders.push(`${file}:${i + 1}`);
      }
    }
  }
  assert.deepEqual(offenders, [], "these doc blocks sit above another doc block, not above code");
});

test("no section file grows back into a file that does everything", () => {
  // options-sections.js reached 1667 lines holding eight sections, four sentence
  // catalogues, two policy comparators, the validation, the persistence and the
  // SVG rendering -- and it kept GROWING under the corrections meant to fix it.
  // Nothing could be loaded alone, nothing reused, and every merge on that screen
  // was a merge on all of it.
  //
  // The bound is deliberately generous: this is a ratchet against the file that
  // eats its neighbours, not a style rule about length.
  const LIMIT = 600;
  const offenders = [];
  for (const file of readdirSync(join(ROOT, "src/ui/sections")).filter((f) => f.endsWith(".js"))) {
    const lines = read(join("src/ui/sections", file)).split("\n").length;
    if (lines > LIMIT) offenders.push(`${file} (${lines})`);
  }
  const assembly = read("src/options-sections.js").split("\n").length;
  if (assembly > 120) offenders.push(`options-sections.js (${assembly}) is the ASSEMBLY, not a section`);
  assert.deepEqual(offenders, [], `over ${LIMIT} lines: split it before it eats its neighbours`);
});

test("the assembly decides the order and nothing else", () => {
  // Its one job is the order on screen. If it starts holding rendering, sentences
  // or validation again, the split has begun to undo itself.
  const assembly = codeOf(read("src/options-sections.js"));
  for (const forbidden of ["Dom.el", "Platform.t(", "document.", "addEventListener", "classList"]) {
    assert.equal(assembly.includes(forbidden), false,
      `options-sections.js is the assembly: ${forbidden} belongs in a section`);
  }
  assert.match(assembly, /global\.OptionsSections = \[/);
});

test("INSTALL.md says not to load the source tree directly", () => {
  // src/ carries ONE manifest for both browsers -- service_worker for Chrome AND
  // background.scripts for Firefox -- because a single file has to serve both. Each
  // engine ignores what it does not know, so the source tree loaded directly is a
  // build neither of them was given, and the failure is a warning nobody reads.
  const install = read("INSTALL.md");
  assert.match(install, /never `src\/`|not `src\/`/i, "the warning must be there");
  assert.match(install, /build:chrome/, "and it must point at the build that replaces it");

  // The two keys really do cohabit, which is what makes the warning necessary.
  assert.ok(manifest.background.service_worker, "Chrome's key");
  assert.ok(Array.isArray(manifest.background.scripts), "Firefox's key");
});

test("every section declares every collaborator it uses", () => {
  // THE BUG THIS EXISTS FOR, found by loading the extension in a browser and not
  // by 306 green tests: status.js called `toggle(...)` without destructuring it,
  // so the whole page died on `toggle is not defined` -- and five other files had
  // the same hole.
  //
  // The cause is worth naming: when options-sections.js was split, the dependency
  // list of each new file was GUESSED from reading the code rather than measured.
  // A guess that compiles is a guess that ships. This measures.
  //
  // It cannot catch everything -- a name used only inside a branch no test walks
  // still reaches a browser first -- but it catches the whole class of "the split
  // forgot one".
  const PARTS = ["t", "el", "icon", "gripIcon", "destination", "label", "toggle",
                 "TRASH", "CHEVRON_UP", "CHEVRON_DOWN"];
  const SENTENCES = ["FACT_SENTENCE", "WARNING_MESSAGE", "sentenceFor",
                     "SKIPPED_SENTENCE", "catchAllNote", "PREVIEW_MISS"];
  const GLOBALS = ["Dom", "Platform", "MutationResult", "ProjectKey", "JiraInstance",
                   "SearchEngineCatalog", "OriginRequirements", "JumpPreview",
                   "ShortcutWarning", "RowReorder", "DiagnosisPresentation",
                   "CatchAllKey", "FocusMemory", "RefusalPresentation"];

  const offenders = [];
  const files = [
    ...readdirSync(join(ROOT, "src/ui/sections")).filter((f) => f.endsWith(".js"))
      .map((f) => join("src/ui/sections", f)),
    // The rest of ui/ too: section-host.js had the same hole, on
    // RefusalPresentation, and it is the file every surface starts from.
    ...readdirSync(join(ROOT, "src/ui")).filter((f) => f.endsWith(".js"))
      .map((f) => join("src/ui", f)),
  ];
  for (const path of files) {
    const file = path.split("/").pop();
    // parts.js and sentences.js DEFINE these names rather than borrowing them.
    if (file === "parts.js" || file === "sentences.js") continue;
    const code = codeOf(read(path));
    const declared = new Set();
    for (const m of code.matchAll(/const \{([^}]*)\}\s*=/g)) {
      for (const name of m[1].split(",")) declared.add(name.trim());
    }
    for (const name of [...PARTS, ...SENTENCES, ...GLOBALS]) {
      // A call or a member access is a real use; a bare mention is not. The
      // lookbehind matters: without it `Platform.t(` reads as a free `t`, and the
      // test cries over every file that reaches a helper through its owner.
      const used = new RegExp(`(?<![.\\w])${name}\\s*[(.]`).test(code);
      // Defined LOCALLY -- `const t = …`, a method `label(…) {`, or an object
      // property `label:` -- is not borrowed. dom.js and the two presentations
      // each spell their own `t`, and reading those as missing imports would make
      // this test cry over the files that own the names.
      const defines =
        new RegExp(`global\\.${name}\\s*=`).test(code) ||
        new RegExp(`(const|let|function)\\s+${name}\\b`).test(code) ||
        new RegExp(`^\\s*${name}\\s*[(:]`, "m").test(code);
      if (used && !declared.has(name) && !defines && !code.includes(`global.${name}`)) {
        offenders.push(`${path} uses ${name} without declaring it`);
      }
    }
  }
  assert.deepEqual(offenders, [], "a section that borrows a name must say so at the top");
});

/**
 * THE DOOR IS GONE, AND STAYS GONE.
 *
 * `JumpPolicy.registry()` handed the catalogue to anyone holding the root, and
 * the pair meant to close the traversal (`orderedIds()` + `shortcutFor(id)`) did
 * not close it: four callers still reached through, one of them three hops deep.
 * The aggregate now answers the questions instead. This measures that no caller
 * -- core, infrastructure, UI or test -- reopens the shortcut.
 */
test("nothing reaches through the aggregate to its catalogue", () => {
  // Tests included: a witness that reaches through teaches the next reader that
  // the door is still there.
  const files = [...srcFiles().map((f) => join(ROOT, f)),
    ...readdirSync(join(ROOT, "test")).filter((f) => f.endsWith(".js")).map((f) => join(ROOT, "test", f))];
  for (const file of files) {
    const body = codeOf(readFileSync(file, "utf8"));
    assert.equal(/\.registry\(\)/.test(body), false,
      `${file} reaches through the root; ask JumpPolicy the question instead`);
  }
});

/**
 * NOBODY TAKES A SHORTCUT APART TO GET A STRING OUT THE OTHER SIDE.
 *
 * `s.key().toString()` stood in fourteen places, `s.instance().baseUrl()` in
 * eleven, `s.key().isCatchAll()` in eight -- thirty-three files that had to know
 * a ProjectShortcut is made of a key and a destination, and that a key is the
 * thing that knows its own nature. Renaming any of those value objects' methods
 * meant editing a dozen unrelated files.
 *
 * The entity now answers keyText(), destination(), isCatchAll() and
 * permissionOrigin(). The accessors stay for callers that need the value object
 * WHOLE -- rule-factory builds a regex fragment from the key, shortcut-warning
 * reads a host's shape from the destination -- so what this measures is the HOP,
 * not the accessor.
 */
test("no caller reaches through a shortcut for a string", () => {
  const banned = [
    [/\.key\(\)\.toString\(\)/, "keyText()"],
    [/\.instance\(\)\.baseUrl\(\)/, "destination()"],
    [/\.key\(\)\.isCatchAll\(\)/, "isCatchAll()"],
    [/\.instance\(\)\.permissionOrigin\(\)/, "permissionOrigin()"],
    [/\.shortcut\(\)\.key\(\)/, "Binding.isCatchAll()"],
  ];
  const files = [...srcFiles().map((f) => join(ROOT, f)),
    ...readdirSync(join(ROOT, "test")).filter((f) => f.endsWith(".js")).map((f) => join(ROOT, "test", f))];
  for (const file of files) {
    // codeOf: shortcut-registry.js legitimately calls key.isCatchAll() on a bare
    // ProjectKey, and jump-policy's header QUOTES the hops it removed.
    const body = codeOf(readFileSync(file, "utf8"));
    for (const [hop, instead] of banned) {
      assert.equal(hop.test(body), false, `${file} reaches through a shortcut; ask ${instead}`);
    }
  }
});

/**
 * A GLOBAL NAME IS AN ADDRESS, NEVER A BAG OF STATE.
 *
 * Thirty-two files hang an object off `globalThis`, and that mechanism is
 * imposed: the same sources run under importScripts, a Firefox event page and
 * <script src>, none of which agree on modules (ARCHITECTURE.md carries the
 * argument). What is NOT imposed is what those files keep between calls.
 *
 * rule-installer.js used to hold `pending`, `queued` and `deferred` as module
 * variables. Two installers were impossible, and a test that jammed the queue
 * poisoned every test after it -- the failure that made this rule worth pinning
 * rather than merely writing down.
 *
 * Four survive, each for a reason stated where it lives. The list is the point:
 * a fifth has to be argued here, in front of someone, instead of appearing.
 */
test("module-level mutable state stays a closed, argued list", () => {
  const allowed = new Map([
    ["src/background.js", "syncGeneration"],
    ["src/rule-installer.js", "theSlot"],
    ["src/install-outcome.js", "lastRev"],
    ["src/ui/refusal-presentation.js", "cached"],
  ]);
  for (const file of srcFiles()) {
    const body = codeOf(read(file));
    for (const [, keyword, name] of body.matchAll(/^  (let|var) ([A-Za-z_$][\w$]*)/gm)) {
      assert.equal(keyword, "let", `${file} declares ${name} with var`);
      assert.equal(allowed.get(file), name,
        `${file} keeps ${name} between calls; make it an attribute of an instantiable object, or argue it into this list`);
    }
  }
  // The list does not outlive what it describes.
  for (const [file, name] of allowed) {
    assert.match(codeOf(read(file)), new RegExp(`^  let ${name}\\b`, "m"),
      `${file} no longer holds ${name}; drop it from the allowed list`);
  }
});

/**
 * THE PUBLISHED PACKAGE CONTAINS ONLY WHAT THE EXTENSION IS MADE OF.
 *
 * Both build scripts copied src/ wholesale. Anything that had ever landed there
 * shipped to both stores -- an editor's .bak, a notes.md, a .env dropped for five
 * minutes. Nothing had to go wrong; it only had to be forgotten.
 *
 * The copy now runs through an allow-list that THROWS on an unknown type, so a
 * stray file breaks the build instead of being published. This is the same list
 * read from the other side: it fails at commit time rather than at release time,
 * and it fails on the file that is actually there rather than on a build nobody
 * ran yet.
 */
test("src holds nothing that must not ship", async () => {
  const { SHIPPABLE } = await import("../scripts/package-filter.mjs");
  // NOT srcFiles(): that one keeps only .js, which is every extension except the
  // ones this test exists to catch. Written with it, the test passed on a
  // src/scratch.txt sitting right there -- measured, which is why it is spelled
  // out here instead.
  const everything = (dir, out = []) => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      if (entry.isDirectory()) everything(join(dir, entry.name), out);
      else out.push(join(dir, entry.name));
    }
    return out;
  };
  for (const file of everything("src")) {
    const name = file.split("/").pop();
    assert.equal(name.startsWith("."), false, `${file} is a dotfile inside src/`);
    const ext = name.slice(name.lastIndexOf("."));
    assert.ok(SHIPPABLE.has(ext),
      `${file} would be published to both stores. Move it out of src/, or add ${ext} to scripts/package-filter.mjs on purpose.`);
  }
});
