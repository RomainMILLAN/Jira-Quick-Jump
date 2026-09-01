import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCore } from "./load-core.js";

const g = await loadCore();

/**
 * The journal talks to storage, so it needs the smallest possible stand-in. Not a
 * mock of the platform: a Map behind the two calls VersionedEntry actually makes.
 */
const fakeArea = () => {
  const store = new Map();
  return {
    async get(name) {
      return store.has(name) ? { [name]: store.get(name) } : {};
    },
    async set(entry) {
      for (const [k, v] of Object.entries(entry)) store.set(k, v);
    },
    async remove(name) {
      store.delete(name);
    },
    _raw: store,
  };
};

const withJournal = async (body) => {
  const area = fakeArea();
  const platform = g.Platform;
  const previous = platform.api;
  platform.api = { storage: { local: area } };
  try {
    await body(area);
  } finally {
    platform.api = previous;
  }
};

test("an entry written by an earlier build is read as a destination change", async () => {
  // There was only one kind of fact then, so those entries carry no `type`. The
  // banner reads its fields flat, and without stamping it would render undefined
  // after an update -- on the one surface whose whole job is to be believed. And
  // the journal cannot simply be cleared: it IS the evidence.
  await withJournal(async (area) => {
    await area.set({
      destinationJournal: {
        rev: 3,
        value: {
          entries: [{ shortcutId: "x", key: "ABC", oldBaseUrl: "https://a.example.org", newBaseUrl: "https://b.example.org", when: 1, source: "MANUAL" }],
          acknowledged: false,
          lastLoggedRev: 3,
        },
      },
    });
    const journal = await g.DestinationJournal.read();
    assert.equal(journal.entries[0].type, "DestinationChanged");
    assert.equal(journal.entries[0].key, "ABC");
  });
});

test("the cap protects the evidence: overflowing says so, and it sticks", async () => {
  // A log whose overflow is triggerable is a log an attacker empties on command.
  // Twenty entries is a documented public cap, so a burst must leave a trace of
  // what it pushed out rather than pretending nothing was lost.
  await withJournal(async () => {
    for (let i = 0; i < g.DestinationJournal.MAX_ENTRIES; i += 1) {
      await g.DestinationJournal.record(
        [{ type: "DestinationChanged", shortcutId: `id-${i}`, key: "K" + i, oldBaseUrl: "https://a.example.org", newBaseUrl: "https://b.example.org" }],
        i + 1, "UNKNOWN", Date.now()
      );
    }
    let journal = await g.DestinationJournal.read();
    assert.equal(journal.entries.length, g.DestinationJournal.MAX_ENTRIES);
    assert.equal(journal.overflowed, false);

    await g.DestinationJournal.record(
      [{ type: "CatchAllAppeared", shortcutId: "star", baseUrl: "https://evil.example.org" }],
      99, "UNKNOWN", Date.now()
    );
    journal = await g.DestinationJournal.read();
    assert.equal(journal.entries.length, g.DestinationJournal.MAX_ENTRIES, "the cap holds");
    assert.equal(journal.entries[0].type, "CatchAllAppeared", "the newest fact is kept");
    assert.equal(journal.overflowed, true, "and the loss is recorded");

    // Sticky: acknowledging the banner does not bring the missing evidence back.
    await g.DestinationJournal.acknowledgeAll();
    journal = await g.DestinationJournal.read();
    assert.equal(journal.acknowledged, true);
    assert.equal(journal.overflowed, true);
  });
});

test("recording nothing still advances the logged revision, so a diff is not replayed", async () => {
  await withJournal(async () => {
    await g.DestinationJournal.record([], 7, "MANUAL", Date.now());
    assert.equal(await g.DestinationJournal.lastLoggedRev(), 7);
    const journal = await g.DestinationJournal.read();
    assert.equal(journal.entries.length, 0);
    assert.equal(journal.acknowledged, true, "no fact means no banner");
  });
});

test("a key-scoped acknowledgement is written and read back, and an orphan row is pruned", async () => {
  await withJournal(async () => {
    const instance = g.JiraInstance.parse("https://catchall.atlassian.net").value;
    let policy = g.JumpPolicy.empty().withEngines(["google.com"]).value;
    policy = policy.registerCatchAll("star", instance).value;
    policy = policy.acknowledge("star", "CATCH_ALL").value;

    await g.KeyAcknowledgements.record(policy);
    const rows = await g.KeyAcknowledgements.read();
    const shortcut = policy.shortcuts()[0];
    assert.deepEqual(rows[g.KeyAcknowledgements.rowKey(shortcut)], ["CATCH_ALL"]);

    // The row is bound to id + destination + nature, so pointing the catch-all
    // elsewhere does NOT inherit the consent -- otherwise a compromised sync
    // account would reuse the id and inherit it.
    const moved = policy.withBaseUrlFor("star", g.JiraInstance.parse("https://evil.example.org").value).value;
    assert.equal(rows[g.KeyAcknowledgements.rowKey(moved.shortcuts()[0])], undefined);

    // And removing the shortcut prunes its row: only live triples are written back.
    await g.KeyAcknowledgements.record(policy.remove("star").value);
    assert.deepEqual(await g.KeyAcknowledgements.read(), {});
  });
});

test("an absent or corrupt acknowledgement store means NOT acknowledged", async () => {
  await withJournal(async (area) => {
    assert.deepEqual(await g.KeyAcknowledgements.read(), {}, "absent");
    await area.set({ keyAcknowledgements: { rev: 1, value: "not an object" } });
    assert.deepEqual(await g.KeyAcknowledgements.read(), {}, "corrupt");
    await area.set({ keyAcknowledgements: { rev: 2, value: { "x y named": ["INSECURE_SCHEME"] } } });
    assert.deepEqual(await g.KeyAcknowledgements.read(), { "x y named": [] }, "a destination kind cannot sneak in");
  });
});

/**
 * The smallest declarativeNetRequest stand-in: the three calls the installer
 * makes, plus a switch to make updateDynamicRules reject.
 */
const fakeDnr = ({ rejectUpdate = false, refuseCapturing = false, stripPriority = false } = {}) => {
  let installed = [];
  const asked = [];
  return {
    asked,
    // refuseCapturing models the real RE2 behaviour the bare call hid: capturing
    // and case-insensitivity both cost memory, so an expression can be supported
    // as asked about and refused as installed.
    async isRegexSupported(options) {
      asked.push(options);
      if (refuseCapturing && options.requireCapturing) return { isSupported: false };
      return { isSupported: true };
    },
    // stripPriority MODELS THE FOREIGN SYSTEM. Every other option keeps readback ==
    // write, so the "rules come from a foreign system" that jump-preview.js declares in
    // its header was modelled NOWHERE -- while this batch makes the preview depend on
    // what the platform HANDS BACK. A shipped v1.0.0 rule, or any store written by an
    // earlier version, is exactly a readback out of step with what we last wrote.
    async getDynamicRules() {
      if (!stripPriority) return installed;
      return installed.map(({ priority, ...rule }) => rule);
    },
    async updateDynamicRules({ addRules }) {
      if (rejectUpdate) throw new Error("MAX_NUMBER_OF_UNSAFE_DYNAMIC_RULES");
      installed = addRules;
    },
  };
};

const withPlatform = async (dnr, body) => {
  const platform = g.Platform;
  const previousApi = platform.api;
  const previousGranted = platform.grantedOrigins;
  platform.api = { declarativeNetRequest: dnr, storage: { local: fakeArea() } };
  platform.grantedOrigins = async () => true;
  try {
    await body();
  } finally {
    platform.api = previousApi;
    platform.grantedOrigins = previousGranted;
  }
};

const armedCatchAll = () => {
  let p = g.JumpPolicy.empty().withEngines(["google.com"]).value;
  p = p.registerCatchAll("star", g.JiraInstance.parse("https://catchall.atlassian.net").value).value;
  p = p.acknowledge("star", "CATCH_ALL").value;
  return p.armShortcut("star").value;
};

test("a rejected install is reported, so the kill switch cannot claim to have stopped", async () => {
  // updateDynamicRules is ATOMIC: on a rejection nothing changes and THE PREVIOUS
  // RULES STAY ALIVE. Unwrapped, the promise surfaced in a listener where nobody
  // caught it, and report() was never reached -- so disarm-all could print "off"
  // over a catch-all still claiming every search.
  await withPlatform(fakeDnr({ rejectUpdate: true }), async () => {
    const report = await g.RuleInstaller.install(armedCatchAll(), 0);
    assert.equal(report.diagnosis, "INSTALL_FAILED");
    // And it outranks everything, including a policy that believes it is armed.
    assert.equal(report.applied, 0, "the badge derives from this, not from policy.armed()");
  });
});

test("a store that hands back rules without a priority still reads as the catch-all", async () => {
  // THE ONLY WITNESS OF THE NORMALISATION. armedCatchAll() on purpose: ONE redirect
  // rule. Add a named shortcut and the answer becomes NON_DETERMINISTIC, because
  // normalising flattens every band to 1 and two redirects to different destinations
  // then tie -- someone taking the other fixture would conclude the normalisation is
  // broken and weaken the assertion.
  await withPlatform(fakeDnr({ stripPriority: true }), async () => {
    const report = await g.RuleInstaller.install(armedCatchAll(), 0);
    const seen = g.JumpPreview.forSearchUrl(
      "https://www.google.com/search?q=BAN-123", report.rules);
    assert.equal(seen.code, "MATCHED_CATCH_ALL", "absent priority => DNR default => catch-all band");
    // The MOST alarming label, never the least: a preview that cannot read the
    // installed programme must not answer "this search goes through untouched".
    assert.ok(seen.destination.endsWith("/browse/BAN-123"));
  });
});

test("a successful install reports the rules as delivered, for the preview to simulate", async () => {
  await withPlatform(fakeDnr(), async () => {
    const report = await g.RuleInstaller.install(armedCatchAll(), 0);
    // THE EXACT CODE, not "not INSTALL_FAILED". A notEqual excluding ONE code out of a
    // twelve-entry catalogue proves nothing about the one you get -- and it is the only
    // automatic witness that the options page still says READY. Expected to redden the
    // day report() is split into two named doors: that is not a regression.
    assert.equal(report.diagnosis, "READY");
    assert.ok(report.rules.length >= 2, "the catch-all and its reserved prefixes");
    // The labels RuleSet needs never reach the platform.
    for (const rule of report.rules) {
      assert.equal("engineId" in rule, false);
      assert.equal("isCatchAll" in rule, false);
      // THE THIRD LABEL, added in the same batch as the field itself. The nominative
      // deny-list this guarded is gone -- platformRules() is now the sole counter and
      // derives from the DNR spec -- but the assertion stays: it pins the OUTCOME, that
      // no label reaches the platform, independently of how the stripping is written.
      // An unknown property hands
      // updateDynamicRules, which rejects THE WHOLE BATCH -- and this assertion
      // would have stayed green while it happened.
      assert.equal("guardedPrefixes" in rule, false);
    }
  });
});

test("the regex check asks about the rule as it will be installed, not a laxer one", async () => {
  // Both options default to the OPPOSITE of what every rule here does:
  // isCaseSensitive to true where the conditions are case-insensitive,
  // requireCapturing to false where every redirect carries a regexSubstitution.
  // Left out, the call vouched for an expression we never install -- and it fails
  // OPEN, so the rule reached updateDynamicRules, which rejects the WHOLE batch
  // and takes every other shortcut with it.
  const dnr = fakeDnr();
  await withPlatform(dnr, async () => {
    await g.RuleInstaller.install(armedCatchAll(), 0);
  });
  assert.ok(dnr.asked.length >= 2, "the catch-all and its reserved-prefix guard");
  for (const options of dnr.asked) {
    assert.equal(options.isCaseSensitive, false, "mirrors isUrlFilterCaseSensitive");
    assert.equal("requireCapturing" in options, true);
  }
  // Derived from the rule, never restated: a guard is an `allow` with no
  // substitution, so it must NOT be asked for capturing -- otherwise a rule that
  // needs no capture group is refused for lacking one.
  //
  // COUNTED, not spelled out: the guard ships as several runs since Chrome refused
  // 49 alternatives in one rule, so a literal pair would have to be edited every
  // time the cut changes.
  const asked = dnr.asked.map((o) => o.requireCapturing);
  assert.equal(asked.filter((x) => x === true).length, 1, "one redirect, asked WITH capturing");
  assert.ok(asked.filter((x) => x === false).length >= 1, "every allow asked WITHOUT it");
});

test("a regex refused only once capturing is required skips its unit, not the batch", async () => {
  // The failure mode the bare call could not see. The catch-all and its guard are
  // one indivisible unit, so both go -- and the named shortcuts must survive.
  await withPlatform(fakeDnr({ refuseCapturing: true }), async () => {
    let p = armedCatchAll();
    p = p.registerAboveCatchAll(
      "named", g.ProjectKey.parse("JUL").value, g.JiraInstance.parse("https://spiriit.atlassian.net").value
    ).value;
    p = p.armShortcut("named").value;
    const report = await g.RuleInstaller.install(p, 0);
    // THE SECOND WITNESS, and it is not a nicety: it is the only one that requires the
    // coverage fact to be FALSE, hence the only one proving the fact TRAVELS instead of
    // being a default. Rename the writers without the reader (or the reverse) and the
    // READY witness above stays green while this one bites.
    assert.equal(report.diagnosis, "CATCH_ALL_NOT_INSTALLED", "the batch survives, uncovered");
    assert.equal(report.rules.length, 0, "every redirect needs capturing, so all are skipped");
    assert.ok(report.skipped.length > 0, "and the skip is REPORTED rather than silent");
  });
});
