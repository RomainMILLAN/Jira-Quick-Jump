# Quick Jump for Jira

Type an issue key in the address bar. Land on the issue.

```
ABC-1234   →   https://example.atlassian.net/browse/ABC-1234
```

No keyword, no tab key, no results page. Chrome and Firefox, Manifest V3.

## How it works, and why that matters

Chrome's site search and the `omnibox` API both need a keyword before the address
bar will hand anything to an extension. This extension uses the one seam they
leave: when what you typed is not a URL, the browser builds a navigation towards
your default search engine. `declarativeNetRequest` rewrites that navigation
**before the request leaves your machine**.

Two consequences follow, and they are the reason to use this rather than a
bookmark keyword:

- **No results page ever paints.** There is no round trip to the search engine and
  no flash of Google before Jira.
- **The issue key never reaches the search engine.** Typed dozens of times a day,
  an internal project key is a rich signal: which projects you work on, at what
  pace, and — if you click a result — the host name of your internal Jira. That
  request simply does not happen.

See [Limitations](#limitations) for the one place that claim needs qualifying.

## Install

No store listing yet. Grab a package from
[Releases](https://github.com/RomainMILLAN/Jira-Quick-Jump/releases) or build it
yourself — [INSTALL.md](INSTALL.md) has the step-by-step, including how to pin a
signed build for a team.

## Set it up

1. **Pick your search engine.** Whatever your address bar actually uses: Google,
   Bing or DuckDuckGo.
2. **Add a shortcut.** A key (`ABC`) and where it points
   (`example.atlassian.net`). Self-hosted works: a port and a path are both
   accepted, so `intra.example.org/jira` is fine, and so is `http://jira:8080`.
3. **Grant access.** One browser prompt, naming the host. Nothing redirects
   before you do this — see [Trust model](#trust-model).
4. **Arm it**, then try the jump once and look at where you land.

## Trust model

This is the uncomfortable part, said plainly.

**The product teaches you not to look at the address bar.** That is the whole
point: you type a key and stop thinking about the URL. Which means that if
something ever pointed a key at the wrong server, the habit the extension built
is exactly the habit that would stop you noticing.

So the extension shows you the destination everywhere else:

- Every shortcut displays its **whole destination**, host and path, on both
  surfaces. Never a truncated origin — truncating would hide `/jira` becoming
  `/jira-fake`.
- **Any change of destination raises a banner** before your next jump, naming the
  old and new host and where the change came from. Not after you have typed your
  password into a copy of your Jira.
- The destination **path is not configurable**. A shortcut always resolves to
  `<base>/browse/<KEY-N>`, never to a path an attacker could choose.

### What it guarantees

- **It makes no network requests of any kind.** The extension pages declare
  `connect-src 'none'`, which makes `fetch`, XHR, WebSocket and `sendBeacon`
  impossible from them — that is a checkable fact, not a promise.
- **A redirect cannot fire without host access you granted**, by name, in a
  browser prompt the extension cannot forge. This is the control that neutralises
  a hostile configuration file, a compromised sync account and even a malicious
  update: rules install, and simply never fire.
- **Nothing is intercepted until you arm it.** Imported shortcuts always arrive
  disarmed, and warnings you accepted before are never carried over — a file
  cannot pre-approve its own warnings.

### What it does not guarantee

That the destination you configured is really your Jira. That part is yours.

**This extension never needs access to all sites.** If a prompt ever asks for it,
refuse it and open an issue.

## Limitations

- **Search suggestions still reach your search engine.** Browsers send address-bar
  keystrokes to the default engine's *suggestion* endpoint as you type, over a
  channel an extension cannot intercept. If suggestions are on — the default in
  both browsers — the key reaches Google anyway, character by character, before
  you press Enter. Turning suggestions off is the only real remedy:
  `chrome://settings/syncSetup` → *Search suggestions*, or Firefox's
  *Settings → Search → Provide search suggestions*.
- **Coupled to your default search engine.** Rules are built for the engines you
  select. Switching to an engine that is not in the catalogue stops the jumps.
- **False positives are possible but bounded.** A rule matches only when the whole
  search is exactly an issue reference, so `CVE-2024-1234` and `ABC-1234 status`
  go through untouched. Mapping a key that people genuinely search for — `ISO`,
  `RFC` — would intercept those searches, and the UI warns you when you try.
- **Between machines, last write wins.** With sync enabled, two devices editing at
  once will lose one of the two changes. Storage is local by default.

## Development

```bash
npm ci --ignore-scripts
npm test          # domain, security corpora, structure
npm run lint      # addons-linter, on the Firefox build
make icons        # regenerate the icons; fails if they drift from what is committed
npm run start:firefox
```

`src/` loads unpacked as-is. The layout is deliberate:

| Directory | Holds |
|---|---|
| `src/core/` | The domain. No DNR, no browser API, no DOM. |
| `src/interception/` | The airlock: search-engine formats and DNR rules. |
| `src/ui/` | The lifecycle shared by both surfaces, and the styles. |

`make sync-signature` re-vendors the author signature from `vendor/rm-tag`.

## Release

```bash
make bump VERSION=1.0.0
make tag && git push origin v1.0.0
```

The tag triggers a build that attests provenance and publishes SHA-256 sums.
Publication waits behind a protected environment with a human reviewer. Secrets:

| Secret | Used for |
|---|---|
| `WEB_EXT_API_KEY` / `WEB_EXT_API_SECRET` | Signing the Firefox `.xpi` via AMO |
| `CWS_*` | Uploading a Chrome Web Store draft (never auto-published) |

## Licence

MIT. The author signature under `src/ui/author-signature.css` is vendored from
[Romain-MILLAN-Tag](https://github.com/RomainMILLAN/Romain-MILLAN-Tag), also MIT.
