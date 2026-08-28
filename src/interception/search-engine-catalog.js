/**
 * The closed catalogue of search engines: the translation table for "how does
 * this foreign system encode the text the human typed".
 *
 * This is the anticorruption layer in data form. Each entry carries the COMPLETE
 * triplet of what actually varies -- host, path and query parameter -- so that
 * "adding an engine is one entry" is true rather than merely claimed. Pulling
 * only the host out and freezing `/search?q=` would send the first engine using
 * text= (Yandex) or wd= (Baidu) straight back into rule-factory.
 */
(function (global) {
  "use strict";

  // The domains a browser actually sends an omnibox search to. Both the host
  // pattern AND the permission origins are DERIVED from this one list, so the
  // rule can never match a host we did not ask permission for — the mismatch that
  // makes a redirect install and then silently never fire.
  // Kept deliberately short: every domain here becomes a line in the browser's
  // permission prompt, and a prompt naming fifteen sites reads as an extension
  // asking for a lot — which is the opposite of what this one is.
  //
  // Adding a domain is one entry, and it updates the rule and the permission
  // request together. If a jump silently stops working on google.<something>,
  // this list is the first place to look.
  const GOOGLE_DOMAINS = [
    "google.com", "google.fr", "google.co.uk", "google.de", "google.es",
  ];

  const ENGINES = [
    {
      id: "google",
      label: "Google",
      domains: GOOGLE_DOMAINS,
      pathPattern: "/search",
      queryParam: "q",
      exampleUrl: "https://www.google.com/search?q=ABC-1234",
    },
    {
      id: "bing",
      label: "Bing",
      domains: ["bing.com"],
      pathPattern: "/search",
      queryParam: "q",
      exampleUrl: "https://www.bing.com/search?q=ABC-1234",
    },
    {
      id: "duckduckgo",
      label: "DuckDuckGo",
      domains: ["duckduckgo.com"],
      pathPattern: "/",
      queryParam: "q",
      exampleUrl: "https://duckduckgo.com/?q=ABC-1234",
    },
  ];

  const build = (engine) => {
    const hostPattern =
      "(?:www\\.)?(?:" + engine.domains.map((d) => d.replace(/\./g, "\\.")).join("|") + ")";
    return {
      ...engine,
      hostPattern,
      // Explicit https, never a wildcard scheme: Chrome refuses a request that
      // is not entirely inside the manifest's optional_host_permissions, and it
      // refuses it silently.
      permissionOrigins: engine.domains.map((d) => `https://*.${d}/*`),

      /**
       * Wraps the typed-text fragment AND places the anchors. The seam is decided
       * here: ReferencePattern returns an UNANCHORED fragment, the engine adds
       * ^https:// at the front and (?:&|$) at the back. Without this rule the
       * anchor would one day be doubled or missing.
       *
       * (?:&|$) is what turns "the regex stops here" into "the typed text must be
       * EXACTLY an issue reference, nothing more" -- the decision that bounds false
       * positives.
       */
      searchUrlPattern(typedTextFragment) {
        const path = engine.pathPattern === "/" ? "/" : engine.pathPattern;
        return (
          "^https://" +
          hostPattern +
          path +
          "\\?(?:.*&)?" +
          engine.queryParam +
          "=" +
          typedTextFragment +
          "(?:&|$)"
        );
      },
    };
  };

  const byId = new Map(ENGINES.map((e) => [e.id, build(e)]));

  const SearchEngineCatalog = {
    all() {
      return [...byId.values()];
    },
    find(id) {
      return byId.get(id);
    },
    has(id) {
      return byId.has(id);
    },
    ids() {
      return [...byId.keys()];
    },
  };

  global.SearchEngineCatalog = SearchEngineCatalog;
})(globalThis);
