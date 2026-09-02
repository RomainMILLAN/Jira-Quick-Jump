/**
 * ONE presentation per diagnosis: a sentence, a label, a tone.
 *
 * Three parallel tables keyed by the same code lived in options-sections.js, and
 * only one of them had a fallback -- `TAG_TONE[code] || "off"`, which applies the
 * LEAST ALARMING tone to the code that says "I do not know whether jumps are
 * departing". Merging them means a rank cannot gain two thirds of a presentation.
 *
 * WHY THUNKS, AND IT IS THE LOCALE SCANNER THAT IMPOSES THEM.
 *
 * structure.test.js extracts the keys with a LITERAL regex over the source --
 * /\bt\(\s*"([A-Za-z0-9_]+)"\s*,\s*"..."\s*\)/g -- and then deepEqual's the key
 * sets per locale. A table of { key, fallback } records read through
 * t(entry.key, entry.fallback) makes the keys DISAPPEAR from that scan, and the
 * natural repair is the worst one: delete the keys from messages.json, which makes
 * the French build half English ON EXACTLY THE SCREENS THIS FILE PROTECTS -- the
 * symptom the repository cites twice.
 *
 * Thunks also keep t() LAZY, which the same scanner's history requires: a table
 * evaluated at load time would resolve every string before i18n is ready.
 *
 * THE CONSTRUCTION THROWS, THE ACCESSES NEVER DO. A code with no presentation is a
 * rank added to the catalogue without opening this file, and that must fail at
 * load -- loudly, once, in every test that loads the core. But an ACCESS that
 * threw would be a dead page: Status.render is the FIRST of eight sections, and a
 * throw there used to leave the reassuring `…` placeholder on screen forever.
 */
(function (global) {
  "use strict";

  const { Platform, JumpPolicy } = global;
  // `t` is a private const of each IIFE, not a global. Forgetting this line is
  // exactly what produces the symptom this file exists to prevent.
  const t = (k, f) => Platform.t(k, f);

  /** The most alarming tone, for a code this table has never heard of. */
  const WORST = "bad";

  const ENTRIES = {
    DISARMED: {
      tone: "off",
      sentence: () => t("diagDisarmed", "Every shortcut is off. Searches behave normally."),
      label: () => t("tagOff", "Off"),
    },
    NO_SHORTCUTS: {
      tone: "off",
      sentence: () => t("diagNoShortcuts", "No shortcut yet, so nothing is intercepted."),
      label: () => t("tagEmpty", "Empty"),
    },
    NO_ENGINES: {
      tone: "warn",
      sentence: () => t("diagNoEngines", "No search engine selected, so no rule can be built."),
      label: () => t("tagNoEngine", "No engine"),
    },
    ALL_SHORTCUTS_DISARMED: {
      tone: "off",
      sentence: () => t("diagAllOff", "Every shortcut is disarmed."),
      label: () => t("tagAllOff", "All off"),
    },
    ALL_SHORTCUTS_AWAITING_ACKNOWLEDGEMENT: {
      tone: "warn",
      sentence: () => t("diagAllAwaitingAck", "Every armed shortcut is waiting for a warning to be accepted."),
      label: () => t("tagAwaitingAck", "Not accepted"),
    },
    ALL_SHORTCUTS_SHADOWED: {
      tone: "warn",
      sentence: () => t("diagAllShadowed", "Every shortcut sits below the catch-all, so none of them fires."),
      label: () => t("tagAllShadowed", "All shadowed"),
    },
    // The honest "otherwise". ALL_SHORTCUTS_SHADOWED used to be the catalogue's
    // catch-all clause under a name that asserted a precise cause; this is the one
    // that says only what it knows.
    NOTHING_TO_INSTALL: {
      tone: "warn",
      sentence: () => t("diagNothingToInstall",
        "Nothing is active right now, so no shortcut fires. Check the rows below."),
      label: () => t("tagNothingToInstall", "Nothing active"),
    },
    CATCH_ALL_NOT_INSTALLED: {
      tone: "warn",
      sentence: () => t("diagCatchAllNotInstalled", "The catch-all could not be installed, so it claims nothing."),
      label: () => t("tagCatchAllOff", "Catch-all off"),
    },
    // `bad`, and the SCALE IS CORRECTED IN THE SAME GESTURE or the change INVERTS
    // it. `.tag.bad` exists in the CSS and NO diagnosis emitted it -- its only
    // emitter was a transfer diff -- while INSTALL_FAILED sat at `warn`. Giving
    // `bad` to "I do not know" while "the installation failed" stayed at `warn`
    // would shout the lesser fact louder, against the axis the catalogue writes
    // itself. So THREE tones move, not two.
    INSTALL_FAILED: {
      tone: "bad",
      sentence: () => t("diagInstallFailed", "The rules could not be installed. What is running may differ from what you see."),
      label: () => t("tagInstallFailed", "Not installed"),
    },
    INSTALL_STATE_UNKNOWN: {
      tone: "bad",
      sentence: () => t("statusInstallUnknown", "Whether the rules were installed is unknown."),
      label: () => t("tagInstallUnknown", "Unknown"),
    },
    COVERAGE_STATE_UNKNOWN: {
      tone: "warn",
      sentence: () => t("statusCoverageUnknown", "Whether the catch-all was installed is unknown."),
      label: () => t("tagCoverageUnknown", "Catch-all unknown"),
    },
    SOME_SHADOWED: {
      tone: "warn",
      sentence: () => t("diagSomeShadowed", "Some shortcuts sit below the catch-all and never fire."),
      label: () => t("tagSomeShadowed", "Some shadowed"),
    },
    PARTIAL_POLICY: {
      tone: "warn",
      sentence: () => t("diagPartial", "Some saved entries could not be read back."),
      label: () => t("tagPartial", "Partial"),
    },
    MISSING_ORIGINS: {
      tone: "warn",
      sentence: () => t("diagMissingOrigins", "Rules are installed but cannot fire: access is missing."),
      label: () => t("tagNoAccess", "No access"),
    },
    READY: {
      tone: "ok",
      sentence: () => t("diagReady", "Ready."),
      label: () => t("tagReady", "Ready"),
    },
  };

  /**
   * THE COMPLETENESS REFERENCE IS JumpPolicy.DIAGNOSES -- exported and, until now,
   * with no reader at all. NOT the three tables against each other, which would be
   * TAUTOLOGICAL: that would catch a code missing from one table, never a rank
   * added to the catalogue without opening this file.
   *
   * Two measured traps: PARTIAL_POLICY appears TWICE in DIAGNOSES (two ranks, one
   * code) and READY is ABSENT from it (it is the fall-through, not an entry).
   */
  const REQUIRED = new Set([...JumpPolicy.DIAGNOSES, "READY"]);
  const missing = [...REQUIRED].filter((code) => ENTRIES[code] === undefined);
  if (missing.length > 0) {
    throw new Error(`diagnosis-presentation.js has no presentation for: ${missing.join(", ")}`);
  }

  const DiagnosisPresentation = {
    /** The raw code, rather than a lie, when the table has never heard of it. */
    sentence(code) {
      const entry = ENTRIES[code];
      return entry ? entry.sentence() : String(code);
    },
    label(code) {
      const entry = ENTRIES[code];
      return entry ? entry.label() : String(code);
    },
    /** The MOST alarming tone on an unknown code: silence is the one wrong answer. */
    tone(code) {
      const entry = ENTRIES[code];
      return entry ? entry.tone : WORST;
    },
    WORST,
    /** For the tests, and for nobody else. */
    codes: () => Object.keys(ENTRIES),
  };

  global.DiagnosisPresentation = DiagnosisPresentation;
})(globalThis);
