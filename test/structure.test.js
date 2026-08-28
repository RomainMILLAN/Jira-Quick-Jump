import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const manifest = JSON.parse(read("src/manifest.json"));
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
