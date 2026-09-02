/**
 * Which search engines the address bar may hand us, one domain at a time.
 *
 * One entry per domain is deliberate: the permission prompt then contains only
 * what was ticked, instead of every Google top-level domain in existence.
 */
(function (global) {
  "use strict";

  const { Dom, MutationResult, SearchEngineCatalog } = global;
  const { el, t, label, toggle } = global.SectionParts;

  const Engines = {
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

    adding: false,

    mount(root, ctx) {
      root.appendChild(label(t("engines", "Search engines"),
        t("enginesNote", "Only searches from these are rewritten.")));
      this.chips = el("div", { class: "chips" });
      this.form = el("div");
      root.appendChild(this.chips);
      root.appendChild(this.form);
    },

    render(stored, ctx) {
      const policy = stored.policy();
      const selected = new Set(policy.engineIds());
      const catalog = SearchEngineCatalog.forPolicy(policy);
      const custom = new Set(policy.customEngines().map((e) => e.id()));

      Dom.clear(this.chips);
      for (const engine of catalog.all()) {
        const on = selected.has(engine.id);
        this.chips.appendChild(el("button", {
          class: "chip", "aria-pressed": String(on), text: engine.label, title: engine.exampleUrl,
          onClick: () => {
            const next = on ? [...selected].filter((e) => e !== engine.id) : [...selected, engine.id];
            ctx.apply((s) => {
              const result = s.policy().withEngines(next);
              return result.ok ? MutationResult.ok(s.withPolicy(result.value), result.events) : result;
            });
          },
        }));
        if (!custom.has(engine.id)) continue;
        this.chips.appendChild(el("button", {
          class: "btn icon", "aria-label": t("removeDomain", "Remove this domain"),
          onClick: () => ctx.apply((s) => {
            const result = s.policy().withoutCustomEngine(engine.id);
            return result.ok ? MutationResult.ok(s.withPolicy(result.value), result.events) : result;
          }),
        }, [icon(TRASH, 12)]));
      }
      this.chips.appendChild(el("button", {
        class: "chip", text: t("addDomain", "Add a domain"),
        onClick: () => { this.adding = !this.adding; this.render(ctx.stored(), ctx); },
      }));

      Dom.clear(this.form);
      if (this.adding) this.form.appendChild(this.addForm(ctx));
    },

    /**
     * Only the HOST is typed. The shape — the path and the query parameter the
     * regex is built from — is picked from a closed list, because a user-supplied
     * parameter would mean a user-supplied regex.
     */
    addForm(ctx) {
      const host = el("input", { class: "f", placeholder: "google.it",
        "aria-label": t("domain", "Domain") });
      const message = el("div", { class: "row-msg refused", hidden: true });
      let shape = SearchEngineCatalog.SHAPES[0];

      const shapes = el("div", { class: "chips" }, SearchEngineCatalog.SHAPES.map((candidate) =>
        el("button", {
          class: "chip", "aria-pressed": String(candidate === shape),
          text: SearchEngineCatalog.shapeLabel(candidate),
          onClick: (event) => {
            shape = candidate;
            for (const chip of shapes.children) chip.setAttribute("aria-pressed", "false");
            event.currentTarget.setAttribute("aria-pressed", "true");
          },
        })));

      return el("div", { class: "add-domain" }, [
        el("p", { class: "hint", text: t("addDomainNote",
          "Only the domain. How it builds its search URL is picked below, never typed.") }),
        host,
        shapes,
        el("div", { class: "btn-row" }, [
          el("button", { class: "btn primary", text: t("add", "Add"),
            onClick: async () => {
              const engine = global.CustomEngine.parse({ host: host.value, shape });
              if (!engine.ok) {
                message.hidden = false;
                message.textContent = RefusalPresentation.sentence(engine);
                return;
              }
              const result = await ctx.apply((s) => {
                const added = s.policy().withCustomEngine(engine.value);
                if (!added.ok) return added;
                const selected = added.value.withEngines([...added.value.engineIds(), engine.value.id()]);
                return selected.ok ? MutationResult.ok(s.withPolicy(selected.value)) : selected;
              });
              message.hidden = result.ok;
              if (!result.ok) message.textContent = RefusalPresentation.sentence(result);
              else this.adding = false;
            } }),
          el("button", { class: "btn plain", text: t("cancel", "Cancel"),
            onClick: () => { this.adding = false; this.render(ctx.stored(), ctx); } }),
        ]),
        message,
      ]);
    },
  };

  global.SectionEngines = Engines;
})(globalThis);
