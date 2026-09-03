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

Released on GitHub, not through a store. Grab a package from
[Releases](https://github.com/RomainMILLAN/Jira-Quick-Jump/releases) or build it
yourself — [INSTALL.md](INSTALL.md) has the step-by-step, including how to pin a
signed build for a team.

## Set it up

1. **Pick your search engine.** Whatever your address bar actually uses.
   `Google.com`, `Google.fr`, Bing and DuckDuckGo are listed; anything else —
   `google.it`, Ecosia, a self-hosted SearxNG — you add with **Add a domain**.
   One entry per domain is deliberate: the permission prompt then contains only
   what you ticked, instead of every Google top-level domain in existence.
2. **Add a shortcut.** A key (`ABC`) and where it points
   (`example.atlassian.net`). Self-hosted works: a port and a path are both
   accepted, so `intra.example.org/jira` is fine, and so is `http://jira:8080`.
   The list is **evaluated from top to bottom and the first match wins**, and the
   arrows on each row reorder it.
3. **Or add a catch-all.** One entry, keyed `*`, that claims every issue key you
   have not declared. Put your exceptions above it:

   ```
   ECR  →  bnee-web.atlassian.net
   JUL  →  spiriit.atlassian.net
   *    →  spiriit.atlassian.net     ← BAN-123, GAIN-123, T1-123 all land here
   ```

   Anything placed *below* it is **shadowed** — the catch-all claims it first, so
   it never fires, and the row says so. A catch-all accepts the hyphen only, and
   leaves a closed list of reserved prefixes (`ISO`, `CVE`, `COVID`…) alone. It
   also asks for one extra acknowledgement before it will arm, because its blast
   radius is every search you type.
4. **Grant access.** One browser prompt, naming the host. Nothing redirects
   before you do this — see [Trust model](#trust-model).
5. **Arm it**, then try the jump once and look at where you land. **Try a URL**
   also accepts the bare text you would type, so you can check what a catch-all
   does and does not claim.

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
  password into a copy of your Jira. **Reordering counts as a change**: moving a
  catch-all above a named key changes where that key's traffic goes without
  touching a single URL, so it raises the banner too, and the banner names the
  host the traffic now leaves for. The comparison is against the last policy that
  was actually *installed*, kept locally, so a change made while the extension
  was asleep is caught on the next wake-up rather than swallowed.
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
  cannot pre-approve its own warnings. A **catch-all** goes further: accepting its
  warning is recorded locally and never travels, so a stored or synced
  configuration cannot arrive pre-approved. On a second device you accept it
  again, deliberately.

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
- **False positives are bounded differently once a catch-all is armed.** Without
  one, the bound is that *you chose the key*: a rule matches only when the whole
  search is exactly an issue reference, so `CVE-2024-1234` and `ABC-1234 status`
  go through untouched, and the UI warns you if you map something people
  genuinely search for.

  With a catch-all the bound is no longer your choice, it is two mechanical
  limits: it accepts **the hyphen only** (so `SALARY 2024`, `WINDOWS 11` and
  every other "two tokens ending in a number" go through), and it leaves a
  **closed list of reserved prefixes** alone (`ISO`, `CVE`, `RFC`, `COVID`, `WD`,
  `MP`, `PS`, `GTA` and forty-one more, 49 in all). That list is a **mitigation, never a
  guarantee of completeness**: `MP3-320`, `X1-9` and `T2-500` are key-shaped and
  will be caught. If that is not a trade you want, declare your keys instead —
  they keep working exactly as before.
- **A catch-all forwards the case you typed.** `ban-123` becomes
  `/browse/ban-123`, because `declarativeNetRequest` cannot upper-case a captured
  group. Jira canonicalises it (verified on Atlassian Cloud and Data Center), so
  you land on `BAN-123` — but the canonicalisation is the destination server's,
  not ours. A Jira behind a case-sensitive path-rewriting proxy may differ. A
  declared key is unaffected: its rule writes the key in upper case.
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

The tag triggers a build that attests provenance and publishes SHA-256 sums,
then attaches both packages to a GitHub release. **That release is the
distribution channel** — there is no store listing, by choice.

Two optional paths stay wired but dormant, each behind its own switch, so
neither can fire by accident:

| Set this | And the release also |
|---|---|
| `WEB_EXT_API_KEY` / `WEB_EXT_API_SECRET` | signs the Firefox `.xpi` via AMO, so it installs permanently |
| variable `PUBLISH_CHROME_WEB_STORE=true` plus the `CWS_*` secrets | uploads a Chrome Web Store **draft**, never auto-published |

Publication runs in the `release` environment. Protect it with a required
reviewer and the tag pattern `v*`, and a stolen token can push a tag without
being able to publish anything.

## Reading the source

Two things surprise people who open the code: every file is an IIFE hanging off
`globalThis` with no imports, and `JumpPolicy` answers six questions where one
accessor would do. Both are deliberate, and
[ARCHITECTURE.md](ARCHITECTURE.md) says why before you change one of them.

## Licence

MIT. The author signature under `src/ui/author-signature.css` is vendored from
[Romain-MILLAN-Tag](https://github.com/RomainMILLAN/Romain-MILLAN-Tag), also MIT.
