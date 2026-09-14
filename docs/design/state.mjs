/**
 * Builds the storage the screenshot page starts from, using the REAL domain code.
 *
 * Hand-writing the JSON would have been quicker and would have rotted the first
 * time StoredPolicy's shape moved: the screenshot would then show a state the
 * extension can no longer produce. Building it through JumpPolicy means a shape
 * change breaks this file loudly instead.
 *
 * The hosts are example hosts, deliberately and permanently. scripts/package-filter.mjs
 * exists because "a screenshot with a real Jira host in it" is a way this
 * repository could leak someone's infrastructure; a screenshot in docs/ is the
 * same leak with a different path.
 */
import { loadCore } from "../../test/load-core.js";

const g = await loadCore();

const instance = (url) => g.JiraInstance.parse(url).value;
const key = (k) => g.ProjectKey.parse(k).value;

const shortcut = (policy, id, k, url) => {
  const registered = policy.register(id, key(k), instance(url), g.Consent.fresh());
  return registered.value.armShortcut(id).value;
};

let policy = g.JumpPolicy.empty().withEngines(["google.com", "duckduckgo.com"]).value;
policy = shortcut(policy, "abc", "ABC", "https://example.atlassian.net");
policy = shortcut(policy, "ops", "OPS", "https://intra.example.org/jira");
policy = policy.arm();

/**
 * The projection is what the status line reads to answer "were the rules
 * actually installed?". Without it the page says "unknown" -- honest for a fresh
 * profile, misleading as a picture of the product working.
 */
export const STORAGE = {
  policy: { rev: 4, value: policy.toJSON() },
  installedProjection: { rev: 4, value: { policy: policy.toJSON() } },
  // The receipt the worker leaves after installing. Absent, the status line says
  // "unknown" -- correct on a fresh profile, and not the state worth picturing.
  installOutcome: { rev: 4, value: { installed: true, coverageSatisfied: true, skipped: [] } },
};

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(JSON.stringify(STORAGE, null, 2));
}
