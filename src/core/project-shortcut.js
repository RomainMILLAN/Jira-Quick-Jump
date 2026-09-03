/**
 * ProjectKey, JiraInstance and ProjectShortcut.
 *
 * ProjectKey.parse and JiraInstance.parse are THE TWO SECURITY FUNCTIONS of this
 * project. They are the only way in -- from typing, from storage and from an
 * import alike. Read the security chapter of the plan before relaxing anything.
 */
(function (global) {
  "use strict";

  // CLOSED character set, bounded, anchored at both ends, no `g` flag.
  //
  // The key is concatenated LITERALLY into a DNR regexFilter. This character set
  // is the only thing guaranteeing the absence of a metacharacter. `A|` would
  // lift the alternation to the top level and turn the extension into a
  // universal redirector; `.*` does the same; `(X)` shifts the capture group so
  // the substitution silently points elsewhere. isRegexSupported() does NOT
  // protect against any of these -- they are perfectly valid regexes.
  //
  // Do not relax without introducing explicit escaping AND a dedicated injection
  // test. The same closed set is also what keeps JumpPreview's JS RegExp from
  // going exponential (see the ReDoS section of the plan).
  const KEY = /^[A-Z][A-Z0-9_]{1,19}$/;

  // The longest a project key may be. KEY above keeps its own literal 19 ON
  // PURPOSE: it is the VALIDATOR, and assertShapesCannotDrift below only has
  // teeth on the length axis while the two notations are written independently.
  // Deriving both from this number would make that post-condition vacuous
  // exactly where it matters.
  const MAX_LENGTH = 20;

  /**
   * The same character set, for a case-insensitive rule, AT A CHOSEN LENGTH.
   *
   * A function rather than a constant because the catch-all claims LESS than a
   * named key may be (see CatchAllKey.claimsKeysUpTo) and the airlock must be
   * able to ask for the shorter form without recomposing the class itself --
   * "never a copy: it comes from its owner".
   *
   * IT CARRIES ITS OWN RULE, and that is the point: a caller asking for 25 would
   * otherwise get {1,24}, a MATCHER WIDER THAN THE VALIDATOR, emitted from the
   * file whose header calls itself one of the two security functions of this
   * project. Capping can only ever NARROW the matcher, so its failure mode is
   * availability, never widening. And max < 2 would emit {1,0}, which matches
   * nothing and which RE2 would accept without a word.
   */
  const caseInsensitiveShape = (max) => {
    if (!Number.isInteger(max) || max < 2) {
      throw new Error("caseInsensitiveShape needs an integer of at least 2");
    }
    return "[A-Za-z][A-Za-z0-9_]{1," + (Math.min(max, MAX_LENGTH) - 1) + "}";
  };

  // The SAME character set, written for a case-insensitive rule. Two literals
  // rather than one derived from the other: the catch-all's DNR rule runs with
  // isUrlFilterCaseSensitive false, and letting that flag widen the captured set
  // behind the reader's back is exactly the validator/matcher drift this header
  // forbids. The post-condition below is what makes the pair unable to drift --
  // it THROWS at load time rather than producing a matcher wider than the
  // validator.
  const CASE_INSENSITIVE_SHAPE = caseInsensitiveShape(MAX_LENGTH);

  /**
   * ONE RULE, ONE PLACE -- and ONLY this one.
   *
   * Both parses ask it, so it is extracted. What is NOT extracted is the sequence
   * around it: ProjectKey trims, checks this, normalises NFKC and refuses anything
   * the normalisation changes; JiraInstance trims, checks this, refuses `%`, `\`
   * and a userinfo, then hands the rest to `new URL()`. Those are two different
   * questions -- "is this exactly what the user sees?" and "will a URL parser take
   * this?" -- so folding them into one SafeText would build a class with two
   * reasons to change.
   */
  const hasInvisibleCharacter = (text) => INVISIBLE.test(text);

  // Control and invisible characters, refused BEFORE anything else. A message
  // saying "invalid character" about characters nobody can see is unusable, so
  // this gets its own code. Bidi overrides matter on their own: they let a host
  // name be displayed backwards in the UI.
  const INVISIBLE = new RegExp(
    "[\\u0000-\\u0020\\u007f\\u00a0\\u200b-\\u200f\\u2028\\u2029" +
      "\\u202a-\\u202e\\u2060-\\u2064\\ufeff]"
  );

  class ProjectKey {
    constructor(value) {
      this._value = value;
    }
    toString() { return this._value; }
    equals(other) {
      return other instanceof ProjectKey && other._value === this._value;
    }
    /**
     * Non-blocking: the UI warns, it does not refuse.
     *
     * NOT `isReservedPrefix`: this is the UNION of the reserved list and the
     * two-character rule, and the two answer different questions. T1 collides
     * with ordinary searches AND must be claimed by a catch-all, so a single
     * predicate named after the list would lie for half its answers.
     *
     * ReservedPrefix is resolved AT CALL TIME, never destructured at the top of
     * the file: the load order would otherwise decide whether this works.
     */
    collidesWithOrdinarySearches() {
      return global.ReservedPrefix.has(this._value) || this._value.length === 2;
    }
    isCatchAll() {
      return false;
    }
    /**
     * WHAT KIND OF KEY THIS IS, as a word rather than a boolean read backwards.
     *
     * Five sites spelled `key.isCatchAll() ? "catch-all" : "named"` -- the
     * acknowledgement row key, the rule label, two fact types, one badge. Each is
     * a dispatch wearing a ternary, and each would need editing to admit a third
     * nature of key. Asking the key costs one method per class instead.
     *
     * NOT a replacement for isCatchAll(): the registry legitimately ASKS whether
     * a key is the catch-all -- "is there one already", "which row is it" -- and a
     * predicate is the honest form of that question.
     */
    nature() {
      return "named";
    }
    /** A named key claims itself, and nothing else. */
    captures(projectKey) {
      return this.equals(projectKey);
    }
    exampleKey() {
      return this;
    }
    /**
     * Which separators this key accepts between itself and the issue number.
     *
     * A DOMAIN rule, not a regex detail: the airlock maps these through IN_URL.
     * Written here so that ShortcutRegistry.claimantFor and the emitted DNR rule
     * cannot disagree -- which is what the agreement test proves.
     */
    separators() {
      return global.IssueReference.SEPARATORS;
    }

    /**
     * WHAT THIS KEY CLAIMS, in the domain's own words.
     *
     * The airlock used to hold a two-entry table plus
     * `shapeOf(key) = key.isCatchAll() ? … : …` -- the branch on the type its own
     * header claimed to have removed; a table does not remove a branch, it moves
     * it. Asking the key killed that, and the first attempt over-corrected: it put
     * `fragmentFor()`, `arity()` and `referenceFor()` in the key protocol, so the
     * DOMAIN started emitting RE2 -- capture-group counts, `\1` backreferences --
     * and CatchAllKey.fragmentFor even called into `interception/`. That was the
     * only live core -> airlock dependency in the project, created by the very
     * batch that removed the other one.
     *
     * So the key says what it CLAIMS, and nothing about how a regex spells it.
     * reference-pattern.js branches on this DATA -- not on a type, not on
     * instanceof -- and asks Re2Budget on its own side of the membrane.
     */
    claim() {
      return { literal: this._value };
    }
  }

  /**
   * The mechanical post-condition that makes the two literals unable to drift.
   *
   * Everything KEY accepts must be accepted by the case-insensitive shape. A
   * one-character divergence between the validator and the matcher is the bug
   * class this file exists to prevent, so it THROWS at load time -- the failure
   * is a dead extension, never a wider matcher.
   *
   * Frozen with defineProperty because every file shares globalThis: an
   * assignment of ProjectKey.CASE_INSENSITIVE_SHAPE before the airlock builds
   * its pattern would turn the extension into a universal redirector.
   */
  (function assertShapesCannotDrift() {
    const insensitive = new RegExp("^" + CASE_INSENSITIVE_SHAPE + "$");
    // SIX AND SIX, and the added ones cover THE AXIS THAT MOVED: the catch-all
    // now claims up to six characters, and not one sample sat at that boundary --
    // the assertion could not have caught a drift exactly where the feature lives.
    for (const sample of [
      "AB", "A_9", "ABCDEFGHIJKLMNOPQRST", "A1",
      "ABCDEF",  // the catch-all's claim boundary, exactly
      "ABCDE",   // one below it
    ]) {
      if (KEY.test(sample) && !insensitive.test(sample)) {
        throw new Error("key shape drifted: " + sample);
      }
    }
    // And the reverse direction, on what must stay OUT of both.
    for (const sample of [
      "A", "1AB", "_AB", "A-B", "A.B", "ABCDEFGHIJKLMNOPQRSTU",
      "AB C",    // a space: the separator set must never widen the key set
      "AB%20C",  // nor its encoded form, which reference-pattern emits as a separator
    ]) {
      if (insensitive.test(sample) !== KEY.test(sample.toUpperCase())) {
        throw new Error("key shape drifted on a rejected sample: " + sample);
      }
    }
  })();

  /**
   * DOES THIS WORD HAVE THE SHAPE OF A KEY? -- the question the airlock actually
   * asked, answered here instead of handed over as syntax.
   *
   * It used to read CASE_INSENSITIVE_SHAPE and build its own RegExp, which made the
   * CORE export a fragment of RE2 notation: a domain that produces syntax, and an
   * airlock that has to know how to wrap it. The constant stays exported -- the
   * emitted key fragment genuinely is notation, and rule-factory needs it -- but a
   * yes/no question no longer travels as a string to be compiled downstream.
   *
   * Anchored HERE, once, rather than at each call site: an unanchored test would
   * accept "NODE.JS" on a substring and let a metacharacter through into a
   * priority-2 allow rule.
   */
  ProjectKey.isShapedLikeAKey = (word) =>
    typeof word === "string" && new RegExp("^" + CASE_INSENSITIVE_SHAPE + "$").test(word);

  Object.defineProperty(ProjectKey, "CASE_INSENSITIVE_SHAPE", {
    value: CASE_INSENSITIVE_SHAPE,
    writable: false,
    configurable: false,
    enumerable: true,
  });

  // Frozen for the SAME reason as its neighbour: every file shares globalThis, so
  // an assignment before the airlock builds its pattern would turn the extension
  // into a universal redirector.
  for (const [name, value] of [["MAX_LENGTH", MAX_LENGTH],
                               ["caseInsensitiveShape", caseInsensitiveShape]]) {
    Object.defineProperty(ProjectKey, name, {
      value, writable: false, configurable: false, enumerable: true,
    });
  }

  ProjectKey.parse = function (input) {
    if (typeof input !== "string") {
      return { ok: false, code: "KEY_NOT_A_STRING", message: "A project key must be text." };
    }
    const trimmed = input.trim();
    if (hasInvisibleCharacter(trimmed)) {
      return {
        ok: false,
        code: "KEY_CONTROL_CHARS",
        message: "The project key contains an invisible or control character.",
      };
    }
    // Normalise BEFORE testing, otherwise full-width characters pass the test
    // and are only then transformed into something else.
    const normalised = trimmed.normalize("NFKC");
    if (normalised.toUpperCase() !== trimmed.toUpperCase()) {
      return {
        ok: false,
        code: "KEY_NOT_NORMALISED",
        message: "The project key contains look-alike characters.",
      };
    }
    const value = normalised.toUpperCase();
    if (!KEY.test(value)) {
      return {
        ok: false,
        code: "KEY_SHAPE",
        message:
          "A project key looks like ABC: 2 to 20 letters, digits or underscores, starting with a letter.",
      };
    }
    return { ok: true, value: new ProjectKey(value) };
  };

  const UNSAFE_PORTS = new Set([
    1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79,
    87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137,
    139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532,
    540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723,
    2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697,
    10080,
  ]);

  // No Jira is ever hosted here; these are exclusively SSRF and instance
  // credential theft targets. Hard refusal, not acknowledgeable: it costs no
  // legitimate use case and removes the whole class.
  const FORBIDDEN_HOSTS = new Set([
    "metadata.google.internal", "0.0.0.0", "[::]", "100.100.100.200",
  ]);
  const LINK_LOCAL = /^(169\.254\.|\[fe80:|\[fd00:ec2)/i;

  const refuse = (code, message) => ({ ok: false, code, message });

  class JiraInstance {
    constructor(baseUrl, url) {
      this._baseUrl = baseUrl;
      this._url = url;
    }
    baseUrl() { return this._baseUrl; }
    protocol() { return this._url.protocol; }
    hostname() { return this._url.hostname; }
    /**
     * The ONLY owner of the origin/path split. Without it the first implementer
     * writes `new URL(baseUrl).origin` inside a rendering function -- taking
     * destination knowledge out of the domain on the very line where the
     * glossary says confusing origin and destination is THE mistake.
     */
    parts() {
      return { origin: this._url.origin, path: this._baseUrl.slice(this._url.origin.length) };
    }
    /**
     * The ONLY owner of /browse/. A security control, not an elegance: it is
     * what stops an attacker who controls the destination from choosing a more
     * convincing path (/login?redirect=...) or a more dangerous one. Never
     * generalise it into a configurable template.
     */
    browseUrl(issueReference) {
      return this._baseUrl + "/browse/" + issueReference.toString();
    }
    permissionOrigin() {
      return this._url.protocol + "//" + this._url.host + "/*";
    }
    equals(other) {
      return other instanceof JiraInstance && other._baseUrl === this._baseUrl;
    }
    toJSON() { return this._baseUrl; }
  }

  JiraInstance.parse = function (input) {
    if (typeof input !== "string") return refuse("BASE_NOT_A_STRING", "A Jira base URL must be text.");
    const trimmed = input.trim();
    if (trimmed === "") return refuse("BASE_EMPTY", "Enter a Jira base URL.");
    if (trimmed.length > 256) return refuse("BASE_TOO_LONG", "This base URL is too long.");

    // Before new URL(): it silently strips tabs and newlines, so any check made
    // afterwards would inspect a different string from the one the user sees.
    if (hasInvisibleCharacter(trimmed)) {
      return refuse("BASE_CONTROL_CHARS", "The base URL contains an invisible or control character.");
    }
    if (trimmed.includes("%")) {
      return refuse("BASE_PERCENT", "Percent-encoded characters are not accepted in a base URL.");
    }
    if (trimmed.includes("\\")) {
      // \0 to \9 are interpreted in a DNR regexSubstitution, and \0 inserts the
      // ENTIRE matched text: a backslash here would inject the whole search URL
      // into the destination.
      return refuse("BASE_BACKSLASH", "A base URL cannot contain a backslash.");
    }
    if (trimmed.includes("?")) return refuse("BASE_QUERY", "A base URL cannot contain a query string.");
    if (trimmed.includes("#")) return refuse("BASE_FRAGMENT", "A base URL cannot contain a fragment.");
    if (trimmed.includes("@")) return refuse("BASE_USERINFO", "A base URL cannot contain credentials.");

    // Implicit scheme is always https, never http: defaulting to http would
    // silently downgrade a user who typed a bare host name.
    const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : "https://" + trimmed;

    let url;
    try {
      url = new URL(candidate);
    } catch {
      return refuse("BASE_NOT_A_URL", "This is not a valid URL.");
    }

    /**
     * `http:` IS ACCEPTED, AND THAT IS A NAMED PRODUCT DECISION.
     *
     * The population is real and specific: a Jira Server on an internal network,
     * behind a VPN, with no TLS -- `http://jira:8080` is the canonical shape. It
     * cannot be typed by accident, because the IMPLICIT scheme is https (above);
     * a user gets here only by writing `http://` themselves.
     *
     * What bounds it is not a refusal but a WARNING THE USER MUST ACCEPT:
     * INSECURE_SCHEME is a high-severity acknowledgement, and a shortcut carrying
     * an unacknowledged warning cannot arm. So the traffic never leaves in clear
     * text without someone having said so.
     *
     * THE COST IS DECLARED, not hidden: optional_host_permissions must then carry
     * an http wildcard beside the https one, which is half of what the stores show
     * at install time. Removing `http:` here would halve that surface -- and cut
     * off every internal Jira Server. Refusing it at THIS door is the only place
     * the change could be made honestly, because permissionOrigin() derives the
     * origin from the scheme kept here.
     */
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return refuse("BASE_SCHEME", 'Only http and https are accepted, not "' + url.protocol + '".');
    }
    if (url.username !== "" || url.password !== "") {
      return refuse("BASE_USERINFO", "A base URL cannot contain credentials.");
    }
    if (FORBIDDEN_HOSTS.has(url.hostname) || LINK_LOCAL.test(url.hostname)) {
      return refuse("BASE_FORBIDDEN_HOST", "This address is a cloud metadata or link-local endpoint.");
    }
    if (url.port !== "") {
      const port = Number(url.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return refuse("BASE_PORT", "The port must be a number between 1 and 65535.");
      }
      if (UNSAFE_PORTS.has(port)) {
        return refuse("BASE_UNSAFE_PORT", "Browsers refuse to connect to port " + port + ".");
      }
    }

    const segments = url.pathname.split("/").filter((s) => s !== "");
    if (segments.some((s) => s === "." || s === "..")) {
      return refuse("BASE_TRAVERSAL", "A base URL cannot contain . or .. path segments.");
    }
    if (segments.length > 4) {
      return refuse("BASE_PATH_DEPTH", "A base URL cannot have more than four path segments.");
    }

    const baseUrl = segments.length === 0 ? url.origin : url.origin + "/" + segments.join("/");

    // Mechanical post-condition: any URL trick (userinfo, ?, #, traversal,
    // backslash, tab, %00, IDN) breaks one of these. We REFUSE rather than
    // clean: silent cleaning creates the gap between what the user typed and
    // what gets installed, and that gap is what an attacker exploits.
    // The input must survive parsing UNCHANGED, apart from the trailing slash we
    // deliberately drop and the case of scheme and host. new URL() silently
    // rewrites `/a/../b` into `/b` and collapses `//`, so a check made on the
    // parsed value would never see the traversal the user typed. Refusing here
    // is what keeps "what you typed" and "what gets installed" identical.
    if (candidate.replace(/\/+$/, "").toLowerCase() !== baseUrl.toLowerCase()) {
      return refuse(
        "BASE_NOT_CANONICAL",
        "Write the base URL in its plain form, for example https://example.atlassian.net/jira."
      );
    }

    const probe = new URL(baseUrl + "/browse/AAA-1");
    if (
      probe.origin !== url.origin ||
      !probe.pathname.endsWith("/browse/AAA-1") ||
      probe.search !== "" ||
      probe.hash !== "" ||
      probe.username !== "" ||
      probe.password !== "" ||
      probe.href !== baseUrl + "/browse/AAA-1"
    ) {
      return refuse("BASE_NOT_CANONICAL", "This base URL cannot be used as written.");
    }
    // Punycode is applied by new URL(), so the stored and displayed value is
    // always ASCII. This satisfies DNR's ASCII constraint and half the homograph
    // problem at once.
    if (!/^[\x21-\x7e]+$/.test(baseUrl)) {
      return refuse("BASE_NOT_ASCII", "This base URL contains non-ASCII characters.");
    }

    return { ok: true, value: new JiraInstance(baseUrl, url) };
  };

  /**
   * An entity: it has a lifecycle (created, renamed, armed, disarmed, removed),
   * and a MUTABLE key cannot serve as identity -- hence the opaque id.
   */
  class ProjectShortcut {
    constructor(id, key, instance, consent) {
      this._id = id;
      this._key = key;
      this._instance = instance;
      this._consent = consent;
    }
    id() { return this._id; }
    key() { return this._key; }
    instance() { return this._instance; }
    consent() { return this._consent; }
    armed() { return this._consent.armed(); }

    /**
     * THE THREE QUESTIONS THE OUTSIDE ACTUALLY ASKED, and it asked them by taking
     * the entity apart: `s.keyText()` fourteen times, `s.instance()
     * .baseUrl()` eleven, `s.isCatchAll()` eight -- thirty-three places
     * that had to know this entity is made of a key and a destination, and that a
     * key is the thing that knows its own nature.
     *
     * The accessors above stay, because a caller that needs the VALUE OBJECT
     * needs it whole: rule-factory builds a regex fragment from the key,
     * shortcut-warning reads a host's shape from the destination. What is banned
     * is reaching through one to get a string out the other side -- the hop that
     * spreads this entity's shape into files that only wanted a word to print.
     */
    keyText() { return this._key.toString(); }
    destination() { return this._instance.baseUrl(); }
    isCatchAll() { return this._key.isCatchAll(); }

    /** WHICH HOST THIS SHORTCUT NEEDS ACCESS TO -- the fourth question, asked by
     *  the airlock that assembles the permission prompt. Same hop as
     *  destination(), and the same reason to name it here rather than there. */
    permissionOrigin() { return this._instance.permissionOrigin(); }

    /**
     * THE ENTITY ASKS, and it is the only caller of forShortcut.
     *
     * The catalogue of warnings is a domain SERVICE, not a stranger: it holds the
     * rules ("a catch-all leaves in clear text", "this host is private"), and it
     * cannot hold state about one shortcut. What matters is the direction -- the
     * options page asks THIS, never the catalogue about the parts of this, which
     * is what an outside caller doing forKey(s.key()) + forInstance(s.instance())
     * would be: a stranger deciding on the entity's behalf.
     *
     * The catalogue's two other doors stay public because the options page needs
     * them on a key and a destination being TYPED, where no shortcut exists yet.
     */
    unacknowledgedWarnings() {
      return global.ShortcutWarning.forShortcut(this).filter((w) => !this._consent.acknowledged(w.kind));
    }

    /** exampleKey(), never the key itself: a catch-all would render "*-1", which
     *  is not an issue reference and answers nobody's question. */
    exampleReference() {
      return global.IssueReference.of(this._key.exampleKey(), "1").value;
    }

    /**
     * WHAT A CONSENT IS GIVEN TO, as one value.
     *
     * The attestation store used to build its row key by reading three accessors
     * off this entity -- `id()`, `instance().baseUrl()`, `key().nature()`. That is
     * a neighbouring context knowing this one's internal shape, and it put the
     * rule "a consent is never recycled" in the hands of the side that does not
     * state it.
     *
     * The rule lives here, where it is stated: consent is given to THIS shortcut,
     * pointing THERE, of THAT nature. Change any of the three and the consent no
     * longer applies -- which is why all three travel, and why the store only has
     * to file what it is handed.
     */
    consentSubject() {
      return { id: this._id, baseUrl: this._instance.baseUrl(), nature: this._key.nature() };
    }

    withConsent(consent) {
      return new ProjectShortcut(this._id, this._key, this._instance, consent);
    }
    /**
     * THROWS when the nature of the key changes, because no caller can
     * legitimately ask for it.
     *
     * Without this, a named shortcut that is already armed and acknowledged
     * could become a catch-all WHILE KEEPING ITS CONSENT -- a universal
     * redirector obtained without ever seeing the CATCH_ALL warning. Guarding
     * this in the registry does not protect the entity, and the UI showing a
     * read-only key protects nothing at all.
     *
     * A throw, not a MutationResult: the entity's three other withX return a
     * shortcut, and this is a programming error rather than a refusal the user
     * should read. The refusal with its message belongs to
     * ShortcutRegistry.withKeyFor.
     */
    withKey(key) {
      if (key.isCatchAll() !== this._key.isCatchAll()) {
        throw new Error("a shortcut cannot change the nature of its key");
      }
      return new ProjectShortcut(this._id, key, this._instance, this._consent);
    }
    /** Consent is given to a destination, so changing it forgets the
     *  DESTINATION acknowledgements -- and only those. */
    withInstance(instance) {
      const consent = instance.equals(this._instance)
        ? this._consent
        : this._consent.forgettingDestinationAcknowledgements();
      return new ProjectShortcut(this._id, this._key, instance, consent);
    }

    toJSON() {
      return {
        id: this._id,
        key: this._key.toString(),
        baseUrl: this._instance.baseUrl(),
        consent: this._consent.toJSON(),
      };
    }
  }

  global.ProjectKey = ProjectKey;
  global.JiraInstance = JiraInstance;
  global.ProjectShortcut = ProjectShortcut;
})(globalThis);
