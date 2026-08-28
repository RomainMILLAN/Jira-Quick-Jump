# Installing Quick Jump for Jira

There is no store listing yet, so installation is manual. Both browsers are
covered below, plus the pinned self-hosted route, which is the right one for a
team.

> **In short.** Chrome: unzip, then load the folder unpacked. Firefox: install the
> signed `.xpi` from a release — an unsigned folder only survives until you close
> the browser.

---

## Google Chrome, Edge, Brave, Opera

1. Download `quick-jump-for-jira-chrome-<version>.zip` from
   [Releases](https://github.com/RomainMILLAN/Jira-Quick-Jump/releases), or build
   it with `npm run build:chrome`.
2. Unzip it somewhere **permanent** — `~/Applications/quick-jump-for-jira`, not
   Downloads. Chrome re-reads the folder at every start; if it disappears, the
   extension breaks.
3. Open `chrome://extensions`.
4. Turn on **Developer mode**, top right.
5. **Load unpacked**, and select the folder that *contains* `manifest.json`.

Chrome shows a "disable developer mode extensions" banner at every start. Only a
store listing removes it.

## Mozilla Firefox

Firefox refuses unsigned extensions permanently, so there are two routes.

**Signed `.xpi`, permanent.** Download the `.xpi` from a release and open it in
Firefox. It installs like any add-on and updates itself if it was published with
an update URL.

**Unpacked, temporary.** For development only: `about:debugging#/runtime/this-firefox`
→ **Load Temporary Add-on** → pick `src/manifest.json`. It disappears when you
close Firefox.

Requires Firefox **140** or later on desktop, **142** on Android. Both floors come
from the manifest declaring that the extension collects no data.

## Verify what you installed

Every release publishes SHA-256 sums and a build provenance attestation.

```bash
sha256sum -c SHA256SUMS
gh attestation verify quick-jump-for-jira-chrome-<version>.zip -R RomainMILLAN/Jira-Quick-Jump
```

Then check the permissions the browser actually granted, on the extension's own
page. You should see exactly two: **declarativeNetRequestWithHostAccess** and
**storage**, plus the individual hosts you allowed. If you ever see access to all
sites, something is wrong — refuse it and open an issue.

## For a team: pin a build

Installing from a store means trusting the store with every future update. For a
team, pinning is stronger.

**Firefox.** Sign the `.xpi` on AMO's `unlisted` channel (`make sign-firefox`),
host it yourself, and serve an update manifest with `update_hash`. Updates are
then pinned by digest and the store leaves the trust chain entirely.

**Chrome.** Use the `ExtensionSettings` enterprise policy with your own
`update_url` and `minimum_version_required`.

## Update, and uninstall

Chrome: replace the folder's contents, then press reload on the extension card.
Firefox: install the newer `.xpi` over the old one.

Uninstalling removes everything: the configuration lives in the browser's
extension storage and nothing is written anywhere else. If you had switched
storage to **sync**, remember that copies may still exist on your other devices —
switch back to *This device only* first, which actively removes the synced entry.
