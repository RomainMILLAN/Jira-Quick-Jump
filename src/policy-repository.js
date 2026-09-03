/**
 * How the policy is stored. Nothing more -- in particular, NOT the journal:
 * that has its own lifecycle and its own reason to change, and background.js is
 * already the single writer.
 */
(function (global) {
  "use strict";

  const { Platform, VersionedEntry, StoredPolicy, JumpPolicy, MutationResult, ShortcutAdmission } = global;
  const ENTRY = "policy";

  const PolicyRepository = {
    async load() {
      // WHICH AREA, ASKED ONCE. It used to be two calls -- storageArea() and
      // storageAreaName() -- and storageArea() is itself storageAreaFor(await
      // storageAreaName()), so that was two reads of the same storage key on a
      // path the debounce walks at every keystroke. The NAME is the primitive
      // answer; the handle derives from it, through the facade that owns both.
      //
      // It also removes a window that was small and real: two independent reads
      // could straddle a migration and hand _restore the handle of one area with
      // the name of the other -- which is precisely the pair whose disagreement
      // decides whether a saved acknowledgement is believed.
      const areaName = await Platform.storageAreaName();
      const area = Platform.storageAreaFor(areaName);
      // READ ONCE, BEFORE any compare-and-set. _restore is synchronous and runs
      // inside a replayed mutate closure, so it can never await this itself.
      const acknowledgements = await global.LocalAcknowledgements.read();
      // THE REVISION TRAVELS. It was refused here, so reconcile received a
      // waterline it could only rewrite, never compare against -- which is why
      // `loggedRev` was decorative and every ordinary edit produced a duplicate
      // fact labelled UNKNOWN, the code reserved for compromise.
      const { value } = await VersionedEntry.read(area, ENTRY);
      // NO ENVELOPE FACT TRAVELS. The window asks the journal "has this CONTENT
      // been claimed", and the content is the policy itself -- see
      // JumpPolicy.fingerprint. A revision and a writer token are fields the
      // hostile channel can read and copy, which is exactly how the first version
      // of this guard was defeated.
      return this._restore(value, acknowledgements, areaName);
    },

    /**
     * The separate context of key-scoped acknowledgements is CLOSED BACK HERE,
     * before the aggregate exists.
     *
     * Merging them at reconstitution is what lets activeBindings() keep its
     * signature: injecting the store into the keystone instead would make it
     * parameterised, and rule-factory, jump-preview, origin-requirements and the
     * badge could then each pass a different set. A cell whose organelles must be
     * supplied from outside is no longer a cell.
     */
    // NO OBJECT-LITERAL DEFAULT. It was `= {}`, left over from the table this
    // used to be, and _merge now asks it for kindsFor() -- so the default
    // GUARANTEED a TypeError. Dormant, because both callers pass the argument;
    // an offer that crashes whoever accepts it, exactly like the SVG tags that
    // had no attributes. An empty Acknowledgements says what the file already
    // says: absent means not attested.
    _restore(
      value,
      acknowledgements = global.LocalAcknowledgements.Acknowledgements.admitting(undefined),
      // THE AREA, and it DEFAULTS TO "sync" -- the distrusting answer. Same
      // shape as trustsSavedConsent's own default: a caller that forgets loses a
      // click, never a control. Spelled as an area rather than a boolean because
      // that is what this layer holds; the core receives the answer, never the
      // reason.
      areaName = "sync"
    ) {
      if (value === undefined) return { ok: true, stored: StoredPolicy.empty(), refused: [], unreadable: [] };
      const restored = JumpPolicy.restore(value.policy === undefined ? value : value.policy, {
        // ONLY THE LOCAL AREA IS BELIEVED about what a user was shown. A synced
        // document is written by an account, not by this browser: see
        // Consent.toJSON for the measured attack this closes.
        trustsSavedConsent: areaName === "local",
      });
      if (!restored.ok) return restored;
      const merged = this._merge(restored.policy, acknowledgements);
      // THE CAP APPLIES TO WHAT COMES FROM STORAGE TOO.
      //
      // MAX_QUARANTINE guarded only the entries THIS read produced; the array
      // already in storage was taken as it stood, then written back by toJSON at
      // every commit. A hundred thousand entries were accepted, re-counted on
      // every load, re-persisted on every write, and fed quarantinedCount ->
      // PARTIAL_POLICY. Unbounded growth on the least trustworthy field in the
      // system, guarded by a constant that looked like it covered it.
      //
      // The entries we just refused come FIRST: they are this read's news, and
      // the ones already on file have had their chance to be repaired.
      const stored = Array.isArray(value.quarantine) ? value.quarantine : [];
      const quarantine = [...restored.quarantine, ...stored].slice(0, ShortcutAdmission.MAX_QUARANTINE);
      const folder = new StoredPolicy(merged, quarantine);
      // THE INVARIANT IS REPAIRED HERE, where both halves are in hand: an entry
      // in the policy AND in quarantine is an entry that was readmitted on
      // another device while this one still held the old copy. The policy wins --
      // it is the repaired form -- and the stale shadow goes, or the user would
      // face a row asking to be fixed that is already fixed.
      const shadows = new Set(folder.duplicatedIds());
      return {
        ok: true,
        stored: shadows.size === 0
          ? folder
          : new StoredPolicy(merged, quarantine.filter((raw) => !(raw && shadows.has(raw.id)))),
        refused: restored.refused,
        // Document-scoped facts, carried separately from refused entries. They
        // have no reader on screen yet; that is named dette, not an oversight --
        // see the arming-state note in admission.js.
        unreadable: restored.unreadable ?? [],
      };
    },

    _merge(policy, acknowledgements) {
      let merged = policy;
      for (const shortcut of policy.shortcuts()) {
        // The table answers about a shortcut; the caller no longer spells the row
        // key. It was `acknowledgements[rowKey(shortcut)]` -- an object literal
        // indexed by a string that comes from storage, which is the very access
        // ShortcutRegistry refuses two files away.
        for (const kind of acknowledgements.kindsFor(shortcut)) {
          const next = merged.acknowledge(shortcut.id(), kind);
          if (next.ok) merged = next.value;
        }
      }
      return merged;
    },

    /**
     * `apply` is not a `save` -- it is a command handler. Calling it `save` would
     * invite the next person to add save(policy) and reopen the lost-update bug.
     *
     * The intention is REPLAYED on conflict, so it must be idempotent; and the
     * whole folder -- policy AND quarantine -- is re-read on every attempt, never
     * memorised at load time, or the surface holding the older snapshot would
     * resurrect the entry the other one just deleted.
     */
    async apply(intention) {
      // ONE read, and the handle derived from it: see load() above.
      const areaName = await Platform.storageAreaName();
      const area = Platform.storageAreaFor(areaName);
      const acknowledgements = await global.LocalAcknowledgements.read();
      let committed;
      const result = await VersionedEntry.update(area, ENTRY, (value) => {
        const restored = this._restore(value, acknowledgements, areaName);
        if (!restored.ok) return restored;
        const outcome = intention(restored.stored);
        if (!outcome.ok) return outcome;
        committed = outcome.value;
        // THE SINGLE PRODUCER, computed here from the RE-READ value -- hence up
        // to three times, and only the winning attempt survives. Safe because it
        // is PURE: calculating is not journaling.
        const facts = global.PolicyDiff.between(restored.stored.policy(), outcome.value.policy());
        return { ok: true, value: outcome.value.toJSON(), events: facts };
      });
      // Written AFTER the winning commit, by the same single writer as the
      // journal: a key-scoped acknowledgement never travels with the policy.
      if (result.ok && committed) await global.LocalAcknowledgements.record(committed.policy());
      // THE COMMITTED FOLDER TRAVELS OUT. The caller claims a fingerprint before
      // committing -- speculatively, against its own stale snapshot -- and the CAS
      // may replay the intention on a fresher base and commit something else. Then
      // the ring holds a claim for a state nobody reached, the real state is
      // unclaimed, and the window reports the user's own edit as UNKNOWN: the very
      // false alarm claiming-ahead exists to close, one layer up.
      return result.ok && committed ? { ...result, committed } : result;
    },

    /**
     * Moving between storage areas is explicit, one direction at a time.
     *
     * Leaving sync REMOVES the entry rather than abandoning it: the point of
     * switching to local is that the host names stop living in the browser
     * account. Copies already replicated to other devices or to the provider's
     * backups may survive, and the UI says so rather than implying otherwise.
     *
     * FOUR THINGS WERE WRONG HERE, and they were wrong together:
     *
     *   The envelope was written BY HAND -- `to.set({ [ENTRY]: { rev: 1, value } })`
     *   -- while versioned-entry.js justifies put() on three paragraphs of "a
     *   client that wrote it by hand would pierce this membrane from one side
     *   while believing in it from the other". The first client to do exactly
     *   that was the file next door.
     *
     *   `rev: 1` was hard-coded, so migrating INTO an area that already held rev 7
     *   walked its revision backwards. A concurrent update that had read 7 then
     *   wrote 8, saw 7+1, and reported SUCCESS while overwriting the migration.
     *
     *   The area was switched BEFORE the copy, so any load() landing in between
     *   read the new, empty area -- StoredPolicy.empty() -- and a sync() slipping
     *   through that window installed ZERO RULES.
     *
     *   The rollback GUESSED the previous area from the target rather than
     *   remembering it, three lines below where `from` was in scope.
     *
     * And one thing was missing: switching areas has to be FELT. If the source
     * was empty, nothing was written, storage.onChanged never fired on the policy
     * key, and the worker kept serving the rules of the area we just left.
     */
    async migrateTo(target) {
      const fromName = await Platform.storageAreaName();
      if (fromName === target) return MutationResult.ok(target);
      const from = await Platform.storageArea();
      const { value } = await VersionedEntry.read(from, ENTRY);
      // NOT awaited: storageAreaFor is synchronous, and the two call sites above
      // now say so. An `await` on a plain value is harmless and reads as a
      // promise the facade does not return.
      const to = Platform.storageAreaFor(target);

      // COPY FIRST, SWITCH AFTER. A reader arriving mid-migration must find the
      // old area still in charge, never an empty new one.
      try {
        // put() and never a hand-written envelope -- and the revision CLIMBS from
        // whatever the destination already holds, so a concurrent writer there
        // cannot mistake our write for the one it made itself.
        const existing = await VersionedEntry.read(to, ENTRY);
        await VersionedEntry.put(to, ENTRY, value, existing.rev + 1);
      } catch (error) {
        return MutationResult.refused("QUOTA_EXCEEDED", String(error));
      }

      await Platform.setStorageArea(target);

      /**
       * AND THE WORKER IS WOKEN AFTER THE SWITCH, not only before it.
       *
       * The copy above fires storage.onChanged, which wakes sync() -- but at that
       * instant `storageArea` still names the OLD area, so sync() reloads from the
       * area we are leaving and reinstalls its rules. The switch that follows
       * changes nothing anyone is listening to: the `storageArea` key is watched by
       * no one (the listener below filters on ENTRY alone, deliberately, because it
       * must not care which area an entry came from).
       *
       * A second write to the SAME bytes would fire nothing -- storage.onChanged is
       * byte-driven -- so the revision climbs instead. That is a touch, not a
       * change: the value is the one we just wrote.
       *
       * The gain is bounded and honest: without it the window closes at the next
       * ordinary edit anyway, and the stale rules are the user's OWN previous ones.
       * Nothing an adversary chooses.
       */
      try {
        const settled = await VersionedEntry.read(to, ENTRY);
        await VersionedEntry.put(to, ENTRY, settled.value, settled.rev + 1);
      } catch {
        // A touch we cannot land leaves the area switched and the rules stale until
        // the next edit -- the pre-existing behaviour, never worse.
      }

      // BOTH DIRECTIONS ARE CLEANED. Only sync -> local removed the source, so
      // migrating INTO sync left a full copy of the host names in local -- the
      // very residue the other direction exists to avoid, and PRIVACY.md did not
      // mention it.
      try {
        await from.remove(ENTRY);
      } catch {
        // A source we cannot clear is a copy left behind, not a failed migration:
        // the policy is already in place and in charge.
      }
      return MutationResult.ok(target);
    },

    /**
     * THE AREA IN CHARGE, AND ONLY IT.
     *
     * This used to fire on `policy` changing in EITHER area, with the reason
     * "it must not care which area an entry came from". That is right about
     * READING -- load() asks the facade which area is in charge and reads only
     * that one -- and wrong about WAKING: an entry in the area we do not use
     * changes nothing we will read, and it was still starting the service
     * worker, reloading the policy, and REPLACING EVERY DYNAMIC RULE.
     *
     * So, on a profile storing locally (the default), the compromised sync
     * account this whole module models could write `sync["policy"]` in a loop
     * and get, per write and for free: a worker wake-up, a getDynamicRules, a
     * wholesale updateDynamicRules, three storage.local writes (projection,
     * receipt, journal), and a full re-render of every open surface through the
     * InstallOutcome doorbell. No confidentiality or integrity loss -- nothing
     * it wrote is ever read -- but battery, write quota and an interface that
     * will not sit still, from the one channel named hostile.
     *
     * InstallOutcome.onRecorded filters its area with these very words ("without
     * the filter, any writer of storage.sync would wake every open page"). This
     * is the same filter, and the asymmetry was unintentional.
     *
     * AND IT REPAIRS migrateTo RATHER THAN BREAKING IT. That method's own header
     * describes the window this closes: the copy into the target area fires
     * onChanged BEFORE `storageArea` names the target, so sync() reloaded from
     * the area being LEFT and reinstalled its rules. With this filter that wake
     * is correctly ignored, and the deliberate second put -- after the switch,
     * already there -- becomes the one that lands. The `from.remove(ENTRY)` that
     * follows is ignored too, which is right: it is the area we just left.
     *
     * THE READ IS AWAITED INSIDE THE LISTENER, so a change is dropped only after
     * the facade has answered. storage.local.get on one key is not a cost worth
     * caching against a stale answer: the area can change under us, and the
     * facade is the single owner of that question.
     */
    onPolicyChanged(listener) {
      Platform.api.storage.onChanged.addListener(async (changes, areaName) => {
        if (!changes[ENTRY]) return;
        if (areaName !== (await Platform.storageAreaName())) return;
        listener(areaName);
      });
    },
  };

  global.PolicyRepository = PolicyRepository;
})(globalThis);
