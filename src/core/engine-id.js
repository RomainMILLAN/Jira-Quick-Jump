/**
 * The identity of a search engine: a value, not a bare string.
 *
 * IT WAS A STRING IN FIFTY-SEVEN PLACES -- the ticked selection, a Binding, the
 * coverage contract, the catalogue's keys, the persisted document -- which makes
 * it *the* concept that crosses every layer of this project while existing in
 * none of them. A string has no rules: nothing stopped a host name, a `null` or
 * an origin from being ticked, and nothing said what `custom:` meant except the
 * two files that happened to spell it.
 *
 * TWO NATURES, one identity:
 *
 *   built-in   `google.com`               -- a domain this build ships
 *   custom     `custom:intra.example.org` -- a domain the user added
 *
 * The `custom:` prefix is owned HERE and nowhere else. It used to be spelled in
 * CustomEngine and read by the catalogue, so the two could drift on a colon.
 *
 * WHAT TRAVELS IS THE WRITTEN FORM, and that is a decision rather than a
 * half-measure. This value is built at the DOORS -- the storage read, the custom
 * domain a user adds -- and what it buys there is real: an old spelling migrated,
 * a shape refused, and one owner for the `custom:` prefix that CustomEngine and
 * the catalogue each used to spell.
 *
 * Past those doors, nobody ASKS an engine id anything. The aggregate compares and
 * carries it; the catalogue keys a Map by it; a rule label prints it. Threading
 * the object through those layers would add `.toString()` at every boundary and
 * close no hole, because there is no question being asked wrongly. The day
 * something in the domain needs to know whether an engine is custom, or which
 * host is behind it, this is where that question already lives -- and THAT is the
 * day the object should start travelling.
 *
 * IT LIVES IN core/ BECAUSE THE STORAGE DOOR NEEDS IT. Reading a saved document
 * decides what an old configuration MEANS today -- a domain act. What an engine
 * looks like on the wire (host patterns, query parameters, shapes) stays with the
 * catalogue, which is why this file knows no host pattern and no shape.
 */
(function (global) {
  "use strict";

  const CUSTOM = "custom:";

  /**
   * Ids written before engines were split per domain. A selection saved as
   * `google` would otherwise resolve to nothing, and an existing configuration
   * would quietly stop working.
   */
  const LEGACY = Object.freeze({
    google: "google.com",
    bing: "bing.com",
    duckduckgo: "duckduckgo.com",
  });

  // A domain, or a domain behind the custom prefix. Deliberately narrow: this
  // value reaches a Map key, a rule label and a permission origin.
  const SHAPE = /^(custom:)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

  class EngineId {
    constructor(written) {
      this._written = written;
    }

    toString() { return this._written; }
    toJSON() { return this._written; }

    equals(other) {
      return other instanceof EngineId && other._written === this._written;
    }

    /** Added by the user, as opposed to shipped with this build. */
    isCustom() {
      return this._written.startsWith(CUSTOM);
    }

    /** The domain behind the identity, prefix removed. The ONE place that knows
     *  the prefix is a prefix. */
    host() {
      return this.isCustom() ? this._written.slice(CUSTOM.length) : this._written;
    }
  }

  /**
   * The door. It migrates an old spelling, then checks the shape.
   *
   * An unknown but WELL-FORMED id passes: it may be a domain a newer build added,
   * and refusing it here would delete a selection the user made. What is refused
   * is what cannot be an engine identity at all.
   */
  EngineId.parse = function (raw) {
    if (typeof raw !== "string") {
      return { ok: false, code: "ENGINE_ID_NOT_A_STRING", message: "A search engine id must be text." };
    }
    const written = LEGACY[raw] || raw;
    if (!SHAPE.test(written)) {
      return { ok: false, code: "ENGINE_ID_SHAPE", message: "That is not a search engine identifier." };
    }
    return { ok: true, value: new EngineId(written) };
  };

  /** For a host this project has already validated -- CustomEngine.parse has run
   *  its own checks, and this only puts the identity together. */
  EngineId.forCustomHost = function (host) {
    return new EngineId(CUSTOM + host);
  };

  EngineId.LEGACY = LEGACY;
  EngineId.CUSTOM_PREFIX = CUSTOM;
  global.EngineId = EngineId;
})(globalThis);
