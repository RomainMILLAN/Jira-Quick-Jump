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
      await g.DestinationJournal.recordUnclaimed(
        [{ type: "DestinationChanged", shortcutId: `id-${i}`, key: "K" + i, oldBaseUrl: "https://a.example.org", newBaseUrl: "https://b.example.org" }],
        `fp-${i}`, Date.now()
      );
    }
    let journal = await g.DestinationJournal.read();
    assert.equal(journal.entries.length, g.DestinationJournal.MAX_ENTRIES);
    assert.equal(journal.overflowed, false);

    await g.DestinationJournal.recordUnclaimed(
      [{ type: "CatchAllAppeared", shortcutId: "star", baseUrl: "https://evil.example.org" }],
      "fp-w99-99", Date.now()
    );
    journal = await g.DestinationJournal.read();
    assert.equal(journal.entries.length, g.DestinationJournal.MAX_ENTRIES, "the cap holds");
    // THE OLDEST EVIDENCE IS THE ONE KEPT, and this is the inversion that
    // matters. Keeping the newest let twenty-one hostile writes erase the line
    // that DATES the intrusion -- the whole reason the journal exists. The
    // invariant is not "keep twenty", it is "never lose the first unclaimed
    // fact"; the ones after it are that fact's noise.
    assert.equal(journal.entries[journal.entries.length - 1].key, "K0",
      "the first unclaimed fact survives a flood of later ones");
    assert.equal(journal.overflowed, true, "and the loss is recorded");

    // Sticky: acknowledging the banner does not bring the missing evidence back.
    await g.DestinationJournal.acknowledgeAll();
    journal = await g.DestinationJournal.read();
    assert.equal(journal.acknowledged, true);
    assert.equal(journal.overflowed, true);
  });
});

test("a claim is recorded even when the commit changed nothing worth a fact", async () => {
  // The door claims every commit, facts or not: a commit that produced no fact
  // still has to be claimable, or the window would report it as unclaimed.
  await withJournal(async () => {
    await g.DestinationJournal.recordClaimed([], "fp-door-7", Date.now());
    const journal = await g.DestinationJournal.read();
    assert.equal(journal.entries.length, 0);
    assert.equal(journal.acknowledged, true, "no fact means no banner");
    assert.ok(journal.claims.includes("fp-door-7"), "the content is on the ring");
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
    assert.deepEqual(rows.kindsFor(policy.shortcuts()[0]), ["CATCH_ALL"]);

    // The row is bound to id + destination + nature, so pointing the catch-all
    // elsewhere does NOT inherit the consent -- otherwise a compromised sync
    // account would reuse the id and inherit it.
    const moved = policy.withBaseUrlFor("star", g.JiraInstance.parse("https://evil.example.org").value).value;
    assert.deepEqual(rows.kindsFor(moved.shortcuts()[0]), [], "consent does not follow a moved destination");

    // And removing the shortcut lapses its row: an attestation whose triple no
    // longer exists has no object any more.
    await g.KeyAcknowledgements.record(policy.remove("star").value);
    assert.equal(Object.keys((await g.KeyAcknowledgements.read()).toJSON()).length, 0);
  });
});

test("an absent or corrupt acknowledgement store means NOT acknowledged", async () => {
  await withJournal(async (area) => {
    assert.equal(Object.keys((await g.KeyAcknowledgements.read()).toJSON()).length, 0, "absent");
    await area.set({ keyAcknowledgements: { rev: 1, value: "not an object" } });
    assert.equal(Object.keys((await g.KeyAcknowledgements.read()).toJSON()).length, 0, "corrupt");
    await area.set({ keyAcknowledgements: { rev: 2, value: { [JSON.stringify(["x", "y", "named"])]: ["INSECURE_SCHEME"] } } });
    assert.equal(
      Object.keys((await g.KeyAcknowledgements.read()).toJSON()).length,
      0,
      "a destination-scoped kind cannot sneak in, and a row left empty is no row"
    );
  });
});

test("a commit never forgets an attestation it was not told about", async () => {
  // THE LOST CLICK. record() rebuilt the whole table from its own policy and
  // overwrote: one tab acknowledged the catch-all while another committed an
  // unrelated edit, and the click was gone -- the user is asked to accept the
  // warning a second time, which is how a security control teaches people to
  // click through it.
  await withJournal(async () => {
    const here = g.JiraInstance.parse("https://catchall.atlassian.net").value;
    const there = g.JiraInstance.parse("https://other.atlassian.net").value;

    let mine = g.JumpPolicy.empty().withEngines(["google.com"]).value;
    mine = mine.registerCatchAll("star", here).value;
    mine = mine.register("named", g.ProjectKey.parse("ABC").value, there).value;

    // The other surface attests, and commits first.
    const theirs = mine.acknowledge("star", "CATCH_ALL").value;
    await g.KeyAcknowledgements.record(theirs);

    // We commit an unrelated edit from a policy that never saw that click.
    await g.KeyAcknowledgements.record(mine);

    const rows = await g.KeyAcknowledgements.read();
    assert.deepEqual(
      rows.kindsFor(mine.shortcuts()[0]),
      ["CATCH_ALL"],
      "the other tab's attestation must survive our commit"
    );
  });
});

test("the bound refuses to admit rather than un-acknowledging afterwards", async () => {
  // Evicting after the fact would silently disarm a live catch-all while keeping
  // ancient orphans. Refusing at the reading door is the honest direction, and it
  // is the only place a hostile size actually arrives.
  await withJournal(async (area) => {
    const inflated = {};
    for (let i = 0; i < g.KeyAcknowledgements.MAX_ENTRIES + 50; i += 1) {
      inflated[JSON.stringify([`id${i}`, "https://x.example.org", "named"])] = ["CATCH_ALL"];
    }
    await area.set({ keyAcknowledgements: { rev: 1, value: inflated } });
    const rows = await g.KeyAcknowledgements.read();
    assert.equal(Object.keys(rows.toJSON()).length, g.KeyAcknowledgements.MAX_ENTRIES, "the excess never enters");
  });
});

/**
 * The smallest declarativeNetRequest stand-in: the three calls the installer
 * makes, plus a switch to make updateDynamicRules reject.
 */
const fakeDnr = ({ rejectUpdate = false, refuseCapturing = false, stripPriority = false } = {}) => {
  let installed = [];
  const asked = [];
  // A brake, so a drain can be caught IN FLIGHT: it is the only state in which
  // two requests land in the single slot and one of them can displace the other.
  let brake = null;
  return {
    asked,
    rules: () => installed,
    hold() {
      let release;
      brake = new Promise((r) => { release = r; });
      return release;
    },
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
      if (brake) await brake;
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
    // fourteen-entry catalogue proves nothing about the one you get -- and it is the only
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

test("a symmetric interleave is DETECTED, where the revision alone said yes twice", async () => {
  // The lost update this pins, measured on the old check `after.rev === rev + 1`:
  //   A reads 5 | B reads 5 | A writes 6 | B writes 6 over it
  //   B re-reads 6 == 5+1 -> ok      A re-reads 6 == 6 -> ok TOO
  // Both callers were told they had written. One write was gone.
  const area = fakeArea();
  await area.set({ e: { rev: 5, writer: "someone-else", value: { who: "base" } } });

  let interleaved = false;
  const racing = {
    get: area.get,
    async set(entry) {
      // Exactly once, between our write and our re-read, someone else lands on
      // the same revision -- which is what a second tab or the worker does.
      await area.set(entry);
      if (!interleaved) {
        interleaved = true;
        await area.set({ e: { rev: 6, writer: "the-other-tab", value: { who: "them" } } });
      }
    },
  };

  const result = await g.VersionedEntry.update(racing, "e", (value) => ({
    ok: true,
    value: { who: "us", saw: value?.who },
    events: [],
  }));

  assert.equal(result.ok, true, "the loser must RETRY, not report a success it did not get");
  const final = await g.VersionedEntry.read(area, "e");
  assert.equal(final.value.who, "us", "the retry lands");
  assert.equal(final.value.saw, "them", "and it replayed on the WINNER's value, not the stale one");
});

test("three losses in a row exhaust the attempts instead of lying", async () => {
  // CONFLICT_EXHAUSTED had no witness at all: the fakes were single-threaded
  // Maps, so `after.rev === current.rev + 1` was always true and this branch was
  // unreachable. It is the branch the whole "intentions are absolute" argument
  // rests on.
  const area = fakeArea();
  const alwaysLoses = {
    get: area.get,
    async set(entry) {
      await area.set(entry);
      const name = Object.keys(entry)[0];
      const mine = entry[name];
      await area.set({ [name]: { rev: mine.rev, writer: "always-someone-else", value: mine.value } });
    },
  };
  const result = await g.VersionedEntry.update(alwaysLoses, "e", () => ({ ok: true, value: 1, events: [] }));
  assert.equal(result.ok, false);
  assert.equal(result.code, "CONFLICT_EXHAUSTED");
});

test("a full table of lapsed rows never costs the user the click they just made", async () => {
  // MEASURED regression, caught in review: composing merged() BEFORE
  // forgetLapsed() measured the bound against a table still full of rows that
  // had no object any more. A local writer inflates the entry to MAX_ENTRIES and
  // every NEW attestation is refused -- in silence. The user clicks "I
  // understand" on the catch-all warning and it never arms.
  await withJournal(async (area) => {
    const lapsed = {};
    for (let i = 0; i < g.KeyAcknowledgements.MAX_ENTRIES; i += 1) {
      lapsed[JSON.stringify([`ghost${i}`, "https://gone.example.org", "catch-all"])] = ["CATCH_ALL"];
    }
    await area.set({ keyAcknowledgements: { rev: 1, value: lapsed } });

    let policy = g.JumpPolicy.empty().withEngines(["google.com"]).value;
    policy = policy.registerCatchAll("star", g.JiraInstance.parse("https://catchall.atlassian.net").value).value;
    policy = policy.acknowledge("star", "CATCH_ALL").value;

    await g.KeyAcknowledgements.record(policy);

    const rows = await g.KeyAcknowledgements.read();
    assert.deepEqual(
      rows.kindsFor(policy.shortcuts()[0]),
      ["CATCH_ALL"],
      "pruning what has no object must make room for what the user just attested"
    );
  });
});

test("the attestations cannot be mutated through what they hand out", async () => {
  await withJournal(async () => {
    let policy = g.JumpPolicy.empty().withEngines(["google.com"]).value;
    policy = policy.registerCatchAll("star", g.JiraInstance.parse("https://catchall.atlassian.net").value).value;
    policy = policy.acknowledge("star", "CATCH_ALL").value;
    await g.KeyAcknowledgements.record(policy);

    const rows = await g.KeyAcknowledgements.read();
    rows.kindsFor(policy.shortcuts()[0]).push("INJECTED");
    assert.deepEqual(rows.kindsFor(policy.shortcuts()[0]), ["CATCH_ALL"], "the value lends nothing it owns");
  });
});

test("a queued purge is never displaced by a later install", async () => {
  // The header always claimed "THE PURGE PRIMES"; the code did not do it.
  // sync() fails -> purge() fills the slot -> storage.onChanged fires another
  // sync() -> install() overwrote it, and the fail-closed gesture was cancelled
  // by the very queue meant to carry it. Both halves are reachable in one turn.
  const dnr = fakeDnr();
  await withPlatform(dnr, async () => {
    let policy = g.JumpPolicy.empty().withEngines(["google.com"]).value;
    policy = policy.register("one", g.ProjectKey.parse("ABC").value,
      g.JiraInstance.parse("https://a.atlassian.net").value).value;
    policy = policy.armShortcut("one").value;

    await g.RuleInstaller.install(policy);
    assert.ok(dnr.rules().length > 0, "something is installed to begin with");

    // A drain is in flight; the purge lands in the slot, then a stale install.
    const release = dnr.hold();
    const inFlight = g.RuleInstaller.install(policy);
    const purged = g.RuleInstaller.purge();
    const stale = g.RuleInstaller.install(policy);
    release();
    await Promise.allSettled([inFlight, purged, stale]);

    assert.equal(dnr.rules().length, 0, "the purge must survive a later install");
  });
});


test("an attributed change is recorded WITHOUT raising the banner", async () => {
  // The act is not the alarm. The user has just moved a destination themselves;
  // telling them a destination moved is noise, and a detector that cries on
  // ordinary use is one people switch off.
  await withJournal(async () => {
    await g.DestinationJournal.recordClaimed(
      [{ type: "DestinationChanged", shortcutId: "a", key: "ABC", oldBaseUrl: "https://a.example.org", newBaseUrl: "https://b.example.org" }],
      "fp-door-4", Date.now()
    );
    const journal = await g.DestinationJournal.read();
    assert.equal(journal.entries.length, 1, "the record is still kept");
    assert.equal(journal.acknowledged, true, "but no banner: somebody claimed this change");
    assert.ok(journal.claims.includes("fp-door-4"), "and the claim is on file");
  });
});

test("the window stays quiet about a commit the door already claimed", async () => {
  // THE DUPLICATE THIS CLOSES: every ordinary edit produced a MANUAL line from
  // the page and, via storage.onChanged -> sync() -> reconcile(), a second line
  // labelled UNKNOWN on the same diff -- the code reserved for compromise. The
  // banner cried on each rename the user typed.
  await withJournal(async () => {
    const fact = { type: "DestinationChanged", shortcutId: "a", key: "ABC", oldBaseUrl: "https://a.example.org", newBaseUrl: "https://b.example.org" };
    const attribution = "fp-door-9";
    await g.DestinationJournal.recordClaimed([fact], attribution, Date.now());
    await g.DestinationJournal.recordUnclaimed([fact], attribution, Date.now());

    const journal = await g.DestinationJournal.read();
    assert.equal(journal.entries.length, 1, "the same change is not journalled twice");
    assert.equal(journal.acknowledged, true, "and the act never became an alarm");
  });
});

test("a change beyond the waterline IS a divergence, and it raises the banner", async () => {
  // The quiet must not become deafness: a write nobody claimed still gets through.
  await withJournal(async () => {
    await g.DestinationJournal.recordClaimed([], "fp-door-5", Date.now());
    await g.DestinationJournal.recordUnclaimed(
      [{ type: "CatchAllAppeared", shortcutId: "star", baseUrl: "https://evil.example.org" }],
      "fp-someone-else-6", Date.now()
    );
    const journal = await g.DestinationJournal.read();
    assert.equal(journal.entries.length, 1);
    assert.equal(journal.acknowledged, false, "an unclaimed change must be seen");
  });
});

test("eviction sacrifices acts before evidence", async () => {
  // The old cap kept the NEWEST twenty, so it ate the oldest -- exactly where the
  // UNKNOWN left by an earlier compromise sits. The comment promised the opposite
  // and the branch meant to do it was dead code: two identical `else` arms testing
  // a field entries never carry.
  await withJournal(async () => {
    await g.DestinationJournal.recordUnclaimed(
      [{ type: "CatchAllAppeared", shortcutId: "the-evidence", baseUrl: "https://evil.example.org" }],
      "fp-intruder-1", Date.now()
    );
    // The attacker now floods with ordinary-looking attributed changes.
    for (let i = 0; i < g.DestinationJournal.MAX_ENTRIES + 5; i += 1) {
      await g.DestinationJournal.recordClaimed(
        [{ type: "DestinationChanged", shortcutId: `noise-${i}`, key: "N", oldBaseUrl: "https://a.example.org", newBaseUrl: "https://b.example.org" }],
        "fp-door-i + 2", Date.now()
      );
    }
    const journal = await g.DestinationJournal.read();
    assert.equal(journal.entries.length, g.DestinationJournal.MAX_ENTRIES, "the cap holds");
    assert.ok(
      journal.entries.some((e) => e.shortcutId === "the-evidence"),
      "the evidence survives the noise of the attack that buries it"
    );
    assert.equal(journal.overflowed, true, "and the loss is said");
  });
});

test("a forged claim cannot silence the detector", async () => {
  // The first version compared `lastLoggedRev >= rev`, and `rev` is a field of
  // the storage envelope -- a number the hostile writer chooses. Writing
  // {rev: 1, value: <trap>} after an ordinary commit at 10 put the trap under the
  // waterline and the detector went quiet: a false positive on every edit traded
  // for a false negative on demand.
  await withJournal(async (area) => {
    await area.set({
      destinationJournal: {
        rev: 1,
        value: { entries: [], acknowledged: true, claim: "fp-forged-1e15", overflowed: false },
      },
    });
    await g.DestinationJournal.recordUnclaimed(
      [{ type: "CatchAllAppeared", shortcutId: "star", baseUrl: "https://evil.example.org" }],
      "fp-a-content-nobody-claimed",
      Date.now()
    );
    const journal = await g.DestinationJournal.read();
    assert.equal(journal.entries.length, 1, "a claim we did not write covers nothing");
    assert.equal(journal.acknowledged, false, "and the banner rises");
  });
});

test("a fact no commit could claim is always written", async () => {
  // MEASURED regression from the previous round: this went through the unclaimed
  // door with `rev: 0`, and `0 >= 0` silenced it on a fresh journal -- so the path
  // the trust model calls the one a compromised sync reaches most easily was
  // mute, under a comment claiming it could not be.
  await withJournal(async () => {
    const written = await g.DestinationJournal.recordUnclaimable(
      [{ type: "PolicyUnreadable", code: "SCHEMA_TOO_NEW" }],
      Date.now()
    );
    assert.equal(written.ok, true);
    const journal = await g.DestinationJournal.read();
    assert.equal(journal.entries.length, 1, "an unreadable policy is never silent");
    assert.equal(journal.acknowledged, false, "and it raises the banner");
  });
});

test("an entry inherited from a build before the split is treated as evidence everywhere", async () => {
  // The species was decided in read() and NOT in the mutation path, so the two
  // disagreed: read charitably called it evidence, eviction called it an act and
  // threw it out FIRST. The very UNKNOWN a past compromise left behind was the
  // first thing sacrificed.
  await withJournal(async (area) => {
    await area.set({
      destinationJournal: {
        rev: 1,
        value: {
          entries: [{ type: "DestinationChanged", key: "OLD", oldBaseUrl: "https://a.example.org", newBaseUrl: "https://b.example.org" }],
          acknowledged: false,
        },
      },
    });
    for (let i = 0; i < g.DestinationJournal.MAX_ENTRIES + 5; i += 1) {
      await g.DestinationJournal.recordClaimed(
        [{ type: "DestinationChanged", shortcutId: `n${i}`, key: "N", oldBaseUrl: "https://a.example.org", newBaseUrl: "https://b.example.org" }],
        "fp-door-i + 1", Date.now()
      );
    }
    const journal = await g.DestinationJournal.read();
    assert.ok(journal.entries.some((e) => e.key === "OLD"), "inherited evidence is not the first sacrificed");
  });
});

test("a corrupt entry is dropped, never promoted to evidence", async () => {
  // Turning a corrupt byte into a synthetic UNKNOWN made noise INEVICTABLE --
  // evidence is kept longest -- so twenty junk values became a permanent
  // saturation weapon, and each rendered an empty sentence in the banner.
  await withJournal(async (area) => {
    await area.set({
      destinationJournal: { rev: 1, value: { entries: [null, "junk", 42, { type: "PolicyReplaced", changedCount: 1 }], acknowledged: false } },
    });
    const journal = await g.DestinationJournal.read();
    assert.equal(journal.entries.length, 1, "only the real entry survives the read");
    assert.equal(journal.entries[0].type, "PolicyReplaced");
  });
});

test("a null entry cannot brick the journal", async () => {
  // MEASURED: eviction read `e.source` with no guard, so any write threw --
  // indefinitely. A one-byte kill switch for the detector.
  await withJournal(async (area) => {
    await area.set({ destinationJournal: { rev: 1, value: { entries: [null], acknowledged: true } } });
    const written = await g.DestinationJournal.recordUnclaimable([{ type: "PolicyUnreadable" }], Date.now());
    assert.equal(written.ok, true, "the journal still accepts writes");
  });
});

test("identical primitive junk cannot defeat the cap", async () => {
  // MEASURED: selection used `includes`, which compares primitives BY VALUE, so
  // twenty identical junk entries all matched the one kept slot -- 21 entries
  // kept under a cap of 20, `overflowed` false while the tape ran away.
  await withJournal(async (area) => {
    await area.set({
      destinationJournal: { rev: 1, value: { entries: Array.from({ length: 25 }, () => "junk"), acknowledged: true } },
    });
    await g.DestinationJournal.recordUnclaimed(
      [{ type: "CatchAllAppeared", shortcutId: "star", baseUrl: "https://evil.example.org" }],
      "fp-someone-2", Date.now()
    );
    const journal = await g.DestinationJournal.read();
    assert.ok(journal.entries.length <= g.DestinationJournal.MAX_ENTRIES, "the cap actually caps");
  });
});

test("the banner shows evidence only, and never a fact already ticked off", async () => {
  // Two defects in one witness. Acts were rendered under an alarm title -- the
  // original bug (crying on ordinary use), moved from journalling to display.
  // And acknowledging set one flag over the whole entry, so the NEXT divergence
  // re-displayed every fact the user had ticked off weeks earlier.
  await withJournal(async () => {
    await g.DestinationJournal.recordUnclaimed(
      [{ type: "CatchAllAppeared", shortcutId: "star", baseUrl: "https://evil.example.org" }],
      "fp-intruder-1", Date.now()
    );
    for (let i = 0; i < 5; i += 1) {
      await g.DestinationJournal.recordClaimed(
        [{ type: "DestinationChanged", shortcutId: `mine-${i}`, key: "M", oldBaseUrl: "https://a.example.org", newBaseUrl: "https://b.example.org" }],
        "fp-door-i + 2", Date.now()
      );
    }

    let journal = await g.DestinationJournal.read();
    assert.equal(journal.unseen.length, 1, "my own edits are not alarms");
    assert.equal(journal.unseen[0].type, "CatchAllAppeared");
    assert.equal(journal.entries.length, 6, "but the journal still records everything");

    await g.DestinationJournal.acknowledgeAll();
    await g.DestinationJournal.recordUnclaimed(
      [{ type: "PolicyReplaced", changedCount: 3 }],
      "fp-intruder-99", Date.now()
    );

    journal = await g.DestinationJournal.read();
    assert.equal(journal.unseen.length, 1, "only the new one comes back");
    assert.equal(journal.unseen[0].type, "PolicyReplaced");
  });
});

test("migrating an area copies before it switches, and cleans both directions", async () => {
  // Four defects at once: the envelope was hand-written (piercing the membrane
  // versioned-entry.js spends three paragraphs defending), `rev: 1` walked the
  // destination's revision BACKWARDS, the switch happened BEFORE the copy so a
  // load() landing in between read an empty area, and only sync -> local removed
  // the source -- so migrating INTO sync left a full copy of the host names in
  // local, the very residue the other direction exists to avoid.
  const local = fakeArea();
  const sync = fakeArea();
  const platform = g.Platform;
  const previous = platform.api;
  platform.api = { storage: { local, sync } };
  try {
    await local.set({ policy: { rev: 4, writer: "w", value: { policy: { schemaVersion: 1, shortcuts: [] } } } });
    // The destination is not virgin: it already holds a higher revision.
    await sync.set({ policy: { rev: 9, writer: "other", value: { policy: { schemaVersion: 1, shortcuts: [] } } } });

    const moved = await g.PolicyRepository.migrateTo("sync");
    assert.equal(moved.ok, true);

    const landed = await g.VersionedEntry.read(sync, "policy");
    assert.ok(landed.rev > 9, `the revision must climb, got ${landed.rev}`);
    assert.ok(landed.writer, "and the envelope carries a writer, so it was not hand-written");

    const left = await local.get("policy");
    assert.deepEqual(left, {}, "the source is cleared in this direction too");
  } finally {
    platform.api = previous;
  }
});

test("the platform is asked once per distinct question, not once per rule", async () => {
  // It was a sequential await per rule, re-run on every sync() -- that is, on
  // every debounced keystroke. The reserved-prefix guards are IDENTICAL across
  // engines and CONSTANT between runs, so most of those serialised IPC round
  // trips asked the same question twice, against a worker whose whole budget is
  // staying alive long enough to finish.
  const dnr = fakeDnr();
  await withPlatform(dnr, async () => {
    let policy = g.JumpPolicy.empty().withEngines(["google.com", "bing.com", "duckduckgo.com"]).value;
    policy = policy.registerCatchAll("star", g.JiraInstance.parse("https://catchall.atlassian.net").value).value;
    policy = policy.acknowledge("star", "CATCH_ALL").value.armShortcut("star").value;

    await g.RuleInstaller.install(policy);

    const questions = dnr.asked.map((q) => JSON.stringify(q));
    assert.equal(
      questions.length,
      new Set(questions).size,
      "the same question must never be asked twice in one install"
    );
    assert.ok(dnr.asked.length > 0, "and it is still asked");
  });
});

test("the queue can be instantiated, so a deadlock in one run cannot poison the next", async () => {
  // It was three module-level variables: the mechanism could not be built twice,
  // could not be isolated, and leaked between test cases -- a run that reached the
  // deadlock this class closes poisoned every case after it.
  const order = [];
  const slot = new g.RuleInstaller.SingleSlot(async (s) => {
    order.push(s.kind);
    if (s.kind === "BOOM") throw new Error("refused");
    return s.kind;
  });
  const isPurge = (s) => s.kind === "PURGE";

  // The deadlock shape: a run rejects, and its waiter posts a purge from the catch.
  const failing = slot.accept({ kind: "BOOM" }, isPurge).catch(async () => {
    return slot.accept({ kind: "PURGE" }, isPurge);
  });
  assert.equal(await failing, "PURGE", "the slot posted from a rejected waiter still drains");

  // And a fresh instance starts clean, which the module-level version could not.
  const other = new g.RuleInstaller.SingleSlot(async () => "ok");
  assert.equal(await other.accept({ kind: "INSTALL" }, isPurge), "ok");
});

test("a claim copied out of the storage envelope cannot silence the detector", async () => {
  // MEASURED regression from the previous round. The claim used to be
  // {revision, writer} -- and the writer token is written INTO THE SAME ENVELOPE
  // as the value, so when the policy lives in `sync`, the adversary this journal
  // exists to watch READS it before writing it. Copying two fields instead of one
  // silenced the detector, under a comment swearing it could not be.
  await withJournal(async () => {
    const here = g.JiraInstance.parse("https://good.example.org").value;
    let mine = g.JumpPolicy.empty().withEngines(["google.com"]).value;
    mine = mine.register("id-a", g.ProjectKey.parse("ABC").value, here).value;

    // The door claims what it is about to write.
    await g.DestinationJournal.claimAhead(mine.fingerprint());

    // The compromised channel rewrites the destination. It can copy anything it
    // can READ -- and what it reads is the policy envelope, which carries no claim.
    const tampered = mine.withBaseUrlFor(
      "id-a",
      g.JiraInstance.parse("https://evil.example.net").value
    ).value;

    const written = await g.DestinationJournal.recordUnclaimed(
      g.PolicyDiff.between(mine, tampered),
      tampered.fingerprint(),
      Date.now()
    );
    assert.equal(written.ok, true);

    const journal = await g.DestinationJournal.read();
    assert.equal(journal.unseen.length, 1, "a content nobody claimed must be reported");
    assert.equal(journal.acknowledged, false, "and the banner rises");
  });
});

test("the door claiming AHEAD of its commit keeps the window quiet", async () => {
  // Claiming after the commit left a race the journal itself called "the likelier
  // order": the policy write is what wakes the worker, so the window reconciled
  // first and reported the user's own edit under the code reserved for compromise.
  await withJournal(async () => {
    const here = g.JiraInstance.parse("https://a.atlassian.net").value;
    let before = g.JumpPolicy.empty().withEngines(["google.com"]).value;
    const after = before.register("id-a", g.ProjectKey.parse("ABC").value, here).value;

    await g.DestinationJournal.claimAhead(after.fingerprint());
    // The window wakes up NOW, before the door has journalled anything.
    const written = await g.DestinationJournal.recordUnclaimed(
      g.PolicyDiff.between(before, after),
      after.fingerprint(),
      Date.now()
    );
    assert.equal(written.ok, true);

    const journal = await g.DestinationJournal.read();
    assert.equal(journal.unseen.length, 0, "the user's own edit is not an alarm, whatever the order");
  });
});

test("the claim ring remembers more than the last commit", async () => {
  // A single slot models "the last claim", not "what has been claimed": a slow
  // commit landing after a fast one left the claim on a stale state, and the next
  // reconciliation cried over an edit the user had made.
  await withJournal(async () => {
    for (let i = 0; i < g.DestinationJournal.MAX_CLAIMS; i += 1) {
      await g.DestinationJournal.claimAhead(`fp-${i}`);
    }
    const journal = await g.DestinationJournal.read();
    assert.equal(journal.claims.length, g.DestinationJournal.MAX_CLAIMS);
    assert.ok(journal.claims.includes("fp-0"), "the earliest of the ring is still covered");
  });
});

test("an install the purge primed over is TOLD SO, never handed the purge's result", async () => {
  // MEASURED regression. The dropped caller fell through to the shared waiter, so
  // it resolved with `undefined` -- and background.js reads `report.installed` one
  // line after the await. The outcome stayed fail-closed (the outer catch purges
  // again), but a named refusal became an anonymous TypeError.
  const ran = [];
  const slot = new g.RuleInstaller.SingleSlot(async (s) => {
    ran.push(s.kind);
    return { kind: s.kind, installed: s.kind !== "PURGE" };
  });
  const isPurge = (s) => s.kind === "PURGE";

  const first = slot.accept({ kind: "INSTALL" }, isPurge);
  const purged = slot.accept({ kind: "PURGE" }, isPurge);
  const stale = slot.accept({ kind: "INSTALL" }, isPurge);

  await assert.rejects(stale, /SUPERSEDED_BY_PURGE/, "the dropped request learns it was dropped");
  await Promise.allSettled([first, purged]);
  assert.ok(ran.includes("PURGE"), "and the purge still runs");
});
