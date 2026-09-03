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
      if (file.size > global.ShortcutAdmission.MAX_TRANSFER_BYTES) {
        this.fail(t("importTooBig", "That file is too large to be a configuration."));
        return;
      }
      const parsed = global.ShortcutAdmission.parseJson(await file.text());
      if (!parsed.ok) {
        this.fail(RefusalPresentation.sentence(parsed));
        return;
      }
      const proposed = global.JumpPolicy.proposeImport(parsed.value);
      if (!proposed.ok) {
        this.fail(RefusalPresentation.sentence(proposed));
        return;
      }
      this.proposal = proposed;
      this.render(ctx.stored(), ctx);
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
