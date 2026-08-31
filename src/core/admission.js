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


  /** Custom domains go through parse like everything else, and a bad one is dropped. */
  const admitCustomEngines = (raws, policy, dropped) => {
    let result = policy;
    for (const raw of raws) {
      const engine = global.CustomEngine.parse(raw);
      if (!engine.ok) {
        dropped.push({ entry: raw, code: engine.code, message: engine.message });
        continue;
      }
      const added = result.withCustomEngine(engine.value);
      if (added.ok) result = added.value;
      else dropped.push({ entry: raw, code: added.code, message: added.message });
    }
    return result;
  };

  /**
   * Puts the surviving shortcuts back into the document's order.
   *
   * A no-op when nothing was quarantined, and never a repair: an id the policy
   * does not hold is simply absent from the list.
   */
  const reassertOrder = (policy, rawShortcuts) => {
    const held = new Set(policy.registry().orderedIds());
    const wanted = rawShortcuts
      .map((entry) => (entry && typeof entry.id === "string" ? entry.id : undefined))
      .filter((id) => id !== undefined && held.has(id));
    if (wanted.length !== held.size) return policy;
    const ordered = policy.withOrder(wanted);
    return ordered.ok ? ordered.value : policy;
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
    // Selections written before engines were split per domain would otherwise
    // resolve to nothing, and an existing configuration would quietly stop working.
    const engines = [...new Set(rawEngines.map((id) => global.SearchEngineCatalog.migrateId(id)))];
    const customEngines = raw.customEngines === undefined ? [] : raw.customEngines;
    if (!Array.isArray(customEngines)) {
      return refuse("CUSTOM_ENGINES_NOT_A_LIST", "`customEngines` must be a list.");
    }
    if (customEngines.length > MAX_CUSTOM_ENGINES) {
      return refuse("TOO_MANY_CUSTOM_ENGINES", "This configuration has too many domains.");
    }
    return {
      ok: true,
      value: {
        schemaVersion: raw.schemaVersion,
        armed: raw.armed,
        engines,
        customEngines,
        shortcuts: raw.shortcuts,
      },
    };
  };

  /**
   * Storage door. Always yields a policy plus whatever could not be re-read.
   *
   * QUARANTINE, NEVER DESTRUCTION: an entry we refuse is MOVED aside, not
   * dropped. Otherwise the first apply -- ticking an engine, arming a shortcut --
   * would rewrite storage from an amputated policy and erase, permanently, a
   * configuration the user created. That path opens on the FIRST UPGRADE, when a
   * hardened validator rejects entries that were legitimate before, and it hits
   * the self-hosted user first.
   */
  JumpPolicy.restore = function (raw) {
    const document = readDocument(raw);
    if (!document.ok) return document;

    const quarantine = [];
    const dropped = [];
    let policy = JumpPolicy.empty()
      .withEngines(document.value.engines)
      .value.disarm();
    policy = admitCustomEngines(document.value.customEngines, policy, dropped);
    if (document.value.armed !== false) policy = policy.arm();

    for (const entry of document.value.shortcuts) {
      const admitted = ShortcutAdmission.admitEntry(entry);
      if (!admitted.ok) {
        quarantine.push(entry);
        dropped.push({ entry, code: admitted.code, message: admitted.message });
        continue;
      }
      const { id, key, instance, consent } = admitted.value;
      const registered = policy.register(id, key, instance, consent);
      if (!registered.ok) {
        // A register refused at restore time -- BINDING_LIMIT because the cap was
        // higher when this was written, or DUPLICATE_KEY -- goes to quarantine.
        // Never a silent `continue`.
        quarantine.push(entry);
        dropped.push({ entry, code: registered.code, message: registered.message });
        continue;
      }
      policy = registered.value;
    }

    // The document's order IS the evaluation order, and it must survive the
    // round trip. register appends, so replaying the array in sequence already
    // preserves it -- but quarantine SHIFTS the positions of everything after a
    // rejected entry, so the surviving order is reasserted explicitly.
    policy = reassertOrder(policy, document.value.shortcuts);

    if (quarantine.length > MAX_QUARANTINE) {
      // Discarding would be exactly what quarantine exists to prevent, so we
      // refuse to load instead, like SCHEMA_TOO_NEW.
      return refuse("QUARANTINE_FULL", "Too many entries could not be read.");
    }
    return { ok: true, policy, quarantine, dropped };
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

    const dropped = [];
    // Disarmed, always: never read from the file.
    let policy = JumpPolicy.empty().withEngines(document.value.engines).value.disarm();
    policy = admitCustomEngines(document.value.customEngines, policy, dropped);

    for (const entry of document.value.shortcuts) {
      const admitted = ShortcutAdmission.admitEntry(entry);
      if (!admitted.ok) {
        dropped.push({ entry, code: admitted.code, message: admitted.message });
        continue;
      }
      const { id, key, instance } = admitted.value;
      // Consent.fresh(): no acknowledgement is importable, so a file cannot
      // pre-approve its own warnings.
      const registered = policy.register(id, key, instance, global.Consent.fresh());
      if (!registered.ok) {
        dropped.push({ entry, code: registered.code, message: registered.message });
        continue;
      }
      policy = registered.value;
    }
    policy = reassertOrder(policy, document.value.shortcuts);
    return { ok: true, policy, dropped };
  };

  ShortcutAdmission.MAX_CUSTOM_ENGINES = MAX_CUSTOM_ENGINES;
  ShortcutAdmission.MAX_QUARANTINE = MAX_QUARANTINE;
  global.ShortcutAdmission = ShortcutAdmission;
})(globalThis);
