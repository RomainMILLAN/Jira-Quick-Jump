# Privacy

**Quick Jump for Jira collects nothing, sends nothing, and has no server.**

There is no analytics, no telemetry, no crash reporting, no account, and no
network endpoint belonging to this project. What follows is how you can check
that rather than take my word for it.

## What it makes verifiable

**The extension cannot make a network request.** Its pages declare
`connect-src 'none'`, which makes `fetch`, XHR, WebSocket and `sendBeacon`
impossible from them; the background script contains no request API at all, and a
test in the repository fails the build if one appears. Everything it needs —
fonts, icons, styles — is bundled.

**It has no permission to read your browsing.** It asks for exactly two:
`declarativeNetRequestWithHostAccess` and `storage`. It has no `tabs`, no
`history`, no `webNavigation`, no `cookies`, and no content script, so there is
no mechanism by which it could see the pages you visit. Host access is requested
per host, by name, and never for all sites.

**What the manifest declares, as opposed to what it asks.** A self-hosted Jira can
be at any address, and a match pattern cannot be written after the fact — so
`optional_host_permissions` declares `http://*/*` and `https://*/*`. That is a
*ceiling*, not a request: the extension only ever calls `permissions.request` with
the origins derived from your own configuration — your Jira hosts and the search
domains you ticked — and a test pins that it never asks for a wildcard.

**That sentence used to be false, and the test it invokes is the part that was
wrong.** `new URL()` accepts `*` as a host character, so a destination written
`https://*` parsed like any other: no forbidden host, no port, no bracket, a
canonical form, pure ASCII. The origin derived from it was then the *ceiling
itself* — the very string this manifest declares — and a browser does not refuse
that, it grants it. `https://*.corp.example` did the same for one company's whole
subdomain tree, and it carried no warning at all: it has a dot, it is not an IP,
it is not punycode. A shared configuration file could therefore put a wildcard in
front of you as an ordinary-looking destination, and the next time you pressed
*Grant access* — the button this extension asks you to press — you would hand it
access to every site. Nothing had to fire for that to cost you something: a
granted permission is not revoked when a later version asks for less.
The three tests that claimed to prevent it all fed the check a configuration
*they had built themselves*, out of clean host names. They asserted that clean
input produces clean output, which is true and is not the question. A host is now
required to be a plain sequence of domain labels — no wildcard, no underscore, no
empty label — refused in the field you type it in, and the test walks every
hostile address this project has ever been shown, through the import door, to the
one function that produces what is asked for.

The consequence of the ceiling itself, said plainly rather than left to be
discovered: because the joker is declared, both browsers offer you a switch to
grant access to every site by hand — Firefox in *about:addons → Permissions*,
Chrome in *chrome://extensions → Site access → On all sites*. Turning it on
activates nothing extra — a redirect rule exists only for a host you configured,
so there is no rule for any other site to fire — but the switch is there, and this
page would be wrong not to mention it.

**Redirection is declarative.** Rules are handed to the browser, which applies
them. The extension never observes a request; it cannot, and the rules it
installed are inspectable.

## What it stores, and where

Your shortcuts — issue keys and their Jira base URLs — plus which engines you
selected and what you acknowledged. Also a short journal, capped at 20 entries,
of when a destination changed, and two small local records described below.

When the journal is full, what it sacrifices is written down rather than left to
chance: changes **you** made go first, oldest first, and a change nobody claimed
is the last to go — the oldest of those last of all, because that one dates the
event. If anything at all had to be dropped, the banner says so and keeps saying
it: the missing evidence does not come back.

**A catch-all sends more than you might expect.** With a catch-all armed, *any*
text shaped like a **short** issue key — `BAN-123`, `GAIN-42`, a project you never
declared — leaves for that Jira instance and lands in its access logs as
`/browse/BAN-123`. That is a real outbound flow, and it is the extension that
creates it, so it is stated here rather than left for you to discover. Three
things bound it: a catch-all claims keys of **2 to 6 characters** only, so
`PAYROLL-3` goes through untouched and a longer key has to be declared by name; it
accepts the hyphen only, so `SALARY 2024` and `WINDOWS 11` never leave; and a
closed list of reserved prefixes (`ISO`, `CVE`, `COVID`, `WD` and forty-five more,
49 in all) is left alone. The list is a mitigation, never a completeness claim —
`MP3-320` and `X1-9` are key-shaped, short, and will be caught.

Two records live in **local storage only**, never synced and never exported, for
the same reason the journal does — *a control that travels by the channel it is
meant to watch is worthless*:

- **Which warnings you accepted — all of them.** Keyed by the shortcut, its
  destination and its nature. It stays local so that a compromised browser
  account cannot accept a universal redirect, *or an insecure or look-alike
  destination*, on your behalf. The consequence is visible: on a second device
  you accept the warning again.
  This used to hold the catch-all's warning only. The others — that a
  destination is plain `http`, that its host name uses non-ASCII characters that
  may imitate another, that it is an IP address or a private one — were written
  *into* the configuration, so they travelled to your browser account the moment
  you turned sync on. A configuration written there claiming you had accepted
  them produced a live, accepted shortcut with no screen and no click. All four
  now live here, beside the catch-all's, and a configuration read from sync is
  believed about *what* it points at and never about *what you were shown*.
- **The last policy that was installed**, so that a change made while the
  extension was not running still raises a banner. It holds the same Jira host
  names as your configuration, which means those host names exist in two local
  records rather than one.

**Storage is local to the device by default.** It never leaves your browser
profile.

You can switch it to **sync**, and the setting says plainly what that means: your
Jira host names and project keys travel to your Google or Mozilla account, and
replicate to every browser you are signed into. Internal host names are
infrastructure mapping and project keys are often customer names, so this is off
unless you turn it on. Switching back to local actively removes the synced entry,
though copies already replicated to other devices or to the provider's backups
may survive.

The destination journal is **always local**, never synced and never exported. A
journal that travelled by the channel it is meant to watch would be worthless.

**Why the Firefox manifest declares no data collection**, given the paragraph
above. `browser_specific_settings.gecko.data_collection_permissions` is
`["none"]`, and that is deliberate rather than an omission: nothing is collected
by, or transmitted to, this extension's author or any third party of its choosing
— there is no endpoint to send it to (`connect-src 'none'`, and no request API in
the background script). Turning on sync does send your configuration somewhere,
but it goes to **your own browser account**, through the browser's own sync, under
Google's or Mozilla's terms rather than anyone's here; the schema has no value
describing that, and the setting states the consequence in the interface where it
is turned on. If a store reviewer reads this differently, the declaration is what
should change — not this page.

## What it does not protect you from

**Search suggestions.** As you type in the address bar, your browser sends
keystrokes to your default search engine's *suggestion* service — a separate
endpoint, over a channel no extension can intercept. If suggestions are enabled,
which is the default in both browsers, `ABC-1234` reaches Google character by
character before you press Enter, whether or not this extension is installed.

This extension removes the search *request* and the results page. It does not and
cannot remove the suggestion traffic. Turning suggestions off is the only real
remedy:

- Chrome: `chrome://settings` → *Sync and Google services* → **Autocomplete
  searches and URLs**, off.
- Firefox: *Settings → Search* → **Provide search suggestions**, off.

Saying otherwise would make this document false, so it says this.

## Data requests

There is nothing to request, correct or delete: no data reaches me. Everything
lives in your browser and uninstalling removes it.

Questions: [SECURITY.md](SECURITY.md) has the contact.
