/**
 * The directory of shortcuts, guardian of key uniqueness AND of evaluation
 * order.
 *
 * Not `Mapping`: that is the name of the dictionary used to implement it, not of
 * the responsibility. This is a registry -- you ask it for ABC, it gives you the
 * address, and it refuses two entries under the same name.
 *
 * THE MAP'S INSERTION ORDER *IS* THE EVALUATION ORDER, first to last. That used
 * to be an accident of implementation; it is now a named, tested invariant, and
 * a piece of DOMAIN DATA persisted as the order of the `shortcuts` array. There
 * is exactly ONE representation of it: an order held both by the Map and by a
 * separate array would let the two diverge unobservably, on the very datum this
 * feature adds. `_with(id, shortcut)` relies on Map.set PRESERVING THE POSITION
 * of an existing key, so editing a destination never moves a row.
 *
 * `register` APPENDS, always. It is the single way in, and JumpPolicy.restore
 * replays it entry by entry to rebuild from storage: a register that also placed
 * rows would silently rewrite the persisted order on every read, changing an
 * effective destination with no user gesture and no event. A customs officer
 * stamps or refuses; he does not rearrange the suitcases. The convenience of
 * being born above the catch-all is an APPLICATION intention, and it lives
 * inside the membrane (see JumpPolicy.registerAboveCatchAll).
 *
 * EVERY mutation is addressed BY IDENTITY, never by key. Otherwise: the options
 * page has a debounced keystroke on ABC, the popup renames ABC to XYZ, the
 * compare-and-set correctly re-reads... and withBaseUrlFor('ABC', ...) aims at a
 * ghost.
 *
 * NO MUTATION EMITS EVENTS ANY MORE. A comparison between two states is the work
 * of neither state: PolicyDiff.between is the single producer, called once per
 * commit. A mutator that journals is no longer pure, and the compare-and-set
 * replays it up to three times.
 */
(function (global) {
  "use strict";

  const { MutationResult, Consent } = global;

  /** ONE owner for the sentence. It was written out three times -- here and at
   *  both admission doors -- and a sentence of the ubiquitous language with three
   *  authors drifts like any other duplicate. */
  const DUPLICATE_ID_MESSAGE = "Two entries claim the same identifier.";

  class ShortcutRegistry {
    /**
     * The internal dictionary is a Map, never an object literal. A key named
     * CONSTRUCTOR, TOSTRING or PROTO is perfectly valid against the character set
     * [A-Z][A-Z0-9_]+ and would break `key in obj` / `obj[key]`, hence the
     * uniqueness invariant. PROTO is a plausible project prefix: a real case, at
     * zero mitigation cost.
     */
    constructor(byId) {
      this._byId = byId;
    }

    /** In EVALUATION ORDER, first to last. First claimant wins. */
    shortcuts() {
      return [...this._byId.values()];
    }

    orderedIds() {
      return [...this._byId.keys()];
    }

    positionOf(id) {
      return this.orderedIds().indexOf(id);
    }

    /**
     * Reordering, stated ABSOLUTELY: the full ordered list of ids.
     *
     * NOT moveUp/swapWith. VersionedEntry replays this intention on a value that
     * may already contain its own effect, so "move up by one" would move up by
     * two. Applying withOrder twice is a no-op, which is the only property that
     * makes a replay safe. The UI's up/down buttons compute the list from their
     * snapshot; the intention that crosses the boundary is never relative.
     *
     * ORDER_STALE rather than "apply what is known and append the rest": the
     * latter would silently drop a concurrently added shortcut BELOW the
     * catch-all, which is to say kill it.
     */
    withOrder(ids) {
      const current = this.orderedIds();
      const sameSet =
        Array.isArray(ids) &&
        ids.length === current.length &&
        new Set(ids).size === ids.length &&
        ids.every((id) => this._byId.has(id));
      if (!sameSet) {
        return MutationResult.refused("ORDER_STALE", "The order changed elsewhere. Try again.");
      }
      if (ids.every((id, i) => id === current[i])) return MutationResult.ok(this);
      const next = new Map();
      for (const id of ids) next.set(id, this._byId.get(id));
      return MutationResult.ok(new ShortcutRegistry(next));
    }

    /**
     * Which shortcuts a catch-all placed before them makes unreachable.
     *
     * CHOSEN FOR PREDICTABILITY, not derived. It used to rest on "the catch-all
     * claims every reference", which stopped being true the day the claim was
     * bounded to six characters -- so this is now a DELIBERATE OVERAPPROXIMATION:
     * everything below the catch-all is switched off, including what the catch-all
     * no longer claims.
     *
     * That was already the case with zero reserved prefixes -- ISO sits below and
     * is switched off although captures("ISO") is false -- so the bound widens the
     * overapproximation rather than creating it. The alternative, shadowing that
     * depends on key length, makes two neighbouring rows behave differently with
     * no way for the interface to explain it. One predictable rule beats a correct
     * one nobody can read, and the way out stays the same: move the line above.
     * A test in domain.test.js pins the three facts together.
     *
     * And NOT from the priority of any DNR rule: the arithmetic implements this,
     * it does not found it.
     */
    shadowedIds() {
      return [...this._shadowed()];
    }

    /**
     * MEMOISED, and safe because this registry is immutable: every mutation
     * returns a NEW one, so a derived answer can never go stale.
     *
     * It was recomputed by five callers -- activeBindings, claimantFor, statusOf
     * via isShadowed, shadowedShortcuts, and PolicyDiff -- and diagnose() reaches
     * three of them up to four times. With isShadowed doing a linear `includes`
     * on top, painting a list of n rows cost O(n^2) walks of the order, per
     * keystroke, inside the service worker.
     */
    _shadowed() {
      if (this._shadowedCache === undefined) {
        const catchAll = this.catchAll();
        const ids = this.orderedIds();
        this._shadowedCache = new Set(catchAll ? ids.slice(ids.indexOf(catchAll.id()) + 1) : []);
      }
      return this._shadowedCache;
    }

    isShadowed(id) {
      return this._shadowed().has(id);
    }

    /**
     * The first shortcut that claims this reference, among those offered.
     *
     * `eligible` is the set the CALLER considers live -- armed, acknowledged, and
     * with engines ticked. The registry knows none of that, which is why the
     * question is asked from JumpPolicy and answered here only for the ordering
     * and the lookup.
     */
    claimantFor(reference, eligible) {
      const key = reference.key();
      for (const shortcut of this._byId.values()) {
        if (eligible && !eligible(shortcut)) continue;
        if (!shortcut.key().separators().includes(reference.separator())) continue;
        if (shortcut.key().captures(key)) return shortcut;
      }
      return undefined;
    }

    size() {
      return this._byId.size;
    }

    find(id) {
      return this._byId.get(id);
    }

    _with(id, shortcut) {
      const next = new Map(this._byId);
      next.set(id, shortcut);
      return new ShortcutRegistry(next);
    }

    _holdsKey(key, exceptId) {
      for (const shortcut of this._byId.values()) {
        if (shortcut.id() !== exceptId && shortcut.key().equals(key)) return true;
      }
      return false;
    }

    /** The catch-all shortcut, or undefined. A registry knows its own shortcuts;
     *  an order of identifiers could not tell which one is a catch-all. */
    catchAll() {
      for (const shortcut of this._byId.values()) {
        if (shortcut.isCatchAll()) return shortcut;
      }
      return undefined;
    }

    _holdsCatchAll(exceptId) {
      const existing = this.catchAll();
      return existing !== undefined && existing.id() !== exceptId;
    }

    /**
     * The single way in, and it APPENDS. The id is supplied by the caller
     * (crypto.randomUUID), which makes register IDEMPOTENT: replayed with the
     * same id it is a no-op rather than a DUPLICATE_KEY. That matters because the
     * compare-and-set replays intentions, and it gives DUPLICATE_KEY back its
     * exact meaning -- a real collision coming from the other surface, never a
     * retry artefact.
     *
     * The id SHAPE is enforced here rather than at the admission door, because
     * StoredPolicy.promote reaches register without passing through admitEntry,
     * carrying an id taken from quarantine.
     */
    register(id, key, instance, consent = Consent.fresh()) {
      const wellFormed = global.ShortcutId.parse(id);
      if (!wellFormed.ok) return MutationResult.refused(wellFormed.code, wellFormed.message);
      const existing = this._byId.get(id);
      if (existing) {
        // The REPLAY no-op, and it must stay: VersionedEntry re-runs intentions,
        // so an identical register is a retry, not a collision.
        if (existing.key().equals(key) && existing.instance().equals(instance)) {
          return MutationResult.ok(this);
        }
        // A CONTRADICTORY REDEFINITION, and it used to fall through to _with(),
        // where Map.set OVERWROTE the living shortcut AND HANDED IT ITS POSITION
        // -- the evaluation order, which is to say who intercepts what. Neither a
        // refusal, nor a quarantine, nor a dropped entry: a squat of identity,
        // silent, from a document this door exists to distrust.
        //
        // IDENTITY IS TESTED BEFORE THE KEY, deliberately. The other way round, a
        // squatter carrying a free key comes back ok.
        return MutationResult.refused("DUPLICATE_ID", DUPLICATE_ID_MESSAGE);
      }
      // Before _holdsKey, or CatchAllKey.equals would answer DUPLICATE_KEY and
      // the code would lose its precise meaning. Kept as a better MESSAGE, not
      // as a second control: _holdsKey already refuses, and two controls end up
      // disagreeing.
      if (key.isCatchAll() && this._holdsCatchAll(id)) {
        return MutationResult.refused("DUPLICATE_CATCH_ALL", "There is already a catch-all shortcut.");
      }
      if (this._holdsKey(key, id)) {
        return MutationResult.refused("DUPLICATE_KEY", `The key ${key} is already used.`);
      }
      const shortcut = new global.ProjectShortcut(id, key, instance, consent);
      return MutationResult.ok(this._with(id, shortcut));
    }

    arm(id) {
      const shortcut = this._byId.get(id);
      if (!shortcut) return MutationResult.refused("UNKNOWN_SHORTCUT", "This shortcut no longer exists.");
      // Combined with "everything imported arrives disarmed", this makes a
      // hostile import MECHANICALLY unable to install a rule without the user
      // having read the destination warning.
      const pending = shortcut.unacknowledgedWarnings();
      if (pending.length > 0) {
        return MutationResult.refused(
          "UNACKNOWLEDGED_WARNING",
          "Acknowledge the destination warnings before arming this shortcut."
        );
      }
      return MutationResult.ok(this._with(id, shortcut.withConsent(shortcut.consent().armedWith(true))));
    }

    disarm(id) {
      const shortcut = this._byId.get(id);
      if (!shortcut) return MutationResult.refused("UNKNOWN_SHORTCUT", "This shortcut no longer exists.");
      return MutationResult.ok(this._with(id, shortcut.withConsent(shortcut.consent().armedWith(false))));
    }

    /**
     * EMITS NOTHING. It used to build a DestinationChanged here, and PolicyDiff
     * now derives the same fact once per commit -- keeping both would put the
     * same change twice into a journal capped at twenty entries.
     */
    withBaseUrlFor(id, instance) {
      const shortcut = this._byId.get(id);
      if (!shortcut) return MutationResult.refused("UNKNOWN_SHORTCUT", "This shortcut no longer exists.");
      if (shortcut.instance().equals(instance)) return MutationResult.ok(this);
      return MutationResult.ok(this._with(id, shortcut.withInstance(instance)));
    }

    /**
     * Refuses a change of NATURE, and carries the message.
     *
     * Without it, a named shortcut that is already armed and acknowledged could
     * become a catch-all while keeping its consent -- a universal redirector
     * obtained without ever seeing the CATCH_ALL warning. The entity throws on
     * the same condition (see ProjectShortcut.withKey): the throw is the
     * post-condition, this refusal is the sentence the user reads.
     */
    withKeyFor(id, key) {
      const shortcut = this._byId.get(id);
      if (!shortcut) return MutationResult.refused("UNKNOWN_SHORTCUT", "This shortcut no longer exists.");
      if (shortcut.key().equals(key)) return MutationResult.ok(this);
      if (shortcut.isCatchAll() !== key.isCatchAll()) {
        return MutationResult.refused(
          "KEY_NATURE_IMMUTABLE",
          "A catch-all cannot be renamed, and a shortcut cannot become a catch-all."
        );
      }
      if (this._holdsKey(key, id)) {
        return MutationResult.refused("DUPLICATE_KEY", `The key ${key} is already used.`);
      }
      return MutationResult.ok(this._with(id, shortcut.withKey(key)));
    }

    acknowledge(id, kind) {
      const shortcut = this._byId.get(id);
      if (!shortcut) return MutationResult.refused("UNKNOWN_SHORTCUT", "This shortcut no longer exists.");
      // An acknowledgement that acknowledges nothing because the string is
      // misspelled is a silent failure of a security control.
      // PARSED, for the same reason consent.js parses it.
      if (!global.ShortcutWarning.parse(kind).ok) {
        return MutationResult.refused("UNKNOWN_WARNING_KIND", `Unknown warning kind "${kind}".`);
      }
      return MutationResult.ok(this._with(id, shortcut.withConsent(shortcut.consent().acknowledging(kind))));
    }

    remove(id) {
      if (!this._byId.has(id)) return MutationResult.ok(this);
      const next = new Map(this._byId);
      next.delete(id);
      return MutationResult.ok(new ShortcutRegistry(next));
    }

    toJSON() {
      return this.shortcuts().map((s) => s.toJSON());
    }
  }

  ShortcutRegistry.DUPLICATE_ID_MESSAGE = DUPLICATE_ID_MESSAGE;

  ShortcutRegistry.empty = function () {
    return new ShortcutRegistry(new Map());
  };

  global.ShortcutRegistry = ShortcutRegistry;
})(globalThis);
