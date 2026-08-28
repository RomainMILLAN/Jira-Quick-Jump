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

  // Control and invisible characters, refused BEFORE anything else. A message
  // saying "invalid character" about characters nobody can see is unusable, so
  // this gets its own code. Bidi overrides matter on their own: they let a host
  // name be displayed backwards in the UI.
  const INVISIBLE = new RegExp(
    "[\\u0000-\\u0020\\u007f\\u00a0\\u200b-\\u200f\\u2028\\u2029" +
      "\\u202a-\\u202e\\u2060-\\u2064\\ufeff]"
  );

  // Prefixes that would silently sabotage ordinary web searches. Availability
  // control, not security: mapping ISO makes the address bar stop working with
  // no way for the user to understand why.
  const AMBIGUOUS = new Set([
    "CVE", "ISO", "RFC", "HTTP", "HTTPS", "SQL", "CSS", "API", "AWS",
    "GPT", "PDF", "USB", "PR", "CI", "TODO", "FIXME",
  ]);

  class ProjectKey {
    constructor(value) {
      this._value = value;
    }
    toString() { return this._value; }
    equals(other) {
      return other instanceof ProjectKey && other._value === this._value;
    }
    /** Non-blocking: the UI warns, it does not refuse. */
    isAmbiguous() {
      return AMBIGUOUS.has(this._value) || this._value.length === 2;
    }
  }

  ProjectKey.parse = function (input) {
    if (typeof input !== "string") {
      return { ok: false, code: "KEY_NOT_A_STRING", message: "A project key must be text." };
    }
    const trimmed = input.trim();
    if (INVISIBLE.test(trimmed)) {
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
    warnings() {
      return global.DestinationWarning.forInstance(this);
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
    if (INVISIBLE.test(trimmed)) {
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

    unacknowledgedWarnings() {
      return this._instance.warnings().filter((w) => !this._consent.acknowledged(w.kind));
    }

    exampleReference() {
      return global.IssueReference.of(this._key, "1").value;
    }

    withConsent(consent) {
      return new ProjectShortcut(this._id, this._key, this._instance, consent);
    }
    withKey(key) {
      return new ProjectShortcut(this._id, key, this._instance, this._consent);
    }
    /** Consent is given to a destination, so changing it forgets the acknowledgements. */
    withInstance(instance) {
      const consent = instance.equals(this._instance)
        ? this._consent
        : this._consent.forgettingAcknowledgements();
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
