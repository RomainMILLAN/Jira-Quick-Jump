/**
 * Local by default, sync on request, one direction at a time.
 *
 * Syncing sends internal Jira host names to the browser account, so the choice is
 * explicit and the screen says what it costs.
 */
(function (global) {
  "use strict";

  const { Platform, Dom } = global;
  const { el, t, label } = global.SectionParts;
  const Storage = {

    mount(root, ctx) {
      root.appendChild(label(t("storage", "Storage"),
        t("storageNote", "Syncing sends your Jira host names to your browser account.")));
      this.chips = el("div", { class: "chips" });
      this.msg = el("p", { class: "hint" });
      root.appendChild(this.chips);
      root.appendChild(this.msg);
    },

    async render(stored, ctx) {
      // THROUGH THE FACADE. Reading the entry here gave the key `storageArea` two
      // owners -- Platform, which exists to own it, and this render function --
      // and the literal was spelled in both.
      const current = await Platform.storageAreaName();
      Dom.clear(this.chips);
      for (const [area, text] of [["local", t("storageLocal", "This device only")],
                                  ["sync", t("storageSync", "Sync across devices")]]) {
        this.chips.appendChild(el("button", {
          class: "chip", "aria-pressed": String(current === area), text,
          onClick: async () => {
            const result = await global.PolicyRepository.migrateTo(area);
            this.msg.textContent = result.ok
              ? (area === "sync"
                  ? t("storageMovedSync", "Your configuration now syncs. Copies already on other devices may remain.")
                  : t("storageMovedLocal", "Your configuration is on this device only, and the synced copy was removed."))
              : t("storageTooBig", "This configuration is too large to sync.");
            this.render(ctx.stored(), ctx);
          },
        }));
      }
    },
  };

  global.SectionStorage = Storage;
})(globalThis);
