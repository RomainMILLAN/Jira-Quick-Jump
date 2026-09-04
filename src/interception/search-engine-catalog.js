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
   *
   * A PERCENT SIGN CANNOT OPEN A PRECEDING PARAMETER NAME, and that one character
   * closes the encoded form of the very hole this function exists for.
   *
   * The first alternative only ever required a first character other than `q`, so
   * `%71` satisfied it -- and `%71` IS `q` once decoded. On an engine that decodes
   * parameter NAMES, `?%71=hello&q=ABC-1` therefore had the rule fire on the
   * second `q` while the engine reads the first: exactly the divergence the strict
   * prefix was written to forbid, under a spelling no reviewer reads.
   *
   * Excluding `%` from that first position is what refuses it, and the direction
   * of failure is safe: a name that cannot be consumed makes the whole prefix
   * fail, so the rule does not match and no redirect happens. What it costs a
   * legitimate URL is nothing -- no search engine names a parameter with a `%`
   * (Google ships `sca_esv`, `sxsrf`, `oq`, `gs_lp`, `sourceid`, `ie`), and a
   * browser's address bar never percent-encodes a name it writes itself.
   *
   * ONE CHARACTER OF BUDGET, and it is spent on the redirect form only: the
   * guards ship `exactParameter: false`, so this branch never enters an envelope
   * that is cut into runs. re2-budget.js says "never WIDEN the query pattern
   * back"; this NARROWS it, which is the direction that paragraph protects.
   *
   * `q[^=&]+` stays as it is: a name starting with `q` and continuing decodes to
   * something other than `q` whatever the continuation, so it is genuinely
   * another parameter.
   */
  const noEarlier = (queryParam) => {
    if (queryParam.length !== 1) {
      // A NAMED REFUSAL, absorbed by rule-factory's per-engine catch, so one
      // costly engine loses its catch-all instead of the whole programme being
      // purged under the anonymous cause UNKNOWN. A bare Error here was the last
      // mute path of this file.
      throw global.Re2Budget.refusal("QUERY_PARAM_TOO_LONG", { word: queryParam });
    }
    return `(?:(?:[^=&%${queryParam}][^=&]*|${queryParam}[^=&]+)?=[^&]*&)*`;
  };

  /**
   * A MAP, AND THE PROTOTYPE CHAIN IS THE REASON.
   *
   * This was an object literal, read as `SHAPES[shape]` with a `shape` that comes
   * from the configuration -- storage.sync included -- and validated only as
   * `/^[a-z-]{1,32}$/`. `constructor` matches that pattern and lives on
   * Object.prototype, so `SHAPES["constructor"]` answered the Object function:
   * TRUTHY. The guard three lines down (`if (!form) return undefined`), whose
   * whole job is "an unknown shape is filtered here, exactly as an unknown engine
   * id is", let it through.
   *
   * MEASURED, on this build, from a document that passes every admission bound:
   *
   *   CustomEngine.parse({ host: "intra.example.org", shape: "constructor" }) -> ok
   *   catalogue entry present            -> true      (the filter did not filter)
   *   entry.pathPattern / queryParam     -> undefined
   *   entry.exampleUrl                   -> "https://intra.example.orgundefined?undefined=ABC-1234"
   *   entry.searchUrlPattern("X")        -> TypeError (noEarlier reads .length)
   *
   * That TypeError leaves buildRules from inside the binding loop, where nothing
   * catches it -- so rule-installer's outer catch fires, the whole programme is
   * purged, and NOTHING is installed: not the catch-all, not one named shortcut,
   * on every device the synchronisation reaches. A one-field denial of service,
   * reported as INSTALL_FAILED with the cause UNKNOWN, because a TypeError is not
   * a Re2Budget.Refusal and cannot be named.
   *
   * A Map has no prototype chain to walk, so `get` answers `undefined` for
   * `constructor` and the existing filter does what it always claimed to do. The
   * core cannot hold this list (it must not learn what shapes exist), so the
   * soundness of THIS lookup is the whole of the control -- which is why it is a
   * Map and not a hardened object literal.
   */
  const SHAPES = new Map([
    ["search-q", { pathPattern: "/search", queryParam: "q" }],
    ["root-q", { pathPattern: "/", queryParam: "q" }],
  ]);

  const BUILT_IN = [
    { id: "google.com", label: "Google.com", domain: "google.com", shape: "search-q" },
    { id: "google.fr", label: "Google.fr", domain: "google.fr", shape: "search-q" },
    { id: "bing.com", label: "Bing", domain: "bing.com", shape: "search-q" },
    { id: "duckduckgo.com", label: "DuckDuckGo", domain: "duckduckgo.com", shape: "root-q" },
  ];

  // Selections written before engines were split per domain. Without this, an
  // existing configuration silently loses every engine and stops jumping.
  const build = ({ id, label, domain, shape }) => {
    const form = SHAPES.get(shape);
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
      /**
       * EXACTLY THE TWO HOSTS THE RULE CAN MATCH, and not one subdomain more.
       *
       * Explicit https, and derived from the very domain the pattern matches:
       * Chrome refuses a request that falls outside the manifest's optional
       * patterns, and a rule matching a host we never asked for installs and then
       * never fires.
       *
       * IT WAS `https://*.${domain}/*`, AND THAT WAS TOO WIDE. hostPattern above
       * is `(?:www\\.)?<domain>` followed IMMEDIATELY by the path, so a rule can
       * only ever fire on `<domain>` and `www.<domain>`. The wildcard asked for
       * accounts.google.com, mail.google.com and every other subdomain -- for an
       * extension whose whole argument is that it never requests broad access,
       * and on the one screen where the browser names what it is granting.
       *
       * The old test only checked SUFFICIENCY (rule inside permission). It is now
       * an assertion of MINIMALITY as well, because the direction that matters is
       * the other one.
       *
       * WHAT IT DOES NOT UNDO, said plainly: a permission already granted is not
       * revoked by an update. A profile that accepted `https://*.google.com/*`
       * under an earlier build keeps it, and permissions.contains() goes on
       * answering yes for every subdomain until the user revokes it by hand. That
       * is why this is a before-publication fix and not an after: SECURITY.md
       * carries the sentence for the users who are already there.
       *
       * DO NOT DERIVE THIS FROM hostPattern, or hostPattern from this. They are
       * two independent spellings of one fact on purpose: made to descend from a
       * single list, the minimality test compares the union to the union and goes
       * green on day one and forever -- the tautology rule-set.js spends a
       * paragraph refusing about assertGuardsCover.
       */
      permissionOrigins: [`https://${domain}/*`, `https://www.${domain}/*`],
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
       * WHAT THIS ENGINE'S GUARD WRAPPER COSTS, in the units re2-budget spends.
       *
       * The engine owns it because the engine owns searchUrlPattern -- and it is
       * DERIVED by calling that very function with an empty fragment, never
       * restated as a number. The two therefore cannot drift: add a segment to the
       * emitted pattern and this grows by itself.
       *
       * THE GUARD FORM, not the redirect form. Only the guards are cut into runs
       * against an alternation budget, so only their envelope competes with one.
       * `exactParameter: false` is what the guards actually ship (see
       * searchUrlPattern below), and the difference is not cosmetic: the strict
       * prefix costs some thirty characters more.
       *
       * The fixed overhead ReferencePattern adds around the alternation --
       * `(?:`, `)`, the separator, `\d+` -- is NOT counted here. It is identical
       * for every engine, so it is already inside the calibrated budget; counting
       * it would charge every engine twice for the same characters.
       */
      guardEnvelopeCost() {
        return this.searchUrlPattern("", { exactParameter: false }).length;
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

    SHAPES: [...SHAPES.keys()],
    /** Through the Map, like build() above: this label reaches a chip in the
     *  options page, and `constructor` used to render "undefined?undefined=". */
    shapeLabel(shape) {
      const form = SHAPES.get(shape);
      return form ? `${form.pathPattern}?${form.queryParam}=` : shape;
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
