/**
 * The sections, shared verbatim by the options page and the popup.
 *
 * Both surfaces show the SAME sections in the same order; only the density
 * differs, and that difference lives entirely in sections.css. Nothing here
 * branches on which surface it is running in.
 *
 * Every section hands the host an INTENTION -- `(stored) => stored` -- never a
 * snapshot, and the intention only ever carries the field the user just touched.
 */
(function (global) {
  "use strict";

  const { Dom, Platform, MutationResult, ProjectKey, JiraInstance, SearchEngineCatalog,
          OriginRequirements, JumpPreview, DestinationWarning } = global;
  const t = (k, f) => Platform.t(k, f);
  const el = Dom.el;

  const icon = (d, size = 14) =>
    el("svg", {
      width: size, height: size, viewBox: "0 0 24 24", fill: "none",
      stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round",
      "stroke-linejoin": "round", "aria-hidden": "true",
    }, [].concat(d).map((path) => el("path", { d: path })));

  const TRASH = "M4 6h16M9 6V4h6v2M18 6l-1 14H7L6 6";

  /** Host in weight, path dimmed -- but the path is ALWAYS rendered. */
  const destination = (instance, className = "dest") => {
    const { origin, path } = instance.parts();
    return el("span", { class: className }, [
      el("span", { class: "host", text: origin }),
      path ? el("span", { class: "path", text: path }) : null,
    ]);
  };

  const label = (text, note) =>
    el("div", { class: "lbl" }, [text, note ? el("span", { class: "note", text: note }) : null]);

  const toggle = (checked, onToggle, ariaLabel, disabled) =>
    el("button", {
      class: "sw", role: "switch", "aria-checked": String(checked),
      "aria-label": ariaLabel, disabled, onClick: onToggle,
    });

  // ---------------------------------------------------------------- Status

  const Status = {
    mount(root, ctx) {
      this.node = el("div", { class: "status" });
      this.banner = el("div", { class: "alert", hidden: true });
      root.appendChild(this.banner);
      root.appendChild(this.node);
      this.ctx = ctx;
    },

    async render(stored, ctx) {
      const policy = stored.policy();
      Dom.clear(this.node);

      const armed = policy.armed();
      this.node.appendChild(el("div", { class: "status-txt" }, [
        el("div", {
          class: "status-t",
          text: armed
            ? t("statusArmed", "Jumping is armed")
            : t("statusDisarmed", "Jumping is off"),
        }),
        el("div", { class: "status-s", text: t("statusCounting", "Checking rules…") }),
      ]));
      this.node.appendChild(el("span", { class: "tag off", text: "…" }));
      this.node.appendChild(toggle(
        armed,
        () => ctx.apply((s) => MutationResult.ok(s.withPolicy(armed ? s.policy().disarm() : s.policy().arm()))),
        t("toggleAll", "Arm or disarm every shortcut"),
      ));

      // getDynamicRules is async and the popup can close first: show a placeholder
      // rather than a transient 0, which reads as a failure.
      const report = await ctx.report();
      const sub = this.node.querySelector(".status-s");
      if (sub) sub.textContent = DIAGNOSIS[report.diagnosis] || report.diagnosis;
      const tag = this.node.querySelector(".tag");
      if (tag) {
        tag.textContent = TAG_TEXT[report.diagnosis] || report.diagnosis;
        tag.className = `tag ${TAG_TONE[report.diagnosis] || "off"}`;
      }

      const entries = await ctx.journal.read();
      this.banner.hidden = entries.acknowledged || entries.entries.length === 0;
      if (!this.banner.hidden) {
        const last = entries.entries[0];
        Dom.clear(this.banner);
        this.banner.appendChild(el("div", { class: "alert-t", text: t("changedTitle", "A destination changed") }));
        this.banner.appendChild(el("div", { class: "alert-s" }, [
          el("span", { class: "dest", text: last.key }),
          " ",
          t("changedNow", "now points to"),
          " ",
          el("span", { class: "dest host", text: last.newBaseUrl }),
          ". ",
          t("changedWas", "It used to point to"),
          " ",
          el("span", { class: "dest", text: last.oldBaseUrl }),
          ".",
        ]));
        this.banner.appendChild(el("div", { class: "btn-row" }, [
          el("button", {
            class: "btn", text: t("changedAck", "I have checked it"),
            onClick: async () => {
              await ctx.journal.acknowledgeAll();
              this.render(ctx.stored(), ctx);
            },
          }),
        ]));
      }
    },
  };

  const DIAGNOSIS = {
    DISARMED: "Every shortcut is off. Searches behave normally.",
    NO_SHORTCUTS: "No shortcut yet, so nothing is intercepted.",
    NO_ENGINES: "No search engine selected, so no rule can be built.",
    ALL_SHORTCUTS_DISARMED: "Every shortcut is disarmed.",
    PARTIAL_POLICY: "Some saved entries could not be read back.",
    MISSING_ORIGINS: "Rules are installed but cannot fire: access is missing.",
    READY: "Ready.",
  };
  const TAG_TEXT = {
    DISARMED: "Off", NO_SHORTCUTS: "Empty", NO_ENGINES: "No engine",
    ALL_SHORTCUTS_DISARMED: "All off", PARTIAL_POLICY: "Partial",
    MISSING_ORIGINS: "No access", READY: "Ready",
  };
  const TAG_TONE = {
    READY: "ok", MISSING_ORIGINS: "warn", PARTIAL_POLICY: "warn",
    NO_ENGINES: "warn", NO_SHORTCUTS: "off", ALL_SHORTCUTS_DISARMED: "off", DISARMED: "off",
  };

  // ------------------------------------------------------------- Shortcuts

  const Shortcuts = {
    drafts: [],

    mount(root, ctx) {
      root.appendChild(label(t("shortcuts", "Shortcuts"), t("shortcutsNote", "Where each issue key sends you.")));
      this.rows = el("div", { class: "rows" });
      root.appendChild(this.rows);
      root.appendChild(el("div", { class: "btn-row" }, [
        el("button", {
          class: "btn", text: t("addShortcut", "Add shortcut"),
          onClick: () => {
            this.drafts.push({ rowId: crypto.randomUUID(), key: "", url: "" });
            this.render(ctx.stored(), ctx);
          },
        }),
      ]));
      this.rows.style.marginBottom = "11px";
    },

    render(stored, ctx) {
      Dom.clear(this.rows);
      for (const shortcut of stored.policy().shortcuts()) {
        this.rows.appendChild(this.savedRow(shortcut, ctx));
      }
      for (const draft of this.drafts) {
        this.rows.appendChild(this.draftRow(draft, ctx));
      }
    },

    setArmed(id, desired, ctx) {
      return ctx.apply((s) => {
        const policy = s.policy();
        const next = desired ? policy.armShortcut(id) : policy.disarmShortcut(id);
        return next.ok ? MutationResult.ok(s.withPolicy(next.value), next.events) : next;
      });
    },

    savedRow(shortcut, ctx) {
      const id = shortcut.id();
      const pending = shortcut.unacknowledgedWarnings();

      const keyInput = el("input", {
        class: "f key", value: shortcut.key().toString(),
        "aria-label": t("key", "Key"),
        onInput: (event) => this.editKey(event.target, id, ctx),
      });

      const row = el("div", {
        class: `row${pending.length > 0 ? " is-pending" : ""}`, "data-id": id,
      }, [
        el("div", { class: "f-key" }, [el("div", { class: "field-label", text: t("key", "Key") }), keyInput]),
        el("div", { class: "f-url" }, [
          el("div", { class: "field-label", text: t("destination", "Destination") }),
          el("input", {
            class: "f", value: shortcut.instance().baseUrl(),
            "aria-label": t("destination", "Destination"),
            onInput: (event) => this.editUrl(event.target, id, ctx),
          }),
        ]),
        el("div", { class: "f-arm" }, [toggle(
          shortcut.armed(),
          // ABSOLUTE, never a flip: the user saw an off switch and asked for on.
          // A relative toggle re-derived inside the intention would come back
          // armed when the compare-and-set replays it after a conflict.
          () => this.setArmed(id, !shortcut.armed(), ctx),
          t("armThis", "Arm this shortcut"),
          pending.length > 0,
        )]),
        el("div", { class: "f-del" }, [el("button", {
          class: "btn icon", "aria-label": t("remove", "Remove this shortcut"),
          onClick: () => ctx.apply((s) => {
            const next = s.policy().remove(id);
            return next.ok ? MutationResult.ok(s.withPolicy(next.value), next.events) : next;
          }),
        }, [icon(TRASH)])]),
      ]);

      if (pending.length > 0) {
        row.appendChild(el("div", { class: "acks" }, [
          ...pending.map((warning) => el("label", { class: "ack" }, [
            el("input", {
              type: "checkbox",
              onChange: () => ctx.apply((s) => {
                const next = s.policy().acknowledge(id, warning.kind);
                return next.ok ? MutationResult.ok(s.withPolicy(next.value), next.events) : next;
              }),
            }),
            warning.message,
          ])),
          el("span", { class: "row-msg pending", text: t("ackBlocks", "Arming stays unavailable until these are accepted.") }),
        ]));
      }
      return row;
    },

    draftRow(draft, ctx) {
      const message = el("div", { class: "row-msg refused", hidden: true });
      const row = el("div", { class: "row" }, [
        el("div", { class: "f-key" }, [
          el("div", { class: "field-label", text: t("key", "Key") }),
          el("input", {
            class: "f key", placeholder: "ABC", value: draft.key, "aria-label": t("key", "Key"),
            onInput: (event) => { draft.key = event.target.value; this.tryRegister(draft, row, message, ctx); },
          }),
        ]),
        el("div", { class: "f-url" }, [
          el("div", { class: "field-label", text: t("destination", "Destination") }),
          el("input", {
            class: "f", placeholder: "example.atlassian.net", value: draft.url,
            "aria-label": t("destination", "Destination"),
            onInput: (event) => { draft.url = event.target.value; this.tryRegister(draft, row, message, ctx); },
          }),
        ]),
        el("div", { class: "f-arm" }, [toggle(false, () => {}, t("armThis", "Arm this shortcut"), true)]),
        el("div", { class: "f-del" }, [el("button", {
          class: "btn icon", "aria-label": t("remove", "Remove this shortcut"),
          onClick: () => {
            this.drafts = this.drafts.filter((d) => d !== draft);
            this.render(ctx.stored(), ctx);
          },
        }, [icon(TRASH)])]),
        message,
      ]);
      return row;
    },

    /** Validation runs on every keystroke; the write only happens once both parse. */
    tryRegister(draft, row, message, ctx) {
      const key = ProjectKey.parse(draft.key);
      const instance = JiraInstance.parse(draft.url);
      const failure = !key.ok && draft.key !== "" ? key : !instance.ok && draft.url !== "" ? instance : null;
      message.hidden = failure === null;
      message.textContent = failure ? failure.message : "";
      row.classList.toggle("is-refused", failure !== null);
      if (!key.ok || !instance.ok) return;

      const id = draft.rowId;
      this.drafts = this.drafts.filter((d) => d !== draft);
      ctx.apply((s) => {
        const next = s.policy().register(id, key.value, instance.value);
        return next.ok ? MutationResult.ok(s.withPolicy(next.value), next.events) : next;
      });
    },

    editKey(input, id, ctx) {
      const parsed = ProjectKey.parse(input.value);
      input.setAttribute("aria-invalid", String(!parsed.ok));
      if (!parsed.ok) return;
      ctx.apply((s) => {
        const next = s.policy().withKeyFor(id, parsed.value);
        return next.ok ? MutationResult.ok(s.withPolicy(next.value), next.events) : next;
      }, `shortcut:${id}:key`);
    },

    editUrl(input, id, ctx) {
      const parsed = JiraInstance.parse(input.value);
      input.setAttribute("aria-invalid", String(!parsed.ok));
      if (!parsed.ok) return;
      ctx.apply((s) => {
        const next = s.policy().withBaseUrlFor(id, parsed.value);
        return next.ok ? MutationResult.ok(s.withPolicy(next.value), next.events) : next;
      }, `shortcut:${id}:baseUrl`);
    },
  };

  // --------------------------------------------------------------- Engines

  const Engines = {
    mount(root, ctx) {
      root.appendChild(label(t("engines", "Search engines"), t("enginesNote", "Only searches from these are rewritten.")));
      this.chips = el("div", { class: "chips" });
      root.appendChild(this.chips);
    },

    render(stored, ctx) {
      Dom.clear(this.chips);
      const selected = new Set(stored.policy().engineIds());
      for (const engine of SearchEngineCatalog.all()) {
        const on = selected.has(engine.id);
        this.chips.appendChild(el("button", {
          class: "chip", "aria-pressed": String(on), text: engine.label,
          title: engine.exampleUrl,
          onClick: () => {
            const next = on ? [...selected].filter((e) => e !== engine.id) : [...selected, engine.id];
            ctx.apply((s) => {
              const result = s.policy().withEngines(next);
              return result.ok ? MutationResult.ok(s.withPolicy(result.value), result.events) : result;
            });
          },
        }));
      }
    },
  };

  // ---------------------------------------------------------------- Access

  const Access = {
    mount(root, ctx) {
      root.appendChild(label(t("access", "Access"), t("accessNote", "A redirect needs permission for its destination.")));
      this.summary = el("div", { class: "access" });
      this.list = el("div", { class: "origins" });
      this.actions = el("div", { class: "btn-row" });
      this.actions.style.marginTop = "11px";
      root.appendChild(this.summary);
      root.appendChild(this.list);
      root.appendChild(this.actions);
    },

    async render(stored, ctx) {
      const policy = stored.policy();
      const origins = OriginRequirements.requiredOrigins(policy, SearchEngineCatalog);
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
            await Platform.requestOrigins(origins);
            this.render(ctx.stored(), ctx);
          },
        }));
      }
    },
  };

  // --------------------------------------------------------- Test & transfer

  const TestTransfer = {
    mount(root, ctx) {
      root.appendChild(label(t("tryIt", "Try a URL"), t("tryItNote", "Paste a search URL to see where it would land.")));
      this.input = el("input", {
        class: "f", placeholder: "https://www.google.com/search?q=ABC-1234",
        "aria-label": t("tryIt", "Try a URL"),
        onInput: () => this.preview(ctx),
      });
      this.out = el("div", { class: "preview empty", text: t("tryItEmpty", "Nothing yet.") });
      root.appendChild(this.input);
      root.appendChild(this.out);
      this.ctx = ctx;
    },

    render() {
      /* Stateless: the preview only reflects what is typed into it. */
    },

    preview(ctx) {
      const result = JumpPreview.forSearchUrl(this.input.value, ctx.stored().policy(), SearchEngineCatalog);
      Dom.clear(this.out);
      if (!result.ok) {
        this.out.className = "preview empty";
        this.out.textContent = PREVIEW_MISS[result.code] || result.code;
        return;
      }
      this.out.className = "preview";
      const url = new URL(result.destination);
      this.out.appendChild(el("span", { class: "host", text: url.origin }));
      this.out.appendChild(el("span", { class: "path", text: url.pathname }));
    },
  };

  const PREVIEW_MISS = {
    NOT_A_URL: "That is not a URL.",
    NOT_A_SEARCH_URL: "That is not a search URL.",
    NO_MATCH: "This search would go through untouched.",
    INPUT_TOO_LONG: "That is too long to be a search URL.",
  };

  global.OptionsSections = [Status, Shortcuts, Engines, Access, TestTransfer];
})(globalThis);
