/**
 * The destination-change journal.
 *
 * A journal of REDIRECTIONS is impossible without webNavigation or tabs -- the
 * very permissions the trust model refuses -- because DNR gives no execution
 * feedback. So we journal the CHANGE, which is better and needs no permission:
 * it catches the hostile import, the compromised sync and the malicious update
 * BEFORE the first jump, whereas a navigation log would only reveal them after
 * credentials had been typed.
 *
 * Never exported, never synced: A JOURNAL THAT TRAVELS BY THE CHANNEL IT IS
 * MEANT TO WATCH IS WORTHLESS -- a compromised sync able to rewrite destinations
 * would also be able to erase the trace of its passage.
 *
 * It is not IN the aggregate; it is a log ABOUT the aggregate: append-only, no
 * shared invariant, hence a separate entry, written AFTER the commit and never
 * inside a mutator (the compare-and-set replays intentions up to three times,
 * and an intention that journals is no longer pure).
 *
 * THREE GESTURES, NAMED, because there are three different facts:
 *
 *   claimed      -- somebody committed this, and said so. No banner: the user
 *                   has just done it themselves, and a detector that cries on
 *                   ordinary use is one people switch off.
 *   unclaimed    -- the installed reality and the projection disagree and no
 *                   commit claims the gap. THIS is the detection, and it alone
 *                   raises the banner.
 *   unclaimable  -- a fact no commit COULD ever claim, because there is no
 *                   readable policy to attribute it to. It can never be covered
 *                   by a claim, so it is never compared against one.
 *
 * A `source` parameter used to carry all three, which made the post-condition a
 * function of an argument -- and the caller got it wrong in the direction that
 * matters: every ordinary edit was journalled twice, once by the door and once by
 * the window, the second time under the code reserved for compromise.
 */
(function (global) {
  "use strict";

  const { Platform, VersionedEntry } = global;
  const ENTRY = "destinationJournal";
  const MAX_ENTRIES = 20;

  const CLAIMED = "MANUAL";
  const UNCLAIMED = "UNKNOWN";

  /**
   * ONE PLACE DECIDES THE SPECIES OF AN ENTRY, and it decides it once.
   *
   * It was decided in `read()` and NOT in the mutation path, so the two
   * disagreed: an entry written by a build from before the split carries no
   * species, `read` charitably called it evidence, and the eviction -- reading
   * the raw stored value -- called it an act and threw it out FIRST. The very
   * UNKNOWN a past compromise left behind was the first thing sacrificed, which
   * is the exact attack the eviction exists to prevent.
   *
   * A NON-OBJECT IS NOT AN ENTRY, and it is DROPPED rather than promoted. Turning
   * a corrupt byte into a synthetic UNKNOWN made noise inevictable -- evidence is
   * kept longest -- so twenty junk values became a permanent saturation weapon,
   * and each of them rendered an empty sentence in the banner. Over-signalling is
   * for a doubtful FACT; it is not for a string.
   */
  const entryOf = (raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
    const type = typeof raw.type === "string" ? raw.type : "DestinationChanged";
    // Entries written before the split carry no species. UNKNOWN is the safe
    // reading: a detector must fail by over-signalling.
    const source = raw.source === CLAIMED ? CLAIMED : UNCLAIMED;
    return { ...raw, type, source };
  };

  const isEvidence = (entry) => entry.source === UNCLAIMED;

  /**
   * The journal's state, reconstituted ONCE from a foreign shape.
   *
   * Four attributes, and they are the four questions the journal answers: what
   * happened, has it been seen, what has already been claimed, and did anything
   * fall off the tape. Every read used to rebuild this shape by hand with a
   * spread -- three times, differently -- which is how a hardened field ended up
   * hardened on one path and raw on another.
   */
  class JournalState {
    constructor(entries, seen, claims, overflowed) {
      this._entries = entries;
      this._seen = seen;
      this._claims = claims;
      this._overflowed = overflowed;
    }

    /**
     * A WHITELIST, never a spread of the stored object.
     *
     * `{ ...empty, ...value }` let any surplus field a hostile writer added
     * travel through, and some paths then wrote it back for ever while others
     * dropped it: three behaviours for one shape.
     */
    static restore(value) {
      if (!value || typeof value !== "object" || !Array.isArray(value.entries)) {
        return new JournalState([], true, [], false);
      }
      return new JournalState(
        value.entries.map(entryOf).filter((entry) => entry !== undefined),
        value.acknowledged !== false,
        claimsOf(value.claims),
        value.overflowed === true
      );
    }

    entries() { return this._entries.map((entry) => ({ ...entry })); }
    seen() { return this._seen; }
    overflowed() { return this._overflowed; }
    claims() { return [...this._claims]; }

    /**
     * HAS A LOCAL DOOR ALREADY CLAIMED THIS EXACT CONTENT?
     *
     * Two earlier answers were wrong, and the second one worse than the first.
     *
     * `lastLoggedRev >= rev` compared a HEIGHT, and a height is a number the
     * hostile writer picks: writing `{rev: 1, value: <trap>}` after an ordinary
     * commit at 10 put the trap under the line and the detector went quiet.
     *
     * `{revision, writer}` was then called an identity. It is not one: the token
     * is written INTO THE SAME ENVELOPE as the value, so when the policy lives in
     * `sync`, the adversary this journal exists to watch READS it before writing
     * it. Copying two fields instead of one silenced the detector again -- under a
     * comment swearing it could not be, which is the worse failure: nobody
     * reopens a door marked shut.
     *
     * A FINGERPRINT OF THE CONTENT closes it. The compromised channel cannot
     * produce a matching claim, not because the value is secret, but because a
     * match means producing a state a LOCAL door already claimed -- and the
     * journal never leaves storage.local, which is the rule this file states in
     * its own first paragraph and had failed to apply to the token.
     */
    covers(fingerprint) {
      return typeof fingerprint === "string" && this._claims.includes(fingerprint);
    }

    withClaim(fingerprint) {
      if (typeof fingerprint !== "string" || this._claims.includes(fingerprint)) return this;
      return new JournalState(
        this._entries,
        this._seen,
        [fingerprint, ...this._claims].slice(0, MAX_CLAIMS),
        this._overflowed
      );
    }

    /**
     * ACKNOWLEDGING IS PER FACT, not per journal.
     *
     * `acknowledged` was a single flag over the whole entry, so the next
     * divergence re-displayed EVERY fact -- including ones the user had ticked
     * off weeks earlier. The dead branch this file used to carry tested
     * `entry.acknowledged`, a field entries never had: it was not merely dead
     * code, it was the trace of the model nobody built. Here it is.
     */
    seenNow() {
      const entries = this._entries.map((entry) => ({ ...entry, seen: true }));
      return new JournalState(entries, true, this._claims, this._overflowed);
    }

    /** What the banner owes the user: unclaimed facts they have not ticked off. */
    unseenEvidence() {
      return this._entries.filter((entry) => isEvidence(entry) && entry.seen !== true).map((e) => ({ ...e }));
    }

    /**
     * Adds facts, sacrificing in a WRITTEN order when the tape is full.
     *
     * THE INVARIANT IS NOT "KEEP TWENTY". It is: never lose the first unclaimed
     * fact. That one dates the intrusion; the ones after it are its noise, and
     * the acts around it are gestures the user can remember making. So acts fall
     * first, and among evidence the NEWEST falls -- the opposite of the usual
     * reflex, and the reason the previous cap was wrong: it kept the twenty most
     * recent, so twenty-one hostile writes erased the line that said when the
     * intrusion began.
     *
     * Selection is BY INDEX. Doing it by membership (`includes`) compared
     * primitives by value, so twenty identical junk entries all matched the one
     * kept slot: the cap stopped capping, `overflowed` stayed false while the
     * tape ran away, and storage grew without bound.
     */
    with(facts, seen) {
      const combined = [...facts, ...this._entries];
      if (combined.length <= MAX_ENTRIES) {
        return new JournalState(combined, seen, this._claims, this._overflowed);
      }
      const evidence = [];
      const acts = [];
      combined.forEach((entry, at) => (isEvidence(entry) ? evidence : acts).push(at));
      // The oldest evidence is the most probative, so it is the last to go.
      const keptEvidence = evidence.slice(Math.max(0, evidence.length - MAX_ENTRIES));
      const keptActs = acts.slice(0, Math.max(0, MAX_ENTRIES - keptEvidence.length));
      const keep = new Set([...keptEvidence, ...keptActs]);
      const entries = combined.filter((_, at) => keep.has(at));
      return new JournalState(entries, seen, this._claims, this._overflowed || entries.length < combined.length);
    }

    toJSON() {
      return {
        entries: this._entries,
        acknowledged: this._seen,
        claims: this._claims,
        overflowed: this._overflowed,
      };
    }
  }

  /**
   * A CLAIM IS THE WITNESS OF A CONTENT, never the identity of a write.
   *
   * The first attempt compared `lastLoggedRev >= rev` -- a HEIGHT, and heights are
   * a number the hostile writer picks. The second compared `{revision, writer}`
   * and called it an identity. It is not one, and the difference was measured:
   * the token is written INTO THE SAME ENVELOPE as the value, so when the policy
   * lives in `sync`, the adversary this journal exists to watch READS the token
   * before writing it. Copying two fields instead of one silenced the detector --
   * with a comment above swearing it could not be, which is worse than the
   * original bug, because nobody reopens a door marked shut.
   *
   * So a claim carries a FINGERPRINT of the policy content. The compromised
   * channel cannot forge one, not because it is secret, but because producing a
   * matching claim means producing a state a LOCAL door already claimed -- and the
   * journal never leaves storage.local, which is the rule this file states in its
   * first paragraph and did not apply to the token.
   *
   * A RING, not a slot. Claiming happens many times; a single slot models "the
   * last one", so a slow commit landing after a fast one left the claim on a
   * stale state and the next reconciliation cried over the user's own edit.
   */
  const MAX_CLAIMS = 4;

  const claimsOf = (raw) =>
    Array.isArray(raw)
      ? raw.filter((c) => typeof c === "string").slice(0, MAX_CLAIMS)
      : [];

  const stampAll = (events, now, source) => events.map((e) => ({ ...e, when: now, source }));

  const DestinationJournal = {
    async read() {
      const { value } = await VersionedEntry.read(Platform.api.storage.local, ENTRY);
      const state = JournalState.restore(value);
      return {
        entries: state.entries(),
        // What the banner must show, already filtered: acts the user performed
        // are not alarms, and a fact they have ticked off is not news. Rendering
        // `entries` flat put nineteen lines of the user's own edits under a title
        // saying "Destinations changed" -- the original defect, moved from the
        // journalling to the display.
        unseen: state.unseenEvidence(),
        acknowledged: state.seen(),
        overflowed: state.overflowed(),
        claims: state.claims(),
      };
    },

    /**
     * A CHANGE SOMEBODY CLAIMED -- written by the door, at the commit.
     *
     * It does not lower `acknowledged`: the user has just moved a destination
     * themselves, and telling them a destination moved is noise. The line is
     * still written, because the journal is the record of what changed; it simply
     * stops treating an act as an alarm.
     */
    async recordClaimed(events, fingerprint, now) {
      return this._update((state) =>
        state.with(stampAll(events, now, CLAIMED), state.seen()).withClaim(fingerprint)
      );
    },

    /**
     * THE DOOR SPEAKS BEFORE IT COMMITS.
     *
     * Claiming after the commit left a race the file itself admitted was "the
     * likelier order": the policy write is what wakes the worker, and the door
     * claims only afterwards -- so an ordinary edit was journalled twice, the
     * second time under the code reserved for compromise. Measured, on this
     * project's own code, before this change.
     *
     * Claiming the content we are ABOUT to write closes it: the window can never
     * observe a state whose claim is not already on tape. A claim whose commit is
     * then refused covers a state nobody reached -- it costs one ring slot and
     * silences nothing.
     */
    async claimAhead(fingerprint) {
      return this._update((state) => state.withClaim(fingerprint));
    },

    /**
     * A CHANGE NOBODY CLAIMED -- written by the window, at reconciliation.
     *
     * THE CLAIM IS CHECKED INSIDE THE MUTATION, against the freshly re-read
     * value, so an attribution that landed while we were waking up is seen and
     * nothing is written. That NARROWS the false-alarm window; it does not close
     * it -- an attribution arriving after this write completes is not caught, and
     * that is the likelier order, since the policy write is what wakes the worker
     * and the door claims only afterwards. versioned-entry.js is honest about the
     * same residue on the same mechanism; so is this.
     */
    async recordUnclaimed(events, fingerprint, now) {
      // A NON-DISCOVERY SHOULD BE A NON-WRITE. Returning the state unchanged from
      // the mutation still went through set + re-read: revision bumped,
      // storage.onChanged fired on this very entry, quota spent -- at every
      // wake-up of the worker. This short-circuit is an OPTIMISATION ONLY; the
      // guard inside the mutation stays, because it is the one that is atomic.
      const { value } = await VersionedEntry.read(Platform.api.storage.local, ENTRY);
      if (JournalState.restore(value).covers(fingerprint)) {
        return { ok: true, value: undefined, events: [] };
      }
      return this._update((state) =>
        state.covers(fingerprint) ? state : state.with(stampAll(events, now, UNCLAIMED), false)
      );
    },

    /**
     * A FACT NO COMMIT COULD CLAIM.
     *
     * The saved policy stopped being readable, so there is no revision to
     * attribute it to and no claim can ever cover it. This used to be pushed
     * through the unclaimed door with `rev: 0` -- and `0 >= 0` silenced it on a
     * fresh journal, every time. The path the trust model calls the one a
     * compromised sync reaches most easily was mute, under a comment saying it
     * could not be. Modelling "no revision" as zero is the banned null wearing an
     * integer's coat.
     */
    async recordUnclaimable(events, now) {
      return this._update((state) => state.with(stampAll(events, now, UNCLAIMED), false));
    },

    async acknowledgeAll() {
      return this._update((state) => state.seenNow());
    },

    _update(change) {
      return VersionedEntry.update(Platform.api.storage.local, ENTRY, (value) => ({
        ok: true,
        value: change(JournalState.restore(value)).toJSON(),
        events: [],
      }));
    },
  };

  DestinationJournal.MAX_ENTRIES = MAX_ENTRIES;
  DestinationJournal.CLAIMED = CLAIMED;
  DestinationJournal.UNCLAIMED = UNCLAIMED;
  DestinationJournal.MAX_CLAIMS = MAX_CLAIMS;
  DestinationJournal.JournalState = JournalState;
  global.DestinationJournal = DestinationJournal;
})(globalThis);
