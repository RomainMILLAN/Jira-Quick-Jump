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

    /** A consent is given to a destination, never to a shortcut. */
    forgettingAcknowledgements() {
      return new Consent(this._armed, new Set());
    }

    toJSON() {
      return { armed: this._armed, acknowledged: this.acknowledgedKinds() };
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
    const seen = new Set();
    for (const kind of kinds) {
      if (!global.DestinationWarning.has(kind)) {
        return { ok: false, code: "UNKNOWN_WARNING_KIND", message: `Unknown warning kind "${kind}".` };
      }
      if (seen.has(kind)) {
        return { ok: false, code: "DUPLICATE_ACKNOWLEDGEMENT", message: `"${kind}" acknowledged twice.` };
      }
      seen.add(kind);
    }
    return { ok: true, value: new Consent(raw.armed, seen) };
  };

  global.Consent = Consent;
})(globalThis);
