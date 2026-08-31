/**
 * The closed catalogue of search engines, plus the domains the user added.
 *
 * ONE ENTRY PER DOMAIN, deliberately. An entry that covered fifteen Google TLDs
 * at once made the browser's permission prompt say "and 15 other sites", which
 * for an extension whose whole argument is that it never asks for broad access
 * is the wrong first impression. Now the prompt contains exactly what was ticked.
 *
 * The SHAPES are closed and the host is not. A user-supplied path or query
 * parameter would mean a user-supplied regex; a user-supplied host only widens
 * the alternation, and it is validated as a plain domain name first.
 */
(function (global) {
  "use strict";

  // How an engine builds its search URL. Adding a shape is a decision made here,
  // never by whoever types a domain into the options page.
  const SHAPES = {
    "search-q": { pathPattern: "/search", queryParam: "q" },
    "root-q": { pathPattern: "/", queryParam: "q" },
  };

  const BUILT_IN = [
    { id: "google.com", label: "Google.com", domain: "google.com", shape: "search-q" },
    { id: "google.fr", label: "Google.fr", domain: "google.fr", shape: "search-q" },
    { id: "bing.com", label: "Bing", domain: "bing.com", shape: "search-q" },
    { id: "duckduckgo.com", label: "DuckDuckGo", domain: "duckduckgo.com", shape: "root-q" },
  ];

  // Selections written before engines were split per domain. Without this, an
  // existing configuration silently loses every engine and stops jumping.
  const LEGACY_IDS = {
    google: "google.com",
    bing: "bing.com",
    duckduckgo: "duckduckgo.com",
  };

  const build = ({ id, label, domain, shape }) => {
    const form = SHAPES[shape];
    if (!form) return null;
    const hostPattern = "(?:www\\.)?" + domain.replace(/\./g, "\\.");
    return {
      id,
      label,
      domain,
      shape,
      hostPattern,
      pathPattern: form.pathPattern,
      queryParam: form.queryParam,
      // Explicit https, and derived from the very domain the pattern matches:
      // Chrome refuses a request that falls outside the manifest's optional
      // patterns, and a rule matching a host we never asked for installs and then
      // never fires.
      permissionOrigins: [`https://*.${domain}/*`],
      exampleUrl: `https://${domain}${form.pathPattern === "/" ? "/" : form.pathPattern}?${form.queryParam}=ABC-1234`,

      /**
       * Wraps the typed-text fragment AND places the anchors. The seam is decided
       * here: ReferencePattern returns an UNANCHORED fragment, the engine adds
       * ^https:// at the front and (?:&|$) at the back.
       *
       * (?:&|$) is what turns "the regex stops here" into "the typed text must be
       * EXACTLY an issue reference, nothing more" — the decision that bounds false
       * positives.
       */
      /**
       * The URL this engine would build for that text. The engine's FORMAT must
       * not have two homes, so the preview asks rather than assembling.
       */
      searchUrlFor(text) {
        return (
          "https://" + domain + (form.pathPattern === "/" ? "/" : form.pathPattern) +
          "?" + form.queryParam + "=" + encodeURIComponent(text)
        );
      },

      searchUrlPattern(typedTextFragment) {
        return (
          "^https://" +
          hostPattern +
          form.pathPattern +
          "\\?(?:.*&)?" +
          form.queryParam +
          "=" +
          typedTextFragment +
          "(?:&|$)"
        );
      },
    };
  };

  const builtIn = new Map(BUILT_IN.map((e) => [e.id, build(e)]));

  const view = (entries) => ({
    all() { return [...entries.values()]; },
    find(id) { return entries.get(id); },
    has(id) { return entries.has(id); },
    ids() { return [...entries.keys()]; },
  });

  const SearchEngineCatalog = {
    ...view(builtIn),

    SHAPES: Object.keys(SHAPES),
    shapeLabel(shape) {
      return SHAPES[shape] ? `${SHAPES[shape].pathPattern}?${SHAPES[shape].queryParam}=` : shape;
    },

    /** Built-ins plus this policy's own domains — the lookup every caller needs. */
    forPolicy(policy) {
      const entries = new Map(builtIn);
      // Deduplicated by (hostPattern, shape), not by id. A custom domain
      // duplicating a built-in one (custom:google.com next to google.com) would
      // otherwise emit two rules with the SAME priority, the SAME action and the
      // SAME regexFilter -- reaching DNR's unspecified tie-break through a
      // perfectly legitimate configuration.
      const seen = new Set([...builtIn.values()].map((e) => e.hostPattern + "|" + e.shape));
      for (const custom of policy.customEngines()) {
        const entry = build({
          id: custom.id(), label: custom.label(), domain: custom.host(), shape: custom.shape(),
        });
        // An unknown shape is filtered here, exactly as an unknown engine id is:
        // translate AND filter is the airlock's job.
        if (!entry) continue;
        const signature = entry.hostPattern + "|" + entry.shape;
        if (seen.has(signature)) continue;
        seen.add(signature);
        entries.set(entry.id, entry);
      }
      return view(entries);
    },

    /** Maps an id written before engines were split per domain. */
    migrateId(id) {
      return LEGACY_IDS[id] || id;
    },
  };

  global.SearchEngineCatalog = SearchEngineCatalog;
})(globalThis);
