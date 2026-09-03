/**
 * The origins this configuration needs, and the browser's own prompt.
 *
 * A redirect rule without host access is inert, so this is what stands between a
 * saved policy and a working one -- and the only place the extension asks for
 * anything.
 */
(function (global) {
  "use strict";

  const { Dom, Platform, OriginRequirements, SearchEngineCatalog, RefusalPresentation } = global;
  const { el, t, label, destination } = global.SectionParts;

  const Access = {

    mount(root, ctx) {
      root.appendChild(label(t("access", "Access"), t("accessNote", "A redirect needs permission for its destination.")));
      this.summary = el("div", { class: "access" });
      this.list = el("div", { class: "origins" });
      this.actions = el("div", { class: "btn-row row-actions" });
      // A permission request the browser refuses to even show must say so; a
      // button that does nothing is the worst of both worlds.
      this.failure = el("p", { class: "row-msg refused", hidden: true });
      root.appendChild(this.summary);
      root.appendChild(this.list);
      root.appendChild(this.actions);
      root.appendChild(this.failure);
    },

    async render(stored, ctx) {
      const policy = stored.policy();
      const origins = OriginRequirements.requiredOrigins(policy, SearchEngineCatalog.forPolicy(policy));
      const granted = await Platform.grantedOrigins(origins);

      Dom.clear(this.summary);
      this.summary.appendChild(el("span", { class: `dot${granted ? "" : " pending"}` }));
      this.summary.appendChild(document.createTextNode(
        granted
          ? t("accessAll", "Every origin this configuration needs has been granted.")
          : t("accessMissing", "Some origins have not been granted yet."),
      ));

      Dom.clear(this.list);
      for (const origin of origins) {
        this.list.appendChild(el("div", { class: "origin", text: origin }));
      }

      Dom.clear(this.actions);
      if (!granted) {
        this.actions.appendChild(el("button", {
          class: "btn primary", text: t("grant", "Grant access"),
          // The prompt is the browser's and names the real host; we can neither
          // fake it nor pre-approve it. On some browsers it closes the popup.
          onClick: async () => {
            const result = await Platform.requestOrigins(origins);
            // THREE OUTCOMES, NOT TWO. `ok` says the prompt ran; `granted` says
            // what the user answered. Reading only `ok` meant a plain "Deny" left
            // the message hidden and the screen unchanged -- the button appeared
            // to do nothing at all, on the one control standing between the
            // extension and the user's data.
            if (!result.ok) {
              this.failure.hidden = false;
              this.failure.textContent = RefusalPresentation.sentence(result);
            } else if (!result.granted) {
              this.failure.hidden = false;
              this.failure.textContent = t("accessDeclined",
                "Access was not granted, so nothing will redirect to these hosts.");
            } else {
              this.failure.hidden = true;
            }
            this.render(ctx.stored(), ctx);
          },
        }));
      }
    },
  };

  global.SectionAccess = Access;
})(globalThis);
