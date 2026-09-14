/**
 * The identifiers every test needs, spelled once.
 *
 * The same UUID was redeclared in five files, sometimes under different names
 * (`ID`, `id`, `ORDER_A`, `STAR`, `REACH`), and `armedCatchAll()` was written out
 * three times with three slightly different bodies. A fixture copied is a fixture
 * that drifts: two of the three catch-all builders already differed in whether
 * they acknowledged the warning, which is the difference between a shortcut that
 * installs a rule and one that does not.
 *
 * They are plain constants, not builders: what a test then does with them stays
 * visible in the test. A helper that also arms, acknowledges and orders hides the
 * preconditions that a reader needs in order to believe the assertion.
 */
export const ID = "11111111-1111-4111-8111-111111111111";
export const ID_A = "aaaaaaaa-1111-4111-8111-111111111111";
export const ID_B = "bbbbbbbb-1111-4111-8111-111111111111";
export const ID_C = "cccccccc-1111-4111-8111-111111111111";
export const STAR = "22222222-1111-4111-8111-111111111111";

/** A destination that needs no acknowledgement: https, public host, no port. */
export const PLAIN_HOST = "https://example.atlassian.net";
