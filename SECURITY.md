# Security policy

## Reporting a vulnerability

Report privately through
[GitHub's advisory form](https://github.com/RomainMILLAN/Jira-Quick-Jump/security/advisories/new).
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
  **If you granted access under version 1.0.0, that wildcard is still granted**: a
  browser does not revoke a permission because a later version asks for less.
  1.0.0 is the only version that ever shipped it — `v1.0.0` is the only tag, here
  and on the remote — so the narrowing lands in the release this paragraph is part
  of, and no other version can have asked for the wildcard. Narrowing it is done by hand — Chrome: *Extensions → Quick Jump for
  Jira → Site access*; Firefox: *Add-ons → Quick Jump for Jira → Permissions*.
  Removing it and re-granting through the Access section leaves you with the two
  narrow origins.
- **A DESTINATION'S PERMISSION CARRIES NEITHER ITS PORT NOR ITS PATH, and those
  are the two places this page's "exactly the hosts a rule can match" is
  knowingly wider than the rule.**
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
  **AND IT CARRIES NO PATH EITHER, which this page used to call "the one place"
  while there were two.** A base URL may hold up to four path segments, and a
  match pattern *can* express a path — `https://intra.example.org/jira/*` is legal
  — yet `permissionOrigin()` asks for `https://intra.example.org/*`, the whole
  host. So a self-hosted Jira at a sub-path grants more than any rule of this
  build can reach.
  It is **declared rather than narrowed**, and half of that decision is now
  measured — which changes the reason without changing the answer.
  **Measured** (Chrome 152.0.7977.82, 2026-09-07, from a loaded extension
  declaring the same ceiling): a path-bearing request **is accepted** by the
  manifest check. `permissions.request({origins: ["https://intra.example.org/jira/*"]})`
  fails with *"This function must be called during a user gesture"* — the same
  error as the whole-host form, and nothing about the manifest; a malformed pattern
  fails differently and by name (*"Invalid host wildcard"*). So narrowing is
  expressible and accepted, and the fear that it would throw and take the whole
  single-call grant down with it was **wrong**.
  **What is still unknown is whether it buys anything:** does Chrome *retain* the
  path once granted, or normalise the grant to the host? That decides between a
  real narrowing and theatre, and it cannot be measured from a desk. It needs a
  permission actually granted, which needs the bubble accepted by hand — verified,
  with a real CDP-dispatched click, that the gesture reaches the handler and that
  `request` then **never settles**: the bubble is views-based browser UI, not a
  CDP target, and seeding `granted_permissions` in the profile does not stand in,
  because loading the extension reinstalls it and clears them.
  So the width stays, bounded by the same thing that bounds the port: the redirect
  target is the literal base URL, path included, so no rule of this build can reach
  another path of that host — pinned on every emitted rule, not on an example. The
  next step is a human clicking Allow once and reading `permissions.getAll()`.
  **The other spelling of that same fault is now closed at the parser, and the
  paragraph that left it open was wrong about both of its reasons.** It read: "a
  destination written as an IPv6 literal (`http://[::1]:8080`) is accepted by the
  parser and produces `http://[::1]/*`, which some browsers do not accept as a
  match pattern either. The failure is visible and fail-closed […] and no rule
  fires. It is not refused at the door because refusing a legitimate destination
  costs more than a visible, explained failure."
  Neither clause held. **The failure was not contained:** origins are requested in
  ONE call — the sentence four lines above says so about the port — so a single
  bracketed destination made `permissions.request` throw and *nothing at all* was
  granted: not the search engines, not the other shortcuts. One row, and the whole
  extension permanently inert behind an Access button that appeared to do nothing.
  **And the destination was not legitimate in any working sense:** it could never
  obtain its permission, so it could never fire. Refusing it therefore takes away
  nothing that ever worked, and moves the moment the user learns it from a
  diagnostics panel to the field they are typing in.
  A bracketed host is now refused as `BASE_IPV6_LITERAL`, *after* the
  forbidden-host list so that `[::]`, `[fe80::1]` and every IPv4-mapped spelling
  of the metadata endpoint keep their own, more specific sentence. The bracketed
  clauses inside the warning catalogue survive as **changelocks** — they answer
  for nothing today, and `shortcut-warning.js` says so in those words, so the day
  this refusal is relaxed a loopback cannot arrive unwarned. The test that used to
  vouch for the bracketed form as "a pattern a browser will accept" — the one
  place this repository asserted the opposite of what this page conceded — now
  asserts that nothing which parses can produce a colon in its host.
- **AND THE THIRD SPELLING OF THAT SAME FAULT WAS THE ONE THAT WIDENED RATHER
  THAN BROKE: the `*`.** The port makes a pattern unparseable, the bracket makes
  it unparseable — and a wildcard makes it *valid and enormous*. `new URL()`
  admits `*` as a host code point, so `https://*` had no forbidden host, no
  bracket, no port, a canonical form and pure ASCII: it **parsed**, and
  `permissionOrigin()` produced the all-https-hosts match pattern — word for word
  one of the two `optional_host_permissions` this manifest declares. A browser
  does not refuse that; **it grants it**. `https://*.corp.example` is the quieter
  half: it carries *no warning at all* (it has a dot, it is not an IP, it is not
  punycode), reads as an ordinary destination on the import review screen, and
  hands over one company's entire subdomain tree.
  Measured end to end, from a configuration file shaped exactly as `toTransfer()`
  writes one, carrying those two rows: import accepted, zero refused, zero
  warnings on the first row, **both disarmed** — and the origins handed to
  `permissions.request` were the two Google ones plus the all-subdomains pattern
  for `corp.example` plus the ceiling itself. Being disarmed protects nothing
  here, and that is not an oversight either: `requiredOrigins` deliberately
  collects the origins of every shortcut, armed or not, so that granting access is
  one prompt and not one per arming. One click on the button this extension asks
  the user to press, and the grant is made — **persistently**, since a permission
  already granted is not revoked when a later version asks for less, which is the
  sentence this page already makes about the `https://*.google.com/*` wildcard of
  1.0.0.
  The other characters are the port's blast radius one notation further, and that
  half is **measured** rather than reasoned about. Chrome 152.0.7977.82,
  2026-09-07, `permissions.contains({origins: ["https://a.*/*"]})`:
  *"Invalid value for origin pattern https://a.\*/\*: Invalid host wildcard."* It
  **throws** — `Platform.grantedOrigins` catches that and answers `false`, so the
  badge reads `off` for ever, and `permissions.request` throws the same way, so
  "Grant access" reports a refusal. Origins are requested in ONE call, so a single
  such row makes the grant fail for the search engines and for every other
  shortcut too. `*` is legal in a match pattern only as the whole host or as a
  leading `*.`, which is why the wildcard forms **widen** and these **break**. **One predicate closes both halves,
  because they are one fact:** a host that is not a plain sequence of LDH labels
  either widens the pattern or breaks it. It is refused at the field the user is
  typing in (`BASE_HOST_SHAPE`), *after* the bracket refusal so that a bracketed
  literal keeps its own more specific sentence. What it takes away is stated
  rather than discovered: a trailing dot, a label ending in `-`, an empty label
  and an underscore stop being accepted; the underscore is the one judgement call,
  and it is refused rather than assumed because no measurement here says whether a
  match pattern carrying one is accepted.
  **THE TEST IS THE PART THAT WAS WRONG, and that is the lesson worth keeping.**
  Three tests claimed this property and `PRIVACY.md` said "a test pins that it
  never asks for a wildcard". All three fed `requiredOrigins` a policy *the test
  had built*, out of host names the test had chosen, and the minimality half only
  ever walked the four engines that ship. They asserted that clean input produces
  clean output — true, and not the question. The pin now walks every base URL of
  the hostile corpus **and** of the legitimate one, in one document, through
  `proposeImport` and then through `requiredOrigins`, and requires a plain host
  pattern out of whatever went in. It goes red on this defect, by name. Same
  failure mode as the two this page already records: *a control that enumerates
  what it guards only guards what its author imagined.*
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
  **BOTH EMBEDDINGS, AND THE FIRST FIX COVERED ONE.** The pattern required
  `ffff:`, so it unwrapped the IPv4-**mapped** form and not the
  IPv4-**compatible** one (RFC 4291 §2.5.5.1, deprecated) — and `[::a9fe:a9fe]`
  denotes that same `169.254.169.254`. Measured: refused as `[::ffff:a9fe:a9fe]`,
  accepted as `[::a9fe:a9fe]`. Whether a browser would route the deprecated form
  is doubtful, so what closing it buys for CERTAIN is this paragraph's own claim:
  it said the list judges an ADDRESS and not a spelling, and one spelling sat
  outside it. A claim wider than its code is what stops the next reader from
  looking. Nothing legitimate is lost — every address in `::/96` is one of the two
  embeddings or is non-routable, and `[::1]` and `[::]` carry no second group.
- **A value shown to be checked by eye is displayed with its deceptive characters
  removed.** An RTL override inside a host name makes the displayed destination
  read backwards — so what you check is not where the traffic would go. This used
  to rest on `unicode-bidi: isolate` in the stylesheet, which **does not do
  that**: measured in Chromium, the rendering with the rule is
  character-for-character the rendering without it, and no value of the property
  helps. The characters are stripped and replaced with `U+FFFD` at render time
  instead; the CSS rule stays as what it always was, typography.
  **THE COUNT OF SURFACES WAS WRONG TWICE, SO WHAT IS WRITTEN DOWN IS THE
  CRITERION.** This paragraph first named the quarantine repair screen as "the
  only surface that shows a value validation rejected", and the code said the same
  in stronger words: "a host on any other screen has survived
  `JiraInstance.parse`, hence `/^[\x21-\x7e]+$/`". That was false for the **change
  banner**, whose facts come back from `storage.local` through the journal's
  reading door. It was then rewritten to say *two*, and that was false for the
  **cause lists** — the reasons an installation was refused, read back through
  `InstallOutcome.read`, painted in the status line *and* in the preview panel.
  Each door bounds the *length* of a text field and validates nothing else; none
  of these values is re-parsed at render time. So the rule is no longer a list to
  be recounted:
  **a surface needs this door when it prints a string that is not re-parsed at
  render time** — not "a value the parser refused", not "a host". The three that
  match today are the quarantine rows, the change banner and the cause lists, and
  a test walks them by field rather than counting calls.
  And the door itself was too narrow: it stripped the bidi controls alone, while
  the parsers refuse a wider class, so a zero-width space, a soft hyphen, a NBSP
  or a `U+FEFF` reached the repair field intact and hid part of a host name. The
  class now has **one author** — the parser's own list, minus the ordinary space,
  which is visible in a field and whose replacement would mangle a legitimate
  value — and a test refuses a second file spelling a range. The limit, stated:
  only a **local** writer can put such a character in the journal or the receipt
  (the facts and subjects this build produces come from an already-admitted
  policy, and the sync channel does not reach `storage.local`), so those two
  thirds are defence in depth. The falsified sentence was the real defect, both
  times: it is what would have stopped the next reader from looking.
  **THE DOMAIN ANSWERS THE QUESTION; IT NO LONGER HANDS OVER THE CLASS.** The
  first version of this fix *exported* the character class as a source string,
  which the interface then wrapped in brackets and compiled itself. That closed
  the duplication and opened something worse: a control whose correctness rested
  on the caller remembering three things, one of which — the global flag — halves
  it in silence, replacing only the first character. The domain owns the rule and
  its application, the interface asks, and a test refuses any regex compiled
  anywhere under `src/ui/`.
  That test used to read one file while this sentence said "the interface" — a
  claim wider than its pin, which is exactly the defect the batch was closing. The
  code passed either way; the sentence was the part that was wrong.
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
  **AND THE SHAPE FOLLOWS THE HOST, which that first fix did not cover.** A custom
  domain's identity is `custom:<host>` — **the shape is not in it** — so the two
  comparisons answered "which domains" and said nothing about "how each one
  intercepts". Measured: the same host under `search-q` and under `root-q` shares
  an id, produces no fact and yields an identical fingerprint, while one
  intercepts `/search?q=…` and the other `/?q=…`. A sync account rewriting that
  one field moved a live rule onto another path of a host whose permission was
  **already granted**, in silence. Both readers now compare the host *and* its
  shape, and a reshaping is a fact of its own, named after what changed. The
  lesson is about the test as much as the code: the pin meant to hold this
  enumerated mutations, so it covered the ones its author had imagined — and this
  was not among them.
- **A claim covers a change once, not for as long as it sits on the ring.** The
  token that tells an *act* from a *discovery* is the fingerprint of a policy's
  content, kept in a four-slot ring in `storage.local`. Nothing used to spend it —
  so **any state the interface had committed within the last four commits could be
  written back by the sync channel and covered by its own stale claim.** The
  cheapest route, measured on this build: you arm a shortcut from the options page
  (the door claims that content), you press **Alt+Shift+J**, and the adversary
  puts the armed document back. The kill switch claims nothing and emits no fact —
  disarming is deliberately silent, or the emergency stop would raise the alarm it
  exists to silence — so the claim was not even pushed off the ring. Result: no
  journal entry, no banner, a quiet badge. The emergency stop undone without a
  word, on the one fact the diff calls *the gesture the attacker needs last*.
  A claim is now **forgotten by the single writer as soon as the projection carries
  its content**, which is the instant no legitimate gap is left for it to cover.
  Not on the reading side, deliberately: on an installation that keeps failing the
  projection stays stale and the same gap is re-diffed at every wake-up, so a
  claim consumed by the first of those reads would report your own edit as
  `UNKNOWN` — the exact false alarm the waterline exists to prevent. Both
  directions are pinned, and the replay is walked end to end through the worker
  rather than through the journal alone.
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
  **WHAT THAT TRADE COST, and it was a real one:** `Object.freeze` does nothing to
  a Map, so converting a frozen table lost the freezing. Measured, one
  `EngineId.LEGACY.set("google", "evil.example")` from any file loaded afterwards
  turned that id's migration into another host — and every file of this extension
  shares one global scope, which is the argument the parsers freeze their own
  constants on. A Map cannot be frozen, so the equivalent is not to publish it:
  the three tables keyed from a frontier are now module-private, which was free
  because nothing outside their own file ever read them. A test refuses **any**
  `Map` reachable from **any** global this project publishes, taking the list of
  globals from the sources rather than naming them.
  That last sentence used to promise more than the test did, for the second time
  on this page: the pin listed three names, and two of them had never existed, so
  it asserted that absent properties were not `Map`s while the regression it
  claimed to guard — re-exporting one of the tables — walked past it green.
  Measured, then fixed by removing the enumeration: a control that lists what it
  guards only guards what its author imagined.
  **AND IT NOW REFUSES A THAWED ARRAY ON THE SAME GROUND, which was open on three
  of them.** A `Map` must stay private because freezing does nothing to it; an
  array CAN be frozen, so the rule there is that it must be — and
  `IssueReference.SEPARATORS`, `ShortcutWarning.KINDS` and
  `SearchEngineCatalog.SHAPES` were published writable. Measured: one
  `SEPARATORS.push(".")` from any file loaded afterwards put an EMPTY branch in the
  emitted alternation, so the separator became **optional** and `ABC1234` matched a
  rule written for `ABC-1234` — a matcher wider than the validator, which is the
  direction this page refuses everywhere else; and `KINDS.push("FORGED")` made
  `Consent.parse` admit an acknowledgement kind nothing knows. The airlock now
  refuses a separator it cannot spell, by name, so the widening is closed whatever
  its source: the freeze stops the mutation, the refusal stops the empty branch.
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
  **AND AN ENGINE IDENTITY IS BOUNDED IN SIZE TOO**, which it was not: the shape
  it is held to is narrow and was mute about length, so it was the one string this
  project admitted with no bound at all. Measured: a 20 004-character id passed,
  was kept, and was re-persisted at every commit, while every neighbour bounded
  its text (256 in the quarantine door, 256 in the journal, 200 in the receipt, 40
  for a custom host). The ceiling is **derived, never chosen** — the longest
  identity this build can mint, which is the custom prefix plus the longest host
  the domain parser admits — because anything above it can resolve to no engine in
  any catalogue, so refusing it costs no selection a user could have made. It
  degrades the way this door's rule requires: the id is dropped, the rest of the
  configuration lives, and the drop is reported under a code that already has a
  translated sentence.
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
- **A catch-all claims only SHORT keys, and the bound is a domain decision.**
  2 to 6 characters, hyphen only. A key of seven to twenty stays perfectly usable —
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
  **RE-MEASURED 2026-09-07** (Chrome 152.0.7977.82, Firefox 154.0), and the
  campaign replaced an unknown with a number and a number with a caveat. The
  alternation ceiling, on this project's own cost scalar, in google.com's guard
  envelope: **cost 108 accepted, cost 114 refused** — so 50 keeps better than
  two-fold margin, and the "(70, 107] — unknown" above is now bounded. **Firefox
  is not the constraint**: Gecko accepted every question asked, cost 294 included.
  And the caveat, which is the finding that matters: **the scalar is a proxy, not
  the quantity RE2 charges.** The 2026-09-01 note records cost 107 *refused*; cost
  108 was accepted six days later. Length is not it either — a guard of 154
  characters is accepted while the catch-all's redirect of 137 is refused. What
  RE2 charges is *program* size, dominated by the unrolled `{1,5}` over a
  63-character class and its capture groups. The margin is what protects, not the
  arithmetic.
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
- **The last spelling of that same divergence — the CASE — is now closed too.**
  It was open for a year, so here is what it was: every condition shipped
  `isUrlFilterCaseSensitive: false`, because `abc-1` has to reach `/browse/ABC-1`,
  and that flag is global to the pattern — so it also reached the **path** and the
  **parameter name**, which Google reads case-sensitively. `/SEARCH?Q=ABC-1` fired
  the rule on a URL that is not a search. Same class as `%71`, the rule firing on
  something the engine does not read; unlike `%71` it granted **nothing**, since a
  page that wants the redirect writes `?q=ABC-1` and gets it. A fidelity gap with
  no capability behind it, which is why it could wait for a measurement rather
  than a guess.
  The half that carried the security always **held**, and it is worth saying how,
  because the repair changed one of its two answers *for the better*. Under the old
  insensitive flag RE2 folded the negated class, so `[^=&%q]` excluded `Q` as well
  as `q`: neither `?Q=hello&q=ABC-1` nor `?q=hello&Q=ABC-1` matched — fail-closed
  in both directions, over-cautiously in the first. Under the sensitive flag `Q=`
  is genuinely a *different* parameter, so `?Q=hello&q=ABC-1` now matches, and it
  should: `q=ABC-1` **is** the first parameter Google reads there. The other one
  still does not match, and must not — Google reads `q=hello`. Both directions are
  pinned by a test that compiles the delivered `regexFilter` **under the flag the
  rule actually ships with**, which the test before it did not.
  **IT IS CLOSED, AND THE REMEDY WAS NOT THE ONE THIS PAGE NAMED.** The
  precondition was met on 2026-09-07, Chrome 152.0.7977.82 and Firefox 154.0, by
  asking `isRegexSupported` from a loaded extension's own service worker.
  `(?-i:…)` turned out **affordable and unusable**: Chrome accepts it everywhere
  and it moves no boundary, but `interception/jump-preview.js` compiles the
  *delivered* `regexFilter` with `new RegExp`, and **JavaScript has no inline flag
  groups** — measured, `SyntaxError: Invalid group`. Every rule would have broken
  the one organ where a user can check this extension against itself, permanently,
  behind the preview's own `catch`. Worse than the gap, on a surface this page
  calls verifiable.
  **What shipped needs no engine feature at all.** A two-element character class is
  the same construct in RE2 and in JavaScript, so the named key spells its own two
  cases — `[Aa][Bb][Cc]` — and the **redirect** conditions go
  `isUrlFilterCaseSensitive: true`. The path and the parameter name stop being
  folded: `/SEARCH?Q=ABC-1` no longer fires a redirect, while `?q=abc-1` — the
  whole reason the flag was ever insensitive — still lands on `/browse/ABC-1`,
  because only the *matcher* learned both cases and the substitution still writes
  the canonical key. Nothing else moved: the catch-all's fragment is
  `[A-Za-z][A-Za-z0-9_]{1,5}`, already explicit, and the separators, `\d+` and the
  host are case-free.
  **The guards keep the insensitive flag, and that half carries the leak.** The
  reserved-prefix list ships in upper case; the typing does not. Measured against
  real RE2: a case-sensitive guard stops matching `q=cve-1`, so `CVE-1` would leave
  for the Jira instance. A guard exists to *stop* a redirect — wider only ever
  stops more, narrower is the one direction that leaks — and the flag being
  per-rule is what makes the pair expressible. Both halves are pinned, each red
  without its own fix, and the guard test walks all 49 prefixes in both cases.
  **AND IT GAVE BUDGET BACK.** Zero rules that installed before stop installing,
  and both custom-host boundaries moved *outward*: the catch-all's from 26 to 28, a
  twenty-character named key's from 32 to 34. Under an insensitive flag RE2 folds
  the path, the parameter name and the host itself, and the folding costs more
  program than the explicit class replacing it. The deferral had assumed for a year
  that closing this would cost margin; it returned some.
  One correctness improvement came free: under a sensitive flag `Q=` is genuinely a
  different parameter, so `?Q=hello&q=ABC-1` now matches — `q=ABC-1` *is* the first
  parameter Google reads there — where the insensitive form refused it.
- **A custom search domain is bounded at 40 characters, and that bound is an RE2
  budget rather than tidiness.** The margin above pays for an engine envelope the
  measurement never covered, and a user-typed domain spends it: the worst case was
  never Google. So the reserved-prefix guards are now cut **once per engine**,
  against that engine's own envelope: a costlier domain gets more and smaller runs
  instead of shipping Google's runs inside its own rule. The four engines that ship
  are byte-identical under the new arithmetic — their envelopes sit at or below the
  one the budget was measured on — and a test pins that.
- **A CUSTOM DOMAIN OF 27 CHARACTERS OR MORE LOSES ITS CATCH-ALL ON CHROME, and
  the bound that was supposed to prevent that was measuring the wrong rule.**
  This is the one finding no desk review of this repository could reach, because
  nothing here executes RE2. `CustomEngine.MAX_HOST_LENGTH` is 40, and justified
  itself on "at 40 the costliest parseable host produces an envelope that exhausts
  the budget, so the two bounds meet almost exactly". Measured 2026-09-07 on
  Chrome 152.0.7977.82, against the rules this build actually emits:
  the catch-all's **redirect** is accepted up to a host of **28** characters and
  refused from **29**; a twenty-character named key's redirect is accepted up to
  **34** and refused from **35**; and the reserved-prefix **guards** are accepted
  even at 40. Firefox 154 accepts all of it. (Both redirect numbers were two lower
  before the case repair landed — see the bullet above: going case-sensitive
  stopped RE2 folding the literals, which gave two characters of host back on
  each.)
  So the guards — the thing the per-engine budget was invented for, and the thing
  the sentence above was about — are the **cheap** rules. What blows is the
  catch-all's redirect, which carries the unrolled `{1,5}` and two capture groups
  and has **no budget of any kind**.
  **What it costs a user, and why it is not a leak:** a domain of 29 to 40
  characters keeps its named shortcuts and loses its catch-all on Chrome.
  Per-unit atomicity takes the guards down with it, so `ISO-9001` cannot leave;
  `coverageSatisfied` comes out false, the status line says the catch-all could not
  be installed, and `skipped` carries `REGEX_UNSUPPORTED` and `UNIT_INCOMPLETE`.
  Fail-closed, reported, one engine, not silent — **and that sentence is now
  pinned rather than asserted.** A test seeds a 38-character domain, injects a
  fault shaped like the measured one (one rule of a unit refused, its neighbours
  accepted) and requires all three halves of the claim: the guards fall *with*
  their catch-all so `ISO-9001` cannot leave, the other engine keeps its catch-all
  and the named shortcut keeps its rule on the long domain, and the receipt comes
  back with `coverageSatisfied: false`, `REGEX_UNSUPPORTED`, `UNIT_INCOMPLETE` and
  a diagnosis of `CATCH_ALL_NOT_INSTALLED`. The fault is a **model** and the test
  says so: a length threshold cannot reproduce RE2's ordering — program size, not
  characters — so what it reproduces is the shape of the failure, which is what
  the reporting has to survive. The measured numbers stay a changelock elsewhere,
  where nothing pretends to execute RE2.
  **The bound stays at 40, deliberately.** Lowering it to 28 would refuse at the
  door — this project's usual preference — and would also take away named
  shortcuts that work perfectly on those hosts. The excess is over-budget for
  **one feature**, not for the domain, and a per-feature refusal is what already
  happens. A changelock now pins both measured boundaries against the constant, so
  the gap is a number somebody chose rather than a number nobody knows.
- **An engine that cannot be guarded costs only itself.** Past a point an envelope
  leaves nothing to spend, and that is refused by name: the engine loses its
  catch-all, the other engines keep theirs, and the status line reports an
  unsatisfied coverage. It used to be a global `INSTALL_FAILED` — one unusable
  domain and nothing installed at all. Nothing leaks either way, because a
  catch-all can never outlive its guards; the cost is availability, per engine.
  A domain long enough to reach that point is also refused at the door it is typed
  at, which is the only place a sentence can still help.
- **An imported file is reviewed for its destinations AND for its surface.**
  Everything imported arrives disarmed with no acknowledgements, so no rule can
  install until each shortcut is armed in front of its destination — and the review
  screen shows those destinations was/now. What it did **not** show is that a
  configuration file also chooses *where searches are intercepted*: which engines
  are ticked, and which search domains are added. Measured: a file adding one
  domain and ticking it displayed a single row — the shortcut — and, once that
  shortcut was armed, emitted two rules, the second on a host that had never
  appeared on screen. Nothing fired unseen (the Access section then asks for that
  host and the browser prompt names it, which is what bounded this to a
  transparency gap rather than a breach), but the consent given at the first step
  did not cover what the file had chosen. The screen now names the engines and the
  added domains before the confirm button.
- **A SET-ASIDE ENTRY GOES THROUGH A READING DOOR, like a journalled fact.** The
  journal rebuilds a fact field by field, on the argument that a surplus field is
  written back for ever and a field with no bound freezes the surface that shows
  it. The quarantine is the other half of that class and had no door: it is
  attacker-shaped by hypothesis, `toJSON` wrote it back verbatim at every commit,
  and its fields are rendered into the two inputs the user is asked to read.
  `MAX_QUARANTINE` bounded the NUMBER of entries; nothing bounded their size or
  their shape — measured, a 5 kB field nobody reads survived the round trip and
  was re-persisted for ever. Three fields are kept now (`id`, `key`, `baseUrl`),
  each at 256 characters, which cannot mangle a repairable value because the
  parsers already refuse a base URL over 256, a key over 20 and an identifier over
  64. An entry with nothing readable left is **kept, empty**, and not dropped: the
  count feeds `PARTIAL_POLICY`, so losing one would make the diagnosis call an
  amputated configuration whole. The limit, stated: only a local writer reaches
  this entry, and such a writer already holds the journal and the projection — this
  removes an unbounded, unspecified shape from a surface that displays, it does
  not separate a new adversary.
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
- **Every unreadable spelling of the saved policy leaves a line, `null` included.**
  When the configuration cannot be read, the rules are emptied *and the journal
  says so* — that entry is what distinguishes "what was saved stopped being
  readable" from an ordinary disarm, and a quiet `off` badge is indistinguishable
  from the latter. One spelling did not reach it. `PolicyRepository` read
  `value.policy` straight through, so `{"rev": 1, "value": null}` — one byte of
  hostile write — threw a **TypeError** out of `load()` instead of returning a
  refusal, on the one path in this project whose every failure is a *value*. The
  fail-closed still held (purge, receipt `installed: false`, badge `off`); what the
  jet skipped was the door: `recordUnclaimable([PolicyUnreadable])` hangs off the
  `!loaded.ok` branch, and a throw lands in the outer `catch` thirty lines past it.
  Measured: `journal: []`, where `5`, `"x"`, `[]`, `{policy: null}` and a
  too-new schema version all wrote their line. Absence now means a fresh profile
  and only that; anything a writer actually wrote is reduced to the document the
  admission door already refuses by name. The pin walks the spellings as a table,
  because the defect was an **asymmetry** between them — a test on `null` alone
  would go green the day another shape starts throwing.
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
gh attestation verify jira-quick-jump-chrome-<version>.zip -R RomainMILLAN/Jira-Quick-Jump
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
