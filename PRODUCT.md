# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Developers who work across **several Jira instances** at once — an agency,
a contractor, or anyone splitting their week between clients — and who type
issue keys dozens of times a day. They already know the key by heart; the
lookup is pure friction.

## Product Purpose

Typing `ABC-1234` in the address bar lands on the issue. No keyword, no tab
key, no search results page.

Success is the absence of an interaction: the user stops thinking about how to
reach an issue. The extension is doing its job when it is invisible.

## Positioning

Chrome's site search and the `omnibox` API both require a keyword trigger
before the address bar hands anything to an extension. This product does not
compete with them — it uses the one seam they leave: the navigation the browser
builds toward the default search engine when the input is not a URL.
`declarativeNetRequest` rewrites that navigation **before the request is
emitted**, so the issue key never reaches the search engine and no results page
ever paints.

That is also the privacy claim a neighbouring product cannot truthfully copy
without the same mechanism: the search request does not happen.

## Operating Context

- The user is mid-task, in a browser, moving between a chat message and a
  ticket. The interaction budget is under a second.
- Destinations are a mix of Atlassian Cloud and **self-hosted Jira** —
  including plain `http://`, non-standard ports, and instances served under a
  path (`https://intra.example.org/jira`).
- Configuration is edited from two surfaces that are always in reach: a
  full-width options page and a browser-action popup.

## Capabilities and Constraints

- Manifest V3, Chrome and Firefox from one source tree. Vanilla JavaScript, no
  bundler; `src/` must stay loadable unpacked.
- Strict CSP: `default-src 'none'`, `connect-src 'none'`. No remote resource,
  no network request of any kind from the extension.
- Storage is **local by default**; syncing is opt-in and warns that it sends
  internal Jira host names to the browser account.
- A redirect rule requires host access to its destination, so nothing redirects
  until the user grants that origin explicitly.
- **Scope is a v1 boundary, not a permanent stance.** Today: `KEY-123` →
  `<base>/browse/KEY-123`. Search engines are listed one domain at a time,
  four built in and the rest added by the user, so a granted permission never
  covers more than what was ticked. Other
  jump forms are expected later (a project board, a Jira search, subtasks). The
  UI must leave room for a second jump form without being rebuilt.
  The destination **path** stays non-configurable regardless: it is a security
  control, not a limitation. A future jump form adds another *fixed* path, it
  never opens the path to user input.
- Vocabulary, used everywhere including the UI: *issue reference*, *shortcut*,
  *instance*, *armed / disarmed*, *destination* (the whole base URL, never just
  its origin), *engine*, *rule*, *origin*, *quarantine*, *consent*,
  *catch-all* (the shortcut that claims every reference), *shadowed* (a shortcut
  a catch-all placed above it claims first, so it never fires), *reserved prefix*
  (a word a catch-all deliberately does not claim), *projection* (the last
  installed policy, kept locally so a change can be detected across a restart).
  One word per concept: not *wildcard*, not *unreachable*, not *deny-list*.

## Brand Commitments

- Name: **Jira Quick Jump**. Author signature (the animated `RomainMILLAN`
  tag) sits in the options page footer, linking to `romainmillan.fr` with the
  domain visible.
- The visual system is inherited from the author's sibling extension
  `chrome-temporary-tab`: Space Grotesk / Hanken Grotesk / JetBrains Mono,
  indigo `#5b4df5`, paper `#f6f5f2`, and the mint / amber / coral accent trio.

## Evidence on Hand

None. No users, no testimonials, no benchmarks, no install counts — the
extension is unreleased. Future work must not fabricate any.

## Product Principles

1. **The absence of interaction is the feature.** Anything that adds a step to
   the jump itself is a regression; friction belongs on the configuration path
   only.
2. **The product teaches the user not to look at the address bar, so it must
   show the destination somewhere else.** Every surface displays where a
   shortcut sends you, and every change of destination is surfaced before the
   next jump — not after credentials have been typed.
3. **Refuse rather than clean.** A value that cannot be used as written is
   rejected with a specific reason, never silently normalised: the gap between
   what was typed and what gets installed is what an attacker exploits.
4. **Say what does not work, and why.** A configuration that produces no rule
   must explain itself; a rule counter is not an answer to "will typing
   `ABC-1` work?".
5. **Self-hosted is a first-class case, not a fallback.** The awkward
   destinations — `http://`, a port, a path, a private host — are the ones the
   product's own audience actually types.

## Accessibility & Inclusion

**WCAG 2.2 level AA is the binding target**, verified rather than assumed.
The consequences that bite here: state colours (ready / warning / refusal)
must carry contrast and never be the only signal; interactive targets meet the
24×24 CSS px minimum; focus is visible on every control; and motion — the
signature's hover bounce included — respects `prefers-reduced-motion`.

Localisation: the UI ships in **English first, French next**. Copy is written
to pass through `i18n.getMessage` from the start, so no string is assembled by
concatenation and no label depends on English word order.
