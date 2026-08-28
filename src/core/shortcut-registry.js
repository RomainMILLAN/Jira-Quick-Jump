/**
 * The directory of shortcuts, guardian of key uniqueness.
 *
 * Not `Mapping`: that is the name of the dictionary used to implement it, not of
 * the responsibility. This is a registry -- you ask it for ABC, it gives you the
 * address, and it refuses two entries under the same name.
 *
 * EVERY mutation is addressed BY IDENTITY, never by key. Otherwise: the options
 * page has a debounced keystroke on ABC, the popup renames ABC to XYZ, the
 * compare-and-set correctly re-reads... and withBaseUrlFor('ABC', ...) aims at a
 * ghost. The coalesceKey only decides which pending write replaces which; it does
 * not protect the target of the mutator.
 */
(function (global) {
  "use strict";

  const { MutationResult, Consent } = global;

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

    shortcuts() {
      return [...this._byId.values()];
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

    /**
     * The single way in. The id is supplied by the caller (crypto.randomUUID),
     * which makes register IDEMPOTENT: replayed with the same id it is a no-op
     * rather than a DUPLICATE_KEY. That matters because the compare-and-set
     * replays intentions, and it gives DUPLICATE_KEY back its exact meaning -- a
     * real collision coming from the other surface, never a retry artefact.
     */
    register(id, key, instance, consent = Consent.fresh()) {
      const existing = this._byId.get(id);
      if (existing) {
        if (existing.key().equals(key) && existing.instance().equals(instance)) {
          return MutationResult.ok(this);
        }
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
     * Emits DestinationChanged when the destination actually changes -- and
     * nothing when it does not, otherwise a compare-and-set replay would
     * fabricate an event where old === new.
     *
     * The event carries no `when` and no `source`: those are STAMPED BY THE
     * WRITER (see background.js). An inferred source would label the other
     * surface's legitimate edit as suspicious, and a badge that cries wolf is a
     * badge people learn to ignore.
     */
    withBaseUrlFor(id, instance) {
      const shortcut = this._byId.get(id);
      if (!shortcut) return MutationResult.refused("UNKNOWN_SHORTCUT", "This shortcut no longer exists.");
      if (shortcut.instance().equals(instance)) return MutationResult.ok(this);
      const event = {
        shortcutId: id,
        key: shortcut.key().toString(),
        oldBaseUrl: shortcut.instance().baseUrl(),
        newBaseUrl: instance.baseUrl(),
      };
      return MutationResult.ok(this._with(id, shortcut.withInstance(instance)), [event]);
    }

    withKeyFor(id, key) {
      const shortcut = this._byId.get(id);
      if (!shortcut) return MutationResult.refused("UNKNOWN_SHORTCUT", "This shortcut no longer exists.");
      if (shortcut.key().equals(key)) return MutationResult.ok(this);
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
      if (!global.DestinationWarning.has(kind)) {
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

  ShortcutRegistry.empty = function () {
    return new ShortcutRegistry(new Map());
  };

  global.ShortcutRegistry = ShortcutRegistry;
})(globalThis);
