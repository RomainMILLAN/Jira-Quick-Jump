/**
 * Export, and import behind a review screen.
 *
 * Everything imported arrives disarmed with no acknowledgements, so a hostile
 * file cannot install a rule until the user arms each shortcut while looking at
 * its destination.
 */
(function (global) {
  "use strict";

  const { Dom, MutationResult, RefusalPresentation } = global;
  const { el, t, label, destination } = global.SectionParts;

  const Transfer = {

    proposal: undefined,

    mount(root, ctx) {
      root.appendChild(label(t("transfer", "Import and export"),
        t("transferNote", "Imported shortcuts always arrive disarmed.")));
      // NO aria-label HERE. `hidden` removes the node from the accessibility tree,
      // so the label was dead: nothing could ever announce it. The BUTTON below is
      // what a screen reader reaches, and it carries the name. The input is a
      // mechanism, not a control -- so it is hidden from assistive tech on purpose.
      this.file = el("input", { type: "file", hidden: true, tabindex: "-1", "aria-hidden": "true" });
      this.file.accept = "application/json";
      this.file.addEventListener("change", () => this.read(ctx));
      this.review = el("div");
      /**
       * THE TWO BUTTONS ARE HELD, because this section is the only one whose
       * CONTROLS ARE BORN IN mount() -- that is, before the first read.
       *
       * Every other section creates its controls in render(), which never runs on
       * a condemned page. These two exist from the moment the page is mounted, and
       * `ctx.stored()` is `null` until the first successful load. Measured, with
       * SectionHost mounted on a policy the storage door cannot read: the ONLY
       * clickable controls left on the recovery view were "Export…" and "Import…",
       * and Export answered `TypeError: Cannot read properties of null (reading
       * 'policy')` -- inside a handler, so nothing at all on screen.
       *
       * On the view SECURITY.md calls a recovery view, and importing a backup is a
       * plausible way out of an unreadable configuration.
       */
      this.buttons = [
        el("button", { class: "btn", text: t("export", "Export…"), onClick: () => this.export(ctx) }),
        el("button", { class: "btn", text: t("import", "Import…"), onClick: () => this.open(ctx) }),
      ];
      root.appendChild(el("div", { class: "btn-row" }, this.buttons));
      root.appendChild(this.file);
      root.appendChild(this.review);
    },

    /**
     * THE PAGE IS CONDEMNED, AND THIS SECTION SAYS SO ITSELF.
     *
     * A total member of the protocol protects against the absence of the MEMBER,
     * not of the POLICY: `Section.blank()` is a no-op for a section that does not
     * declare one, so `condemn()` left these two buttons live with nothing behind
     * them. Status.blank already carries the same argument for its own node.
     *
     * `aria-disabled` and never `disabled`, on the house rule the reorder arrows
     * state: a disabled control is not focusable, so a keyboard user reaching this
     * row would be dropped out of it. The guards in export() and open() are what
     * actually refuse; this is what says so.
     */
    blank() {
      this.proposal = undefined;
      for (const button of this.buttons ?? []) button.setAttribute("aria-disabled", "true");
      if (!this.review) return;
      Dom.clear(this.review);
      this.review.appendChild(el("p", {
        class: "row-msg refused",
        text: t("transferUnavailable",
          "The saved configuration could not be read, so it can be neither exported nor replaced."),
      }));
    },

    render(stored, ctx) {
      Dom.clear(this.review);
      // A SUCCESSFUL RENDER TAKES THE REFUSAL BACK. blank() paints a sentence and
      // marks the buttons; nothing else would ever unmark them, and section-host
      // promises in its own words that "a repaired wake-up renders for good".
      for (const button of this.buttons ?? []) button.setAttribute("aria-disabled", "false");
      if (!this.proposal) return;
      this.review.appendChild(this.diff(stored, ctx));
    },

    export(ctx) {
      // GUARDED, and the guard is not defensive dressing: see the note in mount().
      // The button exists before the first read and survives condemn(), so `null`
      // here is a REACHABLE state and not a hypothesis.
      const stored = ctx.stored();
      if (!stored) return;
      // toTransfer() is defined by what it REMOVES: no acknowledgements, no
      // quarantine. A file cannot carry a decision the reader has not made.
      const json = JSON.stringify(stored.policy().toTransfer(), null, 2);
      Dom.downloadFile("quick-jump-for-jira.json", json);
    },

    /** The picker, behind the same guard as the export: a file chosen against a
     *  policy nobody could read has nothing to be compared with, and the review
     *  screen -- which is the whole control -- could not be painted. */
    open(ctx) {
      if (!ctx.stored()) return;
      this.file.click();
    },

    async read(ctx) {
      const file = this.file.files && this.file.files[0];
      this.file.value = "";
      if (!file) return;
      if (file.size > global.ShortcutAdmission.MAX_TRANSFER_BYTES) {
        this.fail(t("importTooBig", "That file is too large to be a configuration."));
        return;
      }
      // GUARDED, because this handler's promise FLOATS: `change` does not await it.
      //
      // Every refusal on this path is designed to be a VALUE -- parseJson and
      // proposeImport both return { ok: false, code } -- and fail() is the whole
      // recovery. A THROW skipped it: the rejection went nowhere, and the Import
      // button visibly did nothing at all, on a screen whose entire job is to be
      // believed. Measured: a temporal dead zone in admission.js's readDocument
      // turned one unreadable engine id in a file into a ReferenceError out of
      // proposeImport. That jet is fixed at its source; this is what makes the
      // next one land on the sentence that was already written.
      //
      // file.text() is inside too: a file the browser can no longer read (removed
      // or replaced between the pick and the read) rejects here, not in parseJson.
      let proposed;
      try {
        const parsed = global.ShortcutAdmission.parseJson(await file.text());
        if (!parsed.ok) {
          this.fail(RefusalPresentation.sentence(parsed));
          return;
        }
        proposed = global.JumpPolicy.proposeImport(parsed.value);
      } catch (error) {
        this.fail(RefusalPresentation.sentence({
          ok: false, code: "POLICY_UNREADABLE", message: String(error && error.message),
        }));
        return;
      }
      if (!proposed.ok) {
        this.fail(RefusalPresentation.sentence(proposed));
        return;
      }
      this.proposal = proposed;
      // INSIDE THE GUARD, and it was outside. `read()` is called from a `change`
      // listener that does not await it, and its own try covered the PARSE alone --
      // so a throw from the render went nowhere. On a condemned page `diff()` reads
      // `stored.policy()` on `null`, which is exactly that throw: the Import button
      // opened a picker, took the file, and did nothing, in silence.
      const stored = ctx.stored();
      if (!stored) {
        this.blank();
        return;
      }
      this.render(stored, ctx);
    },

    fail(message) {
      this.proposal = undefined;
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
      const current = new Map(stored.policy().shortcuts().map((s) => [s.keyText(), s]));
      const incoming = new Map(this.proposal.policy.shortcuts().map((s) => [s.keyText(), s]));
      const rows = [];

      for (const [key, shortcut] of incoming) {
        const before = current.get(key);
        const changed = before && before.destination() !== shortcut.destination();
        rows.push(el("div", { class: `row${changed ? " is-refused" : ""}` }, [
          el("span", { class: "tag " + (changed ? "bad" : "ok"),
            text: changed ? t("diffChanged", "Changed") : t("diffNew", "New") }),
          el("span", { class: "mono-token", text: key }),
          el("span", {}, changed
            ? [destination(before.instance(), "dest was"), destination(shortcut.instance(), "dest now")]
            : [destination(shortcut.instance())]),
        ]));
      }
      for (const [key, shortcut] of current) {
        if (incoming.has(key)) continue;
        rows.push(el("div", { class: "row" }, [
          el("span", { class: "tag off", text: t("diffRemoved", "Removed") }),
          el("span", { class: "mono-token", text: key }),
          destination(shortcut.instance()),
        ]));
      }

      return el("div", {}, [
        el("p", { class: "hint", text: t("importLede",
          "Check where each key would send you. A configuration file can point a key you already use at a different server.") }),
        el("div", { class: "rows" }, rows),
        this.proposal.refused.length > 0
          ? el("p", { class: "row-msg refused",
              text: t("importRefused", "Some entries were refused and will not be imported.") })
          : null,
        /**
         * THE FILE ALSO CHOOSES WHERE SEARCHES ARE INTERCEPTED, and this screen
         * used to show only the destinations.
         *
         * `toTransfer()` carries `engines` and `customEngines` beside the
         * shortcuts, and the lede above promises "check where each key would send
         * you". Measured: a file adding `intra.attacker.example` and ticking it
         * showed one row -- the shortcut -- and, once the user armed that shortcut,
         * emitted TWO rules, the second on a host that had never appeared on
         * screen.
         *
         * WHAT BOUNDED IT, and why this is transparency rather than a breach: the
         * Access section then asks for that host's origin and the browser prompt
         * names it, so nothing fires unseen; and the destination is still the
         * shortcut's, which IS shown. The gap was consent to the SURFACE, one step
         * before the permission catches it.
         *
         * The engines are printed by id, which is what the user ticked; a custom
         * domain is printed by host, because that is the word they would
         * recognise. Both go through Dom.visibleText: they come from a file.
         */
        this.surface(),
        el("p", { class: "hint", text: t("importDisarmed",
          "Everything arrives disarmed, and warnings you accepted before are not carried over.") }),
        el("div", { class: "btn-row" }, [
          el("button", { class: "btn plain", text: t("cancel", "Cancel"),
            onClick: () => { this.proposal = undefined; this.render(ctx.stored(), ctx); } }),
          el("button", { class: "btn primary", text: t("importConfirm", "Import, disarmed"),
            onClick: () => this.confirm(ctx) }),
        ]),
      ]);
    },

    /** What the file selects, beside the destinations. `null` when it selects
     *  nothing, so a file carrying only shortcuts adds no line. */
    surface() {
      const policy = this.proposal.policy;
      const engines = policy.engineIds();
      const domains = policy.customEngines().map((e) => e.host());
      if (engines.length === 0 && domains.length === 0) return null;
      return el("p", { class: "row-msg pending" }, [
        t("importSurface", "This file also chooses where searches are intercepted:"),
        " ",
        el("span", { class: "mono-token", text: Dom.visibleText(engines.join(", ")) }),
        domains.length > 0 ? " " : null,
        domains.length > 0
          ? el("span", {}, [
              t("importDomains", "and it adds these search domains:"),
              " ",
              el("span", { class: "mono-token", text: Dom.visibleText(domains.join(", ")) }),
            ])
          : null,
      ]);
    },

    async confirm(ctx) {
      const proposed = this.proposal.policy;
      this.proposal = undefined;

      // The change journal is what surfaces a swapped destination BEFORE the next
      // jump, and an import is exactly the source it exists to attribute. The
      // NO SECOND DIFF HERE. This block used to walk the two policies by hand and
      // journal its own list -- so an import wrote every change TWICE: once from
      // PolicyDiff at the commit, once from here.
      //
      // And the hand-rolled one was the wrong one. It paired shortcuts by
      // `key().toString()` instead of by identity, emitted facts with no `type`
      // (readable only through the legacy path meant for entries written by older
      // builds), carried the id of the IMPORTED file rather than the one in the
      // policy, and bypassed MAX_FACTS_PER_COMMIT -- so importing a hundred
      // destinations wrote a hundred entries and set the sticky `overflowed`
      // marker for good. policy-diff.js promises "One implementation, one corpus";
      // there were three, and this was the false one.
      //
      // The commit's own facts already describe the import, and they reach the
      // journal as CLAIMED: the user chose the file and read the review screen.
      const result = await ctx.apply((s) => MutationResult.ok(s.withPolicy(proposed)));
      // The journal is not the policy, so nothing has redrawn it yet.
      if (result && result.ok) await ctx.refresh();
    },
  };

  global.SectionTransfer = Transfer;
})(globalThis);
