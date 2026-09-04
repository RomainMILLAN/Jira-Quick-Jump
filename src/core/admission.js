/**
 * The border post.
 *
 * A factory reconstitutes, assuming the data came from its own model and was
 * valid when written. What happens here is an ADMISSION: an untrusted document
 * is examined, translated, partly rejected, and a refusal report comes out. A
 * factory does not produce a refusal report; a border post does.
 *
 * YOUR OWN STORAGE IS A FOREIGN SYSTEM -- written by an earlier version of your
 * model, by another machine, sometimes by somebody else. The relationship with
 * your own past is conformist, so the airlock applies. Never "optimise away" the
 * double parsing on the grounds that it was already validated when written.
 *
 * Two NAMED DOORS rather than one door with a trust flag: storage quarantines,
 * import refuses wholesale. Different post-conditions, different error policy,
 * different return shape -- that was never an abstraction, it was a mode flag.
 */
(function (global) {
  "use strict";

  const { ProjectKey, JiraInstance, Consent, JumpPolicy, ShortcutRegistry } = global;

  const SHORTCUT_FIELDS = new Set(["id", "key", "baseUrl", "consent"]);
  const DOCUMENT_FIELDS = new Set(["schemaVersion", "armed", "engines", "customEngines", "shortcuts"]);
  const MAX_QUARANTINE = 50;

  // Unbounded resources, closed on the way past: readDocument capped `shortcuts`
  // and left `customEngines` open, while withCustomEngine does a linear scan per
  // addition. Every engine now also adds one reserved-prefix allow rule and one
  // isRegexSupported round trip, so a hostile synced document carrying fifty
  // thousand engines would freeze the service worker. Fail-closed and no leak,
  // but free to close.
  const MAX_CUSTOM_ENGINES = 20;

  /**
   * How many engines this build SHIPS. A number, in core/, about a catalogue that
   * lives in interception/ -- deliberately, because the alternative is worse: the
   * core would have to ask the airlock, which is the dependency this project has
   * removed twice. A changelock in structure.test.js compares it to
   * SearchEngineCatalog.all().length and goes red the day a fifth ships.
   */
  const BUILT_IN_ENGINES = 4;

  /**
   * The built-in catalogue plus every custom domain that may exist. DERIVED, and
   * that is the fix: it was the literal 64 under a comment that said "the number
   * of engines that can exist: the built-in catalogue plus the custom domains,
   * themselves capped" -- which is 24. The cap was 2.7x its own justification.
   *
   * WHAT THE GAP COST, and it is not academic. activeBindings() iterates the
   * ticked ids WITHOUT consulting the catalogue -- it cannot, the core holds only
   * opaque identities -- so an id that resolves to no engine still consumes a
   * binding, and _guarded refuses every register past MAX_BINDINGS (300). A
   * synced document ticking 64 well-formed but non-existent ids, with five armed
   * shortcuts pointing at ordinary https hosts (hence no warning to acknowledge,
   * hence live even after the sync door drops the attestations), pushed
   * 5 x 64 = 320 past the ceiling: every shortcut after the fourth landed in
   * quarantine, on every device, repairable only by hand.
   *
   * At 24 the same document buys nothing a legitimate configuration cannot
   * reach on its own -- 24 engines ticked allows 12 live shortcuts, which is the
   * DNR rule ceiling talking, not an adversary. The phantom ids still cost a
   * binding each; what changes is that the cost is now bounded by what the user
   * could have done themselves, which is the only bound that means anything here.
   */
  const MAX_ENGINES = BUILT_IN_ENGINES + MAX_CUSTOM_ENGINES;
  // What a configuration FILE may weigh. It was written as `64 * 1024` inside the
  // options page -- a security bound living on the surface it protects, with no
  // relation to the limits beside it here and nothing testing it.
  const MAX_TRANSFER_BYTES = 64 * 1024;

  /**
   * A CHEAP ABSOLUTE GUARD AGAINST UNBOUNDED WORK, and the only bound that runs
   * before anything is read.
   *
   * Generous on purpose: its job is TERMINATION, not selection. The selection
   * bound (MAX_ENGINES) now applies to the ids that were successfully READ, which
   * means the loop must be allowed to walk the whole list -- and a list nobody
   * bounded is a list that can be a megabyte of strings.
   *
   * Two bounds, two jobs, the same shape as the 40-character custom domain facing
   * the RE2 budget: one is refused at the door with a sentence, the other is what
   * the machine can carry.
   */
  const MAX_RAW_ENGINES = 1000;

  const refuse = (code, message) => ({ ok: false, code, message });

  const ShortcutAdmission = {
    /**
     * The shared validator: ONE entry. Everything above it differs between the
     * two doors; this is what they genuinely have in common.
     */
    admitEntry(raw) {
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        return refuse("ENTRY_NOT_AN_OBJECT", "A shortcut must be an object.");
      }
      for (const field of Object.keys(raw)) {
        if (!SHORTCUT_FIELDS.has(field)) {
          return refuse("UNKNOWN_FIELD", `Unknown field "${field}" on a shortcut.`);
        }
      }
      const id = global.ShortcutId.parse(raw.id);
      if (!id.ok) return id;
      // ShortcutKey.parse, not ProjectKey.parse: this is the storage and import
      // door, and it is the ONLY place where a string becomes a catch-all key.
      const key = global.ShortcutKey.parse(raw.key);
      if (!key.ok) return key;
      const instance = JiraInstance.parse(raw.baseUrl);
      if (!instance.ok) return instance;
      const consent = Consent.parse(raw.consent);
      if (!consent.ok) return consent;
      return { ok: true, value: { id: raw.id, key: key.value, instance: instance.value, consent: consent.value } };
    },

    /**
     * JSON.parse alone is NOT vulnerable: "__proto__" becomes an own property on
     * an ordinary object and the prototype is untouched. The danger lies in what
     * you do next -- a recursive merge. We never merge (see restore/proposeImport,
     * which build a fresh policy field by field, by explicit reads, never by
     * iterating over the input's keys). This reviver is the belt on top of the
     * braces, and it REFUSES rather than strips: those keys in a team config are
     * an attack signal, not a typo.
     */
    parseJson(text) {
      try {
        const value = JSON.parse(text, (key, v) => {
          if (key === "__proto__" || key === "constructor" || key === "prototype") {
            throw new Error("MALICIOUS_KEY");
          }
          return v;
        });
        return { ok: true, value };
      } catch (error) {
        if (error.message === "MALICIOUS_KEY") {
          return refuse("MALICIOUS_KEY", "This file contains keys that are never legitimate.");
        }
        return refuse("NOT_JSON", "This file is not valid JSON.");
      }
    },
  };


  /** Custom domains go through parse like everything else, and a bad one is refused. */
  const admitCustomEngines = (raws, policy, refused) => {
    let result = policy;
    for (const raw of raws) {
      const engine = global.CustomEngine.parse(raw);
      if (!engine.ok) {
        refused.push({ entry: raw, code: engine.code, message: engine.message });
        continue;
      }
      const added = result.withCustomEngine(engine.value);
      if (added.ok) result = added.value;
      else refused.push({ entry: raw, code: added.code, message: added.message });
    }
    return result;
  };

  /**
   * THE DOCUMENT'S ORDER SURVIVES BY CONSTRUCTION -- this only says so out loud.
   *
   * There used to be a reassertOrder() here that re-applied the order after the
   * admission loop. It could never repair anything, and it is worth writing down
   * why, because the next reader will want to bring it back:
   *
   *   register APPENDS, always (see ShortcutRegistry: _with leans on Map.set,
   *   which keeps an existing key's position and puts a new one last). The loop
   *   walks the document in order and appends what it admits, so orderedIds() IS
   *   the admitted ids in document order before anyone reasserts anything.
   *   withOrder on that list hit `ids.every((id, i) => id === current[i])` and
   *   returned ok(this). A no-op, provably.
   *
   * And it was a HARMFUL no-op. Its `wanted.length !== held.size` guard opened on
   * exactly one case -- a duplicate id, which the document's own quarantine now
   * refuses -- and its answer there was `return policy`, silently abandoning the
   * order. Skipping an entry SHIFTS NOTHING when insertion is append-only, so the
   * comment that justified the whole function was wrong too.
   *
   * A post-condition, therefore, and it THROWS. The day register starts placing
   * rows instead of appending them, this is what must fall -- loudly, at the
   * door -- rather than the user's evaluation order going quiet. And the order is
   * the destination: it decides who intercepts what.
   */
  const assertAdmittedInDocumentOrder = (policy, admittedIds) => {
    const held = policy.orderedIds();
    const same =
      held.length === admittedIds.length && held.every((id, i) => id === admittedIds[i]);
    if (!same) {
      throw new Error("ADMISSION_ORDER_BROKEN: register no longer appends in document order");
    }
  };

  const readDocument = (raw) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return refuse("NOT_A_DOCUMENT", "The configuration must be an object.");
    }
    if (!Number.isInteger(raw.schemaVersion)) {
      return refuse("SCHEMA_MISSING", "The configuration has no schema version.");
    }
    // Refusing a version NEWER than the code is the real case: storage fed by a
    // browser that has already been updated. Refuse to use, never overwrite.
    if (raw.schemaVersion > JumpPolicy.SCHEMA_VERSION) {
      return refuse("SCHEMA_TOO_NEW", "This configuration was written by a newer version.");
    }
    if (!Array.isArray(raw.shortcuts)) {
      return refuse("SHORTCUTS_NOT_A_LIST", "`shortcuts` must be a list.");
    }
    if (raw.shortcuts.length > JumpPolicy.MAX_SHORTCUTS) {
      return refuse("TOO_MANY_SHORTCUTS", "This configuration has too many shortcuts.");
    }
    const rawEngines = raw.engines === undefined ? [] : raw.engines;
    if (!Array.isArray(rawEngines) || rawEngines.some((e) => typeof e !== "string")) {
      return refuse("ENGINES_NOT_A_LIST", "`engines` must be a list of engine ids.");
    }
    // BOUNDED LIKE ITS NEIGHBOURS, and the omission was not benign.
    //
    // customEngines was capped at 20 and shortcuts at 200; the ticked selection
    // was capped at nothing. Bindings are shortcuts x engines, so a document
    // carrying five thousand ids pushes activeBindings() past MAX_BINDINGS --
    // and _guarded then refuses EVERY register, so the WHOLE configuration lands
    // in quarantine, on every device the sync reaches. A denial of service on
    // the configuration, through the field nobody had counted.
    //
    // The cap is the number of engines that can exist: the built-in catalogue
    // plus the custom domains, themselves capped. Anything beyond is not a
    // selection, it is a payload.
    //
    // IT TRUNCATES, IT DOES NOT REFUSE THE DOCUMENT -- and that is this file's own
    // rule, stated forty lines below about a single unreadable id: "A refused id is
    // DROPPED, never fatal: it is one entry of a list, and losing the whole
    // configuration over a ticked engine would be the denial of service the bound
    // above exists to prevent." The bound was the one place that broke its own rule.
    //
    // AND IT COUNTS WHAT WAS READ, NOT WHAT ARRIVED. The first version sliced the
    // RAW list, before a single identity had been read -- so a malformed id, or a
    // duplicate, CONSUMED THE PLACE of a real engine. Measured:
    //
    //   engines: [ 24 well-formed but non-existent ids…, "google.com" ]
    //     -> the 24 are kept, google.com is evicted
    //   engines: [ 24 malformed ids ("foo", "bar"…), "google.com" ]
    //     -> 24 slots consumed then refused, google.com evicted -> ZERO engines
    //
    // The eviction order belonged to whoever wrote the document. The bound now
    // counts admitted ids, so nothing a later line refuses can cost a slot. What
    // remains, and it is the right residual: an adversary can still pad with
    // MAX_ENGINES VALID ids -- which is exactly what a legitimate configuration
    // can do.
    //
    // TWO REASONS, and the second is the one that decided it.
    //
    //   1. A DOWNGRADE CLIFF. This cap used to be 64 -- 2.7x the number of engines
    //      that can exist -- and tightening it to the derived 24 would have made a
    //      document written by a FUTURE build (more built-in engines, same schema
    //      version, so SCHEMA_TOO_NEW never fires) refuse ENTIRELY on the way back.
    //      The headroom was doing work nobody had named.
    //   2. IT CLOSES THE AMPLIFICATION COMPLETELY. A refusal leaves the hostile
    //      document's OTHER effects in place only if some later door admits it;
    //      truncation means no policy can ever hold more than MAX_ENGINES ticked
    //      ids, whatever arrives. A ticked id that resolves to no engine still
    //      costs a binding, so this is the field that fed the quarantine cascade,
    //      and a hard ceiling beats a refusal that a future field could bypass.
    //
    // Fail-closed and VISIBLE: a dropped id is an engine that is not intercepted,
    // and the Engines section shows its chip unticked. Nothing silently redirects.
    //
    // WHY `shortcuts` AND `customEngines` KEEP REFUSING the document, three lines
    // apart from this: their bounds are not the same kind of thing. Truncating
    // `shortcuts` would DELETE shortcuts -- the very loss quarantine exists to
    // prevent -- and truncating `customEngines` would leave ticked ids pointing at
    // domains that no longer exist. A selection is the only one of the three whose
    // excess can be dropped without losing something the user made.
    if (rawEngines.length > MAX_RAW_ENGINES) {
      return refuse("TOO_MANY_ENGINES", "This configuration ticks too many search engines.");
    }
    // Selections written before engines were split per domain would otherwise
    // resolve to nothing, and an existing configuration would quietly stop working.
    // THROUGH THE VALUE OBJECT, which migrates an old spelling AND refuses what
    // cannot be an engine identity. It was a bare string all the way to the
    // catalogue's Map keys, a rule label and a permission origin, so nothing
    // stopped a host name or an origin from being ticked.
    //
    // A refused id is DROPPED, never fatal: it is one entry of a list, and losing
    // the whole configuration over a ticked engine would be the denial of service
    // the bound above exists to prevent.
    //
    // THE TWO REGISTERS ARE DECLARED BEFORE THE LOOP THAT FILLS THEM, and that is
    // not a style question: `unreadableEngines` was a `const` sitting FORTY-FIVE
    // LINES BELOW its only writer, so the first refused id hit the temporal dead
    // zone and threw `ReferenceError: Cannot access 'unreadableEngines' before
    // initialization`.
    //
    // The throw escaped readDocument, hence JumpPolicy.restore, hence
    // PolicyRepository.load -- where nobody expects a jet, because every other
    // failure on this path is a VALUE. background.js caught it in its outer catch
    // and purged the rules; the options page did not catch it at all
    // (section-host.js awaits load() outside a try), so the screen stayed mounted,
    // blank and mute, with no way to repair the very entry that broke it. On every
    // device the sync reached.
    //
    // The sentence three lines above -- "a refused id is DROPPED, never fatal" --
    // was therefore the exact opposite of what the code did, and the only shape
    // that reached it was a STRING that is not an engine identity ("foo",
    // "https://google.com", a bare label with no dot): a non-string is refused
    // earlier, as ENGINES_NOT_A_LIST.
    const unreadable = [];
    const unreadableEngines = [];
    const engines = [];
    const seenEngines = new Set();
    let truncatedEngines = 0;
    for (const raw of rawEngines) {
      // THE SELECTION BOUND, on what has been ADMITTED. Placed before the parse
      // so a full list stops costing work, and after nothing else so a refused or
      // duplicate id cannot occupy a slot.
      if (engines.length >= MAX_ENGINES) {
        truncatedEngines += 1;
        continue;
      }
      const parsed = global.EngineId.parse(raw);
      if (!parsed.ok) {
        unreadableEngines.push({ code: parsed.code, message: parsed.message });
        continue;
      }
      const written = parsed.value.toString();
      if (seenEngines.has(written)) continue;
      seenEngines.add(written);
      engines.push(written);
    }
    if (truncatedEngines > 0) {
      // SAID, like the arming state below: a selection that arrived longer than
      // anything that can be selected is a fact about the document, not an entry
      // that was refused, so it travels in `unreadable` and never in `refused`.
      // "refused" is the verdict word, per the vocabulary map in
      // core/mutation-result.js, and a structure test holds it.
      unreadableEngines.push({ code: "ENGINES_TRUNCATED" });
    }
    const customEngines = raw.customEngines === undefined ? [] : raw.customEngines;
    if (!Array.isArray(customEngines)) {
      return refuse("CUSTOM_ENGINES_NOT_A_LIST", "`customEngines` must be a list.");
    }
    if (customEngines.length > MAX_CUSTOM_ENGINES) {
      return refuse("TOO_MANY_CUSTOM_ENGINES", "This configuration has too many domains.");
    }
    // THE KILL SWITCH IS READ, NEVER COPIED.
    //
    // `armed: raw.armed` let "false", 0, null and {} through, and `restore` armed
    // on anything that was not exactly `false`. A switch has two positions, and
    // "I cannot read the position" is not a third one -- it is the ABSENCE of
    // consent to be armed. Same words as local-acknowledgements.js: "ABSENT OR
    // CORRUPT MEANS NOT ACKNOWLEDGED. Fail closed, never we-assume-so."
    //
    // A FIELD-SCOPED REFUSAL, never a refusal of the document. `shortcuts` not
    // being a list makes the rest impossible -- there is nothing to iterate. A
    // scalar switch is rebuilt by one click, while a refused configuration is not
    // rebuilt at all; and refusing the whole document on one flipped byte would
    // hand the very adversary this module models -- the compromised sync channel
    // -- a one-byte denial of service.
    //
    // ABSENT means disarmed, and that is EXACT rather than merely safe: toJSON
    // always writes `armed`, and the only shape that omits it is the export,
    // which proposeImport disarms anyway. No document this model ever wrote can
    // reach the absent branch.
    // A DOCUMENT-SCOPED FACT, and it travels in its own list.
    //
    // It first went into `refused`, and that was wrong twice. `refused` is the
    // register of REFUSED ENTRIES -- one entry, one reason -- so this fact had to
    // forge `entry: { armed }`, a pseudo-shortcut that was never an entry: when a
    // fact must borrow a foreign identity to fit a list, the list is the wrong
    // one. And it lied on screen: the import surface renders "Some entries were
    // refused" on `refused.length > 0`, so a file carrying `armed: "yes"` -- a
    // field that door does not even read -- announced refusals that never
    // happened, on the one surface the whole batch says must be believed.
    let armed = false;
    if (typeof raw.armed === "boolean") {
      armed = raw.armed;
    } else if (raw.armed !== undefined) {
      // Named for the GESTURE, not the typeof. Its look-alikes
      // (SHORTCUTS_NOT_A_LIST, ENGINES_NOT_A_LIST) are refusals of the whole
      // document; this one is a degradation, and the name has to say so.
      unreadable.push({
        code: "ARMING_STATE_UNREADABLE",
        message: "The saved arming state could not be read, so nothing is armed.",
      });
    }
    return {
      ok: true,
      value: {
        schemaVersion: raw.schemaVersion,
        armed,
        // ALWAYS AN ARRAY, empty when there is nothing to say. A field that shows
        // up only sometimes is the meaningful absence mutation-result.js bans --
        // and the whole point here is to stop being silent.
        unreadable: [...unreadable, ...unreadableEngines],
        engines,
        customEngines,
        shortcuts: raw.shortcuts,
      },
    };
  };

  /**
   * THE WALK BOTH DOORS SHARE, written once.
   *
   * restore and proposeImport were ninety per cent identical: same read, same
   * loop, same duplicate-id guard, same custom engines, same post-condition --
   * with three lines of difference. The header defends "two named doors rather
   * than one door with a trust flag", and that argument is right about the
   * SIGNATURE; it never required duplicating the body. So the doors stay two, and
   * what they do the same is here.
   *
   * A DOOR OBJECT, never a boolean. `keepRefused` decided TWO things under a
   * one-axis name: whether a refused entry is quarantined, AND whether the
   * entry's own consent is honoured. The second is the security-bearing axis --
   * "a hostile import is MECHANICALLY unable to install a rule until the user
   * arms each shortcut while looking at its destination" -- and a reader of the
   * parameter had no way to know it was in there. That is the mode flag this
   * file's own header condemns, one level down.
   */
  const admitAll = (document, policy, door) => {
    const quarantine = [];
    const refused = [];
    const admittedIds = [];
    let admitted = admitCustomEngines(document.customEngines, policy, refused);

    // `rejectEntry`, NEVER `refuse`: the module already has a `refuse(code,
    // message)` with a different arity and a different meaning, and shadowing it
    // here meant a future two-argument call would silently build
    // `{ entry: <code>, code: <message> }` -- in the file whose header is about
    // not confusing two doors.
    const rejectEntry = (entry, code, message) => {
      if (door.quarantines) quarantine.push(entry);
      refused.push({ entry, code, message });
    };

    for (const entry of document.shortcuts) {
      const parsed = ShortcutAdmission.admitEntry(entry);
      if (!parsed.ok) {
        rejectEntry(entry, parsed.code, parsed.message);
        continue;
      }
      const { id, key, instance, consent } = parsed.value;
      if (admittedIds.includes(id)) {
        // THE DOOR CATCHES THIS, NOT register.
        //
        // register keeps a replay no-op for an identical (id, key, instance), and
        // it must: VersionedEntry re-runs intentions against a policy that may
        // already hold their effect. But that reasoning is about ONE intention
        // retried; here we are reading a LIST, where a second identical line is a
        // second line -- a corrupt document, not a retry. register cannot tell the
        // two apart, because it does not know it is being walked through an array.
        // The door does.
        rejectEntry(entry, "DUPLICATE_ID", ShortcutRegistry.DUPLICATE_ID_MESSAGE);
        continue;
      }
      const registered = admitted.register(id, key, instance, door.consentFor(consent));
      if (!registered.ok) {
        // Never a silent `continue`.
        rejectEntry(entry, registered.code, registered.message);
        continue;
      }
      admitted = registered.value;
      admittedIds.push(id);
    }

    assertAdmittedInDocumentOrder(admitted, admittedIds);
    return { policy: admitted, quarantine, refused };
  };

  /**
   * Storage door. Always yields a policy plus whatever could not be re-read.
   *
   * `trustsSavedConsent` IS THE FIX FOR A REAL HOLE, AND IT FAILS CLOSED.
   *
   * This door used to hand the entry's own consent straight through, on the
   * sentence "the saved consent is ours: it was written by this extension, on
   * this machine, after the user read the warning". Every clause of that is true
   * of storage.local and FALSE of storage.sync -- and this extension offers a
   * switch that moves the configuration into sync. So a compromised browser
   * account could write `consent: { armed: true, acknowledged:
   * ["INSECURE_SCHEME"] }` and get an ACTIVE binding with no screen and no
   * click, pre-approving a HIGH-severity warning. Measured; see Consent.toJSON.
   *
   * IT DEFAULTS TO `false`, AND THE DEFAULT IS THE POINT.
   *
   * rule-installer.js argues that `source` must have NO default, because both of
   * its values are meaningful and an omission would fabricate one. That reasoning
   * does not transfer here, and the difference is worth naming: these two values
   * are NOT symmetric. `false` costs an acknowledgement the user gives again
   * while looking at the destination; `true` is the one that can arm a
   * high-severity warning on somebody else's word. So an omission must land on
   * `false` -- the same shape as `armed` in readDocument below, where "I cannot
   * read the position" is the ABSENCE of consent rather than a third value.
   *
   * A caller that forgets the argument therefore loses a click, never a control.
   *
   * A BOOLEAN AND NOT AN AREA NAME: the core must not learn that storage areas
   * exist. What it needs is the answer, not the reason.
   *
   * QUARANTINE, NEVER DESTRUCTION: an entry we refuse is MOVED aside, not
   * refused. Otherwise the first apply -- ticking an engine, arming a shortcut --
   * would rewrite storage from an amputated policy and erase, permanently, a
   * configuration the user created. That path opens on the FIRST UPGRADE, when a
   * hardened validator rejects entries that were legitimate before, and it hits
   * the self-hosted user first.
   */
  JumpPolicy.restore = function (raw, { trustsSavedConsent = false } = {}) {
    const document = readDocument(raw);
    if (!document.ok) return document;

    const seeded = JumpPolicy.empty().withEngines(document.value.engines);
    if (!seeded.ok) return seeded;
    // Disarmed first, then armed only on an explicit `true`: see the kill switch
    // note in readDocument.
    const start = document.value.armed === true ? seeded.value.arm() : seeded.value.disarm();

    const walked = admitAll(document.value, start, {
      // QUARANTINE, NEVER DESTRUCTION: what we cannot read is moved aside.
      quarantines: true,
      // BELIEVED ONLY WHERE IT WAS WRITTEN. On the area this browser writes
      // locally, the record genuinely is ours and carrying it is what stops an
      // upgrade from making every user re-tick every warning. On a synced
      // document it is an attacker's claim about a screen nobody saw, so the
      // arming survives and the attestations do not -- and a shortcut armed with
      // an unacknowledged warning cannot fire.
      consentFor: (consent) =>
        trustsSavedConsent === true ? consent : consent.withoutAcknowledgements(),
    });
    return {
      ok: true,
      policy: walked.policy,
      quarantine: walked.quarantine,
      refused: walked.refused,
      // Document-scoped facts, carried apart from refused entries.
      unreadable: document.value.unreadable,
    };
  };

  /**
   * Import door. Refuses wholesale, and everything that survives arrives
   * DISARMED with no acknowledgements -- three lines that make a hostile import
   * unable to install a single DNR rule until the user arms each shortcut while
   * looking at its destination.
   */
  JumpPolicy.proposeImport = function (raw) {
    if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
      for (const field of Object.keys(raw)) {
        if (!DOCUMENT_FIELDS.has(field)) {
          return refuse("UNKNOWN_FIELD", `Unknown field "${field}" in the configuration.`);
        }
      }
    }
    const document = readDocument(raw);
    if (!document.ok) return document;

    const seeded = JumpPolicy.empty().withEngines(document.value.engines);
    if (!seeded.ok) return seeded;
    // DISARMED, ALWAYS: never read from the file. Combined with fresh consent
    // inside admitAll, a hostile import is MECHANICALLY unable to install a rule
    // until the user arms each shortcut while looking at its destination.
    const walked = admitAll(document.value, seeded.value.disarm(), {
      // Nothing is set aside: the file is still on the user's disk, so a refused
      // entry is reported and nothing is lost.
      quarantines: false,
      // FRESH CONSENT, ALWAYS. No acknowledgement is importable, so a file cannot
      // pre-approve its own warnings -- this is the half of the old boolean that
      // carried the security, and it now says so.
      consentFor: () => global.Consent.fresh(),
    });

    // No `unreadable` here, deliberately: this door disarms whatever it reads, so
    // it never consults `armed`. Refusing to believe a field one was not going to
    // read is a refusal without an object -- and it would render as "some entries
    // were refused" over an import where none were.
    return { ok: true, policy: walked.policy, refused: walked.refused };
  };

  ShortcutAdmission.MAX_CUSTOM_ENGINES = MAX_CUSTOM_ENGINES;
  ShortcutAdmission.MAX_ENGINES = MAX_ENGINES;
  ShortcutAdmission.BUILT_IN_ENGINES = BUILT_IN_ENGINES;
  ShortcutAdmission.MAX_RAW_ENGINES = MAX_RAW_ENGINES;
  ShortcutAdmission.MAX_TRANSFER_BYTES = MAX_TRANSFER_BYTES;
  ShortcutAdmission.MAX_QUARANTINE = MAX_QUARANTINE;
  global.ShortcutAdmission = ShortcutAdmission;
})(globalThis);
