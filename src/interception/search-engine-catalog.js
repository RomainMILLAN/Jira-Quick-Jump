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

  const ENGINES = [
    {
      id: "google",
      label: "Google",
      hostPattern: "(?:www\\.)?google\\.[a-z.]+",
      pathPattern: "/search",
      queryParam: "q",
      permissionOrigins: ["*://*.google.com/*"],
      exampleUrl: "https://www.google.com/search?q=ABC-1234",
    },
    {
      id: "bing",
      label: "Bing",
      hostPattern: "(?:www\\.)?bing\\.com",
      pathPattern: "/search",
      queryParam: "q",
      permissionOrigins: ["*://*.bing.com/*"],
      exampleUrl: "https://www.bing.com/search?q=ABC-1234",
    },
    {
      id: "duckduckgo",
      label: "DuckDuckGo",
      hostPattern: "(?:www\\.)?duckduckgo\\.com",
      pathPattern: "/",
      queryParam: "q",
      permissionOrigins: ["*://*.duckduckgo.com/*"],
      exampleUrl: "https://duckduckgo.com/?q=ABC-1234",
    },
  ];

  const build = (engine) => ({
    ...engine,
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
        engine.hostPattern +
        path +
        "\\?(?:.*&)?" +
        engine.queryParam +
        "=" +
        typedTextFragment +
        "(?:&|$)"
      );
    },
  });

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
