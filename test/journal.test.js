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
const fakeDnr = ({ rejectUpdate = false } = {}) => {
  let installed = [];
  return {
    async isRegexSupported() {
      return { isSupported: true };
    },
    async getDynamicRules() {
      return installed;
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

test("a successful install reports the rules as delivered, for the preview to simulate", async () => {
  await withPlatform(fakeDnr(), async () => {
    const report = await g.RuleInstaller.install(armedCatchAll(), 0);
    assert.notEqual(report.diagnosis, "INSTALL_FAILED");
    assert.ok(report.rules.length >= 2, "the catch-all and its reserved prefixes");
    // The labels RuleSet needs never reach the platform.
    for (const rule of report.rules) {
      assert.equal("engineId" in rule, false);
      assert.equal("isCatchAll" in rule, false);
    }
  });
});
