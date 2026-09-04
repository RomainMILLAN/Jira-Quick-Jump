import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { loadCore } from "./load-core.js";

const g = await loadCore();

const ROOT = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(join(ROOT, p), "utf8");

/** Every .js under a directory, so a test can walk the real tree instead of
 *  restating a list that drifts. */
const walkJs = (dir, out = []) => {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (entry.isDirectory()) walkJs(join(dir, entry.name), out);
    else if (entry.name.endsWith(".js")) out.push(join(dir, entry.name));
  }
  return out;
};

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

test("the vendored signature is byte-for-byte the file that was reviewed", () => {
  // PROVENANCE IS NOT INTEGRITY, and the test above only checks provenance.
  //
  // This stylesheet SHIPS inside both packages and comes from a separate
  // repository. The only drift check was `make sync-signature` -- a LOCAL target
  // (`npm run sync:signature && git diff --exit-code`) that no CI job runs -- and
  // the test next door merely asserts that a provenance header is present. So a
  // hand edit of this file, or a `git submodule update --remote` onto a hostile
  // upstream HEAD followed by a resync, passed CI green.
  //
  // WHAT THE RISK IS, exactly, and it is not exfiltration: the CSP ships
  // `default-src 'none'` with `connect-src 'none'` and `img/font/style-src 'self'`,
  // which closes every network channel a stylesheet has. It is INTERFACE
  // REDIRECTION -- covering the Access section, hiding the origin list, disguising
  // the disarm control -- on the very page where the user checks where ABC-1 goes.
  // scripts/sync-signature.mjs states that risk and accepts it; what was missing is
  // a control that notices when the accepted file changes.
  //
  // The HEADER is excluded on purpose: sync-signature.mjs rewrites the pinned sha
  // in it on every resync, so hashing it would make this test fail for the one
  // legitimate reason. What is pinned is the CSS itself.
  //
  // TO UPDATE, and the middle step is the whole point:
  //   1. git submodule update --remote vendor/rm-tag
  //   2. git -C vendor/rm-tag log <old sha>..<new sha>   <-- READ THIS
  //   3. make sync-signature
  //   4. update the digest below, in the same commit as the file
  const css = read("src/ui/author-signature.css");
  const at = css.indexOf("*/");
  assert.ok(at > 0, "the provenance header is gone, so there is nothing to exclude");
  const body = css.slice(at + 2);
  const digest = createHash("sha256").update(body).digest("hex");
  assert.equal(
    digest,
    "448ef3ce9e52de6049970ef8546fb8bad9d9859801b01ecbaa37ab5d3e039b28",
    "author-signature.css changed: read the upstream log, then update this digest",
  );
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

test("the artefact that is published is the artefact that was attested", () => {
  // AN ATTESTATION THAT COVERS NOTHING PUBLISHED IS NOT A CONTROL, IT IS A CLAIM.
  //
  // release.yml used to build in `build`, attest THOSE zips, then rebuild in
  // `publish` and release the second set. The archives record file mtimes from the
  // compilation, so the two builds have different digests, and
  // `gh attestation verify <published zip>` fails -- on the command SECURITY.md
  // invites people to run. The fix is that `publish` downloads instead of
  // compiling, and this is what keeps it that way: an attestation cannot be
  // retrofitted, so a regression here is permanent for that release.
  const wf = read(".github/workflows/release.yml");
  const at = wf.indexOf("\n  publish:");
  assert.ok(at > 0, "release.yml no longer has a publish job");
  // THE COMMENTS ARE STRIPPED FIRST, and that is not tidiness: the paragraph
  // explaining WHY publish must not rebuild contains the very string this test
  // forbids. refusal-presentation.js hit the same trap from the other side -- a
  // scanner reading a comment as a call site -- and paid for it with a rewritten
  // sentence. What is asserted here is what the runner EXECUTES.
  const steps = wf
    .slice(at)
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");

  assert.equal(
    /npm run build:(chrome|firefox)/.test(steps),
    false,
    "publish compiles again instead of consuming the attested artefact",
  );
  assert.match(steps, /download-artifact/, "publish must download what build attested");
  // The one script that signs WITHOUT rebuilding. `sign:firefox` chains
  // build:firefox-src, which would hand AMO bytes nobody attested.
  assert.equal(
    /npm run sign:firefox\s*$/m.test(steps),
    false,
    "publish signs from a rebuild rather than from the attested package",
  );
  assert.match(steps, /npm run sign:firefox-packaged/, "the signature must consume the attested package");

  // And the sums SECURITY.md promises actually reach the Release. They were
  // written by `build` and uploaded as a run artifact only, so nothing published
  // carried them.
  assert.match(steps, /web-ext-artifacts\/SHA256SUMS/, "SHA256SUMS is not attached to the release");
  assert.match(wf, /attest-build-provenance/, "the build job no longer attests anything");
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

test("the permission asked for is exactly the hosts the rule can match", async () => {
  // BOTH DIRECTIONS, and only one of them used to be checked.
  //
  // SUFFICIENCY (rule ⊆ permission) keeps a rule from being installed for a host
  // nobody granted, where it can never fire. That was the original assertion, and
  // it stays.
  //
  // MINIMALITY (permission ⊆ rule) is the direction that matters for the user: the
  // origins here become the browser's own prompt. `https://*.google.com/*` asked
  // for accounts.google.com and mail.google.com, which no rule of this catalogue
  // can ever match — and a permission already granted is not revoked by a later,
  // narrower request.
  //
  // The two facts are DELIBERATELY spelled independently in the catalogue. Made to
  // descend from one list, this test would compare the union to the union and go
  // green forever; see the note on permissionOrigins.
  const { loadCore } = await import("./load-core.js");
  const g = await loadCore();

  const hostOf = (origin) => {
    const match = /^https:\/\/([^/]+)\/\*$/.exec(origin);
    assert.ok(match, `${origin} is not a plain https://<host>/* pattern`);
    // No wildcard host, ever: it is what made the permission wider than the rule.
    assert.equal(match[1].includes("*"), false, `${origin} still carries a wildcard host`);
    return match[1];
  };

  for (const engine of g.SearchEngineCatalog.all()) {
    const pattern = new RegExp("^" + engine.hostPattern + "$");
    const granted = engine.permissionOrigins.map(hostOf);

    // SUFFICIENCY: every host the rule can match is covered by a granted origin.
    for (const host of [engine.domain, `www.${engine.domain}`]) {
      assert.ok(pattern.test(host), `${engine.id}: hostPattern does not match ${host}`);
      assert.ok(granted.includes(host), `${engine.id}: no permission asked for ${host}`);
    }

    // MINIMALITY: nothing is granted that the rule could not match.
    for (const host of granted) {
      assert.ok(pattern.test(host), `${engine.id}: asks for ${host}, which no rule can match`);
    }
    assert.equal(granted.length, 2, `${engine.id}: expected exactly the two matchable hosts`);

    // And the subdomain the wildcard used to hand over stays out, on both axes.
    const subdomain = `accounts.${engine.domain}`;
    assert.equal(pattern.test(subdomain), false, `${engine.id}: hostPattern reaches ${subdomain}`);
    assert.equal(granted.includes(subdomain), false, `${engine.id}: still asks for ${subdomain}`);
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

/**
 * THE LIFECYCLE MEMBER IS TOTAL -- measured ON THE OBJECT, not on the source text.
 *
 * This used to count `^\s{4}blank\(` and `^\s{4}reconcile\(` with a regex and
 * compare the totals to the number of sections. It was a test of INDENTATION: a
 * reformat broke it, and what it really protected -- that the host never writes
 * `section.blank?.()`, i.e. a presence test -- was only its second assertion.
 *
 * Worse, it MANDATED the copy-paste it was meant to police: six sections carried an
 * empty `blank(){}` and seven an empty `reconcile(){}`, word for word, because the
 * count had to add up.
 *
 * ui/section.js supplies the neutral halves now, so a section declares only what it
 * actually does. What must stay true is what this measures: every wrapped section
 * answers both members, and the host calls them unconditionally.
 */
test("every wrapped section answers the whole lifecycle", async () => {
  const { Section } = await import("../src/ui/section.js").then(() => ({ Section: globalThis.Section }));
  assert.ok(Section, "ui/section.js must publish Section");

  // A section that declares NOTHING but render/mount is still whole once wrapped.
  const bare = new Section({ mount() {} });
  for (const member of ["mount", "blank", "reconcile", "render", "fail", "hold", "root", "isDirty"]) {
    assert.equal(typeof bare[member], "function", `Section must answer ${member}()`);
  }
  bare.blank();
  bare.reconcile(undefined, undefined);
  bare.fail(new Error("x"));
  await bare.render(undefined, undefined);

  // And the wrapper forwards to the section when it DOES declare them.
  const calls = [];
  const speaking = new Section({
    mount() {},
    blank() { calls.push("blank"); },
    reconcile() { calls.push("reconcile"); },
  });
  speaking.blank();
  speaking.reconcile(undefined, undefined);
  assert.deepEqual(calls, ["blank", "reconcile"]);

  // The host still calls them unconditionally -- no presence test came back.
  const host = read("src/ui/section-host.js");
  assert.equal(/section\.blank\?\./.test(host), false,
    "the host calls blank() unconditionally: the member is TOTAL, not optional");
  assert.equal(/section\.reconcile\?\./.test(host), false);
  // And it no longer grafts its own bookkeeping onto the section object.
  assert.equal(/section\.(root|dirty)\s*=/.test(codeOf(host)), false,
    "root and dirty belong to the wrapper, not to the section");
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

test("a refused string is shown with its bidi controls REMOVED, not merely isolated", async () => {
  // THIS TEST USED TO ATTEST THE WRONG CONTROL, and it went green for it.
  //
  // It asserted that `.ltr-isolate` (unicode-bidi: isolate) covered every surface
  // printing a host, calling that "a security control, not a typographic nicety".
  // Measured in Chromium, by reading glyph positions back with
  // Range.getBoundingClientRect, on the stored string
  // `"https://jira." + U+202E + "moc.live/"`:
  //
  //   no rule at all  ->  https://jira./evil.com
  //   isolate         ->  https://jira./evil.com     <- identical
  //   bidi-override   ->  https://jira./evil.com     <- identical
  //   U+202E removed  ->  https://jira.<U+FFFD>moc.live/
  //
  // `unicode-bidi` decides how a sequence relates to its NEIGHBOURS. The explicit
  // formatting characters INSIDE the sequence still apply, under every value of
  // the property. So the control is the removal, and this test attests the
  // removal. The CSS rule survives as typography and is checked as typography.
  // Every explicit bidi formatting character, and the two marks. A value that
  // survives here reorders the field it is displayed in.
  const dangerous = [
    "\\u200e", "\\u200f", "\\u061c",
    "\\u202a", "\\u202b", "\\u202c", "\\u202d", "\\u202e",
    "\\u2066", "\\u2067", "\\u2068", "\\u2069",
  ].map((escaped) => JSON.parse(`"${escaped}"`));
  for (const ch of dangerous) {
    const shown = g.Dom.visibleText("https://jira." + ch + "moc.live/");
    assert.equal(
      shown.includes(ch),
      false,
      `U+${ch.codePointAt(0).toString(16).padStart(4, "0")} survives Dom.visibleText`,
    );
    // REPLACED, never deleted: a silent deletion makes the field the user is
    // asked to repair differ from the bytes on file, which is the gap both
    // parsers spend their headers refusing.
    assert.ok(shown.includes("�"), "something must say a character was there");
  }
  // And it does not mangle what is legitimate.
  assert.equal(g.Dom.visibleText("https://jira.corp.example/jira"), "https://jira.corp.example/jira");
  assert.equal(g.Dom.visibleText(undefined), "", "a missing field shows as empty, never as \"undefined\"");

  // THE TWO QUARANTINE FIELDS GO THROUGH IT. They are THE ONLY surface in the
  // project that displays a string the parser REFUSED: everywhere else the value
  // on screen has passed JiraInstance.parse and its ASCII-printable
  // post-condition, so no override can be in it. Here the entry is in quarantine
  // precisely BECAUSE the override was refused.
  const quarantine = read("src/ui/sections/quarantine.js");
  const sanitised = quarantine.match(/value: Dom\.visibleText\(/g) || [];
  assert.equal(sanitised.length, 2, "both quarantine fields must be sanitised, not one");
  assert.equal(
    /value: String\(/.test(quarantine),
    false,
    "a raw String() into a quarantine field is the bug this test exists for",
  );

  // AND THE CONTROL HAS ONE OWNER -- ONE, not two.
  //
  // It used to allow two: the parser's refusal list and Dom's own copy. They
  // drifted, exactly as the comment feared, and the narrower copy was the one on
  // screen: Dom spelled the BIDI controls alone while the parsers refuse a wider
  // class, so a zero-width space, a soft hyphen, a NBSP or a U+FEFF reached the
  // repair field intact and hid part of a host name in a field the user is asked
  // to read.
  //
  // The domain is now the single author of the class AND of its application:
  // ProjectKey.withoutDeceptiveCharacters. There is nothing left to drift, and
  // nothing left for a caller to remember. A second file spelling a range is the
  // regression this pins.
  const owners = [];
  for (const file of walkJs("src")) {
    if (/\\u202e|\\u2066/i.test(read(file))) owners.push(file);
  }
  assert.deepEqual(
    owners,
    ["src/core/project-shortcut.js"],
    "the character set has exactly one author, and the UI asks it rather than copying it",
  );

  // AND THE UI GENUINELY ASKS. Without this, deleting the range from dom.js and
  // forgetting to replace it with anything would satisfy the assertion above.
  assert.match(
    read("src/ui/dom.js"),
    /ProjectKey\.withoutDeceptiveCharacters/,
    "Dom must ask the owner, not rebuild the class",
  );
  // AND IT ASKS FOR THE ANSWER, NOT FOR THE NOTATION. The first fix exported the
  // character class as a source string, which put three unwritten obligations on
  // this file -- wrap, compile, and remember the `g`. Forgetting the `g` replaces
  // only the FIRST character: a control that works halfway, in silence.
  assert.equal(
    /new RegExp\(/.test(codeOf(read("src/ui/dom.js"))),
    false,
    "ui/dom.js must compile no regex of its own: the domain owns rule and application",
  );

  // THE WIDER CLASS IS WHAT IS ACTUALLY STRIPPED. The bidi loop above is the
  // attack that was measured; these are the characters the previous copy dropped.
  for (const escaped of ["\\u200b", "\\u00ad", "\\u00a0", "\\ufeff", "\\u2060", "\\u180e"]) {
    const ch = JSON.parse(`"${escaped}"`);
    const shown = g.Dom.visibleText("https://jira.corp" + ch + ".example");
    assert.equal(shown.includes(ch), false, `${escaped} survives Dom.visibleText`);
    assert.ok(shown.includes("�"), `${escaped} vanishes without a trace`);
  }

  // And the ordinary space is deliberately NOT stripped: it is visible in a field,
  // so replacing it would mangle a legitimate value on the one screen whose job is
  // to show a value as it stands. The parsers still refuse it.
  assert.equal(g.Dom.visibleText("a b"), "a b", "a space is visible, so it is not replaced");
  assert.equal(g.ProjectKey.parse("A B").code, "KEY_CONTROL_CHARS", "and it is still refused");

  // The CSS rule, now checked as what it is: typography, so a host name is not
  // reordered by the LABELS around it in an RTL interface.
  const css = read("src/ui/sections.css");
  const blocks = css.match(/^\s*unicode-bidi:\s*isolate;/gm) || [];
  assert.equal(blocks.length, 1, "written once, or it drifts");
  const rule = /((?:^|\n)(?:\.[\w-]+,\n)*\.[\w-]+\s*\{[^}]*unicode-bidi:\s*isolate[^}]*\})/.exec(css);
  assert.ok(rule, "the shared rule exists");
  for (const selector of [".dest", ".origin", ".preview", ".signature-domain", ".ltr-isolate"]) {
    assert.ok(rule[1].includes(selector), `${selector} prints a host and must be isolated from its neighbours`);
  }
  assert.ok(rule[1].includes("direction: ltr"), "isolation without a direction is half the typography");

  // AND THE COMMENT NO LONGER PROMISES WHAT THE PROPERTY CANNOT DO. This is the
  // half of the fix a code change alone does not carry: the previous comment was
  // what made the wrong control trusted, here and in the section.
  assert.equal(
    /A security control, not a typographic nicety/.test(css),
    false,
    "the CSS rule must not call itself a security control again",
  );
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
  // PRIVACY.md was the one document left out of this pin, and it already carries
  // the same wording -- so the assertion was a copy of its neighbour away.
  assert.ok(read("PRIVACY.md").includes(`${words.length} in all`),
    `PRIVACY.md must say ${words.length}`);

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

/**
 * EVERY WARNING KIND HAS A SENTENCE, AND THE CORE HAS NONE.
 *
 * shortcut-warning.js used to carry an English `message` beside each `kind` -- a
 * dead copy of interface text no translator ever saw, kept in step with nothing.
 * The core states a KIND and a SEVERITY; the interface owns the wording, exactly
 * as RefusalPresentation already does for refusals.
 *
 * Removing the copy only works if the real table is total, so that is measured
 * here rather than trusted.
 */
test("warning wording lives in the interface, and covers every kind", () => {
  const core = read("src/core/shortcut-warning.js");
  assert.equal(/\n\s*message:\s*"/.test(codeOf(core)), false,
    "the core carries an English sentence again");

  const kinds = [...codeOf(core).matchAll(/kind:\s*"([A-Z_]+)"/g)].map((m) => m[1]);
  assert.ok(kinds.length >= 5, `only ${kinds.length} kinds found -- the scan broke`);

  const sentences = read("src/ui/sections/sentences.js");
  const table = sentences.slice(sentences.indexOf("const WARNING_MESSAGE"));
  for (const kind of kinds) {
    assert.ok(table.includes(`${kind}:`), `${kind} has no sentence in WARNING_MESSAGE`);
  }
});

/**
 * KEY-SCOPED CONSENT NEVER TRAVELS BY THE CHANNEL IT WATCHES.
 *
 * This is the whole reason that context is separate: an acknowledgement that
 * replicated through sync could be granted on your behalf by a compromised browser
 * account -- the named adversary of this project's threat model -- and the control
 * would be worthless. PRIVACY.md promises it in prose, local-acknowledgements.js says
 * "ALWAYS local" in a comment, and NOTHING went red if someone changed it.
 *
 * The frontier map calls this the one row with an empty control column. It is not
 * empty any more.
 */
test("the consent store is local-only, and cannot quietly become synced", () => {
  const body = codeOf(read("src/local-acknowledgements.js"));
  assert.equal(/storage\.sync/.test(body), false,
    "key-scoped consent reached storage.sync: a control that travels by the channel " +
    "it watches is worthless");
  assert.ok(/storage\.local/.test(body), "and it must still name the local area explicitly");

  // Nor through the area-selecting facade, which is what the POLICY uses.
  assert.equal(/Platform\.storageArea\b/.test(body), false,
    "the consent store must not follow the policy's area: that facade is sync-capable");
});

/**
 * THE PAGES READ THE RULES; THEY NEVER WRITE THEM.
 *
 * background.js calls itself "the SINGLE WRITER of the rules", and policy-repository
 * leans on that claim -- but rule-installer.js is loaded by BOTH HTML surfaces, so
 * `RuleInstaller.install()` and `.purge()` are reachable from any extension page.
 * Nothing structural stood behind the sentence.
 *
 * The file cannot simply be dropped from the pages: they need report(), which is
 * what paints the status line and the preview. So what is measured is the boundary
 * that actually matters -- the UI READS, the worker WRITES.
 */
test("no UI file installs or purges rules", () => {
  const writers = ["install", "purge"];
  for (const file of srcFiles().filter((f) => f.startsWith("src/ui/"))) {
    const body = codeOf(read(file));
    for (const verb of writers) {
      assert.equal(new RegExp(`RuleInstaller\\.${verb}\\s*\\(`).test(body), false,
        `${file} calls RuleInstaller.${verb}() -- the worker is the single writer`);
    }
  }

  // And the claim itself stays anchored to something measurable.
  const worker = codeOf(read("src/background.js"));
  assert.ok(/RuleInstaller\.(install|purge)\s*\(/.test(worker),
    "background.js must be the one that actually writes, or this pin guards nothing");
});

/**
 * `dropped` DOES NOT COME BACK AS A SYNONYM FOR `refused`.
 *
 * Five words used to name what we did not take, spread over forty files -- which is
 * how a cause travelled from the worker to the page under three names and was read
 * at neither end. mutation-result.js now states the map: two axes, `refused` for the
 * verdict, `quarantine` for the destination, `unreadable` for "nobody could decide".
 *
 * Two uses of `dropped` survive on purpose, and neither means "the domain said no":
 * a reordering abandoned because the list moved, and a rule dropped with its group.
 * They are listed here so the pin stays honest instead of banning a word outright.
 */
test("the vocabulary of what we did not take stays at four words", () => {
  const allowed = new Map([
    ["src/ui/sections/shortcuts.js", 1],   // orderDropped: a reordering abandoned
    ["src/ui/sections/sentences.js", 1],   // a rule dropped WITH its group
  ]);
  for (const file of srcFiles()) {
    const body = codeOf(read(file));
    const uses = (body.match(/\bdropped\b/gi) || []).length;
    assert.equal(uses, allowed.get(file) || 0,
      `${file} uses "dropped" ${uses} time(s): see the vocabulary map in ` +
      `core/mutation-result.js -- the verdict is "refused"`);
  }
  // The map itself must still be there to be read.
  assert.ok(read("src/core/mutation-result.js").includes("THE VOCABULARY OF WHAT WE DID NOT TAKE"),
    "the map is what makes this pin explicable rather than arbitrary");
});

/**
 * A COLLABORATOR DESTRUCTURED AT LOAD MUST BE LOADED FIRST.
 *
 * These files are classic scripts sharing globalThis, and most of them open with
 * `const { A, B } = global;` -- which reads the value AT LOAD TIME, not at call
 * time. Load the consumer first and the name is `undefined` for ever, with no error
 * until the one line that uses it runs.
 *
 * That is exactly how `RefusalPresentation` came to be undefined in section-host.js:
 * options.html loaded it three lines AFTER its consumer, so every refusal banner
 * threw "Cannot read properties of undefined (reading 'sentence')" -- on the one
 * path whose job is to explain that something went wrong.
 *
 * The existing pins compare the lists to EACH OTHER (manifest vs importScripts, the
 * two pages' shared prefix). None of them read what a file actually needs. This one
 * does, which is why it catches a class of bug no green suite could.
 */
test("every destructured collaborator is loaded before the file that destructures it", () => {
  const published = new Map();
  for (const file of srcFiles()) {
    const body = read(file);
    for (const [, name] of body.matchAll(/^\s*global\.([A-Z][A-Za-z0-9]*)\s*=/gm)) {
      published.set(name, file.replace(/^src\//, ""));
    }
  }

  for (const page of SURFACES) {
    const order = scriptsOf(read(page));
    const positionOf = new Map(order.map((script, at) => [script, at]));

    for (const [at, script] of order.entries()) {
      // Only the load-time form. `const { X } = global;` at module scope reads the
      // value once, when the file runs; `global.X` inside a function resolves late
      // and is this repository's documented way to break a cycle.
      const body = codeOf(read(`src/${script}`));
      for (const block of body.matchAll(/^  const \{([^}]*)\} = global;/gm)) {
        for (const raw of block[1].split(",")) {
          const name = raw.trim();
          if (!name || !published.has(name)) continue;
          const provider = published.get(name);
          if (provider === script) continue;
          const providerAt = positionOf.get(provider);
          if (providerAt === undefined) continue;
          assert.ok(providerAt < at,
            `${page}: ${script} destructures ${name} at load, but ${provider} is loaded ` +
            `after it (${providerAt} > ${at}) -- the name will be undefined for ever`);
        }
      }
    }
  }
});

/**
 * THE RELEASE PIPELINE DENIES WHAT IT DID NOT DECLARE, and the two jobs deny
 * DIFFERENT things.
 *
 * `egress-policy` is one word, and going back from `block` to `audit` is a
 * one-word edit that turns a deny into a log with nothing on screen to say so --
 * exactly the class of silent relaxation this file exists to catch. Worse, the
 * whole value of splitting the lists is that build cannot reach the STORES and
 * publish cannot reach SIGSTORE: merge the two into one convenient list and the
 * separation is gone while both jobs still say `block`.
 *
 * A grep, not a YAML parse: pyyaml-shaped dependencies are exactly what this
 * repository refuses to add, and the properties asserted here are lexical.
 */
test("the release workflow blocks egress, with a separate allowlist per job", () => {
  const release = read(".github/workflows/release.yml");

  const policies = release.match(/egress-policy:\s*\S+/g) || [];
  assert.equal(policies.length, 2, "one policy per job, and there are two jobs");
  for (const policy of policies) {
    assert.match(policy, /egress-policy:\s*block$/, `release.yml relaxed a policy: ${policy}`);
  }

  // The two lists, in file order: build first, publish second.
  const lists = [...release.matchAll(/allowed-endpoints:\s*>([\s\S]*?)\n\s*#/g)]
    .map((m) => m[1].split(/\s+/).filter(Boolean));
  assert.equal(lists.length, 2, "each job declares its own allowlist");
  const [build, publish] = lists;

  // Every entry is host:port. A bare host silently allows nothing.
  for (const entry of [...build, ...publish]) {
    assert.match(entry, /^\*?[a-z0-9.-]+:\d+$/, `${entry} is not a host:port entry`);
  }

  // THE SEPARATION, both ways. This is the assertion with teeth: it fails the day
  // somebody factors the two lists into one.
  const sigstore = (list) => list.filter((e) => e.includes("sigstore.dev"));
  const stores = (list) =>
    list.filter((e) => e.includes("mozilla") || e.includes("googleapis.com"));

  assert.ok(sigstore(build).length >= 3, "build must reach Sigstore: it attests");
  assert.equal(stores(build).length, 0, "build must NOT be able to reach the stores");
  assert.ok(stores(publish).length >= 3, "publish must reach the stores: it publishes");
  assert.equal(sigstore(publish).length, 0, "publish must NOT be able to reach Sigstore");

  // The one endpoint that carries a release asset outward.
  assert.ok(publish.includes("uploads.github.com:443"), "publish attaches the release assets");
  assert.equal(build.includes("uploads.github.com:443"), false,
    "build produces artifacts, it does not attach them to a release");
});

/**
 * AND PULL REQUESTS STAY IN AUDIT, which is a decision rather than an omission.
 *
 * A guessed allowlist on ci.yml breaks every pull request while protecting nothing
 * that ships -- ci.yml publishes no artifact anyone installs. Asserted so the
 * asymmetry between the two files reads as intentional to whoever finds it.
 */
test("CI stays in audit mode on purpose, and says so", () => {
  const ci = read(".github/workflows/ci.yml");
  const policies = ci.match(/egress-policy:\s*\S+/g) || [];
  assert.ok(policies.length > 0, "ci.yml still runs harden-runner");
  for (const policy of policies) {
    assert.match(policy, /egress-policy:\s*audit$/, `ci.yml changed policy: ${policy}`);
  }
  assert.match(ci, /audit, not block/i, "ci.yml no longer explains why it is not block");
});

/**
 * THE CORE'S COUNT OF BUILT-IN ENGINES AND THE CATALOGUE AGREE.
 *
 * admission.js derives MAX_ENGINES from `BUILT_IN_ENGINES + MAX_CUSTOM_ENGINES`,
 * and it has to spell the first number itself: the core must not ask the airlock
 * how many engines ship -- that is the dependency this project has removed twice.
 * So the agreement is mechanical rather than trusted, and it goes red the day a
 * fifth engine ships without the constant moving.
 *
 * The consequence of a drift is not cosmetic. A ticked id that resolves to no
 * engine still costs a binding (activeBindings cannot consult the catalogue), so a
 * cap above what can exist is what let a synced document push past MAX_BINDINGS
 * and quarantine every shortcut after the fourth, on every device.
 */
test("the engine cap and the shipped catalogue cannot drift apart", async () => {
  const { loadCore } = await import("./load-core.js");
  const core = await loadCore();

  assert.equal(
    core.ShortcutAdmission.BUILT_IN_ENGINES,
    core.SearchEngineCatalog.all().length,
    "core/admission.js counts a different number of built-in engines than the catalogue ships",
  );
  assert.equal(
    core.ShortcutAdmission.MAX_ENGINES,
    core.ShortcutAdmission.BUILT_IN_ENGINES + core.ShortcutAdmission.MAX_CUSTOM_ENGINES,
    "the cap must stay derived, never chosen",
  );
  // And it is genuinely derived in the SOURCE, not merely equal by coincidence:
  // a literal that happens to add up today is the shape this replaces.
  const source = read("src/core/admission.js");
  assert.match(
    source,
    /MAX_ENGINES\s*=\s*BUILT_IN_ENGINES\s*\+\s*MAX_CUSTOM_ENGINES/,
    "MAX_ENGINES must be written as its own justification",
  );
});

/**
 * A LOOKUP TABLE INDEXED BY A STORED VALUE CANNOT REACH Object.prototype.
 *
 * `shape` comes from the configuration and is validated only as
 * `/^[a-z-]{1,32}$/`. `constructor` matches that and lives on Object.prototype, so
 * `SHAPES["constructor"]` answered the Object function -- TRUTHY -- and the filter
 * whose whole job is "an unknown shape is filtered here" let it through. The entry
 * then carried `pathPattern: undefined` and searchUrlPattern threw a TypeError out
 * of buildRules, so rule-installer purged everything: NOTHING installed, from one
 * field of a synced document.
 *
 * This pins the SHAPE of the fix rather than only its effect, because the
 * behavioural test next door would stay green if the Map became a hardened object
 * literal and then, one refactor later, a plain one.
 */
test("the shape catalogue is a Map, and nothing indexes it with a bracket", () => {
  const source = read("src/interception/search-engine-catalog.js");
  assert.match(source, /const SHAPES = new Map\(/, "SHAPES must be a Map, not an object literal");
  // THE CODE, NOT THE PROSE. The docstring quotes `SHAPES[shape]` to explain what
  // was wrong, and a test that cannot tell the explanation from the defect makes
  // the explanation undeletable-or-forbidden. Comment lines are dropped first.
  assert.equal(
    /SHAPES\s*\[/.test(codeOf(source)),
    false,
    "a bracket lookup on SHAPES is the prototype walk this fix removed",
  );

  // The other tables reached by a value rather than a literal. None of them is
  // exploitable today -- their keys are closed sets -- which is exactly when the
  // guard is free, and a file where one table is hardened and its neighbour is not
  // teaches the next reader that the rule is optional.
  for (const [file, table] of [
    ["src/core/engine-id.js", "LEGACY"],
    ["src/interception/rule-ranking.js", "BANDS"],
    ["src/interception/reference-pattern.js", "IN_URL"],
    ["src/core/shortcut-warning.js", "SCOPES"],
    ["src/ui/sections/sentences.js", "KIND_NOUN"],
    ["src/ui/sections/sentences.js", "WARNING_MESSAGE"],
    ["src/ui/sections/sentences.js", "PREVIEW_MISS"],
    ["src/ui/sections/sentences.js", "SKIPPED_SENTENCE"],
    ["src/background.js", "BADGE_COLOUR"],
    ["src/ui/diagnosis-presentation.js", "ENTRIES"],
  ]) {
    const body = read(file);
    const declaration = new RegExp(`${table}\\s*=\\s*(?:\\(\\)\\s*=>\\s*)?(?:Object\\.freeze\\()?Object\\.assign\\(Object\\.create\\(null\\)`);
    assert.match(body, declaration, `${file}: ${table} must have no prototype to walk into`);
  }
});
