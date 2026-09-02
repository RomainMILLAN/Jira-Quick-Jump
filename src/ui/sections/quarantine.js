/**
 * What could not be read back, kept rather than deleted.
 *
 * An entry we refuse is MOVED aside: otherwise the first apply would rewrite
 * storage from an amputated policy and erase a configuration the user created.
 */
(function (global) {
  "use strict";

  const { Dom, ProjectKey, JiraInstance } = global;
  const { el, t, label } = global.SectionParts;

  const Quarantine = {
    /**
     * Nothing to blank: this section paints no verdict of its own, so a condemned
     * page leaves it stale rather than lying. DECLARED rather than absent, because
     * an optional protocol member is a presence test -- the null this repository
     * bans everywhere else -- and structure.test.js pins that all eight declare it.
     */
    blank() {
    },
    reconcile() {
      /* No optimistic state to give up: this section writes through ctx.apply and
         never holds a pending order of its own. */
    },

    mount(root, ctx) {
      this.root = root;
      this.body = el("div");
      root.appendChild(this.body);
    },

    render(stored, ctx) {
      const entries = stored.quarantined();
      // A section with nothing to say says nothing.
      this.root.hidden = entries.length === 0;
      Dom.clear(this.body);
      if (entries.length === 0) return;

      this.body.appendChild(label(t("quarantine", "Could not be read back"),
        t("quarantineNote", "Kept, never deleted on your behalf.")));
      entries.forEach(({ entry: raw, fingerprint }) => {
        const message = el("div", { class: "row-msg refused", hidden: true });
        // Fixing means EDITING what could not be read, then sending it back
        // through the one door — re-submitting the same rejected bytes would just
        // reproduce the same refusal, which is honest and useless.
        const key = el("input", { class: "f key", value: String((raw && raw.key) ?? ""),
          "aria-label": t("key", "Key") });
        const url = el("input", { class: "f", value: String((raw && raw.baseUrl) ?? ""),
          "aria-label": t("destination", "Destination") });
        this.body.appendChild(el("div", { class: "row is-pending" }, [
          el("div", { class: "f-key" }, [key]),
          el("div", { class: "f-url" }, [url]),
          el("div", { class: "f-arm" }, [el("button", { class: "btn", text: t("fix", "Fix"),
            onClick: () => this.fix(fingerprint, raw, key.value, url.value, message, ctx) })]),
          el("div", { class: "f-del" }, [el("button", { class: "btn plain", text: t("delete", "Delete"),
            onClick: () => ctx.apply((s) => s.dropQuarantined(fingerprint)) })]),
          message,
        ]));
      });
      this.body.appendChild(el("p", { class: "hint",
        text: t("quarantineFoot", "It produces no rule, and it stays here until you decide.") }));
    },

    /**
     * Fixing goes back through the ONE door, so it can legitimately collide:
     * key uniqueness does not extend to quarantine, and the corrected entry may
     * clash with a shortcut created since.
     */
    async fix(fingerprint, raw, rawKey, rawUrl, message, ctx) {
      const instance = JiraInstance.parse(rawUrl);
      if (!instance.ok) {
        message.hidden = false;
        message.textContent = instance.message;
        return;
      }
      // A QUARANTINED CATCH-ALL TAKES THE OTHER DOOR.
      //
      // ProjectKey.parse refuses `*`, so parsing first made the repair path for a
      // catch-all unreachable -- it failed on KEY_SHAPE before ever asking to be
      // readmitted, and the only way out was deletion. This page still never
      // types a catch-all key: it asks the folder to readmit the one the entry
      // already carries.
      // Struck ONCE, before the compare-and-set, so a replayed attempt reuses it
      // instead of inventing a second identity.
      const freshId = crypto.randomUUID();
      const untouched = String((raw && raw.key) ?? "") === rawKey;
      if (untouched) {
        const result = await ctx.apply((s) => s.readmit(fingerprint, instance.value, freshId));
        this.showOutcome(result, message);
        return;
      }
      const key = ProjectKey.parse(rawKey);
      if (!key.ok) {
        message.hidden = false;
        message.textContent = key.message;
        return;
      }
      const result = await ctx.apply((s) => s.promoteAs(fingerprint, key.value, instance.value, freshId));
      this.showOutcome(result, message);
    },

    /** The `hidden = ok, else print the message` idiom, named once. It was
     *  written out at three call sites, and a fourth was about to be. */
    showOutcome(result, message) {
      message.hidden = result.ok;
      if (!result.ok) message.textContent = RefusalPresentation.sentence(result);
    },
  };

  global.SectionQuarantine = Quarantine;
})(globalThis);
