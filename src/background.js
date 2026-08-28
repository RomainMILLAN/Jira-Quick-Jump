/**
 * The SINGLE WRITER of the rules. The UI only ever writes the policy.
 */
(function (global) {
  "use strict";

  if (typeof importScripts === "function") {
    importScripts(
      "platform.js",
      "core/mutation-result.js",
      "core/issue-reference.js",
      "core/destination-warning.js",
      "core/consent.js",
      "core/project-shortcut.js",
      "core/shortcut-registry.js",
      "core/jump-policy.js",
      "core/admission.js",
      "interception/search-engine-catalog.js",
      "interception/reference-pattern.js",
      "interception/rule-factory.js",
      "interception/origin-requirements.js",
      "interception/jump-preview.js",
      "versioned-entry.js",
      "stored-policy.js",
      "policy-repository.js",
      "destination-journal.js",
      "rule-installer.js"
    );
  }

  const { Platform, PolicyRepository, DestinationJournal, RuleInstaller, JumpPolicy } = global;
  const api = Platform.api;

  let lastKnown = null;

  const sync = async () => {
    const loaded = await PolicyRepository.load();
    if (!loaded.ok) return;
    await reconcile(loaded.stored.policy());
    lastKnown = loaded.stored.policy();
    await RuleInstaller.install(loaded.stored.policy(), loaded.stored.quarantinedCount());
  };

  /**
   * Emission by the mutation catches what comes through the door; this catches
   * what comes through the window.
   *
   * A compromised sync or a malicious editor writes the storage entry DIRECTLY:
   * storage.onChanged fires, we reload and install, and NO DestinationChanged is
   * emitted because withBaseUrlFor was never called. Without reconciliation two
   * of the five sources would have no producer at all, and the trust model would
   * promise a detection the code does not deliver.
   *
   * An unattributed change is UNKNOWN, which is MORE alarming, and correctly so:
   * a detector must fail by over-signalling, never by under-signalling.
   */
  const reconcile = async (policy) => {
    const previous = lastKnown;
    if (!previous) return;
    const before = new Map(previous.shortcuts().map((s) => [s.id(), s]));
    const events = [];
    for (const shortcut of policy.shortcuts()) {
      const old = before.get(shortcut.id());
      if (!old) continue;
      // Whole baseUrl, never the origin: with a path allowed in the base URL,
      // .../jira -> .../jira-fake shares an origin and would be a non-event.
      const oldBaseUrl = old.instance().baseUrl();
      const newBaseUrl = shortcut.instance().baseUrl();
      if (oldBaseUrl !== newBaseUrl) {
        events.push({ shortcutId: shortcut.id(), key: shortcut.key().toString(), oldBaseUrl, newBaseUrl });
      }
    }
    if (events.length > 0) {
      await DestinationJournal.record(events, 0, "UNKNOWN", Date.now());
      await refreshBadge();
    }
  };

  const refreshBadge = async () => {
    const journal = await DestinationJournal.read();
    const loaded = await PolicyRepository.load();
    const armed = loaded.ok && loaded.stored.policy().armed();
    const text = !armed ? "off" : journal.acknowledged ? "" : "!";
    try {
      await api.action.setBadgeText({ text });
    } catch {
      /* no action in some contexts */
    }
  };

  api.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === "install") api.runtime.openOptionsPage();
    if (details.reason === "update") await api.storage.local.set({ updatedBanner: true });
    await sync();
    await refreshBadge();
  });

  api.runtime.onStartup.addListener(async () => {
    await sync();
    await refreshBadge();
  });

  PolicyRepository.onPolicyChanged(async () => {
    await sync();
    await refreshBadge();
  });

  // A genuine domain event from the platform: without it, granting access from
  // the options page would install no rule and the extension would look broken
  // until the browser restarts.
  api.permissions.onAdded.addListener(() => sync());
  api.permissions.onRemoved.addListener(() => sync());

  if (api.commands) {
    api.commands.onCommand.addListener(async (command) => {
      if (command !== "disarm-all") return;
      await PolicyRepository.apply((stored) => {
        const policy = stored.policy();
        return global.MutationResult.ok(stored.withPolicy(policy.armed() ? policy.disarm() : policy.arm()));
      });
      await sync();
      await refreshBadge();
    });
  }

  global.JiraQuickJumpBackground = { sync, reconcile, refreshBadge };
})(globalThis);
