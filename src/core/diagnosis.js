/**
 * The DIAGNOSIS: what the user is actually asking, which is "will typing ABC-1
 * work?" rather than what a rule counter answers.
 *
 * IT LEFT THE AGGREGATE, and the move is the point. JumpPolicy already carried
 * the mutations, the persistence projection, the matching oracle, the quota
 * police and the binding forge; this catalogue plus its arbitration was a sixth
 * reason to change it, seventy-five lines long, and the only one that is not
 * about BEING a policy. It is about READING one.
 *
 * The policy still answers `diagnose(facts)` -- callers ask the thing they hold,
 * and that delegation is one line -- but the order of priority, the codes and the
 * arbitration live here, where they can be read as a table and changed without
 * reopening the aggregate.
 */
(function (global) {
  "use strict";

/**
 * The order of priority, AS A CATALOGUE rather than a chain of ifs -- so that
 * the order is DATA, exactly as it is for the shortcuts themselves. Read top
 * to bottom, FIRST MATCH WINS, so the order written here IS the order of the
 * code and no annotation may contradict it.
 *
 * The axis: a state meaning "no jump will happen at all" always outranks a
 * state meaning "some jumps will not happen". Which is why MISSING_ORIGINS now
 * sits ABOVE PARTIAL_POLICY -- a DELIBERATE INVERSION of the previous order,
 * written as such so nobody "fixes" it back: telling someone that some rows are
 * shadowed, while never telling them that nothing will fire at all, is the
 * fourth product principle broken by a sort order.
 *
 * INSTALL_FAILED comes FIRST, and that is an EXCEPTION to the axis:
 * DISARMED means "no jump" IN INTENTION, INSTALL_FAILED means "the installed
 * reality contradicts the intention". The naive axis would call them equal; the
 * second sense wins, because an emergency stop that reports "stopped" without
 * having stopped is worse than no emergency stop.
 */
const DIAGNOSES = [
  // TWO codes, and the PARTITION is what makes them honest. `!== true` folded
  // "it failed" and "I do not know" into one sentence: it over-signalled on a
  // healthy profile whose receipt was merely absent, and it named the wrong
  // cause. `=== false` alone would be the fail-open -- an ABSENT fact is
  // indistinguishable from a true one -- so the pair must be DISJOINT and
  // TOTAL, which is what the two predicates below are.
  { code: "INSTALL_FAILED", applies: (p, f) => f.installed === false },
  // `typeof !== "boolean"`, NOT `=== undefined`: null, "false" and 0 would fall
  // through the hole and drop all the way to READY. diagnose() is PUBLIC and the
  // tests call it directly, so InstallOutcome.read does not protect this hole.
  //
  // AND THE GUARD IS ON REALITY, NOT ON INTENTION. Three drafts got this wrong.
  // `activeBindings().length > 0` excluded the DISARMED policy -- measured:
  // armed()=false | activeBindings=0 | registry=1 -- so it fell to DISARMED, i.e.
  // "no jump will fire" said without knowing whether the purge happened. Then
  // `registry().size() > 0` alone opened a NEW fail-open -- measured:
  // registry=0, quarantinedCount=2, fact absent  ->  PARTIAL_POLICY, a
  // SUB-signalling, where the old `!== true` said INSTALL_FAILED.
  //
  // The name of the disjunction is "IS THERE ANYTHING TO LOSE?", not "are there
  // rules installed?" -- that second wording justifies only ONE of the three
  // terms (registry is intention, quarantinedCount a failed read), and someone
  // would "simplify" towards it and reopen the fail-open. Disarming, deleting
  // one's last shortcut, seeing everything quarantined: that is three ways of
  // installing the void, and ignorance about the void is the kill switch's
  // question. A blank profile (0/0/0) stays silent and falls to NO_SHORTCUTS.
  //
  // ABOVE DISARMED, or the measurement above falls back onto it.
  {
    code: "INSTALL_STATE_UNKNOWN",
    applies: (p, f) =>
      typeof f.installed !== "boolean" &&
      (f.rulesInstalled === true || p.hasShortcuts() || f.quarantinedCount > 0),
  },
  { code: "DISARMED", applies: (p) => !p.armed() },
  // Before NO_SHORTCUTS: with everything quarantined there are not *no*
  // shortcuts, there are UNREADABLE ones -- and saying "no shortcut yet" is the
  // one answer that hides a partial read.
  { code: "PARTIAL_POLICY", applies: (p, f) => !p.hasShortcuts() && f.quarantinedCount > 0 },
  { code: "NO_SHORTCUTS", applies: (p) => !p.hasShortcuts() },
  { code: "NO_ENGINES", applies: (p) => p.engineIds().length === 0 },
  {
    code: "ALL_SHORTCUTS_DISARMED",
    applies: (p, f, live) => live.length === 0 && p.shortcuts().every((s) => !s.armed()),
  },
  {
    code: "ALL_SHORTCUTS_AWAITING_ACKNOWLEDGEMENT",
    applies: (p) =>
      p.activeBindings().length === 0 &&
      p.shortcuts().some((s) => s.armed()) &&
      p.shortcuts().filter((s) => s.armed()).every((s) => s.unacknowledgedWarnings().length > 0),
  },
  // NAMED FOR ITS CAUSE, and it must keep being able to prove it. This was the
  // catalogue's "otherwise" clause -- `activeBindings().length === 0` with no
  // condition on shadowing at all -- under a name asserting a precise reason.
  // Any future fifth filter in _isLive would have come out under this label and
  // sent the user hunting for a catch-all that does not exist.
  {
    code: "ALL_SHORTCUTS_SHADOWED",
    applies: (p, f, live) => live.length === 0 && p.shadowedShortcuts().length > 0,
  },
  // The honest "otherwise": something excludes every shortcut and it is none of
  // the reasons above.
  { code: "NOTHING_TO_INSTALL", applies: (p, f, live) => live.length === 0 },
  // The FACT is named for what it asserts -- every engine that wanted a catch-all got
  // one -- while the CODE stays the user's sentence. Renaming the reader without the
  // writers, or the writers without this reader, makes the fact arrive ABSENT --
  // which no longer fires THIS code, since it now tests `=== false`, but its twin
  // below, guarded on wantsCatchAll(). The masking moved with the subject.
  { code: "CATCH_ALL_NOT_INSTALLED", applies: (p, f) => f.coverageSatisfied === false },
  // JUST AFTER ITS TWIN, therefore ABOVE MISSING_ORIGINS -- prescribed, not left
  // to the implementation: slid below MISSING_ORIGINS, the wantsCatchAll() guard
  // becomes an ornament and this code masks nothing it was meant to yield to.
  //
  // The GUARD is what keeps it quiet on the profiles that never wanted a
  // catch-all: without it, COVERAGE_STATE_UNKNOWN would mask MISSING_ORIGINS,
  // PARTIAL_POLICY and SOME_SHADOWED on EVERY profile with an absent receipt.
  {
    code: "COVERAGE_STATE_UNKNOWN",
    applies: (p, f, live) =>
      typeof f.coverageSatisfied !== "boolean" &&
      live.some((binding) => binding.isCatchAll()),
  },
  { code: "MISSING_ORIGINS", applies: (p, f) => !f.originsGranted },
  { code: "PARTIAL_POLICY", applies: (p, f) => f.quarantinedCount > 0 },
  { code: "SOME_SHADOWED", applies: (p) => p.shadowedShortcuts().length > 0 },
];

  const Diagnosis = {
    /**
     * THE PUBLISHED LANGUAGE: each code once, in rank order.
     *
     * It projected the RANKS, and PARTIAL_POLICY holds two of them -- one above
     * NO_SHORTCUTS, one far below -- so the list handed out fifteen entries for
     * fourteen words. A vocabulary that repeats itself is not a vocabulary; every
     * reader had to dedupe it, or count wrong.
     *
     * The duplicate stays where it belongs, in RANKS, and a test pins both facts:
     * fifteen ranks, fourteen codes.
     *
     * Frozen: it was a live array handed out through JumpPolicy.DIAGNOSES, so any
     * reader could reorder this project's published language in place.
     */
    CODES: Object.freeze([...new Set(DIAGNOSES.map((d) => d.code))]),

    /** How many rungs the ladder has, duplicates included. The ORDER is the
     *  arbitration; the codes are the words. */
    RANKS: Object.freeze(DIAGNOSES.map((d) => d.code)),

    /**
     * The facts come in THROUGH THE DOOR: answering MISSING_ORIGINS needs the
     * engine catalogue and the platform, neither of which the core may know.
     *
     * NO DEFAULT on any fact. An absent fact of installed reality is not `true`:
     * defaulting here would put the domain's thumb back on the scale behind
     * whatever the caller failed to supply.
     */
    of(policy, facts) {
      // COMPUTED ONCE, HANDED DOWN. Four entries below reach the live bindings,
      // each of which walks the registry and asks every shortcut for its pending
      // warnings.
      const live = policy.activeBindings();
      for (const { code, applies } of DIAGNOSES) {
        if (applies(policy, facts, live)) return code;
      }
      return "READY";
    },
  };

  global.Diagnosis = Diagnosis;
})(globalThis);
