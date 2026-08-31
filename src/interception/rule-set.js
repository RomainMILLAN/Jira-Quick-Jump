/**
 * The rules to install, grouped into INDIVISIBLE UNITS.
 *
 * The invariant this object exists to hold: ON ENGINE E, NEVER A CATCH-ALL
 * WITHOUT ITS RESERVED-PREFIX ALLOW ON E. Violating it is not an availability
 * nuisance -- it is an outbound data flow, ISO-9001 landing in the Jira
 * instance's access logs.
 *
 * It used to be a repair pass: the installer filtered rule by rule and then
 * called a factory method that received its two arrays and corrected them. A
 * factory that mutates its client's collections is not a factory, and the
 * atomicity was guaranteed only by nobody forgetting the call -- which is to say
 * by nothing. One does not hand a pharmacist a pile of capsules with a note
 * saying "if the antidote is missing, remember to remove the poison too". One
 * hands over a sealed blister pack.
 *
 * THE UNIT IS PER ENGINE, not global. A capricious isRegexSupported on Bing must
 * not take down the catch-all on Google: equal security, better availability.
 *
 * And withoutRules is SYNCHRONOUS. The installer does the awaits and hands over
 * the set of unsupported ids; the atomicity logic is then testable with no
 * platform fake, and this stays a value object.
 */
(function (global) {
  "use strict";

  class RuleSet {
    /** `units` is an array of arrays: each inner array falls or stands together. */
    constructor(units, skipped) {
      this._units = units;
      this._skipped = skipped;
    }

    rules() {
      return this._units.flat();
    }

    skipped() {
      return [...this._skipped];
    }

    /** Synchronous, and the UNIT decides: one refused rule drops its whole unit. */
    withoutRules(unsupportedIds) {
      const refused = new Set(unsupportedIds);
      const units = [];
      const skipped = [...this._skipped];
      for (const unit of this._units) {
        const broken = unit.filter((rule) => refused.has(rule.id));
        if (broken.length === 0) {
          units.push(unit);
          continue;
        }
        for (const rule of unit) {
          skipped.push({ binding: rule.id, code: refused.has(rule.id) ? "REGEX_UNSUPPORTED" : "UNIT_INCOMPLETE" });
        }
      }
      return new RuleSet(units, skipped);
    }

    /**
     * The post-condition, ASSERTED rather than deduced from how the units were
     * cut -- because it is a property of the final set, and a sealed blister is
     * checked sealed.
     */
    assertReservedPrefixesCoverEveryCatchAll() {
      const guarded = new Set();
      const needing = new Set();
      for (const rule of this.rules()) {
        if (rule.action.type === "allow") guarded.add(rule.engineId);
        else if (rule.isCatchAll) needing.add(rule.engineId);
      }
      for (const engineId of needing) {
        if (!guarded.has(engineId)) {
          throw new Error("a catch-all rule is installed without its reserved prefixes on " + engineId);
        }
      }
      return this;
    }

    /** True when every catch-all the policy wanted actually survived. */
    catchAllInstalled(wanted) {
      if (!wanted) return true;
      return this.rules().some((rule) => rule.isCatchAll);
    }
  }

  global.RuleSet = RuleSet;
})(globalThis);
