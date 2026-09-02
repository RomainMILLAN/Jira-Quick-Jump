/**
 * The stand-in for the browser, for the ONE test file that exercises
 * background.js as a running service worker rather than as a set of functions.
 *
 * WHY IT IS INSTALLED ONCE, BEFORE THE FIRST IMPORT, AND NEVER SWAPPED
 *
 * Two files capture their handle to the browser AT LOAD TIME: platform.js does
 * `const api = global.browser ?? global.chrome`, and background.js does
 * `const api = Platform.api`. Both keep the VALUE, and neither ever re-reads the
 * property. So journal.test.js's `withPlatform`, which swaps `Platform.api` for
 * the duration of a body, cannot work here -- the worker would keep writing to
 * the object it captured while the test inspected a different one.
 *
 * The often-cited reason -- "background.js registers its listeners once" -- is
 * true but secondary: it explains why listeners must survive a reset, not why a
 * swap fails. The capture is the real constraint.
 *
 * Hence: ONE fake per file, posed on globalThis.chrome before anything imports,
 * with STABLE OBJECT IDENTITY for every node a captured binding can reach, and
 * reset() clearing CONTENT rather than replacing containers.
 *
 * Verified in execution: posing the fake before the first import is enough, with
 * ZERO production lines changed. Without it, importing background.js throws
 * "Cannot read properties of undefined (reading 'runtime')".
 */

/** The switches. Mutable, because the fake object identity must never change. */
export const dnrFaults = {
  // updateDynamicRules is ATOMIC: on a rejection nothing changes and the
  // previous rules stay alive.
  rejectUpdate: false,
  // The real RE2 behaviour the bare call hid: capturing and case-insensitivity
  // both cost memory, so an expression can be supported as asked about and
  // refused as installed.
  refuseCapturing: false,
  // MODELS THE FOREIGN SYSTEM. Every other option keeps readback == write, so
  // "rules come from a foreign system" was modelled nowhere. A shipped v1.0.0
  // rule, or any store written by an earlier version, is exactly a readback out
  // of step with what we last wrote.
  stripPriority: false,
  // The 9bis path: reading back what is installed can fail on its own.
  rejectGet: false,
};

/** Granted by default: the tests that care flip it. */
export const permissionState = { granted: true };

const local = new Map();
const badge = { text: undefined, calls: 0, reject: false };
let installedRules = [];
const asked = [];

/**
 * Listener buckets. They are NOT cleared by reset(): background.js registers
 * once, at import, and those listeners ARE the subject under test.
 */
const buckets = {
  onInstalled: [],
  onStartup: [],
  onAdded: [],
  onRemoved: [],
  onCommand: [],
  onChanged: [],
};

const hub = (bucket) => ({
  addListener: (fn) => bucket.push(fn),
  removeListener: (fn) => {
    const at = bucket.indexOf(fn);
    if (at >= 0) bucket.splice(at, 1);
  },
});

/**
 * Firing AWAITS every listener.
 *
 * The production code registers async listeners and the platform does not await
 * them; a test that did the same would assert on a half-run worker and pass or
 * fail by timing. So the fake gives the test what the browser cannot: a point
 * where the wake-up is over.
 */
const fireAll = async (bucket, ...args) => {
  for (const fn of [...bucket]) await fn(...args);
};

export const fire = {
  installed: (details) => fireAll(buckets.onInstalled, details),
  startup: () => fireAll(buckets.onStartup),
  permissionAdded: (permissions) => fireAll(buckets.onAdded, permissions),
  permissionRemoved: (permissions) => fireAll(buckets.onRemoved, permissions),
  command: (name) => fireAll(buckets.onCommand, name),
  /** What a compromised sync, or a malicious editor, does: it writes DIRECTLY. */
  storageChanged: (changes, areaName = "local") => fireAll(buckets.onChanged, changes, areaName),
};

/**
 * A ONE-SHOT GATE on one entry, so a test can INTERLEAVE two sync() calls.
 *
 * "Single-writer" describes a SITE, not a serialisation: sync() is re-entrant,
 * and the receipt's generation guard exists precisely for the case where a
 * delayed run writes after a later one. Without a way to suspend a run mid-flight
 * that guard can only be argued about, never measured -- and it is the guard whose
 * naive symmetric form was shown to FABRICATE a fail-open.
 *
 * One-shot and keyed on the entry name: the FIRST matching access blocks, every
 * later one goes straight through, so the second sync() is free to overtake.
 */
let gate = null;

/** Suspends the first read of `name`. Returns the release. */
export const holdRead = (name) => {
  let release;
  const promise = new Promise((r) => { release = r; });
  gate = { name, on: "get", promise };
  return () => {
    gate = null;
    release();
    return promise;
  };
};

/** Suspends the first write of `name`. Returns the release. */
export const holdWrite = (name) => {
  let release;
  const promise = new Promise((r) => { release = r; });
  gate = { name, on: "set", promise };
  return () => {
    gate = null;
    release();
    return promise;
  };
};

const passGate = async (on, name) => {
  if (gate && gate.on === on && gate.name === name) {
    const waiting = gate.promise;
    gate = null;
    await waiting;
  }
};

/** The three calls VersionedEntry actually makes, behind a Map. */
const area = {
  async get(name) {
    await passGate("get", name);
    if (local.get("__rejectGet") === true) throw new Error("storage.local.get rejected");
    return local.has(name) ? { [name]: local.get(name) } : {};
  },
  async set(entry) {
    for (const name of Object.keys(entry)) await passGate("set", name);
    if (local.get("__rejectSet") === true) throw new Error("QUOTA_BYTES quota exceeded");
    for (const [k, v] of Object.entries(entry)) local.set(k, v);
  },
  async remove(name) {
    local.delete(name);
  },
};

const chrome = {
  runtime: {
    onInstalled: hub(buckets.onInstalled),
    onStartup: hub(buckets.onStartup),
    openOptionsPage() {
      chrome._openedOptions += 1;
    },
  },
  _openedOptions: 0,
  storage: {
    local: area,
    onChanged: hub(buckets.onChanged),
  },
  permissions: {
    onAdded: hub(buckets.onAdded),
    onRemoved: hub(buckets.onRemoved),
    // Answering here rather than replacing Platform.grantedOrigins keeps the
    // real façade in the path: the test exercises the code that ships.
    async contains() {
      return permissionState.granted;
    },
    async request() {
      return permissionState.granted;
    },
  },
  commands: {
    onCommand: hub(buckets.onCommand),
  },
  action: {
    async setBadgeText({ text }) {
      badge.calls += 1;
      if (badge.reject) throw new Error("no action in this context");
      badge.text = text;
    },
  },
  i18n: {
    getMessage: () => "",
  },
  declarativeNetRequest: {
    async isRegexSupported(options) {
      asked.push(options);
      if (dnrFaults.refuseCapturing && options.requireCapturing) return { isSupported: false };
      return { isSupported: true };
    },
    async getDynamicRules() {
      if (dnrFaults.rejectGet) throw new Error("getDynamicRules rejected");
      if (!dnrFaults.stripPriority) return installedRules;
      return installedRules.map(({ priority, ...rule }) => rule);
    },
    async updateDynamicRules({ removeRuleIds = [], addRules = [] } = {}) {
      if (dnrFaults.rejectUpdate) throw new Error("MAX_NUMBER_OF_UNSAFE_DYNAMIC_RULES");
      const removed = new Set(removeRuleIds);
      installedRules = [...installedRules.filter((r) => !removed.has(r.id)), ...addRules];
    },
  },
};

/**
 * Call BEFORE the first import of anything under src/.
 *
 * Returns nothing worth holding: everything the test needs is exported by name
 * from this module, so no caller has to thread a handle through.
 */
export function installPlatform() {
  globalThis.chrome = chrome;
}

/** Content only. Identities and listener buckets survive, by design. */
export function reset() {
  gate = null;
  local.clear();
  installedRules = [];
  asked.length = 0;
  badge.text = undefined;
  badge.calls = 0;
  badge.reject = false;
  chrome._openedOptions = 0;
  dnrFaults.rejectUpdate = false;
  dnrFaults.refuseCapturing = false;
  dnrFaults.stripPriority = false;
  dnrFaults.rejectGet = false;
  permissionState.granted = true;
}

export const store = {
  /** What the platform believes is installed, priorities included. */
  rules: () => installedRules,
  /** Raw entries, to forge one or to read one back. */
  raw: local,
  entry: (name) => local.get(name),
  put: (name, value) => local.set(name, value),
  regexQuestions: () => asked,
  badge: () => badge.text,
  badgeCalls: () => badge.calls,
  failBadge: (yes = true) => {
    badge.reject = yes;
  },
  /** storage.local itself dying, which is not the same as a quota refusal. */
  failReads: (yes = true) => local.set("__rejectGet", yes),
  failWrites: (yes = true) => local.set("__rejectSet", yes),
  openedOptions: () => chrome._openedOptions,
};
