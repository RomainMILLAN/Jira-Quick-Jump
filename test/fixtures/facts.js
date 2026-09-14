/**
 * The facts a diagnosis is asked about, built so that AN OMISSION IS VISIBLE.
 *
 * `{ originsGranted: true, installed: true, coverageSatisfied: true }` was rewritten
 * roughly twenty times across the suite, with small variations nobody could compare
 * at a glance. The obvious fix -- a factory that fills in the rest -- would rebuild
 * in the harness the very fault `report()` was just cured of: a default that makes
 * a missing field SILENT.
 *
 * So this factory does the opposite of defaulting. `installedAndCovered()` is the
 * happy case, stated once. Every other shape is written by NAMING what differs, and
 * `without()` removes a key on purpose, so a test that means "this field is absent"
 * says so instead of merely forgetting it.
 *
 * The distinction matters here more than anywhere: install-outcome.js keeps the
 * ABSENCE of `installed` and `coverageSatisfied` as a third term -- the unknown --
 * and a factory that quietly supplied them would make that term untestable.
 */

/** Everything granted, installed and covered: the case most tests start from. */
export const installedAndCovered = (over = {}) => ({
  originsGranted: true,
  quarantinedCount: 0,
  installed: true,
  coverageSatisfied: true,
  ...over,
});

/** The same, minus the named keys -- an ABSENCE stated rather than forgotten. */
export const without = (facts, ...keys) => {
  const copy = { ...facts };
  for (const key of keys) delete copy[key];
  return copy;
};
