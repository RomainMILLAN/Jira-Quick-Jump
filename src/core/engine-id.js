/**
 * The identifier of a search engine, and the one place an old spelling is
 * translated.
 *
 * IT LIVES IN core/ BECAUSE THE DOOR THAT NEEDS IT DOES.
 *
 * admission.js -- the storage door, which is core -- called
 * SearchEngineCatalog.migrateId, so `core/` depended on `interception/`. That is
 * the exact inversion rule-factory.js states in the other direction ("the core
 * only holds opaque engine ids"), and the dependency was invisible because both
 * modules meet on globalThis.
 *
 * Reading a saved document is a DOMAIN concern: it decides what an old
 * configuration means today. The catalogue's job is to know what an engine looks
 * like on the wire -- host patterns, query parameters, shapes -- and it keeps
 * that. What travels here is only the spelling, which is why this file knows no
 * host, no shape and no pattern.
 *
 * Ids written before engines were split per domain: a selection saved as
 * `google` would otherwise resolve to nothing, and an existing configuration
 * would quietly stop working.
 */
(function (global) {
  "use strict";

  const LEGACY = Object.freeze({
    google: "google.com",
    bing: "bing.com",
    duckduckgo: "duckduckgo.com",
  });

  const EngineId = {
    /** The id as it is written today. Unknown spellings pass through: an id this
     *  build does not recognise may still be a custom domain, and refusing it
     *  here would delete a selection the user made. */
    current(id) {
      return LEGACY[id] || id;
    },
  };

  EngineId.LEGACY = LEGACY;
  global.EngineId = EngineId;
})(globalThis);
