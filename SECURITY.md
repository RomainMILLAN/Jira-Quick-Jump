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
at all, the dynamic rules are now emptied rather than left running, and the
options page degrades to a recovery view. That is the right direction — a denied
jump beats a hijacked one — but it means a compromised sync account can reliably
*disable* the extension by writing enough unreadable entries. We accept that
trade rather than leave stale rules firing under a badge that says `off`.

## The controls worth knowing about

- **A redirect requires host access to its destination.** Nothing fires until the
  user grants that origin in a browser prompt naming it. This is the control that
  neutralises a hostile import, a compromised sync account and a malicious update
  alike — and why the extension never requests access to all sites.
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
  Chrome refuses a single rule carrying all 49 alternatives (`memoryLimitExceeded`),
  so the guard is cut into runs. Each run belongs to the SAME unit as the catch-all
  of its engine: none can be installed without the others, and a refused run takes
  that engine's catch-all with it. The final set is checked prefix by prefix, per
  engine — never merely "an allow is present", which stopped being equivalent the
  day there was more than one.
- **A DATED BET, and it is the only debt no test can see.** The cut is budgeted at 60
  units of alternation cost (sum of lengths plus count) against a real RE2 limit
  measured on Chrome, 2026-09-01, to lie somewhere in (70, 107] — unknown. The last
  measured-good point costs exactly 70, so the eleven units of margin pay for an
  engine envelope the measurement never covered; a custom domain of sixty characters
  is the real worst case, not Google. **If Google ever refuses at 60, drop to 50 —
  never raise the key bound, which is a domain decision.** Re-measure before touching
  either number: no test in this repository executes RE2.
- **A key-scoped acknowledgement never travels.** Accepting a catch-all's warning
  is recorded in local storage, outside the configuration, so a compromised sync
  account cannot accept a universal redirect on your behalf. The limit, stated:
  this separates the **sync channel**, not a local attacker — who could write that
  record just as easily as the configuration itself. Same limit as the journal.
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
- **The status line still lies, and the preview no longer does.** The preview panel
  now reports the programme the browser actually holds. The **status line** above it
  is not yet wired to the installed reality: it can read `READY` while the catch-all
  failed to install. The pane and the line are therefore not equally trustworthy
  today, and the line is the one to distrust. Closing that gap is the next change.

## Supply chain

The extension ships **no third-party code**: no runtime dependency, no bundler,
no CDN. A test fails the build if one appears.

CI never clones an external repository, runs with least-privilege tokens, pins
every action by commit SHA, installs with `--ignore-scripts`, and never exposes a
secret to pull-request code. Releases attest their provenance and publish SHA-256
sums; publication waits behind a protected environment with a human reviewer.

## Supported versions

The latest release. Fixes are not backported.
