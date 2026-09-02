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
text shaped like an issue key — `PAYROLL-3`, `BAN-123`, a project you never
declared — leaves for that Jira instance and lands in its access logs as
`/browse/PAYROLL-3`. That is a real outbound flow, and it is the extension that
creates it, so it is stated here rather than left for you to discover. Two things
bound it: a catch-all accepts the hyphen only, so `SALARY 2024` and `WINDOWS 11`
never leave; and a closed list of reserved prefixes (`ISO`, `CVE`, `COVID`, `WD`
and forty-five more, 49 in all) is left alone. The list is a mitigation, never a
completeness claim — `MP3-320` and `X1-9` are key-shaped and will be caught.

Two records live in **local storage only**, never synced and never exported, for
the same reason the journal does — *a control that travels by the channel it is
meant to watch is worthless*:

- **Which catch-all warnings you accepted.** Keyed by the shortcut, its
  destination and its nature. It stays local so that a compromised browser
  account cannot accept a universal redirect on your behalf. The consequence is
  visible: on a second device you accept the warning again.
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
