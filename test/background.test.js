/**
 * The service worker, exercised as a worker.
 *
 * Until this file existed background.js had NO behavioural test at all, and its
 * export was consumed nowhere -- so every claim about what the worker does on a
 * failed load, a cold start or a compromised store was an argument, not a fact.
 * The point of this file is to make those claims fail when they stop being true.
 *
 * ONE fake platform, posed before the first import, never swapped: see the
 * header of fake-platform.js for why a per-test swap cannot work here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { installPlatform, reset, fire, store, dnrFaults, holdRead, holdWrite } from "./fake-platform.js";
import { loadCore } from "./load-core.js";

// BEFORE any import of src/: platform.js captures `global.chrome` by VALUE at
// load time. loadCore() imports dynamically, inside the function, which is what
// makes this ordering possible in an ES module.
installPlatform();

const g = await loadCore();
await import("../src/background.js");

const bg = g.JiraQuickJumpBackground;

/** A policy that installs something: one armed, acknowledged catch-all. */
const armedCatchAll = () => {
  let p = g.JumpPolicy.empty().withEngines(["google.com"]).value;
  p = p.registerCatchAll("star", g.JiraInstance.parse("https://catchall.atlassian.net").value).value;
  p = p.acknowledge("star", "CATCH_ALL").value;
  return p.armShortcut("star").value;
};

const named = (key, host) => {
  const id = "11111111-1111-4111-8111-111111111111";
  let p = g.JumpPolicy.empty().withEngines(["google.com"]).value;
  p = p.register(id, g.ProjectKey.parse(key).value, g.JiraInstance.parse(host).value).value;
  return p.armShortcut(id).value;
};

/**
 * Writes a policy where the repository will find it, envelope included -- AND
 * its key-scoped acknowledgements, which live in their OWN entry.
 *
 * JumpPolicy.toJSON does not carry them, by design: _restore closes that
 * separate context back at reconstitution. A fixture that seeds only the policy
 * therefore hands the worker an UNACKNOWLEDGED catch-all, which is excluded from
 * activeBindings() and installs nothing -- measured, and it is the state every
 * fresh catch-all passes through, not an artefact of the test.
 */
const seedPolicy = async (policy, rev = 1) => {
  store.put("policy", { rev, value: new g.StoredPolicy(policy, []).toJSON() });
  await g.KeyAcknowledgements.record(policy);
};

/** What the projection holds, as background.js writes it. */
const seedProjection = (policy, loggedRev = 0, rev = 1) =>
  store.put("installedProjection", { rev, value: { policy: policy.toJSON(), loggedRev } });

const journal = () => g.DestinationJournal.read();

test.beforeEach(() => reset());

// ---------------------------------------------------------------------------
// The five behaviours that must be GREEN ON THE CURRENT CODE. They are the net,
// not the change: if any of them is red before a production line moves, the
// diagnosis behind this batch is wrong and the batch stops.
// ---------------------------------------------------------------------------

test("1. a readable policy is installed, and the count follows the installed reality", async () => {
  await seedPolicy(armedCatchAll());

  await bg.sync();

  const installed = store.rules();
  assert.ok(installed.length > 0, "the catch-all reached the platform");
  // The badge derives from what is really installed, never from policy.armed().
  await bg.refreshBadge();
  assert.notEqual(store.badge(), "off", "rules are live, so the badge must not say off");
});

test("2. an unreadable policy purges, and `off` is then the truth", async () => {
  // First install something, so there is something to lose.
  await seedPolicy(armedCatchAll());
  await bg.sync();
  assert.ok(store.rules().length > 0, "precondition: rules are live");

  // Now what a compromised sync writes: an entry that cannot be restored.
  store.put("policy", { rev: 2, value: { policy: "not a policy" } });
  await bg.sync();

  assert.equal(store.rules().length, 0, "fail-closed: the rules are emptied");
  await bg.refreshBadge();
  assert.equal(store.badge(), "off", "and `off` is now a true statement");
});

test("3. reconcile with NO baseline reports an unattributed change", async () => {
  // A wiped storage.local, a fresh profile, a new device. Returning here would
  // move the in-memory hole thirty lines rather than close it.
  const policy = armedCatchAll();
  await seedPolicy(policy);
  assert.equal(store.entry("installedProjection"), undefined, "precondition: no baseline");

  await bg.sync();

  const log = await journal();
  assert.equal(log.entries.length, 1);
  assert.equal(log.entries[0].type, "PolicyReplaced");
  assert.equal(log.acknowledged, false, "an unattributed change must raise the banner");
});

test("4. a policy changed OUTSIDE the door is journalled as UNKNOWN", async () => {
  // Emission by the mutation catches what comes through the door; this catches
  // what comes through the window. No withBaseUrlFor was ever called.
  const before = named("ABC", "https://honest.atlassian.net");
  await seedPolicy(before);
  seedProjection(before);

  const after = before.withBaseUrlFor(
    before.shortcuts()[0].id(),
    g.JiraInstance.parse("https://evil.example.org").value
  ).value;
  await seedPolicy(after, 2);

  await bg.sync();

  const log = await journal();
  assert.ok(log.entries.length > 0, "the window is watched, not just the door");
  const change = log.entries.find((e) => e.type === "DestinationChanged");
  assert.ok(change, "a destination change is named, not hashed");
  assert.equal(change.source, "UNKNOWN", "unattributed, which is MORE alarming");
  assert.equal(change.newBaseUrl, "https://evil.example.org", "the trust model promises the host, not a hash");
});

test("5. the projection is NOT written after a failed install", async () => {
  // A stale comparison base would re-diff the same gap at every wake-up and fill
  // a twenty-entry journal with duplicates -- evicting the very UNKNOWN a
  // compromise left behind.
  await seedPolicy(armedCatchAll());
  dnrFaults.rejectUpdate = true;

  await bg.sync();

  assert.equal(store.rules().length, 0, "precondition: nothing was installed");
  assert.equal(
    store.entry("installedProjection"),
    undefined,
    "the detector keeps its baseline rather than adopting a state that never existed"
  );
});

// ---------------------------------------------------------------------------
// The behaviours that arrive WITH their gesture. Each of these was RED before
// its change, which is the only thing that makes it a witness rather than a
// description.
// ---------------------------------------------------------------------------

test("6. after a fail-closed, the receipt says installed: false", async () => {
  // THE MAIN FAIL-CLOSED PATH IS NOT AN EXCEPTION. load() returns { ok: false } as
  // a VALUE, so the early return traversed the finally with `outcome` still {} --
  // the receipt saying "I know nothing" where it had LEARNED NO, on the path a
  // compromised sync reaches most easily.
  store.put("policy", { rev: 1, value: { policy: "not a policy" } });

  await bg.sync();

  assert.deepEqual(store.entry("installOutcome").value, { installed: false, coverageSatisfied: false });
});

test("7. permissions.onAdded refreshes the badge, and every listener shares one protocol", async () => {
  // Granting access from the options page must install the rules without waiting
  // for a browser restart -- and the badge must follow, or the extension looks
  // broken on the very screen where permission was just given.
  await seedPolicy(armedCatchAll());

  await fire.permissionAdded({ origins: ["https://www.google.com/*"] });

  assert.ok(store.rules().length > 0, "the grant installed the rules");
  assert.notEqual(store.badge(), undefined, "the badge was refreshed by the envelope");
  assert.notEqual(store.badge(), "off");
});

test("7bis. a body that rejects does NOT prevent the sync, and the badge still runs", async () => {
  // The exact fault sync() fixes, redone one level up: onInstalled with
  // reason === "update" does a storage.local.set that rejects on a full quota, and
  // the update then installs nothing, reconciles nothing, journals nothing.
  await seedPolicy(armedCatchAll());
  const badgeCallsBefore = store.badgeCalls();
  store.failWrites(true);

  // The body's own write throws; the envelope treats the body as INCIDENTAL.
  await fire.installed({ reason: "update" });
  store.failWrites(false);

  assert.ok(store.badgeCalls() > badgeCallsBefore, "the badge ran despite the body throwing");
  // And the rules were installed: the body's failure did not cancel the sync.
  assert.ok(store.rules().length > 0, "syncing matters more than what triggered it");
});

test("7ter. the kill switch is INSIDE the protocol, not the one listener without it", async () => {
  // Left outside, a throw from sync() would skip the badge, the old rules would
  // stay alive (a DNR rejection is atomic), and the screen would keep its previous
  // text -- possibly empty, i.e. "all is well".
  await seedPolicy(armedCatchAll());
  await bg.sync();
  assert.ok(store.rules().length > 0, "precondition: armed and installed");

  await fire.command("disarm-all");

  assert.equal(store.rules().length, 0, "the emergency stop really stopped");
  assert.equal(store.badge(), "off", "and the badge says so, through the same envelope");
});

test("7quater. a command that is not disarm-all returns false, and syncs nothing", async () => {
  await seedPolicy(armedCatchAll());
  const before = store.badgeCalls();

  await fire.command("something-else");

  assert.equal(store.rules().length, 0, "no sync was triggered");
  assert.ok(store.badgeCalls() > before, "but the badge is refreshed either way");
});

test("8. a healthy install writes installed: true in BOTH the receipt and the projection", async () => {
  await seedPolicy(armedCatchAll());

  await bg.sync();

  assert.deepEqual(store.entry("installOutcome").value, { installed: true, coverageSatisfied: true });
  assert.ok(store.entry("installedProjection"), "and the detector gets its baseline");
});

test("9. the badge IGNORES the forgeable fact: a forged receipt cannot silence `off`", async () => {
  // Forging { installed: true } silences the STATUS LINE. It must touch neither the
  // badge, which counts the rules really installed, nor the banner, which reads the
  // journal. This is the behavioural half of the single-writer witness, so it cannot
  // live in structure.test.js.
  store.put("installOutcome", { rev: 99, value: { installed: true, coverageSatisfied: true } });
  assert.equal(store.rules().length, 0, "precondition: nothing is installed");

  await bg.refreshBadge();

  assert.equal(store.badge(), "off", "the badge asks the platform, never the receipt");
});

test("9bis. refreshBadge under a DNR failure never says `off`", async () => {
  // `off` is the only one of the three values that ASSERTS something. An unknown
  // count must not be reported as "nothing is installed".
  dnrFaults.rejectGet = true;

  await bg.refreshBadge();

  assert.equal(store.badge(), "!", "an unknown count is never the reassuring branch");
});

test("9ter. refreshBadge survives a dead storage AND lets sync's own error live", async () => {
  // DestinationJournal.read() used to sit OUTSIDE the try, with only setBadgeText
  // swallowed -- and a throw from inside a finally ERASES the in-flight exception
  // while never reaching setBadgeText.
  await seedPolicy(armedCatchAll());
  await bg.sync();
  store.failReads(true);

  await bg.refreshBadge();

  store.failReads(false);
  assert.notEqual(store.badge(), undefined, "setBadgeText was still reached");
  assert.notEqual(store.badge(), "off", "and an unreadable journal is NOT acknowledged");
});

// ---------------------------------------------------------------------------
// The receipt's own guards
// ---------------------------------------------------------------------------

test("a QUOTA refusal ERASES the receipt rather than leaving a stale `true` standing", async () => {
  // The remanence argument is NOT bounded by "the same area": VersionedEntry has
  // three failure modes and two break it. Under QUOTA_EXCEEDED `set` dies and READS
  // STAY ALIVE, so a stale `installed: true` reads back perfectly -- READY, empty
  // badge, no banner. That is exactly what forget() was written to close.
  await seedPolicy(armedCatchAll());
  await bg.sync();
  assert.equal(store.entry("installOutcome").value.installed, true, "precondition: a true receipt");

  // Now the quota dies while the policy becomes unreadable.
  store.put("policy", { rev: 2, value: { policy: "not a policy" } });
  store.failWrites(true);
  await bg.sync();
  store.failWrites(false);

  assert.equal(store.entry("installOutcome"), undefined,
               "absent means UNKNOWN, which is the safe direction; a stale `true` is not");
});

test("the doorbell rings TWICE on the same pair of booleans", async () => {
  // Date.now() alone is not enough: hundreds of awaited operations fit inside one
  // millisecond, so two consecutive record() calls of the same pair would write two
  // BYTE-IDENTICAL envelopes and storage.onChanged -- which only fires when the
  // bytes change -- would stay silent. This witness is the one that meets that
  // first.
  let rings = 0;
  g.InstallOutcome.onRecorded(() => { rings += 1; });

  await g.InstallOutcome.record({ installed: true, coverageSatisfied: true });
  const first = store.entry("installOutcome").rev;
  await g.InstallOutcome.record({ installed: true, coverageSatisfied: true });
  const second = store.entry("installOutcome").rev;

  assert.notEqual(first, second, "the envelope must differ from the previous entry");
  // The fake notifies on a real write, as the browser does on changed bytes.
  await fire.storageChanged({ installOutcome: {} }, "local");
  assert.ok(rings > 0, "and the listener is wired");
});

test("the doorbell FILTERS the area, or a sync writer would wake every open page", async () => {
  let rings = 0;
  g.InstallOutcome.onRecorded(() => { rings += 1; });

  await fire.storageChanged({ installOutcome: {} }, "sync");
  assert.equal(rings, 0, "storage.sync cannot ring this bell");

  await fire.storageChanged({ installOutcome: {} }, "local");
  assert.equal(rings, 1, "storage.local can");
});

test("read() reconstructs: a forged `rules` or `applied` cannot ride along", async () => {
  store.put("installOutcome", {
    rev: 1,
    value: { installed: true, coverageSatisfied: false, rules: ["FORGED"], applied: 99 },
  });

  assert.deepEqual(await g.InstallOutcome.read(), { installed: true, coverageSatisfied: false });
});

test("read() never throws, on the three shapes the store can hold", async () => {
  // VersionedEntry.read validates the ENVELOPE ONLY: on an absent entry it returns
  // { rev: 0 } with value === undefined, so a naive value.installed throws -- and
  // that is the NORMAL case, a fresh profile on first opening.
  assert.deepEqual(await g.InstallOutcome.read(), {}, "absent");
  store.put("installOutcome", { rev: 1, value: null });
  assert.deepEqual(await g.InstallOutcome.read(), {}, "a null value");
  store.put("installOutcome", { rev: 2, value: { installed: "false" } });
  assert.deepEqual(await g.InstallOutcome.read(), {}, "a non-boolean is not a fact");
  store.failReads(true);
  assert.deepEqual(await g.InstallOutcome.read(), {}, "a dead area");
  store.failReads(false);
});

test("forget() returns nothing and never throws", async () => {
  store.failReads(true);
  assert.equal(await g.InstallOutcome.forget(), undefined, "it returns NOTHING");
  store.failReads(false);
});

// ---------------------------------------------------------------------------
// The generation guard: single-writer describes a SITE, not a serialisation
// ---------------------------------------------------------------------------

test("a delayed HEALTHY sync does not overwrite a recent `false`", async () => {
  // Measured order: A (healthy) is suspended on its projection write; B learns the
  // policy is unreadable and writes `false`; A resumes, sees a newer generation, and
  // MUST NOT write its stale `true`.
  const healthy = armedCatchAll();
  await seedPolicy(healthy);
  seedProjection(healthy);

  const release = holdWrite("installedProjection");
  const first = bg.sync();
  // Let A reach the gate.
  await new Promise((r) => setImmediate(r));

  store.put("policy", { rev: 2, value: { policy: "not a policy" } });
  await bg.sync();
  assert.equal(store.entry("installOutcome").value.installed, false, "B learned NO and said so");

  release();
  await first;

  assert.equal(store.entry("installOutcome").value.installed, false,
               "the receipt is ABSOLUTE, so the last to leave is not the last to arrive");
});

test("a SUPPLANTED sync that learned `false` writes it anyway", async () => {
  // DO NOT RE-SYMMETRISE THIS GUARD. `false` is always safe to write; only `true`
  // needs ordering. Symmetric, two syncs that had both learned NO would silence
  // each other and the receipt would still say `true` -- the guard would fabricate
  // the very fail-open the batch exists to close.
  store.put("policy", { rev: 1, value: { policy: "not a policy" } });

  const release = holdRead("policy");
  const first = bg.sync();
  await new Promise((r) => setImmediate(r));

  await bg.sync();                       // B bumps the generation and writes false
  await g.InstallOutcome.forget();       // erase it, so only A's own write can show
  assert.equal(store.entry("installOutcome"), undefined, "precondition: nothing left");

  release();
  await first;

  assert.equal(store.entry("installOutcome").value.installed, false,
               "a supplanted run that learned NO is not silenced by the guard");
});

// ---------------------------------------------------------------------------
// The queue: its three bugs, and the purge that primes
// ---------------------------------------------------------------------------

test("the queue keeps the PAIR: a replayed install does not lose quarantinedCount", async () => {
  // The slot held the policy alone and the replay called install(next) with ONE
  // argument, so a re-run silently re-defaulted the count to 0 and PARTIAL_POLICY
  // could never fire.
  const policy = armedCatchAll();
  const release = holdWrite("__never");   // no-op gate: nothing writes that name
  release();

  const first = g.RuleInstaller.install(policy, 0);
  const second = g.RuleInstaller.install(policy, 7);
  const [, report] = await Promise.all([first, second]);

  assert.equal(report.diagnosis, "PARTIAL_POLICY", "the count survived the replay");
});

test("a coalesced caller gets the report of ITS OWN request, not the previous one", async () => {
  // `return pending` handed back the run ALREADY IN FLIGHT, which does not include
  // the request just made -- and a naive `return pending.then(...)` still returns
  // the old one.
  const policy = armedCatchAll();
  const firstPromise = g.RuleInstaller.install(policy, 0);
  const coalesced = g.RuleInstaller.install(policy, 3);
  const [first, second] = await Promise.all([firstPromise, coalesced]);

  assert.notEqual(first, second, "two distinct reports, not one shared object");
  assert.equal(second.diagnosis, "PARTIAL_POLICY", "the coalesced caller sees its own count");
});

test("the purge PRIMES the queue: the fail-closed gesture is never coalesced away", async () => {
  // Otherwise the gesture would be cancelled by the very queue meant to protect it.
  const policy = armedCatchAll();
  await g.RuleInstaller.install(policy, 0);
  assert.ok(store.rules().length > 0, "precondition: rules are live");

  const running = g.RuleInstaller.install(policy, 0);
  const purging = g.RuleInstaller.purge();
  await Promise.all([running, purging]);

  assert.equal(store.rules().length, 0, "the purge replaced the slot rather than queueing behind");
});

test("a failed purge stops saying `off`, because the badge ASKS", async () => {
  await seedPolicy(armedCatchAll());
  await bg.sync();
  assert.ok(store.rules().length > 0, "precondition: rules are live");

  // The purge cannot land: updateDynamicRules is ATOMIC, so the previous rules
  // STAY ALIVE. The old `lastReport = null` printed `off` over them.
  store.put("policy", { rev: 2, value: { policy: "not a policy" } });
  dnrFaults.rejectUpdate = true;
  // sync() REJECTS here, and that is deliberate: LOUD. The value-path purge throws,
  // the outer catch assigns `outcome` BEFORE retrying it -- which is the whole
  // reason for that ordering -- and the second attempt throws too. What must NOT
  // happen is a silent swallow.
  await assert.rejects(() => bg.sync(), /MAX_NUMBER_OF_UNSAFE_DYNAMIC_RULES/);
  dnrFaults.rejectUpdate = false;

  // And the receipt was still written, because the finally runs on the way out.
  assert.equal(store.entry("installOutcome").value.installed, false,
               "outcome is assigned BEFORE the purge that can throw");

  await bg.refreshBadge();
  assert.notEqual(store.badge(), "off", "the rules are still there, so `off` would be a lie");
});

// ---------------------------------------------------------------------------
// The detector that fails WITHOUT throwing
// ---------------------------------------------------------------------------

test("a detector that fails silently leaves the projection UNWRITTEN", async () => {
  // reconcile threw away DestinationJournal.record's return at both sites, so a full
  // quota meant NO ENTRY, NO EXCEPTION, projection written -- and the detection
  // window closed FOREVER.
  const before = named("ABC", "https://honest.atlassian.net");
  await seedPolicy(before);
  seedProjection(before);

  const after = before.withBaseUrlFor(
    before.shortcuts()[0].id(),
    g.JiraInstance.parse("https://evil.example.org").value
  ).value;
  await seedPolicy(after, 2);

  // The journal write refuses, quietly.
  store.failWrites(true);
  await bg.sync();
  store.failWrites(false);

  const projection = store.entry("installedProjection");
  assert.deepEqual(projection.value.policy, before.toJSON(),
                   "the baseline is KEPT, so the gap is re-diffed rather than lost");
});

// ---------------------------------------------------------------------------
// The fail-closed by THROW, which is the third path and the second fact
// ---------------------------------------------------------------------------

test("a load that REJECTS also purges, writes `false`, and sets the badge", async () => {
  // "I learned nothing", "I learned no by value" and "I learned no by throw" are
  // THREE PATHS AND TWO FACTS. PolicyRepository.load() awaits Platform.storageArea()
  // outside any try, so it can reject rather than merely refuse.
  await seedPolicy(armedCatchAll());
  await bg.sync();
  assert.ok(store.rules().length > 0, "precondition: rules are live");

  store.failReads(true);
  await bg.sync();          // load() REJECTS: the outer catch owns this path
  store.failReads(false);

  assert.equal(store.rules().length, 0, "the rules are emptied");
  assert.deepEqual(store.entry("installOutcome").value, { installed: false, coverageSatisfied: false });

  await bg.refreshBadge();
  assert.equal(store.badge(), "off", "and `off` is the truth again");
});

// ---------------------------------------------------------------------------
// Nothing lets itself be overwritten, AT EITHER END
// ---------------------------------------------------------------------------

test("report() cannot be overwritten on the way OUT", async () => {
  await seedPolicy(armedCatchAll());
  await bg.sync();
  const real = store.rules().length;
  assert.ok(real > 0, "precondition: real rules exist");

  const report = await g.RuleInstaller.report(
    armedCatchAll(), [], 0,
    { installed: true, rules: ["FORGED RULE"], applied: 99 },
    "PAGE");

  assert.equal(report.applied, real, "the REAL count, not the forged one");
  assert.notDeepEqual(report.rules, ["FORGED RULE"], "and the REAL rules, which the preview PAINTS");
  assert.equal(report.source, "PAGE", "the discriminant is always present");
});

test("report() cannot be overwritten on the way IN, and the POLARITY is what counts", async () => {
  // An attacker does not forge rulesInstalled: true, which makes the diagnosis MORE
  // alarming; he forges FALSE, to extinguish the only non-forgeable term. So: an
  // EMPTY registry, quarantine 0, three rules really installed, `installed` ABSENT.
  // Named fields => INSTALL_STATE_UNKNOWN. A spread => NO_SHORTCUTS, the fail-open.
  await seedPolicy(armedCatchAll());
  await bg.sync();
  assert.ok(store.rules().length > 0, "precondition: rules are really installed");

  const report = await g.RuleInstaller.report(
    g.JumpPolicy.empty(), [], 0, { rulesInstalled: false }, "PAGE");

  assert.equal(report.diagnosis, "INSTALL_STATE_UNKNOWN", "never NO_SHORTCUTS");
});

test("the TWO call sites pass `source`, and a third one would go red", async () => {
  // "PURGE" is UNREACHABLE: purge() produces no report at all. What the field buys
  // is a CHANGELOCK -- no caller can reach the projection guard with another source.
  await seedPolicy(armedCatchAll());
  const report = await g.RuleInstaller.install(armedCatchAll(), 0);
  assert.equal(report.source, "INSTALL");

  const page = await g.RuleInstaller.report(armedCatchAll(), [], 0, {}, "PAGE");
  assert.equal(page.source, "PAGE");

  // And with no source at all the guard cannot be reached: `undefined` is exactly
  // the meaningful absence the discriminant exists to abolish, and it fails CLOSED.
  const nameless = await g.RuleInstaller.report(armedCatchAll(), [], 0, { installed: true });
  assert.equal(nameless.source, undefined);
  assert.notEqual(nameless.source, "INSTALL", "a forgotten source never governs the projection");
});

// ---------------------------------------------------------------------------
// The presentation: the CONSTRUCTION throws, the ACCESSES never do
// ---------------------------------------------------------------------------

test("the presentation is TOTAL over the catalogue, and its accesses never throw", async () => {
  // The reference is JumpPolicy.DIAGNOSES -- exported and, until this batch, with no
  // reader at all. NOT the tables against each other, which would be tautological.
  // Two measured traps: PARTIAL_POLICY appears TWICE and READY is ABSENT.
  for (const code of [...g.JumpPolicy.DIAGNOSES, "READY"]) {
    assert.equal(typeof g.DiagnosisPresentation.sentence(code), "string", code);
    assert.equal(typeof g.DiagnosisPresentation.label(code), "string", code);
    assert.ok(["ok", "warn", "off", "bad"].includes(g.DiagnosisPresentation.tone(code)), code);
  }

  // An UNKNOWN code: the raw code back, and the MOST alarming tone. `|| "off"` used
  // to apply the LEAST alarming tone to the code saying "I do not know whether jumps
  // are departing".
  assert.equal(g.DiagnosisPresentation.sentence("NOPE"), "NOPE");
  assert.equal(g.DiagnosisPresentation.label("NOPE"), "NOPE");
  assert.equal(g.DiagnosisPresentation.tone("NOPE"), g.DiagnosisPresentation.WORST);
  assert.equal(g.DiagnosisPresentation.WORST, "bad");

  // THE SCALE, which the same gesture had to correct or it would have INVERTED it:
  // "I do not know" must not shout louder than "the installation failed".
  assert.equal(g.DiagnosisPresentation.tone("INSTALL_FAILED"), "bad");
  assert.equal(g.DiagnosisPresentation.tone("INSTALL_STATE_UNKNOWN"), "bad");
  assert.equal(g.DiagnosisPresentation.tone("READY"), "ok");
});
