# Security policy

## Reporting a vulnerability

Report privately through
[GitHub's advisory form](https://github.com/RomainMILLAN/jira-quick-jump/security/advisories/new).
Please do not open a public issue for anything exploitable.

Expect an acknowledgement within **five working days** and an assessment within
**fifteen**. This is a side project maintained by one person: that is the honest
figure, not a service commitment.

## What is in scope, and what a report should say

Anything that would let a configuration send a user somewhere they did not
choose, or that would weaken one of the controls below. In particular: a project
key or base URL that survives validation and reaches a rule unescaped; a way to
install a rule without the corresponding host permission; a way to make an
imported configuration arrive armed; an injection in the options page or popup.

A report is most useful with the exact input, the resulting rule or destination,
and which control you think it bypasses.

## What a catch-all changes, and what it costs

Two properties are worth knowing before reporting, because they are deliberate.

**A catch-all makes the extension detectable, and gives any site a navigation
primitive.** With one armed, a page can call
`window.open("https://www.google.com/search?q=ZZZZZZ-1")` and force a top-level
navigation to your Jira host with a path segment of its choosing. Detection is
the symptom; the forced navigation towards an internal host is the fact. Before
the catch-all, doing this required guessing a configured key. Rules still apply to
top-level navigation only, so nothing can probe your network from a sub-resource.

**Failing closed costs availability.** When the configuration cannot be read back
at all, the dynamic rules are emptied rather than left running -- on every path
  that can end an installation, the refused build included, and not only on the
  two that throw. The
options page degrades to a recovery view. That is the right direction — a denied
jump beats a hijacked one — but it means a compromised sync account can reliably
*disable* the extension by writing enough unreadable entries. We accept that
trade rather than leave stale rules firing under a badge that says `off`.

## The controls worth knowing about

- **A redirect requires host access to its destination.** Nothing fires until the
  user grants that origin in a browser prompt naming it. This is the control that
  neutralises a hostile import, a compromised sync account and a malicious update
  alike — and why the extension never requests access to all sites.
- **The permission asked for is exactly the hosts a rule can match.** A search
  engine's rule fires on `<domain>` and `www.<domain>` and nothing else, so those
  are the two origins requested — `https://google.com/*` and
  `https://www.google.com/*`. It used to ask for `https://*.google.com/*`, which
  covered `accounts.google.com`, `mail.google.com` and every other subdomain that
  no rule of this build can ever match. A test now asserts **both** directions:
  no rule outside the permission (a rule that could never fire), and no permission
  outside the rules (an octroi nobody needs).
  **If you granted access under version 1.1.0 or earlier, that wildcard is still
  granted**: a browser does not revoke a permission because a later version asks
  for less. Narrowing it is done by hand — Chrome: *Extensions → Quick Jump for
  Jira → Site access*; Firefox: *Add-ons → Quick Jump for Jira → Permissions*.
  Removing it and re-granting through the Access section leaves you with the two
  narrow origins.
- **A DESTINATION'S PERMISSION CARRIES NO PORT, and that is the one place this
  page's "exactly the hosts a rule can match" is knowingly wider than the rule.**
  It used to carry one: `permissionOrigin()` read `URL.host`, so `http://jira:8080`
  asked for `http://jira:8080/*`. **A match pattern cannot hold a port.** Firefox
  refuses one outright ([bug 1362809](https://bugzil.la/1362809)), so the
  WebExtensions schema rejected the whole call — `permissions.request` threw,
  "Grant access" reported a refusal, `permissions.contains` threw too and the
  extension answered "not granted" for ever: badge `off`, status `MISSING_ORIGINS`,
  not one jump possible. Chrome accepts a port there, so the fault was **Gecko-only**
  and no Chromium test could see it. Worse than its own blast radius: origins are
  requested in ONE call, so a single port-bearing destination made the grant fail
  for the search engines as well. And it was precisely the population `http:` is
  admitted for — `http://jira:8080` is the shape that argument names.
  The origin asked for is now `http://jira/*`, which **may be granted for every
  port of that host**. What bounds it is not the permission but the substitution:
  the redirect target is the literal base URL, port included, so no rule of this
  build can reach another port. A test asserts both — that every origin collected
  is a pattern a browser can parse, and that the emitted rule keeps the port.
  **The residual, stated:** a destination written as an IPv6 literal
  (`http://[::1]:8080`) is accepted by the parser and produces `http://[::1]/*`,
  which some browsers do not accept as a match pattern either. The failure is
  visible and fail-closed — the browser's own refusal is shown in the Access
  section — and no rule fires. It is not refused at the door because refusing a
  legitimate destination costs more than a visible, explained failure.
- **Project keys and base URLs are the two security functions.** A key is
  concatenated literally into a regex filter, so it is held to a closed character
  set; a base URL becomes a redirect target, so it is refused rather than cleaned
  when it cannot be used exactly as written. Both are validated on every path in,
  including reads from storage and imports — never trust your own storage.
- **Rules apply to top-level navigation only.** Were they to apply to
  sub-resources, any web page could probe your internal network with an `<img>`
  tag and learn which hosts answer.
- **The destination path is fixed.** A shortcut always resolves to
  `<base>/browse/<KEY-N>`, so an attacker who controls a destination cannot choose
  a more convincing or more dangerous path.
- **Cloud metadata and link-local endpoints are a hard refusal, judged on the
  ADDRESS and not on its spelling.** No Jira is hosted at `169.254.169.254` or
  `metadata.google.internal`, so those are refused outright rather than warned
  about. `new URL()` already canonised the decimal, octal and hexadecimal forms of
  an IPv4 literal back to the dotted one — but not the IPv4-**mapped IPv6** form,
  so `http://[::ffff:a9fe:a9fe]` *is* `169.254.169.254` and used to be accepted
  while the dotted spelling was refused. That is the spelling an attacker would
  put in a shared configuration file, because no reviewer can read it. The
  mapping is now unwrapped before the list is consulted, and the same address
  feeds the private-network warning, so a mapped RFC 1918 host is called private
  for the right reason instead of incidentally.
- **A value shown to be checked by eye is displayed with its deceptive characters
  removed.** An RTL override inside a host name makes the displayed destination
  read backwards — so what you check is not where the traffic would go. This used
  to rest on `unicode-bidi: isolate` in the stylesheet, which **does not do
  that**: measured in Chromium, the rendering with the rule is
  character-for-character the rendering without it, and no value of the property
  helps. The characters are stripped and replaced with `U+FFFD` at render time
  instead; the CSS rule stays as what it always was, typography.
  **TWO SURFACES, NOT ONE, AND A WIDER CLASS THAN BIDI.** This paragraph used to
  name the quarantine repair screen as "the only surface that shows a value
  validation rejected", and the code said the same in stronger words: "a host on
  any other screen has survived `JiraInstance.parse`, hence `/^[\x21-\x7e]+$/`".
  That is false for the **change banner**: its facts come back from
  `storage.local` through the journal's reading door, which bounds the *length* of
  a text field and validates nothing else — they are never re-parsed at render
  time. Both surfaces now go through the same door. And the door was too narrow:
  it stripped the bidi controls alone, while the parsers refuse a wider class, so
  a zero-width space, a soft hyphen, a NBSP or a `U+FEFF` reached the repair field
  intact and hid part of a host name. The class now has **one author** — the
  parser's own list, minus the ordinary space, which is visible in a field and
  whose replacement would mangle a legitimate value — and a test refuses a second
  file spelling a range. The limit, stated: only a **local** writer can put such a
  character in the journal (the facts this build produces come from an
  already-admitted policy, and the sync channel does not reach `storage.local`),
  so this half is defence in depth. The falsified sentence was the real defect:
  it is what would have stopped the next reader from looking.
  **THE DOMAIN ANSWERS THE QUESTION; IT NO LONGER HANDS OVER THE CLASS.** The
  first version of this fix *exported* the character class as a source string,
  which the interface then wrapped in brackets and compiled itself. That closed
  the duplication and opened something worse: a control whose correctness rested
  on the caller remembering three things, one of which — the global flag — halves
  it in silence, replacing only the first character. The domain owns the rule and
  its application, the interface asks, and a test refuses any regex compiled in
  the interface at all.
- **A change nobody claims raises the banner, and "nobody claims" now includes the
  added search domains.** The detector compared the ticked *selection* and ignored
  the *catalogue* it draws from, in both of its halves: no fact was produced for a
  domain added to `customEngines`, and the fingerprint that serves as the claim
  token did not cover them either — so two policies differing only by their added
  domains shared one, and a claim posted by a legitimate edit covered somebody
  else's addition. What that bought an attacker holding the sync channel:
  `google.com` added under the *other* URL shape is not deduplicated (the
  catalogue keys on host pattern **and** shape), so it ships a second rule, on a
  path the built-in entry never matched, against a host permission you have
  **already granted** — live, immediately, with nothing on screen. The destination
  is still whatever your shortcuts say, and a change to those was always detected,
  which is what bounded this. A domain added or removed is now a fact of its own,
  it **names the domain** (where an engine id can only be counted), and it moves
  the fingerprint. A test asserts the general rule rather than the field: anything
  the diff can report must move the fingerprint, or an unrelated edit can silence
  it.
- **A search-engine shape is looked up in a Map, and that is a security control.**
  The URL shape of a custom domain is chosen from a closed set — a user-supplied
  path or query parameter would mean a user-supplied regex — and the airlock is
  the only place that filtering happens, because the domain layer deliberately
  does not know what shapes exist. The set was an object literal read as
  `SHAPES[shape]`, and `shape` is validated only as `/^[a-z-]{1,32}$/`:
  **`constructor` matches that pattern and lives on `Object.prototype`**, so the
  lookup answered a function, the "an unknown shape is filtered here" guard saw a
  truthy value, and the entry was built with no path and no parameter. Measured,
  from a document that passes every admission bound: a `TypeError` out of the rule
  factory, from inside a loop where nothing catches it, so the installer purged
  everything — **not one rule installed**, catch-all and named shortcuts alike, on
  every device the synchronisation reached, reported as `INSTALL_FAILED` with the
  cause `UNKNOWN` because a `TypeError` cannot be named. A Map has no prototype
  chain to walk. Every other table in the project that is indexed by a value
  rather than a literal is now prototype-free too — none of them was reachable,
  which is exactly when the guard is free, and a file where one table is hardened
  and its neighbour is not teaches the next reader that the rule is optional.
  **WHICH OF THE TWO SHAPES A TABLE TAKES IS NOW WRITTEN DOWN**, beside the
  project's other vocabulary convention: a key that crosses a frontier — the
  configuration, the journal, the rule store, an imported file — takes a `Map`,
  read with `.get()`; a key that is a literal of ours may stay a prototype-free
  object. The distinction is not taste. Both stop the prototype walk; only the
  `Map` stops the *mistake*, because the bracket becomes inexpressible instead of
  merely harmless until somebody refactors the hardening away.
- **The cap on ticked search engines is derived from what can exist.** It was 64,
  under a comment reading "the number of engines that can exist: the built-in
  catalogue plus the custom domains, themselves capped" — which is 24. A ticked id
  that resolves to no engine still costs a binding (the domain layer holds opaque
  identities and cannot consult the catalogue), so the gap let a synced document
  ticking 64 well-formed but non-existent ids push five armed shortcuts past the
  300-rule ceiling: every shortcut after the fourth landed in quarantine, on every
  device, repairable only by hand. At the derived cap the same document leaves
  twelve live shortcuts — which is the platform's rule ceiling talking, not an
  adversary, and exactly what a user ticking every engine this build can hold gets
  on their own. A test pins the count against the shipped catalogue, so a fifth
  built-in engine cannot ship without moving it.
  **AND THE EXCESS IS TRUNCATED, NOT THE DOCUMENT REFUSED**, which is this file's
  own rule about a single unreadable id — "a refused id is dropped, never fatal:
  losing the whole configuration over a ticked engine would be the denial of
  service the bound exists to prevent" — applied to the bound that broke it. Two
  gains: no policy can ever hold more ticked ids than engines that can exist,
  whatever arrives; and a document written by a *future* build with more built-in
  engines (same schema version, so the newer-format refusal never fires) is no
  longer refused entirely on the way back — a downgrade cliff the old headroom of
  64 was silently paying for. The truncation is reported rather than silent, and
  it is visible: an id that is not kept is an engine whose chip shows unticked.
  `shortcuts` and `customEngines` keep refusing the document, three lines away,
  because truncating those would delete something the user made.
  **THE BOUND COUNTS WHAT WAS READ, NOT WHAT ARRIVED**, and the first version of
  this fix got that wrong. It sliced the raw list before a single identity had
  been read, so an id the door refuses three lines later had already consumed a
  slot — and the eviction order therefore belonged to whoever wrote the document.
  Measured: 24 malformed ids followed by `google.com` left **zero** engines. There
  are now two bounds with two jobs, the same shape as the 40-character custom
  domain facing the RE2 budget: a cheap absolute guard on the raw length, whose
  job is termination and which refuses the document outright, and the selection
  ceiling, which counts admitted ids so that nothing a later line refuses can cost
  a place. The residual, stated: an adversary can still pad with a full ceiling's
  worth of **valid** ids — which is exactly what a legitimate configuration can do.
  **AND THE CEILING BELONGS TO THE AGGREGATE.** It lived at the admission door
  alone, so a policy built anywhere else could hold any number of ticked engines:
  an invariant held at one door is a filter, not an invariant. The domain now
  refuses it beside its two neighbours (200 shortcuts, 300 rules), and the door
  receives from the layer that knows the catalogue what *this build* can actually
  use — a value it may only narrow, never widen, with a post-condition that throws
  rather than clamps. The number 4 has left `core/`, where it asserted something
  the domain cannot verify.
- **Reordering goes through one door, whatever the affordance.** The arrows and the
  drag handle share a single write path: an absolute intention carrying the whole
  ordered list, settled by a compare-and-set that refuses any mismatch of the id
  set. **A drop carries no authority** — the gesture is local to the document that
  started it, and the payload it puts on the clipboard is a constant, not an
  identifier. A drop from another page, another window or a file finds no local
  gesture and is refused before its payload is even read. A catch-all copies the key you typed
  into that path, so the key's character set is asserted at emission and the
  captured text can contain no `/`, `.`, `%`, `?`, `#` or backslash.
- **A catch-all claims only SHORT keys, and the bound is a domain decision.** Two to
  six characters, hyphen only. A key of seven to twenty stays perfectly usable —
  declared by name, where its rule is a literal. The narrowing is deliberate: fewer
  ordinary searches leave the engines for the Jira instance. What it does NOT cover
  is stated too: two-character keys are claimed, although the model elsewhere calls
  them collision-prone, and only a short reserved list holds that end. Adding a word
  to that list is the answer to one too many, not a floor.
- **The reserved-prefix guard ships as several rules, and they are indivisible.**
  Chrome refuses a single rule carrying all 49 alternatives (`memoryLimitExceeded`).
  **This one is a measurement, not a check**: it was observed once, on one build,
  and no test in this repository executes RE2. Everything else on this page is
  verifiable from the source or the suite; this line is not, and it is marked so
  rather than sitting unmarked among things that are.
  so the guard is cut into runs. Each run belongs to the SAME unit as the catch-all
  of its engine: none can be installed without the others, and a refused run takes
  that engine's catch-all with it. The final set is checked prefix by prefix, per
  engine — never merely "an allow is present", which stopped being equivalent the
  day there was more than one.
- **A DATED BET, and it is the only debt no test can see.** The cut is budgeted at 50
  units of alternation cost (sum of lengths plus count) against a real RE2 limit
  measured on Chrome, 2026-09-01, to lie somewhere in (70, 107] — unknown. It was 60,
  and the bet came due: closing the query-parameter hole added one alternation of two
  to every engine's envelope, Chrome refused the guards, and the documented remedy —
  drop to 50, five runs instead of four — was applied for the documented reason.
  **Never widen the query pattern back, and never raise the key bound, which is a
  domain decision.** Re-measure before touching either number: no test in this
  repository executes RE2.
  **The query pattern was NARROWED once since, by one character, and that
  direction is the one this paragraph protects.** "No earlier parameter of this
  name" is spelled by enumerating what a *different* name looks like, and the
  first branch only required a first character other than `q` — so `%71`
  satisfied it, and `%71` **is** `q` once decoded. On an engine that decodes
  parameter names, `?%71=hello&q=ABC-1` therefore fired the rule on the second `q`
  while the engine reads the first: the exact divergence the strict prefix exists
  to forbid, under a spelling no reviewer reads. A percent sign can no longer open
  a preceding parameter name. It costs one character, on the redirect form only —
  the guards ship the wide form, so no envelope that is cut into runs pays for it —
  and its failure direction is safe: a name that cannot be consumed makes the
  whole prefix fail, so nothing matches and nothing redirects. What it does **not**
  change is the assumed cost of a catch-all: a page could already force
  `?q=ANYTHING-1` directly, so this closes a fidelity gap, not a capability.
- **A custom search domain is bounded at 40 characters, and that bound is an RE2
  budget rather than tidiness.** The margin above pays for an engine envelope the
  measurement never covered, and a user-typed domain spends it: the worst case was
  never Google. So the reserved-prefix guards are now cut **once per engine**,
  against that engine's own envelope: a costlier domain gets more and smaller runs
  instead of shipping Google's runs inside its own rule. The four engines that ship
  are byte-identical under the new arithmetic — their envelopes sit at or below the
  one the budget was measured on — and a test pins that.
- **An engine that cannot be guarded costs only itself.** Past a point an envelope
  leaves nothing to spend, and that is refused by name: the engine loses its
  catch-all, the other engines keep theirs, and the status line reports an
  unsatisfied coverage. It used to be a global `INSTALL_FAILED` — one unusable
  domain and nothing installed at all. Nothing leaks either way, because a
  catch-all can never outlive its guards; the cost is availability, per engine.
  A domain long enough to reach that point is also refused at the door it is typed
  at, which is the only place a sentence can still help.
- **No acknowledgement travels with the configuration. Not one.** Accepting a
  warning — the catch-all's, or a destination's — is recorded in local storage,
  outside the configuration, so a compromised sync account cannot accept a
  universal redirect *or an insecure destination* on your behalf. The limit,
  stated: this separates the **sync channel**, not a local attacker — who could
  write that record just as easily as the configuration itself. Same limit as the
  journal.
  **This used to be true of the catch-all only, and that was a hole.** The
  destination warnings — `INSECURE_SCHEME`, `PUNYCODE`, `LITERAL_IP`,
  `INTERNAL_HOST`, two of them high severity — were written *into* the
  configuration, so they travelled through `storage.sync` the moment you ticked
  "Sync across devices". A document claiming `acknowledged: ["INSECURE_SCHEME"]`
  with `armed: true` produced a live, acknowledged shortcut with no screen and no
  click; measured, and it falsified the sentence that justified accepting `http:`
  at all ("the traffic never leaves in clear text without someone having said
  so"). What still bounded it was the host permission (the rule installs inert)
  and the change journal (the banner fires) — neither of which is this control.
  Reading a document saved **locally** still honours its acknowledgements, because
  there that record genuinely is your browser's and a local attacker could forge
  the local entry just as easily; on a synced document they are dropped and the
  warning is owed again, on the machine in front of you. The arming survives, so
  what you see on screen is the switch that was saved.
- **The change detector tells an act from a discovery.** A change somebody
  claimed at the commit is recorded without raising anything; only a divergence
  nobody claims raises the banner. The claim is a FINGERPRINT OF THE CONTENT --
  never a height, because a height is a number the hostile writer chooses, and no
  longer an envelope identity either: `{revision, writer}` was tried and defeated,
  because the token is written into the SAME envelope as the value, so an adversary
  holding the sync channel reads it before copying it. A fingerprint cannot be
  forged, not because it is secret, but because matching one means producing a state
  a LOCAL door already claimed — and the journal never leaves local storage. The
  residual window is narrowed, not closed: an attribution landing after a divergence
  has been written is not caught.
- **The change detector survives a restart.** The last installed policy is kept
  locally and compared on every wake-up, so a write pushed while the service
  worker was dead is still reported. Its absence is treated as a change, never as
  silence.
- **Extension pages cannot reach the network** (`connect-src 'none'`), build no
  HTML from strings, and create links only from re-parsed http(s) URLs.

## What the options page can and cannot tell you

- **The detector fails by over-signalling, never by under-signalling.** A fact about
  the installed reality that is *absent* is not treated as `true`. The preview
  likewise normalises a rule read back from the store: a rule whose priority band is
  missing, or is not a band the platform could have written, is read as the
  **catch-all** — the most alarming label — rather than as an ordinary shortcut. A
  detector that dies quietly, or that answers "this search goes through untouched"
  when it cannot read the installed programme, is the failure this rule forbids.
- **The status line now tells the truth, and so does the preview.** Both are wired
  to the installed reality. The **status line** used to read `READY` while the
  catch-all had failed to install: the service worker records the result of each
  installation in local storage (`installOutcome`) and the page reads it, so a
  failed install and an *unknown* install are two distinct sentences with two
  distinct tones, rather than one reassuring silence.
- **That receipt is FORGEABLE by a local attacker, and here is exactly what it
  buys.** `installOutcome` lives in `storage.local`, **never** in sync — so the
  compromised sync account the detector watches for cannot write it. A local
  attacker can, and already holds the journal and the installed-policy projection,
  so this adds no new capability. What forging `{ installed: true }` does is
  **silence the status line**, the only channel able to report a failed
  installation. It does **not** touch the **badge**, which counts the rules really
  installed and asks the browser for that count, nor the **banner**, which reads the
  change journal. The detector is not turned off; one of its three voices is.
- **Whether the catch-all was installed can also be *unknown*.** On a device where
  the configuration arrived through sync but the local receipt has not yet been
  written, the page says so rather than guessing — an over-signal that lasts until
  the first installation lands.

## Supply chain

The extension ships **no third-party JavaScript**: no runtime dependency, no
bundler, no CDN, no remote code of any kind. `package.json` has an empty
`dependencies`, and a test fails the build if that changes.

It does ship **one third-party stylesheet**, and the earlier wording ("no
third-party code") was stronger than the control behind it, so here it is
plainly: `src/ui/author-signature.css` is a byte-for-byte mirror of
[Romain-MILLAN-Tag](https://github.com/RomainMILLAN/Romain-MILLAN-Tag) (MIT),
pinned by commit through a submodule that CI never clones. Two controls cover it,
both hermetic: its provenance header is asserted, and **its content is pinned by
SHA-256** — a hand edit, or a resync onto a different upstream, goes red.

What that stylesheet cannot do is exfiltrate: the CSP ships `default-src 'none'`
with `connect-src 'none'` and `img/font/style-src 'self'`, which closes every
network channel CSS has. What it *could* do, if it were ever replaced by something
hostile, is redirect the interface — cover the Access section, hide the origin
list, disguise the disarm control. That risk is **accepted**, and reading the
upstream log before a resync is what keeps it accepted rather than ignored.

CI never clones an external repository, runs with least-privilege tokens, pins
every action by commit SHA, installs with `--ignore-scripts`, and never exposes a
secret to pull-request code. It also audits **what actually ships**
(`npm audit --omit=dev`, expected to stay at zero for ever since nothing ships).
The development toolchain is another matter and is not gated: `addons-linter`
pulls `image-size`, which carries two denial-of-service advisories
(GHSA-w3rx-r6r6-pgpr, GHSA-5p2g-fcmc-qvqq); it is reachable only through the lint
step, which parses this repository's own icons, so the worst case is a hung CI job
and never a user. Downgrading `web-ext` to close it would cost more than it buys.
Dependabot is the fix path, and this paragraph is the exception, in the open.

**Releases attest their provenance, and the attested file is the published one.**
That was not always true: the release workflow used to build twice — attesting one
set of archives and publishing a second, freshly compiled set. Archives record
file timestamps from the compilation, so the two never had the same digests, and
`gh attestation verify` on a published asset failed. The publish job now
*downloads* what the build job attested instead of recompiling, signs the Firefox
xpi from that same archive, and attaches the SHA-256 sums to the release. A test
reads the workflow and refuses a return to compiling in the publish job.

Anyone can therefore check what they downloaded:

```sh
gh attestation verify jira-quick-jump-chrome-<version>.zip -R RomainMILLAN/jira-quick-jump
sha256sum -c SHA256SUMS
```

Publication waits behind a protected environment with a human reviewer.

The release workflow also **denies every outbound connection it did not declare**
(`egress-policy: block`), with a separate allowlist per job: the build job can
reach the npm registry and Sigstore and not the stores, the publish job can reach
the stores and not Sigstore. Two limits, stated rather than implied. It is a
control against an **unwitting** exfiltration — a dependency phoning a host nobody
declared — and not a wall: domain filtering is bypassable by tunnelling, so it does
not stop code that is already running and trying. And the allowlists are derived
from the steps and from the shipped code of the tools they run, not observed from a
real run; if a release ever fails on a blocked endpoint, the run summary names it.
Pull requests stay in audit mode on purpose: a guessed list there would break them
while protecting nothing that ships.

## Supported versions

The latest release. Fixes are not backported.
