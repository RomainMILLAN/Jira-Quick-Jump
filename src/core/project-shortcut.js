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
  //
  // THE ISOLATES WERE MISSING, and they are the MODERN spelling of the very
  // attack the paragraph above names. U+202A-U+202E were here; U+2066-U+2069
  // (LRI, RLI, FSI, PDI) are what Unicode 6.3 added to replace them, and
  // U+061C (ALM) is the Arabic mark that does the same job for one character.
  //
  // NOTHING WAS EXPLOITABLE THROUGH THE GAP, and saying so is what stops the
  // next reader from treating this list as the only rampart: measured on all
  // three doors, every uncovered character was already refused downstream --
  // BASE_NOT_A_URL or BASE_NOT_CANONICAL for a base URL, KEY_SHAPE for a key,
  // HOST_SHAPE for a custom domain. What the omission cost was the ERROR
  // MESSAGE: the user was told "this is not a valid URL" about a string whose
  // only fault was a character nobody can see, which is the one sentence this
  // code exists to avoid.
  //
  // U+00AD (SHY) and U+180E join for the same reason and with the same status:
  // caught downstream by the canonicality post-condition, refused here by name.
  //
  // SPLIT IN TWO, WITH ONE OWNER, and the seam is a domain distinction rather
  // than a convenience.
  //
  // DECEPTIVE_SOURCE is the set that LIES ON SCREEN: invisible, zero-width, or
  // reordering. `withoutDeceptiveCharacters` below replaces exactly these before
  // a value the parser refused is displayed, and nothing else may spell them --
  // a second regex somewhere else is how the two drift, and the drift costs a
  // character nobody notices.
  //
  // IT IS PRIVATE, AND IT USED TO BE EXPORTED. The UI received this string and
  // built its own `new RegExp("[" + source + "]", "g")` -- so the domain
  // published NOTATION, and the caller carried three unwritten obligations:
  // wrap it in brackets, compile it, and remember the `g`. Forget the `g` and
  // only the FIRST character is replaced: a control that works halfway, in
  // silence, on the one screen whose job is to have a value read.
  //
  // This file's neighbour states the rule in capitals -- "NO REGEX NOTATION IN
  // THIS FILE", said of the core in interception/reference-pattern.js -- and
  // this export was the same violation mirrored. The domain owns the RULE and
  // its APPLICATION; `ui/` asks the question.
  //
  // The ORDINARY SPACE is deliberately NOT in it. The parsers refuse a space
  // (a base URL or a key holding one is not what the user sees), which is why
  // INVISIBLE adds it below -- but a space is VISIBLE in a field, so replacing
  // it with U+FFFD would mangle a legitimate value on the one screen whose whole
  // job is to show a value as it stands. Refusing and displaying are two
  // questions, and only one of them is about deception.
  const DECEPTIVE_SOURCE =
    "\\u0000-\\u001f\\u007f\\u00a0\\u00ad\\u180e\\u200b-\\u200f\\u2028\\u2029" +
    "\\u202a-\\u202e\\u2060-\\u2064\\u2066-\\u2069\\u061c\\ufeff";

  // The same set plus the space: what NO parser of this project accepts. Built
  // from the source above rather than restated, so the pair cannot drift on a
  // range -- the post-condition below holds the one added character.
  const INVISIBLE = new RegExp("[\\u0020" + DECEPTIVE_SOURCE + "]");

  // COMPILED ONCE, at load, and never by a caller. The `g` lives here, with the
  // class it belongs to, instead of being an obligation the UI had to remember.
  const DECEPTIVE_GLOBAL = new RegExp("[" + DECEPTIVE_SOURCE + "]", "g");

  /**
   * The parsers refuse everything the display replaces, plus the space. Asserted
   * at load time, because "plus one character" is a claim and not a comment.
   *
   * BY THE BOUNDS OF EVERY RANGE, not by walking the plane. The first version
   * looped over all 65 536 code points, which is 3 ms on every service-worker
   * wake-up for a property that the ends of each range establish exactly: both
   * expressions are built from ONE source string plus a literal ` `, so they
   * can only ever differ at a range boundary or at that one character. Same
   * gesture, and same reasoning, as assertShapesCannotDrift below -- named samples
   * that cover the axis that can move.
   */
  (function assertRefusalCoversDeception() {
    const deceptive = new RegExp("[" + DECEPTIVE_SOURCE + "]");
    const at = (code) => String.fromCharCode(code);
    // Every range end, plus one interior sample per range that has an interior.
    for (const code of [
      0x0000, 0x0010, 0x001f,             // C0 controls
      0x007f, 0x00a0, 0x00ad, 0x180e,     // DEL, NBSP, SHY, Mongolian vowel separator
      0x200b, 0x200d, 0x200f,             // zero-width family and the two marks
      0x2028, 0x2029,                     // line and paragraph separators
      0x202a, 0x202c, 0x202e,             // legacy embeddings and overrides
      0x2060, 0x2062, 0x2064,             // invisible operators
      0x2066, 0x2067, 0x2069,             // Unicode 6.3 isolates
      0x061c, 0xfeff,                     // Arabic letter mark, BOM
    ]) {
      if (!deceptive.test(at(code))) {
        throw new Error("a character this class must strip is outside it: U+" + code.toString(16));
      }
      if (!INVISIBLE.test(at(code))) {
        throw new Error("a deceptive character is not refused: U+" + code.toString(16));
      }
    }
    // THE ONE CHARACTER THE TWO DISAGREE ON, in both directions.
    if (!INVISIBLE.test(" ")) throw new Error("the space must be refused by the parsers");
    if (deceptive.test(" ")) throw new Error("the space must not be replaced on screen");
    // And the neighbours just outside each range, so a widening cannot pass as a
    // boundary: a class that swallows `!`, `-` or a soft-hyphen look-alike would
    // put U+FFFD through legitimate values on the repair screen.
    for (const code of [0x0021, 0x002d, 0x007e, 0x00a1, 0x2010, 0x2030, 0x205f, 0xfefe]) {
      if (deceptive.test(at(code)) || INVISIBLE.test(at(code))) {
        throw new Error("a legitimate character is caught: U+" + code.toString(16));
      }
    }
  })();

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

  /**
   * A STRING SAFE TO SHOW, for the surfaces that display a value to be read
   * rather than trusted: the quarantine repair fields, and the change banner.
   *
   * THE DOMAIN ANSWERS, IT DOES NOT HAND OVER THE CLASS. `DECEPTIVE_SOURCE` used
   * to be exported and `ui/dom.js` compiled it itself -- see the note on that
   * constant for why three unwritten obligations, one of which silently halves
   * the control, is not a contract worth keeping.
   *
   * REPLACED, never deleted: a silent deletion makes the field the user is asked
   * to repair differ from the bytes on file, which is the gap both parsers spend
   * their headers refusing. U+FFFD says "something was here".
   *
   * `lastIndex` is not a hazard: `String.prototype.replace` with a global regex
   * resets it before returning, so the shared instance is safe to reuse.
   */
  const withoutDeceptiveCharacters = (text) =>
    String(text ?? "").replace(DECEPTIVE_GLOBAL, "�");

  // Frozen for the SAME reason as its neighbour: every file shares globalThis, so
  // an assignment before the airlock builds its pattern would turn the extension
  // into a universal redirector. withoutDeceptiveCharacters joins them on the
  // same ground: it is what the repair screen and the change banner print
  // through, so a writable copy would let a file loaded afterwards return its
  // argument untouched and put an RTL override back on screen.
  for (const [name, value] of [["MAX_LENGTH", MAX_LENGTH],
                               ["withoutDeceptiveCharacters", withoutDeceptiveCharacters],
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
    /**
     * THE SIZE IS JUDGED HERE, BEFORE THE SENSE -- and it was judged by the
     * neighbours.
     *
     * The validation order is origin -> size -> lexical -> syntax -> semantics,
     * and JiraInstance.parse below keeps it (`length > 256` sits second). This
     * door did not: an unbounded string reached hasInvisibleCharacter and then
     * normalize("NFKC"), both linear over the input, before KEY ever got to refuse
     * it on shape. Nothing exploitable -- the callers are bounded (a 64 kB
     * transfer file, `shortcuts` capped at 200, a typed field) and KEY is anchored
     * -- but in the file that declares itself one of the two security functions of
     * this project, the order was held by the callers rather than by the door.
     *
     * KEY_SHAPE, AND DELIBERATELY NOT A NEW CODE. Its sentence already says "2 to
     * 20 letters, digits or underscores", which is exactly what is wrong here, and
     * test/ui.test.js requires a translated sentence for EVERY code the typed-input
     * parsers can return -- so a fresh KEY_TOO_LONG would cost two locale entries
     * and a RefusalPresentation row to say what this one already says.
     */
    if (trimmed.length > MAX_LENGTH) {
      return {
        ok: false,
        code: "KEY_SHAPE",
        message:
          "A project key looks like ABC: 2 to 20 letters, digits or underscores, starting with a letter.",
      };
    }
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

  /**
   * WHAT A WEBEXTENSIONS MATCH PATTERN CAN NAME AS A HOST: a sequence of LDH
   * labels, and nothing else. See the paragraph at its call site in parse() for
   * the measured wildcard grant this closes.
   *
   * DELIBERATELY NOT the same expression as CustomEngine.HOST, which requires a
   * dot and an alphabetic last label -- a search engine is never reached at
   * `jira`, while a self-hosted Jira very often is. Two questions, two
   * expressions, and the difference is the single-label name.
   *
   * Anchored, linear, no `g` flag, and applied to a value `new URL()` has already
   * lower-cased and punycoded.
   */
  const HOST_LDH = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

  /**
   * THE ADDRESS, NOT ITS SPELLING -- and the claim above ("removes the whole
   * class") was false without this.
   *
   * `new URL()` canonises the decimal, octal and hexadecimal forms of an IPv4
   * literal back to the dotted one, so `http://2852039166` and `http://0xA9FEA9FE`
   * both arrived as `169.254.169.254` and were refused. What it does NOT do is
   * unwrap an IPv4 address EMBEDDED IN AN IPv6 LITERAL -- mapped or compatible,
   * see IPV4_IN_V6 below for why both count: `[::ffff:169.254.169.254]` comes out as
   * `[::ffff:a9fe:a9fe]`, in hexadecimal, matching neither the list nor
   * LINK_LOCAL. Measured, before this function existed:
   *
   *   http://169.254.169.254            -> BASE_FORBIDDEN_HOST
   *   http://[::ffff:169.254.169.254]   -> BASE_NOT_CANONICAL   (the post-condition)
   *   http://[::ffff:a9fe:a9fe]         -> ACCEPTED
   *
   * The middle line is why this was only ever a defence-in-depth hole rather
   * than an open door: the canonicality post-condition catches the readable
   * spelling. It does not catch the one an attacker would actually write in a
   * shared configuration file, and `[::ffff:a9fe:a9fe]` is unreadable to every
   * reviewer -- which is the whole point of using it.
   *
   * IT RETURNS THE DOTTED FORM, so ONE list and ONE regex keep deciding. Adding
   * hexadecimal twins to FORBIDDEN_HOSTS would have meant maintaining every
   * entry twice, in two notations, and getting the second one wrong.
   *
   * BOTH EMBEDDINGS, AND THE SECOND ONE WAS MISSING -- the pattern required
   * `ffff:`, so it unwrapped the IPv4-MAPPED form and not the IPv4-COMPATIBLE one
   * (RFC 4291 section 2.5.5.1, deprecated), which denotes the SAME address.
   * Measured, with the first fix in place and the second one not:
   *
   *   http://[::ffff:a9fe:a9fe]  -> BASE_FORBIDDEN_HOST
   *   http://[::169.254.169.254] -> BASE_NOT_CANONICAL   (the readable form again)
   *   http://[::a9fe:a9fe]       -> ACCEPTED
   *
   * The same shape of hole, one notation further, and the unreadable spelling is
   * again the whole point. Whether a browser would actually route it is doubtful
   * -- the form is deprecated and modern stacks do not translate it -- so what
   * closing it buys for CERTAIN is the sentence: this block, and SECURITY.md,
   * claim the list judges an ADDRESS and not a spelling, and one spelling sat
   * outside it. A claim wider than its code is what stops the next reader from
   * looking.
   *
   * Nothing legitimate is taken away: every address in ::/96 is one of these two
   * embeddings or is non-routable. `[::1]` and `[::]` carry no second group, so
   * they are untouched -- the loopback is warned about by name, and `[::]` is
   * refused by the list.
   *
   * AND A THIRD SPELLING, WHICH IS NOT IN ::/96 AT ALL -- so the paragraph above
   * stayed true while the pattern stayed short. `::ffff:0:0/96` is the IPv4-
   * TRANSLATED block (RFC 2765, deprecated with SIIT), and it denotes the same
   * endpoint a third time. Measured on this build's own URL parser, which is what
   * decides what reaches the list:
   *
   *   [::ffff:169.254.169.254]    -> [::ffff:a9fe:a9fe]      mapped, unwrapped
   *   [::169.254.169.254]         -> [::a9fe:a9fe]           compatible, unwrapped
   *   [::0:169.254.169.254]       -> [::a9fe:a9fe]           collapses onto the above
   *   [::ffff:0:169.254.169.254]  -> [::ffff:0:a9fe:a9fe]    SURVIVES as its own spelling
   *
   * The fourth line is the whole reason for the `(?:0:)?`: it is the only one the
   * canonicalisation does not fold onto a form already covered, so it was the only
   * one that reached the list unrecognised.
   *
   * WHAT THIS CLOSES IS A SENTENCE, NOT A ROUTE, and saying so is what stops the
   * next reader from believing more of it than there is. No browser translates
   * ::ffff:0:0/96 -- a connection there goes to the IPv6 literal, not to
   * 169.254.169.254 -- so nothing was reachable through the gap. What was wrong is
   * that this block claims the list judges an ADDRESS and not a spelling, and a
   * spelling sat outside it. A claim wider than its code is what stops the next
   * reader from looking.
   *
   * `0:` is admitted ONLY behind `ffff:`, deliberately. Written `(?:ffff:)?(?:0:)?`
   * the pattern would also swallow `[::0:X:Y]`, a form `new URL()` never produces --
   * an alternative with no input, which is how a matcher starts covering shapes
   * nobody can check.
   */
  const IPV4_IN_V6 = /^\[::(?:ffff:(?:0:)?)?([0-9a-f]{1,4}):([0-9a-f]{1,4})\]$/i;
  const asAddress = (hostname) => {
    const mapped = IPV4_IN_V6.exec(hostname);
    if (!mapped) return hostname;
    const high = parseInt(mapped[1], 16);
    const low = parseInt(mapped[2], 16);
    return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
  };

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
     * THE ENDPOINT THIS HOSTNAME DENOTES, which is not always how it is written.
     *
     * Asked of the instance rather than recomputed by whoever needs it: the
     * judgement "is this host private" (shortcut-warning.js) and the refusal
     * "is this host forbidden" (parse, below) are two different questions about
     * ONE fact, and that fact belongs here -- unwrapping an IPv4-mapped IPv6
     * literal is URL knowledge, exactly like the origin/path split next door.
     *
     * Written this way, `[::ffff:0a00:0001]` reaches PRIVATE_V4 as `10.0.0.1`
     * instead of slipping past it. It used to slip: only isLiteralIp caught it,
     * so the row was warned about being an IP and never about being on a private
     * network -- the less specific of the two sentences, on the one screen where
     * the user decides whether to trust a destination.
     *
     * SINCE BASE_IPV6_LITERAL, THE UNWRAPPING IS A CHANGELOCK ON THIS PATH, and
     * that is worth writing down rather than leaving to be rediscovered as dead
     * code. No JiraInstance can exist with a bracketed hostname any more, so
     * asAddress() called from here always answers its argument unchanged. It stays
     * for two reasons: parse() calls it BEFORE the bracket refusal, where it is
     * fully live and is what keeps the metadata endpoint's own sentence winning
     * over the generic one; and the day the bracket refusal is relaxed, this is
     * what stops a mapped RFC 1918 address from being warned about as merely "an
     * IP" instead of "a private network". Do not delete it as unreachable, and do
     * not trust it as a live check from this door.
     */
    address() { return asAddress(this._url.hostname); }
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
    /**
     * THE ORIGIN TO ASK THE BROWSER FOR, AND IT CARRIES NO PORT.
     *
     * It was `this._url.host`, which INCLUDES the port -- so a self-hosted Jira
     * produced `http://jira:8080/*`, and a match pattern cannot hold a port.
     * Firefox refuses one outright (bug 1362809), so the WebExtensions schema
     * rejects the whole call: `permissions.request` throws, "Grant access"
     * reports a refusal, `permissions.contains` throws too and grantedOrigins
     * answers `false` -- for ever. The badge reads `off`, the diagnosis stays on
     * MISSING_ORIGINS, and no jump can ever happen. Chrome does accept a port
     * here, so the fault was Gecko-only and invisible to a Chromium test.
     *
     * WORSE THAN ITS OWN BLAST RADIUS: requestOrigins asks for every origin in
     * ONE call, so a single port-bearing destination made the grant fail for the
     * search engines as well. One shortcut, and the whole extension inert.
     *
     * AND THIS IS THE POPULATION `http:` WAS ACCEPTED FOR. The scheme is
     * admitted a hundred lines below on the sentence "a Jira Server on an
     * internal network, behind a VPN, with no TLS -- `http://jira:8080` is the
     * canonical shape". That shape was exactly the one that could not work.
     *
     * WHAT DROPPING THE PORT WIDENS, and why it widens nothing that matters. A
     * granted origin now covers every port of that host, where the rule fires on
     * one. That is a permission wider than the rule -- the direction
     * search-engine-catalog.js spends a paragraph refusing for the ENGINES -- and
     * it is admitted here for a reason that does not apply there: a match pattern
     * has no way to say "this port", so the narrow form is not merely unasked, it
     * is INEXPRESSIBLE. What bounds it instead is the substitution: the redirect
     * target is the literal base URL, port included, so no rule of this build can
     * ever reach another port of that host. The extra grant buys an attacker who
     * already controls the configuration nothing, because changing the
     * destination is what the host permission gates in the first place.
     *
     * AND IT DROPS THE PATH TOO, which is a SECOND derogation and was declared
     * nowhere -- SECURITY.md called the port "the ONE place" this project's
     * permission is knowingly wider than its rule. A base URL may hold up to four
     * path segments, and a match pattern CAN express a path
     * (`https://intra.example.org/jira/*` is legal), so asking for the whole host
     * is wider by a margin that is expressible, unlike the port's.
     *
     * It is DECLARED rather than narrowed, and HALF of that decision is now
     * measured -- which changes the reason without changing the answer.
     *
     * MEASURED (Chrome 152.0.7977.82, 2026-09-07, from a loaded extension whose
     * manifest declares the same `http://*` and `https://*` ceiling this one does):
     * a path-bearing request IS accepted by the manifest check.
     * `permissions.request({origins: ["https://intra.example.org/jira/*"]})` fails
     * with "This function must be called during a user gesture" -- the SAME error
     * as the whole-host form, and nothing about the manifest. Compare a malformed
     * pattern, which fails differently and by name: "Invalid host wildcard". So
     * narrowing is EXPRESSIBLE and ACCEPTED; the fear that it would throw and take
     * the whole single-call grant down with it is answered, and it was wrong.
     *
     * WHAT IS STILL UNKNOWN IS WHETHER IT BUYS ANYTHING: does Chrome RETAIN the
     * path once granted, or normalise the grant to the host? That decides between
     * a real narrowing and theatre, and it cannot be measured from a desk. It
     * needs a permission actually granted, which needs the bubble accepted by
     * hand: verified, with a real CDP-dispatched click, that the gesture reaches
     * the handler (the page's own marker is set) and that `request` then NEVER
     * SETTLES -- the bubble is views-based browser UI, not a CDP target. Seeding
     * `granted_permissions` in the profile does not stand in: loading the
     * extension reinstalls it and clears them.
     *
     * So the width stays, and what bounds it is what bounds the port: the
     * substitution is the literal base URL, path included, so no rule of this
     * build reaches another path of that host, and a test asserts that on EVERY
     * emitted rule rather than on an example. The next step is a human clicking
     * Allow once and reading `permissions.getAll()`, not an edit here.
     */
    permissionOrigin() {
      /**
       * AND `hostname` CAN NO LONGER CARRY A BRACKET, which is the other half of
       * the same lesson. A match pattern has no syntax for an IPv6 host either,
       * so `http://[::1]:8080` produced `http://[::1]/*` and the browser refused
       * to even ask -- with the same blast radius as the port, since origins are
       * requested in ONE call: one such row and NOTHING was granted, search
       * engines included. parse() now refuses the bracket outright
       * (BASE_IPV6_LITERAL), which is why this concatenation can be trusted to
       * produce a parseable pattern for every instance that exists.
       *
       * The port is dropped here and the bracket is refused there, and the
       * asymmetry has a reason: a port is a legitimate part of a WORKING
       * destination that the pattern merely cannot express, so it is widened
       * away; a bracketed host makes the whole permission inexpressible, so the
       * destination could never work at all.
       */
      return this._url.protocol + "//" + this._url.hostname + "/*";
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
    // THE ADDRESS the hostname denotes, never the hostname as written: see
    // asAddress. An IPv4-mapped IPv6 literal is the same endpoint under another
    // spelling, and this list decides about endpoints.
    const address = asAddress(url.hostname);
    if (FORBIDDEN_HOSTS.has(address) || LINK_LOCAL.test(address)) {
      return refuse("BASE_FORBIDDEN_HOST", "This address is a cloud metadata or link-local endpoint.");
    }
    /**
     * AN IPv6 LITERAL IS REFUSED, AND IT IS THE PERMISSION THAT DECIDES -- not
     * a judgement about the address.
     *
     * A WebExtensions match pattern has NO SYNTAX for a bracketed host. So
     * `http://[::1]:8080` parsed, `permissionOrigin()` produced `http://[::1]/*`,
     * and the browser refused to even ask. That refusal was believed to be
     * contained -- SECURITY.md said "the failure is visible and fail-closed [...]
     * and no rule fires" -- and it was not: `permissions.request` is called ONCE
     * with EVERY origin, so a single such destination made the grant fail for the
     * search engines and for every other shortcut too. Not one jump possible,
     * anywhere, from one row.
     *
     * That is exactly the blast radius permissionOrigin() dropped the port to
     * close, one spelling further, and the arithmetic it was left open on --
     * "refusing a legitimate destination costs more than a visible, explained
     * failure" -- was wrong about both halves: the failure is neither visible nor
     * contained, and the destination is not legitimate in any working sense.
     * NOTHING is taken away that ever functioned: a shortcut written this way
     * could never obtain its permission, so it could never fire. What changes is
     * WHERE the user learns it -- at the field they are typing in, with a
     * sentence they can act on, instead of a permanently inert extension whose
     * Access button appears to do nothing.
     *
     * AFTER the forbidden-host check, deliberately: `[::]`, `[fe80::1]` and every
     * IPv4-mapped spelling of the metadata endpoint keep their own, more specific
     * and more alarming sentence. The order is the message's, not the control's --
     * both refuse.
     *
     * IT TESTS THE BRACKET, which is the whole of the syntax question. `new URL()`
     * is the one that decides: it brackets an IPv6 host and never brackets
     * anything else, so this needs no address parsing of its own -- and an address
     * that is not routable as written cannot slip past by another spelling,
     * because there is no unbracketed spelling of an IPv6 host in a URL.
     */
    if (url.hostname.startsWith("[")) {
      return refuse(
        "BASE_IPV6_LITERAL",
        "A browser permission cannot name an IPv6 address. Use a host name instead."
      );
    }
    /**
     * THE HOST OF A MATCH PATTERN IS NOT THE HOST OF A URL, and `*` is the
     * PATTERN LANGUAGE'S WILDCARD.
     *
     * `new URL()` admits `*` as a host code point, so `https://*` PARSED -- no
     * forbidden host, no bracket, canonical, pure ASCII -- and permissionOrigin()
     * produced the ALL-HTTPS-HOSTS pattern -- the very string, word for word, that
     * this manifest declares in `optional_host_permissions`, so the browser does
     * not refuse it: IT GRANTS IT. (The pattern is not spelled out in this comment
     * because its last two characters would close it; it is the second entry of
     * that manifest field, and the corpus in test/fixtures/hostile-base-urls.js
     * carries the inputs verbatim.) Measured end to end, from a configuration file
     * shaped exactly as `toTransfer()` writes one:
     *
     *   shortcuts: [{ key: "OPS", baseUrl: "https://*.corp.example" },
     *               { key: "ALL", baseUrl: "https://*" }]
     *   -> import accepted, 0 refused, 0 warnings on the first row, both disarmed
     *   -> origins handed to permissions.request: the two Google ones, PLUS the
     *      all-subdomains pattern for corp.example AND the all-https-hosts one
     *
     * Being DISARMED protects nothing here: OriginRequirements deliberately
     * collects the origins of every shortcut, armed or not, so one click on the
     * button this extension asks the user to press hands it every subdomain of a
     * domain the attacker picked -- or every https site. And a granted permission
     * is NOT revoked by a later, narrower version: SECURITY.md makes that exact
     * point about the `https://*.google.com/*` wildcard of 1.0.0.
     *
     * THE SAME RULE CLOSES THE OTHER HALF, which is the port's and the bracket's
     * blast radius one notation further. `https://a.*`, `https://ex*ample.com`,
     * `https://a_b.example`, `https://a(b.example` produce patterns whose host a
     * browser cannot parse -- `*` is legal only as the whole host or as a leading
     * `*.` -- and origins are requested in ONE call, so a single such row makes
     * the grant fail for the search engines and for every other shortcut.
     *
     * ONE PREDICATE, BOTH FAILURES, because they are the same fact: a host that is
     * not a plain sequence of LDH labels either WIDENS the pattern or BREAKS it.
     * Refused at the door the user is standing at, with a sentence they can act
     * on -- the argument BASE_IPV6_LITERAL is written on.
     *
     * AFTER the bracket refusal, deliberately: a bracketed IPv6 literal fails this
     * too, and it keeps its own, more specific sentence. Before the port, because
     * a host that cannot be named makes the port question moot.
     *
     * WHAT IT TAKES AWAY, stated rather than discovered: a trailing dot
     * (`a.com.`), a label ending in `-` (`a-.com`), an empty label (`a..com`) and
     * an underscore (`a_b.example`) stop being accepted. None of the first three
     * is a host a Jira is served from; the underscore is the one judgement call --
     * RFC 1123 forbids it in a host name, browsers tolerate it, and no measurement
     * in this repository says whether a match pattern carrying one is accepted. It
     * is refused rather than assumed, which is the direction this file takes
     * everywhere: refuse rather than clean.
     *
     * A single-label intranet name (`http://jira`) still passes, and so does a
     * punycode host -- `new URL()` has already applied it, so the value here is
     * ASCII and lower-cased.
     */
    if (!HOST_LDH.test(url.hostname)) {
      return refuse(
        "BASE_HOST_SHAPE",
        "Write the host as a plain domain name: no wildcard, no underscore, no empty label."
      );
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
