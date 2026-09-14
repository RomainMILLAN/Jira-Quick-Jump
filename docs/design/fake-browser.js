/**
 * A browser, for a screenshot.
 *
 * The options page is plain scripts on globalThis behind ONE façade
 * (src/platform.js reads `globalThis.browser ?? globalThis.chrome`), so posing an
 * object under that name is enough to run the real page in a plain browser --
 * no extension loaded, no profile, no network. That is what makes a screenshot
 * of the shipped markup possible without a real Jira anywhere near it.
 *
 * It answers reads and accepts writes. It is not a fake of the browser's
 * BEHAVIOUR -- test/fake-platform.js is that, and it is the one that has to be
 * right. Nothing here is ever asserted against.
 *
 * `__SCREENSHOT_STORAGE__` and `__SCREENSHOT_MESSAGES__` are injected by
 * docs/design/screenshot.mjs.
 */
(function (global) {
  "use strict";

  const store = new Map(Object.entries(global.__SCREENSHOT_STORAGE__ ?? {}));
  const messages = global.__SCREENSHOT_MESSAGES__ ?? {};

  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

  const area = {
    async get(request) {
      if (typeof request === "string") {
        const value = clone(store.get(request));
        return value === undefined ? {} : { [request]: value };
      }
      const keys = Array.isArray(request) ? request : Object.keys(request ?? {});
      const out = {};
      for (const key of keys.length ? keys : [...store.keys()]) {
        const value = clone(store.get(key));
        if (value !== undefined) out[key] = value;
      }
      return out;
    },
    async set(entries) {
      for (const [key, value] of Object.entries(entries)) store.set(key, clone(value));
    },
    async remove(keys) {
      for (const key of [].concat(keys)) store.delete(key);
    },
  };

  const listeners = () => ({ addListener() {}, removeListener() {} });

  global.chrome = {
    runtime: {
      getManifest: () => ({ version: global.__SCREENSHOT_VERSION__ ?? "0.0.0" }),
      onInstalled: listeners(),
      onStartup: listeners(),
      openOptionsPage() {},
    },
    i18n: { getMessage: (key) => messages[key]?.message ?? "" },
    storage: { local: area, onChanged: listeners() },
    // Every origin this page names is already granted, so the Access section
    // draws its settled state rather than a row of buttons.
    permissions: {
      contains: async () => true,
      request: async () => true,
      onAdded: listeners(),
      onRemoved: listeners(),
    },
    declarativeNetRequest: {
      getDynamicRules: async () => [],
      updateDynamicRules: async () => {},
      isRegexSupported: async () => ({ isSupported: true }),
    },
    action: { setBadgeText() {}, setBadgeBackgroundColor() {}, setTitle() {} },
  };
})(globalThis);
