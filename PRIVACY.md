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
of when a destination changed.

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
