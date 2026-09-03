/**
 * One sentence per fact, per warning, per refused rule -- the catalogues.
 *
 * They live together because they answer one kind of question ("what do we tell
 * the reader about X?") and because they are the part of this screen a
 * translator touches. A section builds nodes; it does not decide wording.
 *
 * Every entry goes through Platform.t with its English as the fallback, which is
 * what keeps the French build honest -- and what a scan of this file can check.
 */
(function (global) {
  "use strict";

  const { el, t } = global.SectionParts;
  const { CatchAllKey } = global;

  /**
   * The nouns behind the fact types carried by PolicyReplaced. No prototype: the
   * keys come from a stored fact, and `{ kinds: ["constructor"] }` would otherwise
   * resolve through Object.prototype -- the same trap SKIPPED_SENTENCE closes.
   * An unknown kind maps to undefined and is refused, which is the safe direction:
   * the count is still said.
   */
  const KIND_NOUN = () => Object.assign(Object.create(null), {
    DestinationChanged: t("kindDestination", "destinations"),
    KeyChanged: t("kindKey", "keys"),
    ShortcutArmed: t("kindArmed", "shortcuts switched on"),
    CatchAllAppeared: t("kindCatchAll", "a catch-all"),
    ShadowingChanged: t("kindShadowing", "which shortcut wins"),
    EnginesAdded: t("kindEngines", "search engines"),
    EnginesRemoved: t("kindEnginesRemoved", "search engines removed"),
    PolicyArmed: t("kindPolicyArmed", "the extension switched on"),
    QuarantinedReadmitted: t("kindReadmitted", "quarantined entries brought back"),
  });

  const FACT_SENTENCE = (fact) => {
    const host = (text) => el("span", { class: "dest host", text });
    // NOT `.dest`: this paints a key, or a phrase standing in for one -- never a
    // destination. One class for three meanings made a rule about where traffic
    // goes govern the word beside it.
    const plain = (text) => el("span", { class: "mono-token", text });
    switch (fact.type) {
      case "ShortcutAppeared":
      case "CatchAllAppeared":
        return [
          plain(fact.key || t("catchAllKey", "Any short key")),
          " ",
          t("factAppeared", "was added, pointing to"),
          " ",
          host(fact.baseUrl),
          ".",
        ];
      case "ShortcutRemoved":
      case "CatchAllRemoved":
        return [
          plain(fact.key || t("catchAllKey", "Any short key")),
          " ",
          t("factRemoved", "was removed. It pointed to"),
          " ",
          host(fact.baseUrl),
          ".",
        ];
      case "ShadowingChanged":
        // TWO FACTS, BECAUSE THEY ARE TWO. The single sentence read "these keys now
        // go to the catch-all", which is FALSE for a key of more than six
        // characters or a reserved prefix: the catch-all does not claim those at
        // all, so they are not intercepted any more and leave IN CLEAR for the
        // search engine. The wrong destination, named on the surface whose whole
        // job is to be believed -- and wrong in the reassuring direction.
        return [
          t("factShadowedStopped", "These keys no longer fire, because the catch-all moved above them:"),
          " ",
          plain(fact.affectedKeys.join(", ")),
          ". ",
          t("factShadowedClaims", "What the catch-all does claim goes to"),
          " ",
          host(fact.catchAllBaseUrl),
          ".",
        ];
      case "PolicyReplaced": {
        // AND WHICH KINDS, when the diff carried them. Without this the collapse
        // rewarded noise: six moved destinations read "the whole configuration
        // changed" while ONE read the old and the new host by name. The kinds are
        // a closed vocabulary this repository writes -- unlike an engine id, none
        // of these words is authored by whoever wrote the policy.
        const said = (fact.kinds || []).map((kind) => KIND_NOUN()[kind]).filter(Boolean);
        if (said.length === 0) {
          return [t("factReplaced", "The whole configuration changed elsewhere. Check every destination.")];
        }
        return [
          t("factReplaced", "The whole configuration changed elsewhere. Check every destination."),
          " ",
          t("factReplacedKinds", "What changed:"),
          " ",
          said.join(", "),
          ".",
        ];
      }
      case "KeyChanged":
        return [
          plain(fact.oldKey),
          " ",
          t("factKeyChanged", "no longer intercepts what it did; the key is now"),
          " ",
          plain(fact.newKey),
          ". ",
          t("changedNow", "now points to"),
          " ",
          host(fact.baseUrl),
          ".",
        ];
      case "ShortcutArmed":
        return [
          plain(fact.key || t("catchAllKey", "Any short key")),
          " ",
          t("factArmed", "was armed and now redirects to"),
          " ",
          host(fact.baseUrl),
          ".",
        ];
      case "EnginesAdded":
        return [
          t("factEnginesAdded", "More search engines are intercepted than before. Check the Access section."),
        ];
      case "EnginesRemoved":
        // The reassuring direction -- a smaller surface -- but still a change to
        // the policy made somewhere else, and saying it is what stops "one engine
        // added" from being the whole story of a swap.
        return [
          t("factEnginesRemoved", "Fewer search engines are intercepted than before."),
        ];
      case "PolicyArmed":
        return [t("factPolicyArmed",
          "The extension was switched back on elsewhere, and every shortcut redirects again.")];
      case "PolicyUnreadable":
        // The path a compromised sync reaches most easily, and it used to be
        // mute: purge, badge to `off`, not one line anywhere.
        return [t("factUnreadable",
          "What was saved stopped being readable, so nothing is installed. Check every destination.")];
      case "ProjectionStale":
        // The change detector's baseline could not be refreshed. Nothing is wrong
        // with the rules; what is at risk is the NEXT comparison, which may report
        // an ordinary edit as unattributed. Said, so a spurious banner afterwards
        // has an explanation instead of looking like a compromise.
        return [t("factProjectionStale",
          "The change detector could not refresh its baseline, so the next alert may name a change you made yourself.")];
      default:
        return [
          plain(fact.key),
          " ",
          t("changedNow", "now points to"),
          " ",
          host(fact.newBaseUrl),
          ". ",
          t("changedWas", "It used to point to"),
          " ",
          plain(fact.oldBaseUrl),
          ".",
        ];
    }
  };

  // The core returns a CODE; the sentence is written here, and therefore
  // translated here. Built lazily: t() reads the browser's locale, which is not
  // available while this file is still being evaluated in a service worker.
  /**
   * The four warning messages never went through t(), so the French build was
   * half English on exactly the screens this feature adds. Lazy, like DIAGNOSIS
   * below: t() reads the locale, which is not available while this file is still
   * being evaluated in a service worker.
   */
  const WARNING_MESSAGE = () => ({
    INSECURE_SCHEME: t("warnInsecureScheme", "Traffic and your Jira session cookie travel in clear text."),
    INTERNAL_HOST: t("warnInternalHost", "This destination is on a private or non-public network."),
    LITERAL_IP: t("warnLiteralIp", "This destination is an IP address rather than a host name."),
    PUNYCODE: t("warnPunycode", "This host name uses non-ASCII characters and may imitate another one."),
    CATCH_ALL: t("warnCatchAll", "Every search shaped like a 2-to-6-character key, a hyphen and a number will leave for this destination, on each engine you ticked. Only a short reserved list is held back."),
  });

  /**
   * The three parallel tables that lived here -- DIAGNOSIS, TAG_TEXT, TAG_TONE --
   * are now ONE table in ui/diagnosis-presentation.js, whose CONSTRUCTION refuses
   * an incomplete catalogue. Only TAG_TONE ever had a fallback, and it was
   * `|| "off"`: the LEAST alarming tone applied to the code that says "I do not
   * know whether jumps are departing".
   */

  /**
   * What a move did to the row that moved, as a CATALOGUE keyed by a TRIPLET --
   * not a chain of ifs, and not a pair.
   *
   * The key is (was shadowed, the resulting status, the direction), because a move
   * with NO change of shadowing is the majority case and must keep saying which way
   * it went. A pair would have left that case with no entry, and the next reader
   * would either drop the direction or bolt an `if` in front of the table.
   *
   * ONE JUDGE, ONE CALL. `SHADOWED` is the FIRST test in statusOf's chain, so
   * asking the aggregate for the status IS asking the registry whether the row is
   * shadowed -- identically, not approximately. The transition therefore needs no
   * separate reading, and this file never has to reach past the aggregate to its
   * collection (a structure test holds that line, comments included). What
   * guarantees the equivalence is the order at jump-policy.js:172-175, and that is
   * why that order does not get rearranged.
   *
   * AND THE ASYMMETRY, which is the whole reason this is a catalogue:
   *
   *   shadowed  =>  never fires   (unconditional, safe to promise)
   *   not shadowed  =/=>  fires   (three other doors can be shut)
   *
   * An unlocked door is not an open door. So only the "now shadowed" direction may
   * promise anything about firing; coming back out, the sentence stops at "no
   * longer shadowed" unless the status is actually ACTIVE. Saying "it fires again"
   * to a screen-reader user about a row that is merely awaiting an
   * acknowledgement would be a lie in the only channel that speaks to them.
   *
   * It is also a THIRD comparator of two states, and deliberately so. PolicyDiff
   * answers "what changed, for the journal" -- in a batch, only newlyShadowed,
   * inside the commit closure. This answers "what does THIS gesture do to THIS
   * row, before writing it" -- for one id, in both directions. Same material, two
   * questions, neither can answer for the other.
   */
  const sentenceFor = (before, after, id, movedUp) => {
    const wasShadowed = before.statusOf(id) === "SHADOWED";
    const status = after.statusOf(id);
    if (!wasShadowed && status === "SHADOWED") {
      return t("nowShadowed", "Now shadowed: this shortcut no longer fires.");
    }
    if (wasShadowed && status !== "SHADOWED") {
      return status === "ACTIVE"
        ? t("noLongerShadowedActive", "No longer shadowed: this shortcut fires again.")
        : t("noLongerShadowed", "No longer shadowed.");
    }
    return movedUp ? t("movedUp", "Moved up.") : t("movedDown", "Moved down.");
  };

  /**
   * NO PROTOTYPE, because this table is the only one here indexed by a key that
   * comes from OUTSIDE. `cause.code` and `cause.subject` are read back from the
   * receipt, where install-outcome.js checks `typeof === "string"` and nothing
   * else -- so `{ code: "constructor" }` would return the `Object` function,
   * which is TRUTHY, so the `|| cause.code` fallback would not fire, and the
   * panel meant to explain why a security control fell would print
   * `function Object() { [native code] }`. Same for toString, valueOf, __proto__.
   *
   * `cause.subject` is the one that matters most: `code` is a closed vocabulary we
   * write (Re2Budget.REASONS, frozen), while `subject` is free text derived from
   * the policy -- the "text chosen by whoever wrote the policy" that policy-diff
   * already refuses to carry elsewhere.
   *
   * Object.create(null) closes BOTH lookups at once. A hasOwn() at each call site
   * would work too, and would be forgotten on one of the two.
   */
  const SKIPPED_SENTENCE = () => Object.assign(Object.create(null), {
    UNKNOWN_ENGINE: t("skipUnknownEngine", "A ticked search engine is no longer known."),
    REGEX_UNSUPPORTED: t("skipRegexUnsupported", "The browser refused the pattern for this rule."),
    UNIT_INCOMPLETE: t("skipUnitIncomplete", "This rule was dropped with the group it belongs to."),
    CONSTRUCTION_REFUSED: t("skipConstructionRefused", "The rules could not be built."),
    RUN_OVER_BUDGET: t("skipRunOverBudget", "The reserved-prefix guard is too long for the browser."),
    ENVELOPE_OVER_BUDGET: t("skipEnvelopeOverBudget", "This search engine's address leaves no room for a rule."),
    KEY_LENGTH_OVER_BUDGET: t("skipKeyLengthOverBudget", "The catch-all claims longer keys than the browser can match."),
  });

  /** Lazy and translated, like DIAGNOSIS: these four never went through t(). */
  /** The catch-all's own bounds, asked of the objects that hold them. */
  const catchAllNote = () => {
    const shortest = 2;
    // The CONSTANT, never `CatchAllKey.only()`: this file must not mint a
    // catch-all key, and a structure test holds that line.
    const longest = CatchAllKey.CLAIMS_KEYS_UP_TO;
    // The fallback carries the SAME placeholders as the catalogue, so the English
    // and the French are filled by one substitution rather than two spellings of
    // the bound. A template literal here would also hide the call from the i18n
    // scan, which only reads double-quoted pairs.
    return t("catchAllNote", "Any {min}-to-{max}-character key followed by a hyphen and a number goes to this destination, on the engines you ticked. A short reserved list is held back.")
      .replace("{min}", String(shortest))
      .replace("{max}", String(longest));
  };

  const PREVIEW_MISS = () => ({
    NOT_A_URL: t("previewNotAUrl", "That is not a URL."),
    // A configuration answer, never a verdict on the text: with nothing ticked
    // the preview used to blame the input for a problem it did not have.
    NO_ENGINES: t("previewNoEngines", "Tick a search engine first: nothing is intercepted yet."),
    NOT_A_SEARCH_URL: t("previewNotASearchUrl", "That is not a search URL."),
    NO_MATCH: t("previewNoMatch", "This search would go through untouched."),
    INPUT_TOO_LONG: t("previewTooLong", "That is too long to be a search URL."),
    RESERVED_PREFIX: t("previewNoMatch", "This search would go through untouched."),
    // NON_DETERMINISTIC is an assertion canary and must stay unreachable, so it
    // deliberately has no sentence of its own: translating something nobody can
    // see would be a stage set.
    NON_DETERMINISTIC: t("previewNoMatch", "This search would go through untouched."),
  });

  global.SectionSentences = {
    FACT_SENTENCE, WARNING_MESSAGE, sentenceFor,
    SKIPPED_SENTENCE, catchAllNote, PREVIEW_MISS,
  };
})(globalThis);
