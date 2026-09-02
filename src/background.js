/**
 * The SINGLE WRITER of the rules. The UI only ever writes the policy.
 */
(function (global) {
  "use strict";

  if (typeof importScripts === "function") {
    importScripts(
      "platform.js",
      "core/mutation-result.js",
    "core/engine-id.js",
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
    "core/diagnosis.js",
      "core/policy-diff.js",
      "core/admission.js",
      "interception/search-engine-catalog.js",
      "interception/re2-budget.js",
    "interception/not-installed.js",
      "interception/reference-pattern.js",
      "interception/rule-ranking.js",
      "interception/installed-rule.js",
      "interception/rule-set.js",
      "interception/rule-factory.js",
      "interception/origin-requirements.js",
      "interception/jump-preview.js",
      "versioned-entry.js",
      "install-outcome.js",
      "stored-policy.js",
      "key-acknowledgements.js",
      "installed-projection.js",
      "policy-repository.js",
      "destination-journal.js",
      "rule-installer.js"
    );
  }

  const { Platform, PolicyRepository, DestinationJournal, RuleInstaller,
          InstalledProjection, InstallOutcome, PolicyDiff,
          OriginRequirements, SearchEngineCatalog } = global;
  const api = Platform.api;

  /**
   * "SINGLE-WRITER" DESCRIBES A SITE, NOT A SERIALISATION.
   *
   * sync() is RE-ENTRANT: permissions.onAdded does not await its promise, and
   * onPolicyChanged can run alongside. An A that succeeded and then got delayed on
   * InstalledProjection.record -- up to three CAS attempts, which a local attacker
   * can provoke -- may write its receipt AFTER a B that failed: the stale one
   * overwrites the true one. A compare-and-set would change nothing; it protects a
   * concatenation, it does not serialise intentions.
   *
   * Hence this counter: THE RECEIPT IS ABSOLUTE, so the last to leave is not
   * necessarily the last to arrive.
   */
  let syncGeneration = 0;

  /**
   * FAIL CLOSED when the policy cannot be read, AND SAY SO.
   *
   * It used to `return` on a failed load, which left THE PREVIOUS RULES ALIVE
   * while refreshBadge -- reading the policy rather than the installed reality --
   * printed `off` over them. It then emptied the rules but told nobody: the status
   * line kept the previous verdict.
   *
   * THREE ASSIGNMENTS OF `outcome`, NOT TWO. The main fail-closed path is NOT an
   * exception: load() returns { ok: false } AS A VALUE, so an early return
   * traversed the finally with outcome still {} -- the receipt said "I know
   * nothing" where it had LEARNED NO, on the path a compromised sync reaches most
   * easily. "I learned nothing", "I learned no by value" and "I learned no by
   * throw" are THREE PATHS AND TWO FACTS.
   *
   * The fusible that never blew because the current never arrived is not an intact
   * fusible: it is a disconnected meter.
   */
  const sync = async () => {
    let outcome = {};                    // ABSENT is the third term
    let report;                          // LOCAL: no more shared lastReport
    const gen = (syncGeneration += 1);
    try {
      const loaded = await PolicyRepository.load();
      if (!loaded.ok) {
        // FAIL-CLOSED BY VALUE, not by throw: a fact LEARNED, not an ignorance --
        // and this is the path a compromised sync reaches by writing an unreadable
        // policy.
        outcome = { installed: false, coverageSatisfied: false };
        await RuleInstaller.purge();
        // AND IT IS SAID. This path was mute: purge, return, badge to `off`, and
        // not one line in the journal -- on the channel SECURITY.md makes the
        // pivot of detection, along the route a compromised sync reaches most
        // easily. The badge says "nothing fires"; it does not say "what was
        // saved stopped being readable", and those are different sentences.
        //
        // ITS OWN DOOR. There is no readable policy, hence no revision to
        // attribute this to and no claim that could ever cover it. Pushing it
        // through the unclaimed door with `rev: 0` silenced it on a fresh journal
        // -- 0 >= 0 -- so the loudest path in the trust model was mute.
        await DestinationJournal.recordUnclaimable(
          [{ type: "PolicyUnreadable", code: loaded.code }],
          Date.now()
        );
        return;                          // this return TRAVERSES the finally
      }
      const policy = loaded.stored.policy();
      // A NESTED try, because a single one is not enough: a throw inside reconcile
      // would jump to the outer catch, so install would STILL not be reached --
      // the very fault this rewrite exists to fix, moved one level up.
      let detectorIntact = true;
      try {
        detectorIntact = await reconcile(policy);
      } catch {
        detectorIntact = false;
      }
      report = await RuleInstaller.install(policy, loaded.stored.quarantinedCount());
      outcome = {
        installed: report.installed,
        coverageSatisfied: report.coverageSatisfied,
        // The causes reach the page only through here: they are produced during an
        // installation, which only this worker performs.
        skipped: report.skipped,
      };
      // AFTER reconciliation, and NOT AT ALL if the install failed or the detector
      // did -- a stale comparison base would re-diff the same gap at every wake-up
      // and fill a twenty-entry journal with duplicates.
      //
      // The condition NAMES THE THING IT PROTECTS -- "this report comes from an
      // installation" -- instead of saying "a field is missing". And it reads the
      // LOCAL, not a shared mutable.
      // `report.source === "INSTALL"` is DELIBERATELY KEPT, and it cannot open:
      // _install is the only producer of a report on this path, and "PURGE" is
      // unreachable because purge() produces none. It is a CHANGELOCK, not a
      // guard -- the day a factorisation lets another source reach the projection,
      // this is what has to be looked at. Written down so the next reader does not
      // delete it as dead, nor trust it as a live check.
      if (detectorIntact && report.source === "INSTALL" && report.installed === true) {
        // THE RETURN IS DELIBERATELY NOT ACTED UPON, and that is a claim worth
        // being precise about rather than a second omission.
        //
        // A failed write leaves the comparison base stale, which used to mean the
        // next wake-up re-diffed the same gap and refilled the journal with
        // duplicates. It no longer does: recordDivergence consults the journal's
        // own waterline inside its mutation, so a gap the door has already
        // claimed is a NON-DISCOVERY and nothing is written. The stale base costs
        // a recomputation, not a false alarm.
        //
        // What it would cost is a MISSED divergence -- but only for a change that
        // is itself below the waterline, i.e. one already attributed. There is
        // nothing to detect there.
        await InstalledProjection.record(policy);
      }
    } catch {
      outcome = { installed: false, coverageSatisfied: false };   // BEFORE purge, which can throw
      await RuleInstaller.purge();
    } finally {
      // THE try IS WRITTEN, NOT MERELY ANNOUNCED: record() is a BARE set, so it
      // THROWS -- and throwing from a finally would erase the in-flight exception.
      //
      // THE TWO VALUES ARE NOT SYMMETRIC. `false` is ALWAYS safe to write (at worst
      // an over-signalling that persists until the next sync(), which NO TIMER
      // triggers); only `true` needs ordering.
      //
      // DO NOT RE-SYMMETRISE THIS GUARD. Measured scenario: sync #1 writes true;
      // #2 learns false and waits on purge(); #3 starts and bumps the counter; #2
      // reaches its finally, sees gen != syncGeneration and DOES NOT WRITE; #3 is
      // killed by MV3 mid-purge. Both syncs that had learned NO silenced each
      // other, and the receipt still says true. The symmetric guard fabricated the
      // very fail-open this batch exists to close.
      if (outcome.installed === false || gen === syncGeneration) {
        try {
          await InstallOutcome.record(outcome);
        } catch {
          // QUOTA_EXCEEDED lands HERE: `set` dies and READS STAY ALIVE, so without
          // this the STALE `installed: true` receipt reads back perfectly --
          // READY, empty badge, no banner.
          await InstallOutcome.forget();
        }
      }
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
   * An unattributed change is a DIVERGENCE, which is more alarming than an
   * attributed one, and correctly so: a detector must fail by over-signalling.
   *
   * But it must not signal on ordinary use. The door records its attribution
   * right after its commit, and the same write wakes us; without the waterline
   * every rename typed by the user produced a second line labelled UNKNOWN -- the
   * code reserved for compromise -- and the banner cried on the act itself.
   */
  const reconcile = async (policy) => {
    const { policy: previous } = await InstalledProjection.read();
    if (!previous) {
      // ABSENT means the detector has no baseline -- a wiped storage.local, a
      // fresh profile, a new device. Returning here would move the in-memory hole
      // thirty lines rather than close it, so an armed non-empty policy is
      // reported as an unattributed change instead of being swallowed.
      if (policy.armed() && policy.shortcuts().length > 0) {
        // THE RETURN IS INSPECTED. It used to be thrown away, at both sites: a full
        // quota meant NO ENTRY, NO EXCEPTION, projection written -- and the
        // detection window closed FOREVER. CONFLICT_EXHAUSTED is provocable too:
        // three attempts, and a local attacker who already writes storage.local
        // only has to hammer the entry while the worker starts. The channel he
        // compromises and the one that records him ARE THE SAME AREA.
        //
        // The recorder does not break down: it politely answers "tape busy", and
        // nobody was listening to the answer.
        const written = await DestinationJournal.recordUnclaimed(
          [{ type: "PolicyReplaced", changedCount: policy.shortcuts().length }],
          policy.fingerprint(),
          Date.now()
        );
        return written.ok;
      }
      return true;
    }
    // THE SAME function as the door. One implementation, one corpus, and both
    // paths of the trust model covered -- the door and the window.
    const facts = PolicyDiff.between(previous, policy);
    if (facts.length > 0) {
      // The waterline is compared INSIDE the mutation, against the freshly
      // re-read journal -- so a commit the door claimed while we were waking up
      // is seen, and nothing is written. See recordDivergence.
      const written = await DestinationJournal.recordUnclaimed(facts, policy.fingerprint(), Date.now());
      return written.ok;
    }
    return true;
  };

  /** Whether the installed programme can actually fire: a redirect rule without
   *  host access is inert. Its own failure reads as "granted", because the badge
   *  must never print `off` on an ignorance -- `off` is the only one of the three
   *  values that ASSERTS something. */
  const hasEveryOrigin = async () => {
    try {
      const loaded = await PolicyRepository.load();
      if (!loaded.ok) return true;
      const policy = loaded.stored.policy();
      const origins = OriginRequirements.requiredOrigins(policy, SearchEngineCatalog.forPolicy(policy));
      return await Platform.grantedOrigins(origins);
    } catch {
      return true;
    }
  };

  /**
   * The badge reads the INSTALLED REALITY, not the intention.
   *
   * Deriving it from policy.armed() is what let an emergency stop print `off`
   * over rules that were still live.
   *
   * IT NOW ASKS rather than reading a shared mutable. That one change removes at
   * once: lastReport as the badge's source, the implicit ordering
   * sync() -> refreshBadge() that nothing wrote down, and the two refreshBadge()
   * calls INSIDE reconcile that flashed `off` on a cold worker -- at the exact
   * moment the badge was detecting a compromise.
   *
   * THE WHOLE BODY IS GUARDED. DestinationJournal.read() used to sit OUTSIDE the
   * try, with only setBadgeText swallowed -- and a throw from inside a finally
   * ERASES the in-flight exception while never reaching setBadgeText.
   *
   * The fallbacks carry their DIRECTION: an unreadable journal means NOT
   * acknowledged; an UNKNOWN count NEVER means `off`, because `off` is the only
   * one of the three values that ASSERTS something.
   */
  const refreshBadge = async () => {
    // `!` stays a symbol on purpose -- it is punctuation, not a word -- but `off`
    // was an ENGLISH WORD shown to every reader, with no key of its own. And the
    // badge carried neither colour nor tooltip: the only permanently visible
    // surface of this extension said "!" with no way to learn what it meant.
    let text = "!";
    try {
      let journal = { acknowledged: false };
      try {
        journal = await DestinationJournal.read();
      } catch {
        /* the proof is unreadable: NOT acknowledged, never the reassuring branch */
      }
      const applied = await RuleInstaller.installedRuleCount();
      // RULES WITHOUT ACCESS FIRE NOTHING, and the badge said nothing about it.
      // Revoking a host relaunches sync(), which correctly REINSTALLS the rules --
      // a DNR redirect without host access simply never fires, and becomes live
      // again on its own the moment permission returns. But the badge counted
      // those rules and printed the reassuring empty text, so the one surface
      // that is always visible claimed everything was fine while not a single
      // jump could happen.
      const granted = await hasEveryOrigin();
      text = applied === 0 || !granted ? Platform.t("badgeOff", "off") : journal.acknowledged ? "" : "!";
    } catch {
      /* the count is unknown: `text` keeps its initial "!" */
    }
    try {
      await api.action.setBadgeText({ text });
      // The tooltip is what makes the badge readable at all, and the colour is a
      // second signal beside it -- never the only one, since the text says it too.
      if (api.action.setTitle) {
        await api.action.setTitle({
          title: text === ""
            ? Platform.t("badgeReady", "Quick Jump for Jira: shortcuts are active.")
            : text === "!"
              ? Platform.t("badgeUnseen", "Quick Jump for Jira: a destination changed. Open the options to check it.")
              : Platform.t("badgeOffTitle", "Quick Jump for Jira: nothing is redirecting right now."),
        });
      }
      if (api.action.setBadgeBackgroundColor) {
        await api.action.setBadgeBackgroundColor({ color: text === "!" ? "#b3372c" : "#6a7370" });
      }
    } catch {
      /* no action in some contexts */
    }
  };

  /**
   * ONE listener protocol, THE KILL SWITCH INCLUDED.
   *
   * The INNER try is indispensable: without it a body that rejects prevents
   * sync() -- the exact fault sync() fixes, redone one level up. Real case:
   * onInstalled with reason === "update" does a storage.local.set that rejects on
   * a full quota, and the update then INSTALLS NOTHING, RECONCILES NOTHING,
   * JOURNALS NOTHING.
   *
   * commands.onCommand comes IN, with a guard: its body returns false when the
   * command is not disarm-all. Leaving it OUT would make THE KILL SWITCH THE ONLY
   * LISTENER WITHOUT THE PROTOCOL -- a throw from sync() would skip the badge, the
   * old rules would stay alive (a DNR rejection is atomic), and the screen would
   * keep its previous text, possibly empty, i.e. "all is well". The user presses
   * the emergency stop, the redirects keep departing, and nothing says so.
   *
   * The throw from sync() is NOT caught, and that is deliberate: loud.
   */
  const onEvent = (body) => async (...args) => {
    try {
      let proceed = true;
      try {
        proceed = (await body(...args)) !== false;
      } catch {
        /* the body is INCIDENTAL: syncing matters more than what triggered it */
      }
      if (proceed) await sync();
    } finally {
      await refreshBadge();
    }
  };

  // An update writes NOTHING here. It used to set `updatedBanner: true`, an entry
  // with no reader anywhere in the project -- and the try inside onEvent was
  // justified, in writing, by the risk of THAT write being rejected. A storage
  // entry nobody reads is a claim nobody can check; the sync() that onEvent runs
  // afterwards is what an update actually needs.
  api.runtime.onInstalled.addListener(onEvent(async (details) => {
    if (details.reason === "install") api.runtime.openOptionsPage();
  }));

  api.runtime.onStartup.addListener(onEvent(async () => {}));

  PolicyRepository.onPolicyChanged(onEvent(async () => {}));

  // A genuine domain event from the platform: without it, granting access from
  // the options page would install no rule and the extension would look broken
  // until the browser restarts.
  api.permissions.onAdded.addListener(onEvent(async () => {}));
  api.permissions.onRemoved.addListener(onEvent(async () => {}));

  if (api.commands) {
    api.commands.onCommand.addListener(onEvent(async (command) => {
      // `return false` SAYS what the bare return meant. And the badge is refreshed
      // either way, which is correct: after a refused disarm-all nothing changed;
      // after a disarm-all whose sync() threw, it MUST change.
      if (command !== "disarm-all") return false;
      await PolicyRepository.apply((stored) => {
        const policy = stored.policy();
        return global.MutationResult.ok(stored.withPolicy(policy.armed() ? policy.disarm() : policy.arm()));
      });
      return true;
    }));
  }

  global.JiraQuickJumpBackground = { sync, reconcile, refreshBadge };
})(globalThis);
