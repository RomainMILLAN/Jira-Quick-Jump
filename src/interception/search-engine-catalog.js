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
  /**
   * THE PARAMETER WE READ MUST BE THE ONE THE ENGINE READS -- the first of its
   * name, not any of its name.
   *
   * `\\?(?:.*&)?q=` stood here, and `.*&` happily swallowed `q=hello&` in
   * `?q=hello&q=ABC-1`: the rule matched the SECOND `q`, which every search
   * engine ignores. A third-party page could therefore navigate a visitor to
   * `<their Jira>/browse/ABC-1` -- with a catch-all armed, to `/browse/ANYTHING`
   * -- without a search ever happening, and without the address bar being used.
   * The redirect is the extension's, so the flow is the extension's to close.
   *
   * RE2 has no lookaround, so "no earlier parameter of this name" is spelled by
   * enumerating what a DIFFERENT name looks like: one that diverges at the first
   * character, or one that starts with it and runs longer. The trailing `?`
   * admits the nameless `?=v&` that browsers tolerate.
   *
   * THE COST IS ONE ALTERNATION OF TWO, and it is paid out of the eleven units
   * re2-budget.js calls "a dated bet" against the unmeasured envelope. If Chrome
   * ever refuses a rule over this, the fix is re2-budget's documented one -- drop
   * MAX_ALTERNATION_COST to 50 -- and never widening this back, which would
   * reopen the flow above.
   *
   * Single-character names only, which is what both shapes use. A longer name
   * would need one alternative per position, and that IS a budget question rather
   * than a free one -- so it fails loudly here instead of silently there.
   */
  const noEarlier = (queryParam) => {
    if (queryParam.length !== 1) {
      throw new Error(`query parameter ${queryParam}: only single-character names are budgeted`);
    }
    return `(?:(?:[^=&${queryParam}][^=&]*|${queryParam}[^=&]+)?=[^&]*&)*`;
  };

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
  const build = ({ id, label, domain, shape }) => {
    const form = SHAPES[shape];
    // `undefined`, like find() two lines down. This file had BOTH spellings of
    // absence, and the caller wrote `if (!entry) continue` to cover the pair --
    // a presence test that exists only because the vocabulary was double.
    if (!form) return undefined;
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
       *
       * The URL this engine would build for that text. The engine's FORMAT must
       * not have two homes, so the preview asks rather than assembling.
       *
       * THE FORM A BROWSER ACTUALLY EMITS.
       *
       * encodeURIComponent turns a space into %20, and a browser's address bar
       * emits `+`. The rule matches both, so the preview still said "matched" --
       * BUT THROUGH THE OTHER BRANCH OF THE ALTERNATION than the one reality
       * takes. A screen that claims to simulate the delivered programme was
       * validating a path no navigation ever walks, and the day one of the two
       * forms is dropped the regression net would stay green.
       */
      searchUrlFor(text) {
        return (
          "https://" + domain + (form.pathPattern === "/" ? "/" : form.pathPattern) +
          "?" + form.queryParam + "=" + encodeURIComponent(text).replace(/%20/g, "+")
        );
      },

      /**
       * `exactParameter` DECIDES HOW STRICT THE QUERY PREFIX IS, and the two
       * answers are not a matter of taste -- they are the two directions of failure.
       *
       *   REDIRECT rules  -> strict. The rule must fire on the parameter the engine
       *                      READS, i.e. the FIRST of its name. Firing on a later
       *                      one lets any page navigate a visitor to their Jira.
       *                      Matching too WIDE here is a real outbound flow.
       *   ALLOW guards    -> wide. A guard exists to STOP a redirect. Matching too
       *                      wide only ever stops more, which is the safe direction;
       *                      matching too NARROW is what would let ISO-9001 leave.
       *
       * And the width is what pays for itself: the strict prefix costs thirty-odd
       * characters on EVERY rule, and it was those characters -- multiplied by four
       * engines and five guard runs -- that pushed the reserved-prefix guards past
       * what Chrome accepts, so the browser refused them and the catch-all fell with
       * its unit. Spending them only where they buy something is not an optimisation.
       */
      searchUrlPattern(typedTextFragment, { exactParameter = true } = {}) {
        return (
          "^https://" +
          hostPattern +
          form.pathPattern +
          "\\?" +
          (exactParameter ? noEarlier(form.queryParam) : "(?:.*&)?") +
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
        if (entry === undefined) continue;
        const signature = entry.hostPattern + "|" + entry.shape;
        if (seen.has(signature)) {
          /**
           * A DUPLICATE IS ALIASED, NEVER DROPPED -- and this was a real fault, not
           * a tidiness question.
           *
           * `google.fr` ships as a built-in. A user who ALSO adds it as a custom
           * domain gets an entry with the same hostPattern and shape, so it was
           * skipped here to avoid emitting two identical rules at the same priority
           * (which reaches DNR's unspecified tie-break). But the id `custom:google.fr`
           * stayed ticked in the policy, and `catalog.find()` then answered nothing:
           * every binding on that engine became UNKNOWN_ENGINE -- INCLUDING THE
           * CATCH-ALL'S, which is why the page said "the catch-all could not be
           * installed" while listing google.fr as a chosen engine.
           *
           * Deduplication is still what ships: the same entry is registered under
           * BOTH ids, so exactly one rule is emitted and the ticked id resolves.
           */
          const twin = [...entries.values()].find(
            (e) => e.hostPattern + "|" + e.shape === signature
          );
          if (twin) entries.set(entry.id, twin);
          continue;
        }
        seen.add(signature);
        entries.set(entry.id, entry);
      }
      return view(entries);
    },

    /** Kept as a convenience for callers already holding the catalogue; the
     *  identity itself is owned by core/engine-id.js, because the storage door
     *  needs it and the storage door is core. An id this build cannot read at all
     *  resolves to itself, and the lookup then simply finds nothing. */
    migrateId(id) {
      const parsed = global.EngineId.parse(id);
      return parsed.ok ? parsed.value.toString() : String(id);
    },
  };

  global.SearchEngineCatalog = SearchEngineCatalog;
})(globalThis);
