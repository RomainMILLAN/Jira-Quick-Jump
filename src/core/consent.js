/**
 * What the user has consented to for one shortcut: armed, plus the destination
 * warnings they acknowledged.
 *
 * Consent was the only one of ProjectShortcut's four attributes without a parse
 * of its own -- and that hole, not the number of construction doors, is what
 * made rebuilding from storage look like it needed a second entry point. With a
 * parse, register(id, key, instance, consent = Consent.fresh()) is enough and
 * there is literally one way into the registry.
 *
 * Criterion for future cases: a parameter is a mode flag if the body branches on
 * it; it is a carried value if it is merely stored. Consent is stored.
 */
(function (global) {
  "use strict";

  class Consent {
    constructor(armed, acknowledged) {
      this._armed = armed;
      this._acknowledged = acknowledged; // Set of warning kinds
    }

    armed() {
      return this._armed;
    }

    acknowledged(kind) {
      return this._acknowledged.has(kind);
    }

    acknowledgedKinds() {
      return [...this._acknowledged];
    }

    armedWith(armed) {
      return new Consent(armed, new Set(this._acknowledged));
    }

    acknowledging(kind) {
      const next = new Set(this._acknowledged);
      next.add(kind);
      return new Consent(this._armed, next);
    }

    /**
     * A consent is given to a destination, never to a shortcut -- so changing the
     * destination forgets the DESTINATION acknowledgements, and only those.
     *
     * NO SCOPE PARAMETER, by the criterion written above: the body would branch
     * on it. The scope stays with its owner, ShortcutWarning.kindsInScope, and
     * this method reads like a sentence at its call site.
     *
     * FAIL CLOSED: a kind whose scope cannot be placed is FORGOTTEN, never kept.
     * A future kind must not silently survive a change of destination.
     */
    forgettingDestinationAcknowledgements() {
      const kept = global.ShortcutWarning.kindsInScope("key");
      return new Consent(this._armed, new Set(this.acknowledgedKinds().filter((k) => kept.includes(k))));
    }

    /**
     * ONLY the destination-scoped acknowledgements are persisted here.
     *
     * A key-scoped acknowledgement never travels with the configuration: it
     * would let a compromised sync account write acknowledged:["CATCH_ALL"] and
     * install a universal redirector without a single screen or click. Same
     * argument as the journal -- A CONTROL THAT TRAVELS BY THE CHANNEL IT IS
     * MEANT TO WATCH IS WORTHLESS. Its home is a separate storage.local entry
     * (see key-acknowledgements.js), merged back in at reconstitution.
     */
    toJSON() {
      const scoped = global.ShortcutWarning.kindsInScope("destination");
      return {
        armed: this._armed,
        acknowledged: this.acknowledgedKinds().filter((k) => scoped.includes(k)),
      };
    }
  }

  Consent.fresh = function () {
    return new Consent(false, new Set());
  };

  Consent.parse = function (raw) {
    if (raw === undefined || raw === null) return { ok: true, value: Consent.fresh() };
    if (typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, code: "CONSENT_NOT_AN_OBJECT", message: "Consent must be an object." };
    }
    if (typeof raw.armed !== "boolean") {
      return { ok: false, code: "CONSENT_ARMED_NOT_BOOLEAN", message: "`armed` must be a boolean." };
    }
    const kinds = raw.acknowledged === undefined ? [] : raw.acknowledged;
    if (!Array.isArray(kinds)) {
      return { ok: false, code: "CONSENT_NOT_A_LIST", message: "`acknowledged` must be a list." };
    }
    // What a document may say about acknowledgements, as a table -- because the
    // two halves ("refuse the key scope" and "admit the entry anyway") read in
    // opposite directions, and the wrong direction is a self-quarantine loop:
    // the user acknowledges, toJSON writes, storage.onChanged wakes sync(),
    // restore refuses, and the entry the user just authorised lands in
    // quarantine seconds later -- on every device, every time, unrepairable.
    //
    //   destination scope -> KEPT
    //   key scope         -> DROPPED SILENTLY, the entry is still admitted
    //   unknown           -> HARD REFUSAL (a misspelled acknowledgement stays a
    //                        silent failure of a security control)
    //
    // Quarantine is for what we cannot READ. Here we read perfectly well; we
    // refuse to BELIEVE.
    const seen = new Set();
    for (const kind of kinds) {
      if (!global.ShortcutWarning.has(kind)) {
        return { ok: false, code: "UNKNOWN_WARNING_KIND", message: `Unknown warning kind "${kind}".` };
      }
      if (seen.has(kind)) {
        return { ok: false, code: "DUPLICATE_ACKNOWLEDGEMENT", message: `"${kind}" acknowledged twice.` };
      }
      if (global.ShortcutWarning.scopeOf(kind) === "key") continue;
      seen.add(kind);
    }
    return { ok: true, value: new Consent(raw.armed, seen) };
  };

  global.Consent = Consent;
})(globalThis);
