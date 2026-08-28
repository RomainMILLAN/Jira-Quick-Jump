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
      if (sub) sub.textContent = DIAGNOSIS()[report.diagnosis] || report.diagnosis;
      const tag = this.node.querySelector(".tag");
      if (tag) {
        tag.textContent = TAG_TEXT()[report.diagnosis] || report.diagnosis;
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

  // The core returns a CODE; the sentence is written here, and therefore
  // translated here. Built lazily: t() reads the browser's locale, which is not
  // available while this file is still being evaluated in a service worker.
  const DIAGNOSIS = () => ({
    DISARMED: t("diagDisarmed", "Every shortcut is off. Searches behave normally."),
    NO_SHORTCUTS: t("diagNoShortcuts", "No shortcut yet, so nothing is intercepted."),
    NO_ENGINES: t("diagNoEngines", "No search engine selected, so no rule can be built."),
    ALL_SHORTCUTS_DISARMED: t("diagAllOff", "Every shortcut is disarmed."),
    PARTIAL_POLICY: t("diagPartial", "Some saved entries could not be read back."),
    MISSING_ORIGINS: t("diagMissingOrigins", "Rules are installed but cannot fire: access is missing."),
    READY: t("diagReady", "Ready."),
  });
  const TAG_TEXT = () => ({
    DISARMED: t("tagOff", "Off"),
    NO_SHORTCUTS: t("tagEmpty", "Empty"),
    NO_ENGINES: t("tagNoEngine", "No engine"),
    ALL_SHORTCUTS_DISARMED: t("tagAllOff", "All off"),
    PARTIAL_POLICY: t("tagPartial", "Partial"),
    MISSING_ORIGINS: t("tagNoAccess", "No access"),
    READY: t("tagReady", "Ready"),
  });
  const TAG_TONE = {
    READY: "ok", MISSING_ORIGINS: "warn", PARTIAL_POLICY: "warn",
    NO_ENGINES: "warn", NO_SHORTCUTS: "off", ALL_SHORTCUTS_DISARMED: "off", DISARMED: "off",
  };

  // ------------------------------------------------------------- Shortcuts

  const Shortcuts = {
    drafts: [],

    mount(root, ctx) {
      root.appendChild(label(t("shortcuts", "Shortcuts"), t("shortcutsNote", "Where each issue key sends you.")));
      this.rows = el("div", { class: "rows rows-spaced" });
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
                message.textContent = engine.message;
                return;
              }
              const result = await ctx.apply((s) => {
                const added = s.policy().withCustomEngine(engine.value);
                if (!added.ok) return added;
                const selected = added.value.withEngines([...added.value.engineIds(), engine.value.id()]);
                return selected.ok ? MutationResult.ok(s.withPolicy(selected.value)) : selected;
              });
              message.hidden = result.ok;
              if (!result.ok) message.textContent = result.message;
              else this.adding = false;
            } }),
          el("button", { class: "btn plain", text: t("cancel", "Cancel"),
            onClick: () => { this.adding = false; this.render(ctx.stored(), ctx); } }),
        ]),
        message,
      ]);
    },
  };

  // ---------------------------------------------------------------- Access

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
            this.failure.hidden = result.ok;
            if (!result.ok) this.failure.textContent = result.message;
            this.render(ctx.stored(), ctx);
          },
        }));
      }
    },
  };

  // --------------------------------------------------------- Test & transfer

  const Preview = {
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
      const result = JumpPreview.forSearchUrl(this.input.value, ctx.stored().policy(), SearchEngineCatalog.forPolicy(ctx.stored().policy()));
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

  // -------------------------------------------------------------- Transfer

  const Transfer = {
    proposal: null,

    mount(root, ctx) {
      root.appendChild(label(t("transfer", "Import and export"),
        t("transferNote", "Imported shortcuts always arrive disarmed.")));
      this.file = el("input", { type: "file", hidden: true, "aria-label": t("import", "Import…") });
      this.file.accept = "application/json";
      this.file.addEventListener("change", () => this.read(ctx));
      this.review = el("div");
      root.appendChild(el("div", { class: "btn-row" }, [
        el("button", { class: "btn", text: t("export", "Export…"), onClick: () => this.export(ctx) }),
        el("button", { class: "btn", text: t("import", "Import…"), onClick: () => this.file.click() }),
      ]));
      root.appendChild(this.file);
      root.appendChild(this.review);
    },

    render(stored, ctx) {
      Dom.clear(this.review);
      if (!this.proposal) return;
      this.review.appendChild(this.diff(stored, ctx));
    },

    export(ctx) {
      // toTransfer() is defined by what it REMOVES: no acknowledgements, no
      // quarantine. A file cannot carry a decision the reader has not made.
      const json = JSON.stringify(ctx.stored().policy().toTransfer(), null, 2);
      Dom.downloadFile("quick-jump-for-jira.json", json);
    },

    async read(ctx) {
      const file = this.file.files && this.file.files[0];
      this.file.value = "";
      if (!file) return;
      if (file.size > 64 * 1024) {
        this.fail(t("importTooBig", "That file is too large to be a configuration."));
        return;
      }
      const parsed = global.ShortcutAdmission.parseJson(await file.text());
      if (!parsed.ok) {
        this.fail(parsed.message);
        return;
      }
      const proposed = global.JumpPolicy.proposeImport(parsed.value);
      if (!proposed.ok) {
        this.fail(proposed.message);
        return;
      }
      this.proposal = proposed;
      this.render(ctx.stored(), ctx);
    },

    fail(message) {
      this.proposal = null;
      Dom.clear(this.review);
      this.review.appendChild(el("p", { class: "row-msg refused", text: message }));
    },

    /**
     * The security-sensitive screen: a shared file pointing a key you already use
     * at a look-alike host. Changed destinations are shown was/now so the swap
     * cannot pass unnoticed, and the comparison is on the WHOLE base URL — an
     * origin-only diff would hide /jira becoming /jira-fake.
     */
    diff(stored, ctx) {
      const current = new Map(stored.policy().shortcuts().map((s) => [s.key().toString(), s]));
      const incoming = new Map(this.proposal.policy.shortcuts().map((s) => [s.key().toString(), s]));
      const rows = [];

      for (const [key, shortcut] of incoming) {
        const before = current.get(key);
        const changed = before && before.instance().baseUrl() !== shortcut.instance().baseUrl();
        rows.push(el("div", { class: `row${changed ? " is-refused" : ""}` }, [
          el("span", { class: "tag " + (changed ? "bad" : "ok"),
            text: changed ? t("diffChanged", "Changed") : t("diffNew", "New") }),
          el("span", { class: "dest", text: key }),
          el("span", {}, changed
            ? [destination(before.instance(), "dest was"), destination(shortcut.instance(), "dest now")]
            : [destination(shortcut.instance())]),
        ]));
      }
      for (const [key, shortcut] of current) {
        if (incoming.has(key)) continue;
        rows.push(el("div", { class: "row" }, [
          el("span", { class: "tag off", text: t("diffRemoved", "Removed") }),
          el("span", { class: "dest", text: key }),
          destination(shortcut.instance()),
        ]));
      }

      return el("div", {}, [
        el("p", { class: "hint", text: t("importLede",
          "Check where each key would send you. A configuration file can point a key you already use at a different server.") }),
        el("div", { class: "rows" }, rows),
        this.proposal.dropped.length > 0
          ? el("p", { class: "row-msg refused",
              text: t("importDropped", "Some entries were refused and will not be imported.") })
          : null,
        el("p", { class: "hint", text: t("importDisarmed",
          "Everything arrives disarmed, and warnings you accepted before are not carried over.") }),
        el("div", { class: "btn-row" }, [
          el("button", { class: "btn plain", text: t("cancel", "Cancel"),
            onClick: () => { this.proposal = null; this.render(ctx.stored(), ctx); } }),
          el("button", { class: "btn primary", text: t("importConfirm", "Import, disarmed"),
            onClick: () => this.confirm(ctx) }),
        ]),
      ]);
    },

    async confirm(ctx) {
      const proposed = this.proposal.policy;
      this.proposal = null;

      // The change journal is what surfaces a swapped destination BEFORE the next
      // jump, and an import is exactly the source it exists to attribute. The
      // previous destinations therefore have to be read BEFORE the write: after
      // it, `stored` already holds the imported policy and every comparison finds
      // nothing — which is silence exactly where the alarm belongs.
      const before = ctx.stored().policy();
      const events = [];
      for (const shortcut of proposed.shortcuts()) {
        const old = before.shortcuts().find((s) => s.key().toString() === shortcut.key().toString());
        if (old && old.instance().baseUrl() !== shortcut.instance().baseUrl()) {
          events.push({
            shortcutId: shortcut.id(), key: shortcut.key().toString(),
            oldBaseUrl: old.instance().baseUrl(), newBaseUrl: shortcut.instance().baseUrl(),
          });
        }
      }
      await ctx.apply((s) => MutationResult.ok(s.withPolicy(proposed)));
      if (events.length > 0) {
        await ctx.journal.record(events, 0, "IMPORT", Date.now());
        // The journal is not the policy, so nothing has redrawn it yet.
        await ctx.refresh();
      }
    },
  };

  // ------------------------------------------------------------- Quarantine

  const Quarantine = {
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
      entries.forEach((raw, index) => {
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
            onClick: () => this.fix(index, key.value, url.value, message, ctx) })]),
          el("div", { class: "f-del" }, [el("button", { class: "btn plain", text: t("delete", "Delete"),
            onClick: () => ctx.apply((s) => s.dropQuarantined(index)) })]),
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
    async fix(index, rawKey, rawUrl, message, ctx) {
      const key = ProjectKey.parse(rawKey);
      const instance = JiraInstance.parse(rawUrl);
      const failure = !key.ok ? key : !instance.ok ? instance : null;
      if (failure) {
        message.hidden = false;
        message.textContent = failure.message;
        return;
      }
      const result = await ctx.apply((s) => s.promote(index, key.value, instance.value));
      message.hidden = result.ok;
      if (!result.ok) message.textContent = result.message;
    },
  };

  // ---------------------------------------------------------------- Storage

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
      const current = (await Platform.api.storage.local.get("storageArea")).storageArea || "local";
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

  global.OptionsSections = [Status, Shortcuts, Engines, Access, Preview, Transfer, Quarantine, Storage];
})(globalThis);
