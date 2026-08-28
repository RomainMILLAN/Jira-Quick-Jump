/**
 * The façade that ABSORBS the browser difference. Zero public booleans: callers
 * never learn which browser they are running in.
 *
 * A pair of capability probes would have exported per-browser `if`s to every
 * caller while claiming to confine them -- procedural code wearing an
 * abstraction's clothes.
 */
(function (global) {
  "use strict";

  const api = global.browser ?? global.chrome;

  const Platform = {
    api,

    /**
     * storage.local by default. Sync would ship internal Jira host names
     * (infrastructure mapping) and project keys (often customer names) to the
     * user's Google or Mozilla account, replicated to every signed-in browser.
     * It is also an attack path: compromising that account rewrites destinations
     * without touching the extension.
     */
    async storageArea() {
      try {
        const { storageArea } = await api.storage.local.get("storageArea");
        return storageArea === "sync" && api.storage.sync ? api.storage.sync : api.storage.local;
      } catch {
        return api.storage.local;
      }
    },

    /** The setting itself always lives in local, or one device could re-enable sync on another. */
    async setStorageArea(area) {
      await api.storage.local.set({ storageArea: area });
    },

    async grantedOrigins(origins) {
      if (origins.length === 0) return true;
      try {
        return await api.permissions.contains({ origins });
      } catch {
        return false;
      }
    },

    async requestOrigins(origins) {
      if (origins.length === 0) return true;
      try {
        return await api.permissions.request({ origins });
      } catch {
        return false;
      }
    },
  };

  global.Platform = Platform;
})(globalThis);
