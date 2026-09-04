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
   * WHAT A FACT MAY CARRY, and how long. See entryOf for why this is a list and
   * not a spread.
   *
   * The three groups are the three shapes PolicyDiff emits: text a fact names
   * (a key, a destination), counts it summarises, and the two flags the journal
   * itself owns. Anything else a writer added does not travel.
   */
  const MAX_FACT_TEXT = 256;
  const MAX_FACT_LIST = 32;
  const TEXT_FIELDS = [
    "shortcutId", "catchAllId", "code",
    "key", "oldKey", "newKey",
    "baseUrl", "oldBaseUrl", "newBaseUrl", "catchAllBaseUrl",
  ];
  const COUNT_FIELDS = ["changedCount", "engineCount", "shortcutCount"];
  // `affectedHosts` beside `affectedKeys`, and the two are NOT interchangeable:
  // one carries project keys, the other host names. They were one field for a
  // while -- DomainsAdded reused `affectedKeys` because ShadowingChanged already
  // had it -- and a field that carries two natures under a name announcing one is
  // how the first reader writes `affectedKeys.map(k => policy.shortcutFor(k))`
  // and is right to.
  const LIST_FIELDS = ["kinds", "affectedKeys", "affectedHosts"];

  const text = (value) =>
    typeof value === "string" ? value.slice(0, MAX_FACT_TEXT) : undefined;

  /**
   * THE PUBLISHED LANGUAGE OF THIS JOURNAL, closed and owned here.
   *
   * `type` used to be admitted as any string of up to 256 characters, and the
   * presentation layer has no case for an unknown one -- so it fell through to
   * the `default:` branch, which is the DestinationChanged sentence. That branch
   * prints `fact.key`, `fact.newBaseUrl` and `fact.oldBaseUrl`; on a fact that
   * carries none of them, Dom.el skips an `undefined` text and the banner renders
   * " now points to  . It used to point to ." -- a sentence with holes where the
   * destinations should be, on the one surface that must be believed.
   *
   * Worse than ugly: it FABRICATES A CLAIM. A reader is told a destination
   * changed, with no destination named, from an entry that never said so.
   *
   * So an unknown type is coerced to UNKNOWN_FACT, which has a sentence of its
   * own ("a change this version cannot describe -- check every destination").
   * Over-signalling, which is the direction this file's whole trust model
   * requires, and never a fabricated specific.
   *
   * NOT DROPPED: an entry we cannot name is still evidence that SOMETHING was
   * recorded, and dropping it would be the under-signalling the detector forbids.
   */
  const UNKNOWN_FACT = "UnknownFact";

  /**
   * TWO NATURES, TWO LISTS, ONE PUBLISHED LANGUAGE -- and the distinction had no
   * word for it while all three kinds sat in one array.
   *
   * A DOMAIN FACT describes a change to the configuration: it names a shortcut, a
   * key or a destination, and it is a fact in the past that somebody could in
   * principle have intended. Those come from the diff, or from a readmission.
   */
  const DOMAIN_FACTS = Object.freeze([
    // Produced by core/policy-diff.js -- the one corpus of both doors.
    "ShortcutAppeared", "CatchAllAppeared", "ShortcutRemoved", "CatchAllRemoved",
    "DestinationChanged", "KeyChanged", "ShortcutArmed", "ShadowingChanged",
    "PolicyArmed", "EnginesAdded", "EnginesRemoved", "DomainsAdded", "DomainsRemoved",
    "PolicyReplaced",
    // Produced by stored-policy.js, when a quarantined entry is readmitted.
    "QuarantinedReadmitted",
  ]);

  /**
   * A READING INCIDENT designates no shortcut and no destination: it says that
   * something could not be read or could not be attributed. A DEAD LETTER, not an
   * event of the domain -- and the difference matters the day somebody writes
   * "for each fact, find the shortcut it concerns".
   *
   * Two of them predate the distinction (`PolicyUnreadable`, `ProjectionStale`,
   * both from background.js, on the paths that have no revision to attribute
   * themselves to); the third is the reading door's own answer to a type it
   * cannot place.
   */
  const READING_INCIDENTS = Object.freeze([
    "PolicyUnreadable", "ProjectionStale", UNKNOWN_FACT,
  ]);

  /** What the journal accepts, which is the union. Published as one list because
   *  a reader admitting an entry does not care which nature it is. */
  const FACT_TYPES = Object.freeze([...DOMAIN_FACTS, ...READING_INCIDENTS]);

  const KNOWN_TYPE = new Set(FACT_TYPES);

  /**
   * ABSENT MEANS DestinationChanged, and that is a MIGRATION rather than a
   * default: builds before the type field wrote exactly that fact and nothing
   * else. Unknown means UnknownFact, which is a refusal to guess.
   */
  const typeOf = (raw) => {
    if (raw === undefined) return "DestinationChanged";
    if (typeof raw !== "string") return UNKNOWN_FACT;
    return KNOWN_TYPE.has(raw) ? raw : UNKNOWN_FACT;
  };

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
   *
   * AND ONE FACT IS REBUILT FIELD BY FIELD -- never `{ ...raw }`.
   *
   * JournalState.restore, thirty lines below, refuses exactly this geste in
   * exactly these words: "A WHITELIST, never a spread of the stored object.
   * `{ ...empty, ...value }` let any surplus field a hostile writer added travel
   * through, and some paths then wrote it back for ever while others dropped it".
   * The argument was right and was applied to the ENVELOPE only; the ENTRIES
   * inside it kept the spread, and they are the half that reaches the screen --
   * sentences.js reads fact.key, fact.newBaseUrl, fact.affectedKeys and paints
   * them in the banner whose whole job is to be believed.
   *
   * TWO THINGS THIS CLOSES, and neither is an injection (everything goes through
   * textContent): a surplus field written back for ever, and a field with NO
   * BOUND -- a 5 MB `newBaseUrl` freezes the banner, and twenty of them freeze it
   * for good, on the one surface that reports a compromise.
   *
   * THE LIMIT IS UNCHANGED AND STATED: the journal never leaves storage.local,
   * so only a LOCAL attacker writes here, and such an attacker already holds the
   * projection and the receipt. This adds no defence against him; it removes an
   * unbounded, unspecified shape from the surface he can reach.
   *
   * A NON-OBJECT IS NOT AN ENTRY, and it is DROPPED rather than promoted --
   * unchanged, and the reason still holds: turning a corrupt byte into a
   * synthetic UNKNOWN made noise inevictable, since evidence is kept longest.
   *
   * The fields are `undefined` when absent, which is what sentences.js already
   * expects: `fact.key || t("catchAllKey", …)`.
   */
  const entryOf = (raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
    const entry = {
      // Entries written before the split carry no species. UNKNOWN is the safe
      // reading: a detector must fail by over-signalling.
      type: typeOf(raw.type),
      source: raw.source === CLAIMED ? CLAIMED : UNCLAIMED,
      // `seen` is the journal's own flag, and ABSENT MEANS NOT SEEN: the banner
      // filters on `entry.seen !== true`, so a corrupt value must never read as
      // acknowledged.
      seen: raw.seen === true,
      when: Number.isFinite(raw.when) ? raw.when : undefined,
      // The journal's other own flag, carried by QuarantinedReadmitted.
      renamed: raw.renamed === true,
    };
    for (const field of TEXT_FIELDS) entry[field] = text(raw[field]);
    for (const field of COUNT_FIELDS) {
      entry[field] = Number.isInteger(raw[field]) ? raw[field] : undefined;
    }
    for (const field of LIST_FIELDS) {
      entry[field] = Array.isArray(raw[field])
        ? raw[field].map(text).filter((value) => value !== undefined).slice(0, MAX_FACT_LIST)
        : undefined;
    }
    return entry;
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
  DestinationJournal.FACT_TYPES = FACT_TYPES;
  DestinationJournal.DOMAIN_FACTS = DOMAIN_FACTS;
  DestinationJournal.READING_INCIDENTS = READING_INCIDENTS;
  DestinationJournal.UNKNOWN_FACT = UNKNOWN_FACT;
  DestinationJournal.CLAIMED = CLAIMED;
  DestinationJournal.UNCLAIMED = UNCLAIMED;
  DestinationJournal.MAX_CLAIMS = MAX_CLAIMS;
  DestinationJournal.JournalState = JournalState;
  global.DestinationJournal = DestinationJournal;
})(globalThis);
