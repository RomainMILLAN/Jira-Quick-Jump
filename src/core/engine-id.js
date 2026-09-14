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
   *
   * A MAP, because `raw` comes from the CONFIGURATION -- see the table-shape rule
   * in core/mutation-result.js.
   *
   * `LEGACY[raw]` with `raw === "constructor"` answered the Object function on a
   * plain literal, and `const written = LEGACY[raw] || raw` then carried a
   * FUNCTION into SHAPE.test() -- which refused it, so the door failed closed by
   * accident rather than by design. The sibling table in
   * search-engine-catalog.js had the same shape and did NOT fail closed (it
   * purged every rule).
   *
   * Prototype-free would have been enough to make it safe; a Map makes the
   * bracket inexpressible, which is what keeps it safe through the next
   * refactoring.
   *
   * AND IT IS NOT EXPORTED, which the frozen object it replaced could afford to
   * be. `Object.freeze` does nothing to a Map: measured, a single
   * `EngineId.LEGACY.set("google", "evil.example")` from any file loaded
   * afterwards turned `EngineId.parse("google")` into `evil.example` -- and every
   * file of this project shares `globalThis`. project-shortcut.js freezes its own
   * constants for exactly that reason ("an assignment before the airlock builds
   * its pattern would turn the extension into a universal redirector"); trading
   * the freeze for the Map lost half of what was there.
   *
   * The export had ZERO readers, so removing it costs nothing. If a reader ever
   * appears, the safe form is a function -- `EngineId.migrated(raw)` -- and not
   * the table.
   */
  const LEGACY = new Map([
    ["google", "google.com"],
    ["bing", "bing.com"],
    ["duckduckgo", "duckduckgo.com"],
  ]);

  // A domain, or a domain behind the custom prefix. Deliberately narrow: this
  // value reaches a Map key, a rule label and a permission origin.
  const SHAPE = /^(custom:)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

  /**
   * AND A LENGTH, because SHAPE was narrow and MUTE ABOUT SIZE -- the one string
   * this project admitted with no bound at all.
   *
   * Measured, before this: `EngineId.parse("a".repeat(20000) + ".com")` came back
   * ok, `JumpPolicy.restore` kept it, and 20 kB of a single ticked id was
   * re-persisted at every commit. Its neighbours all bound their text --
   * stored-policy at 256, the journal at 256, the receipt at 200, a custom host
   * at 40 -- and the rule those files state ("a field with NO BOUND") had one
   * exception left.
   *
   * IT IS DERIVED, NEVER CHOSEN. The honest ceiling is the longest identity this
   * build can legitimately mint: `custom:` plus the longest host
   * CustomEngine.parse admits. An id above it can resolve to NO engine, in any
   * catalogue -- a built-in is a domain this build ships (fourteen characters at
   * most today), a custom one is that same 40-character bound -- so refusing it
   * costs no selection a user could have made.
   *
   * A LITERAL HERE, A CHANGELOCK IN THE TESTS -- and not a runtime read of the
   * collaborator, which is the shape this first looked like it wanted.
   *
   * `core/custom-engine.js` is loaded AFTER this file in all five lists, so the
   * number cannot be read at load time; reading it lazily inside parse() works
   * (nothing invokes parse while the modules load) but costs either a duplicated
   * fallback for an unreachable branch -- the drift this file's LEGACY note
   * spends a paragraph refusing -- or a TypeError escaping a door whose every
   * other failure is a VALUE, which is the exact fault admission.js was rewritten
   * to remove.
   *
   * So it is spelled, like Re2Budget.CALIBRATION_ENVELOPE_COST, and a test
   * compares it to what CustomEngine actually admits. Seven characters of prefix
   * plus a forty-character host: the two cannot drift, because the pin goes red
   * rather than the bound going quiet.
   */
  const MAX_WRITTEN = 47;

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
    const written = LEGACY.get(raw) ?? raw;
    // THE SIZE BEFORE THE SENSE, which is the validation order this repository
    // states at its other doors (origin -> size -> lexical -> syntax): SHAPE is
    // anchored and linear, but a door that judges an unbounded string on shape
    // first is the order project-shortcut.js spent a paragraph correcting.
    //
    // ENGINE_ID_SHAPE, and deliberately NOT a new code. Its sentence -- "A saved
    // search engine was not an engine at all, so it is no longer selected" --
    // says exactly what is wrong here, it is already translated in both locales,
    // and a refused id is DROPPED rather than fatal (see admission.js). A fresh
    // ENGINE_ID_TOO_LONG would cost two locale entries to say the same thing.
    if (written.length > MAX_WRITTEN) {
      return { ok: false, code: "ENGINE_ID_SHAPE", message: "That is not a search engine identifier." };
    }
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

  EngineId.CUSTOM_PREFIX = CUSTOM;
  // Published for the changelock alone: the test compares it to
  // CUSTOM_PREFIX.length + CustomEngine.MAX_HOST_LENGTH, so neither side can
  // move without the other going red.
  EngineId.MAX_WRITTEN = MAX_WRITTEN;
  global.EngineId = EngineId;
})(globalThis);
