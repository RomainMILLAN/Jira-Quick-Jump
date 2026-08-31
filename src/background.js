/**
 * The SINGLE WRITER of the rules. The UI only ever writes the policy.
 */
(function (global) {
  "use strict";

  if (typeof importScripts === "function") {
    importScripts(
      "platform.js",
      "core/mutation-result.js",
      "core/reserved-prefix.js",
      "core/issue-reference.js",
      "core/shortcut-warning.js",
      "core/consent.js",
      "core/project-shortcut.js",
      "core/catch-all-key.js",
      "core/shortcut-key.js",
      "core/shortcut-id.js",
      "core/shortcut-registry.js",
      "core/custom-engine.js",
      "core/jump-policy.js",
      "core/policy-diff.js",
      "core/admission.js",
      "interception/search-engine-catalog.js",
      "interception/reference-pattern.js",
      "interception/rule-ranking.js",
      "interception/rule-set.js",
      "interception/rule-factory.js",
      "interception/origin-requirements.js",
      "interception/jump-preview.js",
      "versioned-entry.js",
      "stored-policy.js",
      "key-acknowledgements.js",
      "installed-projection.js",
      "policy-repository.js",
      "destination-journal.js",
      "rule-installer.js"
    );
  }

  const { Platform, PolicyRepository, DestinationJournal, RuleInstaller, JumpPolicy,
          InstalledProjection, PolicyDiff } = global;
  const api = Platform.api;

  let lastReport = null;

  /**
   * FAIL CLOSED when the policy cannot be read.
   *
   * It used to `return` on a failed load, which left THE PREVIOUS RULES ALIVE
   * while refreshBadge -- reading the policy rather than the installed reality --
   * printed `off` over them. Disarming a compromised shortcut then stopped
   * propagating. So: empty the rules, and say so on screen.
   */
  const sync = async () => {
    const loaded = await PolicyRepository.load();
    if (!loaded.ok) {
      try {
        const existing = await api.declarativeNetRequest.getDynamicRules();
        await api.declarativeNetRequest.updateDynamicRules({
          removeRuleIds: existing.map((r) => r.id),
          addRules: [],
        });
      } catch {
        /* nothing better to do: the rules stay as they are and the badge says so */
      }
      lastReport = null;
      return;
    }
    const policy = loaded.stored.policy();
    await reconcile(policy);
    lastReport = await RuleInstaller.install(policy, loaded.stored.quarantinedCount());
    // AFTER reconciliation, and NOT AT ALL if the install failed -- a stale
    // comparison base would re-diff the same gap at every wake-up and fill a
    // twenty-entry journal with duplicates.
    if (lastReport && lastReport.diagnosis !== "INSTALL_FAILED") {
      await InstalledProjection.record(policy, await DestinationJournal.lastLoggedRev());
    }
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
    const { policy: previous, loggedRev } = await InstalledProjection.read();
    if (!previous) {
      // ABSENT means the detector has no baseline -- a wiped storage.local, a
      // fresh profile, a new device. Returning here would move the in-memory hole
      // thirty lines rather than close it, so an armed non-empty policy is
      // reported as an unattributed change instead of being swallowed.
      if (policy.armed() && policy.shortcuts().length > 0) {
        await DestinationJournal.record(
          [{ type: "PolicyReplaced", changedCount: policy.shortcuts().length }],
          0,
          "UNKNOWN",
          Date.now()
        );
        await refreshBadge();
      }
      return;
    }
    // THE SAME function as the door. One implementation, one corpus, and both
    // paths of the trust model covered -- the door and the window.
    const facts = PolicyDiff.between(previous, policy);
    if (facts.length > 0) {
      await DestinationJournal.record(facts, loggedRev, "UNKNOWN", Date.now());
      await refreshBadge();
    }
  };

  /**
   * The badge reads the INSTALLED REALITY, not the intention.
   *
   * Deriving it from policy.armed() is what let an emergency stop print `off`
   * over rules that were still live. rule-installer already reports `applied`, so
   * there is one owner of "what is really installed" and two consumers.
   */
  const refreshBadge = async () => {
    const journal = await DestinationJournal.read();
    const applied = lastReport ? lastReport.applied : 0;
    const text = applied === 0 ? "off" : journal.acknowledged ? "" : "!";
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
