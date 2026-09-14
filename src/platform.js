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

  // Captured once for the load-time bindings below; the STORAGE methods go
  // through `this.api` instead, because that is the handle every other module in
  // the project already uses -- and a facade that cannot be stood in for is a
  // facade its own tests must reach around.
  const api = global.browser ?? global.chrome;

  const Platform = {
    api,

    /**
     * Every user-visible string goes through here, with its English text as the
     * fallback. Writing it this way from the start is what keeps the French
     * version cheap: no string is assembled by concatenation, and no label
     * depends on English word order.
     */
    t(key, fallback) {
      try {
        return api.i18n.getMessage(key) || fallback;
      } catch {
        return fallback;
      }
    },

    /**
     * storage.local by default. Sync would ship internal Jira host names
     * (infrastructure mapping) and project keys (often customer names) to the
     * user's Google or Mozilla account, replicated to every signed-in browser.
     * It is also an attack path: compromising that account rewrites destinations
     * without touching the extension.
     */
    async storageArea() {
      return this.storageAreaFor(await this.storageAreaName());
    },

    /**
     * WHICH area is in charge, by name.
     *
     * The name was only ever readable by comparing the OBJECT storageArea()
     * returns, so callers that needed to know "am I already there?" reached past
     * this facade and re-read the `storageArea` entry themselves -- giving the
     * key two owners. It has one.
     */
    async storageAreaName() {
      try {
        const { storageArea } = await this.api.storage.local.get("storageArea");
        return storageArea === "sync" && this.api.storage.sync ? "sync" : "local";
      } catch {
        return "local";
      }
    },

    /** The area an intention names, whether or not it is the one in charge. A
     *  migration has to hold both at once. */
    storageAreaFor(name) {
      return name === "sync" && this.api.storage.sync ? this.api.storage.sync : this.api.storage.local;
    },

    /** The setting itself always lives in local, or one device could re-enable sync on another. */
    async setStorageArea(area) {
      await this.api.storage.local.set({ storageArea: area });
    },

    async grantedOrigins(origins) {
      if (origins.length === 0) return true;
      try {
        return await api.permissions.contains({ origins });
      } catch {
        return false;
      }
    },

    /**
     * Returns the browser's answer, or the reason it refused to ask.
     *
     * Chrome rejects a request for an origin that is not entirely inside the
     * manifest's `optional_host_permissions`, and it does so by throwing — so
     * swallowing the error turns a misconfiguration into a button that does
     * nothing at all, with a clean console. Never swallow this one.
     */
    async requestOrigins(origins) {
      if (origins.length === 0) return { ok: true, granted: true };
      try {
        const granted = await api.permissions.request({ origins });
        return { ok: true, granted };
      } catch (error) {
        return { ok: false, granted: false, message: String(error && error.message) };
      }
    },
  };

  global.Platform = Platform;
})(globalThis);
