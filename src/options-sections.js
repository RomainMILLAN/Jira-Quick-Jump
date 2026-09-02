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

  /**
   * WHAT THIS FILE DEPENDS ON, all of it, in one place.
   *
   * There were two styles and no rule: twelve collaborators destructured here,
   * and four more reached through `global.X` at call time -- so a reader auditing
   * this module's couplings from its header missed a quarter of them.
   *
   * The split is REAL and it is kept, because the two groups differ:
   *
   *   captured here      -- everything loaded before this file, guaranteed by the
   *                         five loading lists that structure.test.js compares;
   *   read at call time  -- CustomEngine, JumpPolicy, PolicyRepository and
   *                         ShortcutAdmission, which sit behind a user gesture and
   *                         cost nothing to resolve late. Late resolution also
   *                         means a wrong rank in one of those lists surfaces as a
   *                         plain failure at the click rather than as `undefined`
   *                         captured at load.
   *
   * Named here so the header answers the question, whichever group a name is in.
   */
  const {
    Dom,
    Platform,
    MutationResult,
    ProjectKey,
    JiraInstance,
    SearchEngineCatalog,
    OriginRequirements,
    JumpPreview,
    ShortcutWarning,
    RowReorder,
    DiagnosisPresentation,
    CatchAllKey,
  } = global;
  const t = (k, f) => Platform.t(k, f);
  const el = Dom.el;

  const icon = (d, size = 14) =>
    el("svg", {
      width: size, height: size, viewBox: "0 0 24 24", fill: "none",
      stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round",
      "stroke-linejoin": "round", "aria-hidden": "true",
    }, [].concat(d).map((path) => el("path", { d: path })));

  const TRASH = "M4 6h16M9 6V4h6v2M18 6l-1 14H7L6 6";
  const CHEVRON_UP = "M6 15l6-6 6 6";
  /**
   * Six dots without widening the attribute whitelist: a zero-length subpath with
   * a round cap renders as a disc, so cx/cy/r never have to be allowed. icon() is
   * not reused -- it hardcodes stroke-width 2 on a 24-unit box, which would draw
   * 1.2px dots.
   */
  const GRIP_DOTS = ["M6 4h.01", "M6 8h.01", "M6 12h.01", "M10 4h.01", "M10 8h.01", "M10 12h.01"];
  const gripIcon = () =>
    el("svg", {
      width: 16, height: 16, viewBox: "0 0 16 16", fill: "none",
      stroke: "currentColor", "stroke-width": 2.5, "stroke-linecap": "round",
      "stroke-linejoin": "round", "aria-hidden": "true",
    }, GRIP_DOTS.map((d) => el("path", { d })));
  const CHEVRON_DOWN = "M6 9l6 6 6-6";

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
    reconcile() {
      /* No optimistic state to give up: this section writes through ctx.apply and
         never holds a pending order of its own. */
    },

    mount(root, ctx) {
      this.node = el("div", { class: "status" });
      this.banner = el("div", { class: "alert", hidden: true });
      root.appendChild(this.banner);
      root.appendChild(this.node);
      this.ctx = ctx;
    },

    /**
     * Paints the ALARMING state, and it must be SAFE ON AN UNMOUNTED SECTION.
     *
     * Being a total member of the protocol protects against the absence of the
     * MEMBER, not of the NODE -- so this guard is the only thing keeping the next
     * caller from reopening the hole, even now that mounting has moved up.
     *
     * It paints the CLASS, not just the text: what is GREEN on screen is
     * className === "tag ok". An implementation writing textContent and forgetting
     * the class would pass a textual witness WITH THE GREEN PILL LIT -- and
     * "Ready" is t("tagReady"), which in French is "Prêt", so a textual witness is
     * only green through the absence of an i18n fake.
     */
    blank() {
      if (!this.node) return;
      // MOUNTED BUT NEVER RENDERED is a real state, and it is the FIRST LOAD on an
      // unreadable policy -- measured. The span.tag is born in render(), which never
      // runs on that path, so a querySelector alone painted NOTHING and the status
      // line said nothing at all next to the host banner. The witness asks for the
      // tag to CARRY the alarming tone, so it is created when absent.
      let tag = this.node.querySelector(".tag");
      if (!tag) {
        tag = el("span", { class: "tag" });
        this.node.appendChild(tag);
      }
      tag.className = `tag ${DiagnosisPresentation.WORST}`;
      tag.textContent = DiagnosisPresentation.label("INSTALL_STATE_UNKNOWN");
      let sub = this.node.querySelector(".status-s");
      if (!sub) {
        sub = el("div", { class: "status-s" });
        this.node.appendChild(sub);
      }
      sub.textContent = DiagnosisPresentation.sentence("INSTALL_STATE_UNKNOWN");
    },

    /**
     * THE CATCH PAINTS. The twin of the presentation contract: a section that fails
     * leaves an ALARMING state, NEVER its placeholder.
     *
     * render() adds a span.tag.off of text "…" BEFORE its first await, so a throw in
     * ctx.report() -- the DNR-failure path -- used to leave the LEAST alarming of the
     * four tones on screen, permanently. A catch that merely "marks it as failed"
     * gets implemented as console.warn.
     */
    fail(error) {
      if (!this.node) return;
      const tag = this.node.querySelector(".tag");
      if (tag) {
        tag.className = `tag ${DiagnosisPresentation.WORST}`;
        tag.textContent = String((error && error.name) || "Error");
      }
      const sub = this.node.querySelector(".status-s");
      if (sub) sub.textContent = String((error && error.message) || error);
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

      /**
       * THE JOURNAL IS READ FIRST, AND THE BANNER RENDERED FIRST, IN ITS OWN try.
       *
       * The order used to be report() then journal.read(), with the banner mounted
       * hidden -- so a failing getDynamicRules NEVER DISPLAYED "A destination
       * changed", even with an unacknowledged UNKNOWN in the journal. The detector's
       * channel reads storage.local and was doing fine: it was being switched off by
       * the failure of a NEIGHBOURING organ. AN ORGAN OF PROOF NEVER DEPENDS ON THE
       * ORGAN NEXT TO IT ON SCREEN.
       *
       * And the fallback carries its DIRECTION, like the badge: an unreadable journal
       * SHOWS the banner saying the proof is unreadable, never the hidden
       * placeholder. A bare `catch {}` would leave the detector as mute as the DNR
       * failure did -- the same fault closed by the other door.
       */
      try {
        await this.renderBanner(ctx);
      } catch (error) {
        this.banner.hidden = false;
        Dom.clear(this.banner);
        this.banner.appendChild(el("div", {
          class: "alert-t",
          text: t("changedTitle", "A destination changed"),
        }));
        this.banner.appendChild(el("div", {
          class: "alert-s",
          text: t("journalUnreadable", "The change record could not be read."),
        }));
      }
      // A render suspended on the await above resumes and finishes its gesture --
      // over whatever blank() has painted in the meantime. Asked after EVERY await
      // that repaints, not just the first.
      if (ctx.condemned()) return;

      // getDynamicRules is async and the popup can close first: show a placeholder
      // rather than a transient 0, which reads as a failure.
      const report = await ctx.report();
      if (ctx.condemned()) return;
      const sub = this.node.querySelector(".status-s");
      if (sub) sub.textContent = DiagnosisPresentation.sentence(report.diagnosis);
      const tag = this.node.querySelector(".tag");
      if (tag) {
        tag.textContent = DiagnosisPresentation.label(report.diagnosis);
        tag.className = `tag ${DiagnosisPresentation.tone(report.diagnosis)}`;
      }
    },

    async renderBanner(ctx) {
      const entries = await ctx.journal.read();
      // UNSEEN EVIDENCE ONLY. The journal keeps the acts too -- it is the record
      // of what changed -- but an act the user performed is not an alarm, and a
      // fact they have already ticked off is not news.
      const facts = entries.unseen;
      this.banner.hidden = facts.length === 0;
      if (!this.banner.hidden) {
        Dom.clear(this.banner);
        // EVERY UNSEEN FACT, not just the newest one. It rendered `entries[0]`
        // alone, so nineteen of the twenty were never shown: the cap, the sticky
        // overflow marker and the per-commit limit all fed a surface that read one
        // line. Evidence kept and unreadable is evidence lost, only more
        // expensively. Bounded by MAX_ENTRIES, so the list cannot run away.
        this.banner.appendChild(el("div", {
          class: "alert-t",
          text: facts.length > 1
            ? t("changedTitleMany", "Destinations changed")
            : t("changedTitle", "A destination changed"),
        }));
        for (const fact of facts) {
          this.banner.appendChild(el("div", { class: "alert-s" }, FACT_SENTENCE(fact)));
        }
        if (entries.overflowed) {
          // STICKY, and it says the evidence is MISSING rather than merely that
          // something overflowed. A camera that no longer films is useless; one
          // that says "tape full" is worth half a tape.
          this.banner.appendChild(el("div", {
            class: "row-msg pending",
            text: t("journalOverflowed", "Some changes could not be recorded."),
          }));
        }
        this.banner.appendChild(el("div", { class: "btn-row" }, [
          el("button", {
            class: "btn", text: t("changedAck", "I have checked it"),
            onClick: async () => {
              await ctx.journal.acknowledgeAll();
              // ctx.refresh() rather than a direct render call: those bypass BOTH
              // the per-section try/catch AND the coalescing, and this one
              // repainted the reassuring "…" placeholder before awaiting -- so a
              // throw left it on screen for good, on the gesture the user makes
              // JUST AFTER seeing the compromise banner. A full repaint is wanted
              // here anyway: the banner has just changed state.
              await ctx.refresh();
            },
          }),
        ]));
      }
    },
  };

  /**
   * One sentence per fact TYPE, as a table.
   *
   * The banner used to read `last.key` and `last.newBaseUrl` flat, which was true
   * when there was only one kind of fact. ShadowingChanged has no `key` and
   * PolicyReplaced has neither, so the surface whose whole job is to be believed
   * would render `undefined`. Composed from DOM NODES rather than concatenated
   * strings, so no label depends on English word order.
   */
  const FACT_SENTENCE = (fact) => {
    const host = (text) => el("span", { class: "dest host", text });
    const plain = (text) => el("span", { class: "dest", text });
    switch (fact.type) {
      case "ShortcutAppeared":
      case "CatchAllAppeared":
        return [
          plain(fact.key || t("catchAllKey", "Any short key")),
          " ",
          t("factAppeared", "was added, pointing to"),
          " ",
          host(fact.baseUrl),
          ".",
        ];
      case "ShortcutRemoved":
      case "CatchAllRemoved":
        return [
          plain(fact.key || t("catchAllKey", "Any short key")),
          " ",
          t("factRemoved", "was removed. It pointed to"),
          " ",
          host(fact.baseUrl),
          ".",
        ];
      case "ShadowingChanged":
        // TWO FACTS, BECAUSE THEY ARE TWO. The single sentence read "these keys now
        // go to the catch-all", which is FALSE for a key of more than six
        // characters or a reserved prefix: the catch-all does not claim those at
        // all, so they are not intercepted any more and leave IN CLEAR for the
        // search engine. The wrong destination, named on the surface whose whole
        // job is to be believed -- and wrong in the reassuring direction.
        return [
          t("factShadowedStopped", "These keys no longer fire, because the catch-all moved above them:"),
          " ",
          plain(fact.affectedKeys.join(", ")),
          ". ",
          t("factShadowedClaims", "What the catch-all does claim goes to"),
          " ",
          host(fact.catchAllBaseUrl),
          ".",
        ];
      case "PolicyReplaced":
        return [t("factReplaced", "The whole configuration changed elsewhere. Check every destination.")];
      case "KeyChanged":
        return [
          plain(fact.oldKey),
          " ",
          t("factKeyChanged", "no longer intercepts what it did; the key is now"),
          " ",
          plain(fact.newKey),
          ". ",
          t("changedNow", "now points to"),
          " ",
          host(fact.baseUrl),
          ".",
        ];
      case "ShortcutArmed":
        return [
          plain(fact.key || t("catchAllKey", "Any short key")),
          " ",
          t("factArmed", "was armed and now redirects to"),
          " ",
          host(fact.baseUrl),
          ".",
        ];
      case "EnginesAdded":
        return [
          t("factEnginesAdded", "More search engines are intercepted than before. Check the Access section."),
        ];
      case "PolicyArmed":
        return [t("factPolicyArmed",
          "The extension was switched back on elsewhere, and every shortcut redirects again.")];
      case "PolicyUnreadable":
        // The path a compromised sync reaches most easily, and it used to be
        // mute: purge, badge to `off`, not one line anywhere.
        return [t("factUnreadable",
          "What was saved stopped being readable, so nothing is installed. Check every destination.")];
      default:
        return [
          plain(fact.key),
          " ",
          t("changedNow", "now points to"),
          " ",
          host(fact.newBaseUrl),
          ". ",
          t("changedWas", "It used to point to"),
          " ",
          plain(fact.oldBaseUrl),
          ".",
        ];
    }
  };

  // The core returns a CODE; the sentence is written here, and therefore
  // translated here. Built lazily: t() reads the browser's locale, which is not
  // available while this file is still being evaluated in a service worker.
  /**
   * The four warning messages never went through t(), so the French build was
   * half English on exactly the screens this feature adds. Lazy, like DIAGNOSIS
   * below: t() reads the locale, which is not available while this file is still
   * being evaluated in a service worker.
   */
  const WARNING_MESSAGE = () => ({
    INSECURE_SCHEME: t("warnInsecureScheme", "Traffic and your Jira session cookie travel in clear text."),
    INTERNAL_HOST: t("warnInternalHost", "This destination is on a private or non-public network."),
    LITERAL_IP: t("warnLiteralIp", "This destination is an IP address rather than a host name."),
    PUNYCODE: t("warnPunycode", "This host name uses non-ASCII characters and may imitate another one."),
    CATCH_ALL: t("warnCatchAll", "Every search shaped like a 2-to-6-character key, a hyphen and a number will leave for this destination, on each engine you ticked. Only a short reserved list is held back."),
  });

  /**
   * The three parallel tables that lived here -- DIAGNOSIS, TAG_TEXT, TAG_TONE --
   * are now ONE table in ui/diagnosis-presentation.js, whose CONSTRUCTION refuses
   * an incomplete catalogue. Only TAG_TONE ever had a fallback, and it was
   * `|| "off"`: the LEAST alarming tone applied to the code that says "I do not
   * know whether jumps are departing".
   */

  /**
   * What a move did to the row that moved, as a CATALOGUE keyed by a TRIPLET --
   * not a chain of ifs, and not a pair.
   *
   * The key is (was shadowed, the resulting status, the direction), because a move
   * with NO change of shadowing is the majority case and must keep saying which way
   * it went. A pair would have left that case with no entry, and the next reader
   * would either drop the direction or bolt an `if` in front of the table.
   *
   * ONE JUDGE, ONE CALL. `SHADOWED` is the FIRST test in statusOf's chain, so
   * asking the aggregate for the status IS asking the registry whether the row is
   * shadowed -- identically, not approximately. The transition therefore needs no
   * separate reading, and this file never has to reach past the aggregate to its
   * collection (a structure test holds that line, comments included). What
   * guarantees the equivalence is the order at jump-policy.js:172-175, and that is
   * why that order does not get rearranged.
   *
   * AND THE ASYMMETRY, which is the whole reason this is a catalogue:
   *
   *   shadowed  =>  never fires   (unconditional, safe to promise)
   *   not shadowed  =/=>  fires   (three other doors can be shut)
   *
   * An unlocked door is not an open door. So only the "now shadowed" direction may
   * promise anything about firing; coming back out, the sentence stops at "no
   * longer shadowed" unless the status is actually ACTIVE. Saying "it fires again"
   * to a screen-reader user about a row that is merely awaiting an
   * acknowledgement would be a lie in the only channel that speaks to them.
   *
   * It is also a THIRD comparator of two states, and deliberately so. PolicyDiff
   * answers "what changed, for the journal" -- in a batch, only newlyShadowed,
   * inside the commit closure. This answers "what does THIS gesture do to THIS
   * row, before writing it" -- for one id, in both directions. Same material, two
   * questions, neither can answer for the other.
   */
  const sentenceFor = (before, after, id, movedUp) => {
    const wasShadowed = before.statusOf(id) === "SHADOWED";
    const status = after.statusOf(id);
    if (!wasShadowed && status === "SHADOWED") {
      return t("nowShadowed", "Now shadowed: this shortcut no longer fires.");
    }
    if (wasShadowed && status !== "SHADOWED") {
      return status === "ACTIVE"
        ? t("noLongerShadowedActive", "No longer shadowed: this shortcut fires again.")
        : t("noLongerShadowed", "No longer shadowed.");
    }
    return movedUp ? t("movedUp", "Moved up.") : t("movedDown", "Moved down.");
  };

  // ------------------------------------------------------------- Shortcuts

  const Shortcuts = {
    drafts: [],
    // The OPTIMISTIC order: an array of ids while a coalesced write is pending,
    // null otherwise. section-host re-renders this subtree (isEditing only
    // protects INPUT and TEXTAREA), so it has to survive a redraw.
    order: undefined,

    mount(root, ctx) {
      root.appendChild(label(
        t("shortcuts", "Shortcuts"),
        t("orderNote", "Evaluated from top to bottom. The first match wins.")
      ));
      // An <ol>, so screen readers announce "item 2 of 5" NATIVELY, in the
      // reader's own language, with zero strings to translate. Which is why the
      // placeholder ban in the locale test is not weakened for an aria-label.
      this.rows = el("ol", { class: "rows" });
      // NOT assigned to an attribute: sections have no teardown, SectionHost.stop
      // never calls them, and the listeners live as long as this.rows -- which
      // render only ever empties of its children. Storing a handle would promise a
      // lifecycle nobody implements, and this section already carries five
      // attributes where the project's rule allows four.
      RowReorder.on(this.rows, {
        // NOT counted off the DOM: drafts are appended after the saved rows, so an
        // index read from the list's children would be wrong.
        orderedIds: () => this.orderToShow(ctx.stored()),
        moveTo: (id, toIndex) => this.moveTo(id, toIndex, ctx),
      });
      this.announcer = el("div", {
        class: "sr-only", role: "status", "aria-live": "polite", "aria-atomic": true,
      });
      root.appendChild(this.rows);
      root.appendChild(this.announcer);
      this.actions = el("div", { class: "btn-row shortcuts-actions" });
      root.appendChild(this.actions);
      this.hint = el("p", { class: "hint", id: "catch-all-exists", hidden: true });
      root.appendChild(this.hint);
    },

    announce(sentence) {
      if (this.announcer) this.announcer.textContent = sentence;
    },

    /**
     * A PURE READ of the optimistic order. It used to reconcile as well -- a
     * getter with a side effect on the very state it reported, called from render
     * AND from move. Reconciling belongs to reconcile, and it has a name.
     */
    orderToShow(stored) {
      return this.order || stored.policy().orderedIds();
    },

    /**
     * ABANDONS A COMMAND THAT BECAME UNSATISFIABLE, AND SAYS SO.
     *
     * That is what this is -- a compensating action -- and the name explains its
     * three constraints at once: it runs BEFORE the host's latch (the command
     * leaves by a timer, not by the render, so a frozen view must not be able to
     * strand it), it must SPEAK (a silent compensation is data loss for the user,
     * in a product whose README says reordering IS a change of destination), and
     * it must NOT redraw (it is not a view).
     *
     * Not "no DOM": it may write the live region, which sits outside the subtree
     * render clears. And it announces CONSTANTS only -- routing storage text
     * through a path the freeze hides from the tests would be the best place for a
     * future injection.
     *
     * Idempotent: a second pass finds this.order already null and returns.
     *
     * The project has another `reconcile`, in background.js, which reconciles the
     * INSTALLED RULES against the policy and produces facts. Different subject,
     * same verb; the host calls this one generically on every section, so the name
     * has to stay generic.
     *
     * Nothing to blank: this section paints no verdict of its own, so a condemned
     * page leaves it stale rather than lying. DECLARED rather than absent, because
     * an optional protocol member is a presence test -- the null this repository
     * bans everywhere else -- and structure.test.js pins that all eight declare it.
     */
    blank() {
    },
    reconcile(stored, ctx) {
      if (!this.order) return;
      const ids = stored.policy().orderedIds();
      const sameSet =
        this.order.length === ids.length && this.order.every((id) => ids.includes(id));
      if (!sameSet) {
        this.order = undefined;
        ctx.cancel("shortcuts:order");
        this.announce(t("orderDropped", "The list changed, so your move was dropped."));
        return;
      }
      if (this.order.every((id, i) => id === ids[i])) this.order = null; // storage caught up
    },

    /**
     * THE ONLY place the order is written, shared by the arrows and the drop.
     *
     * `toIndex` is an index in the list as displayed. The intention that crosses
     * the boundary is ABSOLUTE (`withOrder(ids)` carries the whole list), because
     * VersionedEntry replays it on a value that may already contain its own
     * effect: the UI gesture is relative, the intention never is.
     */
    moveTo(id, toIndex, ctx, focus) {
      const policy = ctx.stored().policy();
      const shown = [...this.orderToShow(ctx.stored())];
      const from = shown.indexOf(id);
      if (from < 0) return false;
      if (toIndex < 0 || toIndex >= shown.length) {
        this.announce(toIndex < 0
          ? t("alreadyFirst", "Already first.")
          : t("alreadyLast", "Already last."));
        return false;
      }
      if (toIndex === from) return false; // a no-op deserves silence

      // The DOMAIN judges the outcome, on the future. withOrder is a
      // side-effect-free function: it returns a new policy and writes nothing.
      // Both predictions are guarded TOGETHER -- the splice preserves the id set,
      // so they are refused together, and guarding one alone would make one fail
      // closed and the other throw. Unreachable by construction (reconcile
      // guarantees the set is equal), kept fail-closed. The message comes from the
      // domain: withOrder carries ORDER_STALE, _guarded carries BINDING_LIMIT and
      // SHORTCUT_LIMIT -- so raising a row above the catch-all can be refused for
      // rule budget, and the prediction refuses BEFORE writing where move() used
      // to write first and find out after.
      const before = policy.withOrder(shown);
      shown.splice(toIndex, 0, ...shown.splice(from, 1));
      const after = policy.withOrder(shown);
      if (!before.ok || !after.ok) {
        this.announce(RefusalPresentation.sentence(before.ok ? after : before));
        return false;
      }

      this.order = shown;
      ctx.applyToPolicy((p) => p.withOrder(shown), "shortcuts:order");
      this.render(ctx.stored(), ctx, focus ? { focus } : {});
      this.announce(sentenceFor(before.value, after.value, id, toIndex < from));
      // The boolean says "something moved", for the arrows (which decide the
      // focus) and for the tests. It carries no interpretation: the user has
      // already been told, through the live region.
      //
      // AND THE PREDICTION NEVER LEAVES THIS METHOD. section-host.js: "Sections
      // hand over an INTENTION, never a snapshot." Committing `after.value`
      // instead would be one line shorter and would reduce the compare-and-set to
      // a set. A prediction is a quote, not an invoice.
      return true;
    },

    move(id, delta, stored, ctx) {
      const shown = this.orderToShow(stored);
      // "Is this row at the edge of what is displayed" is a question about the
      // VIEW -- it is literally the predicate that paints aria-disabled on the
      // arrows -- so it stays here, and moveTo answers it too for the drop path.
      this.moveTo(id, shown.indexOf(id) + delta, ctx, { id, delta });
    },

    render(stored, ctx, options = {}) {
      const policy = stored.policy();
      const ordered = this.orderToShow(stored);
      Dom.clear(this.rows);
      let toFocus = undefined;
      ordered.forEach((id, index) => {
        const shortcut = policy.shortcutFor(id);
        if (!shortcut) return;
        const row = this.savedRow(shortcut, ctx, {
          policy,
          index,
          total: ordered.length,
          onMove: (delta) => this.move(id, delta, ctx.stored(), ctx),
        });
        this.rows.appendChild(row.node);
        if (options.focus && options.focus.id === id) {
          // The reference of the node we just built, never a querySelector with
          // an interpolated data-id: that would be a selector injection in a page
          // running with the extension's own privileges.
          toFocus = () => row.focusArrow(options.focus.delta);
        }
      });
      for (const draft of this.drafts) {
        this.rows.appendChild(this.draftRow(draft, ctx));
      }
      this.renderActions(policy, ctx);
      if (toFocus) toFocus();
    },

    renderActions(policy, ctx) {
      Dom.clear(this.actions);
      this.actions.appendChild(el("button", {
        class: "btn", text: t("addShortcut", "Add shortcut"),
        onClick: () => {
          this.drafts.push({ rowId: crypto.randomUUID(), key: "", url: "", catchAll: false, error: "" });
          this.render(ctx.stored(), ctx);
        },
      }));
      const existing = policy.catchAllShortcut();
      this.actions.appendChild(el("button", {
        class: "btn", text: t("addCatchAll", "Add a catch-all"),
        // The model would refuse a second one, but the UI must not offer a
        // doomed click -- and it says why.
        "aria-disabled": existing !== undefined,
        "aria-describedby": existing ? "catch-all-exists" : undefined,
        onClick: () => {
          if (policy.catchAllShortcut()) {
            this.announce(t("catchAllExists", "There can only be one catch-all."));
            return;
          }
          this.drafts.push({ rowId: crypto.randomUUID(), key: "", url: "", catchAll: true, error: "" });
          this.render(ctx.stored(), ctx);
        },
      }));
      if (existing) {
        // A <p class="hint">, not a span.note: the CSS only defines `.lbl .note` as
        // a descendant, so a note outside a label rendered as unstyled body text.
        // AFTER the button row, not inside it -- and it KEEPS its id, which is the
        // target of the button's aria-describedby: losing that would turn a visual
        // fix into an accessibility regression.
        this.hint.textContent = t("catchAllExists", "There can only be one catch-all.");
        this.hint.hidden = false;
      } else {
        this.hint.textContent = "";
        this.hint.hidden = true;
      }
    },

    setArmed(id, desired, ctx) {
      return ctx.apply((s) => {
        const policy = s.policy();
        const next = desired ? policy.armShortcut(id) : policy.disarmShortcut(id);
        return next.ok ? MutationResult.ok(s.withPolicy(next.value), next.events) : next;
      });
    },

    savedRow(shortcut, ctx, { policy, index, total, onMove }) {
      const id = shortcut.id();
      const pending = shortcut.unacknowledgedWarnings();
      // statusOf is the SOLE judge of a row, so the row's vocabulary is the one
      // diagnose() speaks and two places never qualify the same line.
      const status = policy.statusOf(id);
      const isCatchAll = shortcut.key().isCatchAll();

      const orderArrow = (path, delta, ariaLabel, atEdge) =>
        el("button", {
          class: "btn icon move", "aria-label": ariaLabel,
          // aria-disabled, never disabled: a disabled button is not focusable, so
          // moving a row to the top would drop focus to <body>.
          "aria-disabled": atEdge,
          "data-field": delta < 0 ? "move-up" : "move-down",
          onClick: () => onMove(delta),
        }, [icon(path, 12)]);

      const moveUp = isCatchAll ? null : orderArrow(CHEVRON_UP, -1, t("moveUp", "Move up"), index === 0);
      const moveDown = isCatchAll ? null : orderArrow(CHEVRON_DOWN, 1, t("moveDown", "Move down"), index === total - 1);

      // NO HANDLE AND NO ARROWS ON THE CATCH-ALL, and the two halves of that are
      // different in kind. Pinning it as a DRAGGABLE OBJECT is an affordance
      // restriction: the model keeps withOrder entirely free, an import can still
      // put it first, and PolicyDiff still emits ShadowingChanged. It is the same
      // pattern as registerAboveCatchAll (which puts "born above the catch-all"
      // behind a named door inside the membrane while the registry always appends)
      // and as the Add-a-catch-all button's aria-disabled.
      //
      // Free ordering survives from the other end: a NAMED key crosses it, and
      // moveTo splices the whole list, so every relative arrangement stays
      // reachable from the keyboard -- by adjacent swaps in which the catch-all is
      // moved, pushed by the others, never picked up.
      //
      // And the mechanism is the ABSENCE of a handle, not a rule: no .f-grip means
      // dragstart never begins here, while the data-id keeps it a valid drop
      // target. That is why RowReorder has no notion of an undraggable row.
      //
      // The cell itself is not rendered at all: .f-ord and .f-grip have FIXED
      // widths precisely so that an empty track still holds its column.
      const grip = isCatchAll ? null : Dom.dragHandle([gripIcon()]);

      const reasonId = `why-${id}`;
      const row = el("li", {
        class: `row${pending.length > 0 ? " is-pending" : ""}${status === "SHADOWED" ? " is-shadowed" : ""}`,
        "data-id": id,
      }, [
        el("div", { class: "f-grip-cell" }, grip ? [grip] : []),
        el("div", { class: "f-ord" }, moveUp ? [moveUp, moveDown] : []),
        el("div", { class: "f-key" }, [el("div", { class: "field-label", text: t("key", "Key") }),
          isCatchAll
            ? el("div", { class: "f key is-static" }, [
                el("span", { text: t("catchAllKey", "Any short key") }),
                el("code", { text: shortcut.key().toString() }),
              ])
            : el("input", {
                class: "f key", value: shortcut.key().toString(),
                "aria-label": t("key", "Key"),
                onInput: (event) => this.editKey(event.target, id, ctx),
              }),
        ]),
        el("div", { class: "f-url" }, [
          el("div", { class: "field-label", text: t("destination", "Destination") }),
          el("input", {
            class: "f", value: shortcut.instance().baseUrl(),
            "aria-label": t("destination", "Destination"),
            "aria-describedby": status === "SHADOWED" ? reasonId : undefined,
            onInput: (event) => this.editUrl(event.target, id, ctx),
          }),
        ]),
        el("div", { class: "f-arm" }, [toggle(
          shortcut.armed(),
          // ABSOLUTE, never a flip: the user saw an off switch and asked for on.
          () => this.setArmed(id, !shortcut.armed(), ctx),
          t("armThis", "Arm this shortcut"),
          pending.length > 0,
        )]),
        el("div", { class: "f-del" }, [el("button", {
          class: "btn icon", "aria-label": t("remove", "Remove this shortcut"),
          onClick: () => ctx.applyToPolicy((p) => p.remove(id)),
        }, [icon(TRASH)])]),
      ]);

      if (status === "SHADOWED") {
        // A text chip, because state colour must never be the only signal -- and a
        // WRITTEN reason, referenced by aria-describedby so a screen-reader user
        // hears WHY rather than meeting a grey box. Every control stays operable:
        // the row has to be movable back up, or deleted.
        row.appendChild(el("span", { class: "tag off", text: t("shadowed", "Shadowed") }));
        row.appendChild(el("div", {
          class: "row-msg pending", id: reasonId,
          text: t("shadowedWhy", "A line placed below the catch-all never fires, whatever its key. Move it above the catch-all."),
        }));
      }

      if (pending.length > 0) {
        row.appendChild(el("div", { class: "acks" }, [
          ...pending.map((warning) => el("label", { class: "ack" }, [
            el("input", {
              type: "checkbox",
              onChange: () => ctx.applyToPolicy((p) => p.acknowledge(id, warning.kind)),
            }),
            WARNING_MESSAGE()[warning.kind] || warning.message,
          ])),
          // Two independent high-severity warnings whose COMPOSITION means
          // something neither says alone. A UI sentence, assembled from DOM nodes
          // -- not a catalogue entry, which would belong to no scope and be
          // forgotten on every keystroke in the destination field.
          pending.some((w) => w.kind === "CATCH_ALL") && pending.some((w) => w.kind === "INSECURE_SCHEME")
            ? el("span", { class: "row-msg pending", text: t("catchAllInsecure", "Together: every search shaped like a short key will leave in clear text.") })
            : null,
          el("span", { class: "row-msg pending", text: t("ackBlocks", "Arming stays unavailable until these are accepted.") }),
        ]));
      }
      // ONE member, not an inventory of parts: the only use was row.moveUp.focus(),
      // i.e. two getters for one call. When the handle or a future button arrive,
      // this interface does not move.
      return {
        node: row,
        focusArrow: (delta) => {
          const button = delta < 0 ? moveUp : moveDown;
          if (button) button.focus();
        },
      };
    },

    draftRow(draft, ctx) {
      // The refusal SURVIVES a repaint. It was a node created hidden on every
      // render, so `draft.key` and `draft.url` came back and the reason they were
      // refused did not: the user faced a visibly wrong field with nothing to
      // explain it.
      const message = el("div", {
        class: "row-msg refused",
        hidden: !draft.error,
        text: draft.error || "",
      });
      // The catch-all draft has NO key field at all: the Key input never sees `*`,
      // at any point. The UI expresses a gesture and the core forges the key.
      // No written form here: it belongs to the key, and a draft has no key yet.
      // The saved row shows it, from shortcut.key().toString().
      const keyCell = draft.catchAll
        ? el("div", { class: "f key is-static" }, [
            el("span", { text: t("catchAllKey", "Any short key") }),
          ])
        : el("input", {
            class: "f key", placeholder: "ABC", value: draft.key, "aria-label": t("key", "Key"),
            onInput: (event) => { draft.key = event.target.value; this.tryRegister(draft, row, message, ctx); },
          });
      const row = el("li", { class: "row" }, [
        // Two EMPTY command cells, and no decorative controls in them. A draft has
        // no position in the configuration yet, so it has no position to command --
        // exactly like the catch-all above. It is the FIXED WIDTH of .f-grip-cell
        // and .f-ord that aligns the card with the saved rows, not a control; and
        // disabled arrows here would have had to break one of the two house rules
        // (never `disabled` on the arrows, `disabled` on the draft's inert switch).
        el("div", { class: "f-grip-cell" }),
        el("div", { class: "f-ord" }),
        el("div", { class: "f-key" }, [
          el("div", { class: "field-label", text: t("key", "Key") }),
          keyCell,
        ]),
        el("div", { class: "f-url" }, [
          el("div", { class: "field-label", text: t("destination", "Destination") }),
          el("input", {
            class: "f", placeholder: "example.atlassian.net", value: draft.url,
            "aria-label": t("destination", "Destination"),
            "aria-describedby": draft.catchAll ? "catch-all-note" : undefined,
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
        draft.catchAll
          ? el("div", {
              class: "row-msg pending", id: "catch-all-note",
              // THE BOUNDS COME FROM THEIR OWNERS. They were written into the sentence --
              // "2-to-6" -- in two places and two languages, with no link to
              // CatchAllKey.claimsKeysUpTo() or to the key validator. Lowering either
              // left the UI lying in both languages, and the i18n test stayed green
              // because it compares the code to the catalogue, never to the truth.
              text: catchAllNote(),
            })
          : null,
        message,
      ]);
      return row;
    },

    /** Validation runs on every keystroke; the write only happens once both parse. */
    async tryRegister(draft, row, message, ctx) {
      // A catch-all draft has no key to parse: only its destination.
      const key = draft.catchAll ? { ok: true } : ProjectKey.parse(draft.key);
      const instance = JiraInstance.parse(draft.url);
      // WRITTEN AS THE RULE IT IS. A nested ternary encoded a display policy --
      // "do not shout at a field the user has not filled in yet" -- and the case
      // where BOTH are wrong showed only one of the two reasons.
      const typed = (raw, parsed) => (raw !== "" && !parsed.ok ? parsed : undefined);
      const failure = typed(draft.key, key) ?? typed(draft.url, instance);
      // `undefined`, because `typed()` returns undefined. Replacing the ternary
      // without moving these two comparisons left `failure` never equal to null,
      // so EVERY draft row wore the red refusal border from the first keystroke --
      // including when nothing was wrong.
      message.hidden = failure === undefined;
      message.textContent = failure ? RefusalPresentation.sentence(failure) : "";
      row.classList.toggle("is-refused", failure !== undefined);
      if (!key.ok || !instance.ok) return;

      // THE DRAFT IS DROPPED ONLY ONCE THE WRITE IS ACCEPTED.
      //
      // It was removed FIRST, and the promise was not awaited. On a refusal --
      // DUPLICATE_KEY, DUPLICATE_CATCH_ALL, SHORTCUT_LIMIT, BINDING_LIMIT --
      // commit() does not reload, so the row stayed on screen while no longer
      // being in `drafts`: the user went on typing into a dead object, and at the
      // next render the row vanished with everything they had written. Losing
      // someone's typing right after telling them their input was refused is the
      // one thing this page must never do.
      const id = draft.rowId;
      draft.pending = true;
      const written = await ctx.applyToPolicy((policy) =>
        draft.catchAll
          ? policy.registerCatchAll(id, instance.value)
          // The named door that keeps "a shortcut is useless below the catch-all"
          // inside the membrane, and composes register + withOrder there.
          : policy.registerAboveCatchAll(id, key.value, instance.value));
      draft.pending = false;
      if (!written || !written.ok) {
        // The refusal is shown ON THE ROW, where the correction happens, and the
        // draft keeps everything that was typed.
        draft.error = RefusalPresentation.sentence(written);
        message.hidden = draft.error === "";
        message.textContent = draft.error;
        row.classList.toggle("is-refused", draft.error !== "");
        return;
      }
      draft.error = "";
      this.drafts = this.drafts.filter((d) => d !== draft);
    },

    editKey(input, id, ctx) {
      // ProjectKey.parse, deliberately: the typed field is NOT the storage door,
      // and the only door that turns a string into a catch-all key must stay out
      // of this file. A structure test greps for it literally, comments included.
      const parsed = ProjectKey.parse(input.value);
      input.setAttribute("aria-invalid", String(!parsed.ok));
      if (!parsed.ok) return;
      ctx.applyToPolicy((policy) => policy.withKeyFor(id, parsed.value), `shortcut:${id}:key`);
    },

    editUrl(input, id, ctx) {
      const parsed = JiraInstance.parse(input.value);
      input.setAttribute("aria-invalid", String(!parsed.ok));
      if (!parsed.ok) return;
      ctx.applyToPolicy((policy) => policy.withBaseUrlFor(id, parsed.value), `shortcut:${id}:baseUrl`);
    },
  };

  // --------------------------------------------------------------- Engines

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

  // ---------------------------------------------------------------- Access

  const Access = {
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

  // --------------------------------------------------------- Test & transfer

  const Preview = {
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
      root.appendChild(label(
        t("tryIt", "Try a URL"),
        t("previewTypedHint", "Paste a search URL, or just the text you would type in the address bar.")
      ));
      this.input = el("input", {
        class: "f", placeholder: "ABC-1234",
        "aria-label": t("tryIt", "Try a URL"),
        onInput: () => this.preview(ctx),
      });
      this.out = el("div", { class: "preview empty", text: t("tryItEmpty", "Nothing yet.") });
      this.why = el("div", { class: "preview-why" });
      root.appendChild(this.input);
      root.appendChild(this.out);
      root.appendChild(this.why);
    },

    render() {
      /* Stateless: the preview only reflects what is typed into it. Every gesture
         receives its ctx, so nothing is stored -- the field that used to be kept
         here had no reader at all. */
    },

    async preview(ctx) {
      // A THROW HERE MUST NOT BE SILENT. This handler is called from onInput, so its
      // promise is floating: without this catch, anything that throws downstream --
      // a rule read back from the store in a shape we cannot parse, most of all --
      // leaves the PREVIOUS verdict on screen. A stale "Matched a named shortcut" is
      // worse than no answer, and it is indistinguishable from the initial state.
      //
      // rule-ranking.js accepts a canary throw precisely because this exists: the
      // fail-fast door now opens onto someone who is listening.
      try {
        await this.evaluate(ctx);
      } catch (error) {
        Dom.clear(this.out);
        Dom.clear(this.why);
        this.out.className = "preview empty";
        this.out.textContent = t("previewUnavailable", "Could not read the installed rules.");
      }
    },

    async evaluate(ctx) {
      const typed = this.input.value.trim();
      Dom.clear(this.out);
      Dom.clear(this.why);

      // AN EMPTY FIELD IS NOT A FAILED ANSWER. It fell through to
      // forSearchUrl(""), where `new URL("")` throws, and the screen read "That is
      // not a URL." over a field the user had merely cleared.
      if (typed === "") {
        this.out.className = "preview empty";
        this.out.textContent = t("tryItEmpty", "Nothing yet.");
        return;
      }

      // The rules AS INSTALLED, memoised per render by section-host -- never
      // fetched per keystroke.
      const report = await ctx.report();
      const rules = report.rules || [];
      const policy = ctx.stored().policy();
      const catalog = SearchEngineCatalog.forPolicy(policy);
      const engineIds = policy.engineIds();

      // NO ENGINE IS ITS OWN ANSWER, and it used to borrow someone else's. With
      // nothing ticked, `catalog.find(undefined)` handed forTypedText an absent
      // engine, which answered NOT_A_SEARCH_URL -- so the screen blamed the text
      // for a configuration problem. The organ built to be believed said the
      // wrong thing about the one question it exists for.
      if (engineIds.length === 0) {
        this.out.className = "preview empty";
        this.out.textContent = PREVIEW_MISS().NO_ENGINES;
        return;
      }

      // TWO NAMED DOORS, and the UI arbitrates ON WHAT IT KNOWS -- the shape of
      // the input -- rather than on the other door's refusal code. Testing
      // `result.code === "NOT_A_URL"` made the fallback depend on a refusal
      // internal to forSearchUrl: renaming that code would have silently sent
      // every typed reference down the wrong door. A scheme test, not "contains a
      // space": `covid 19` and `iso 9001` are exactly the forms this screen
      // exists for.
      const pasted = /^https?:\/\//i.test(typed);

      // EVERY TICKED ENGINE, not the first one in an array. With Bing and
      // DuckDuckGo ticked the verdict was computed for whichever sat at index
      // zero, and nothing said so. They do not share a shape, so the answers can
      // genuinely differ; the honest screen is the one that agrees across all of
      // them, and names the engine when they disagree.
      let result;
      let disagreeing;
      if (pasted) {
        result = JumpPreview.forSearchUrl(typed, rules);
      } else {
        const verdicts = engineIds
          .map((id) => ({ id, engine: catalog.find(id) }))
          .filter(({ engine }) => engine !== undefined)
          .map(({ id, engine }) => ({ id, verdict: JumpPreview.forTypedText(typed, rules, engine) }));
        result = verdicts.length > 0 ? verdicts[0].verdict : { ok: false, code: "NO_ENGINES" };
        disagreeing = verdicts.find(({ verdict }) => verdict.code !== result.code);
      }

      if (disagreeing) {
        this.out.className = "preview empty";
        this.out.textContent = t("previewEngineDisagreement",
          "The answer depends on which search engine the address bar uses.");
        return;
      }

      if (!result.ok) {
        this.out.className = "preview empty";
        this.out.textContent = PREVIEW_MISS()[result.code] || result.code;
        if (result.code === "RESERVED_PREFIX") {
          // THE sentence that makes the reserved prefixes verifiable by the user.
          // A control the user cannot verify is not a control.
          this.why.appendChild(el("span", { text: t("previewReservedPrefix", "Held back by a reserved prefix, so the catch-all leaves it alone.") }));
        }
        return;
      }
      this.out.className = "preview";
      const url = new URL(result.destination);
      this.out.appendChild(el("span", { class: "host", text: url.origin }));
      // Rendered AS IT IS, lower case included: the honest display is the point.
      this.out.appendChild(el("span", { class: "path", text: url.pathname }));
      this.why.appendChild(el("span", {
        text: result.code === "MATCHED_CATCH_ALL"
          ? t("previewMatchedCatchAll", "Matched the catch-all.")
          : t("previewMatchedShortcut", "Matched a named shortcut."),
      }));
      if (report.skipped && report.skipped.length > 0) {
        this.why.appendChild(el("span", {
          class: "row-msg pending",
          text: t("installDiffers", "The installed configuration differs from the one you see."),
        }));
        // AND WHY, not merely that. Six named causes existed -- RUN_OVER_BUDGET,
        // GUARDS_NOT_A_PARTITION, PREFIX_NOT_KEY_SHAPED, REGEX_UNSUPPORTED,
        // UNIT_INCOMPLETE, UNKNOWN_ENGINE -- and reached a `.length`. A
        // configuration that produces no rule must explain itself; a counter is
        // not an explanation.
        for (const cause of report.skipped) {
          this.why.appendChild(el("span", {
            class: "row-msg pending",
            // THE SUBJECT IS TRANSLATED TOO when it is one of the named reasons.
            // RUN_OVER_BUDGET and its siblings arrive as the SUBJECT of
            // CONSTRUCTION_REFUSED, never as a code -- so listing them among the
            // codes left three dead entries while the user read a raw enum inside
            // a translated sentence.
            text: [
              SKIPPED_SENTENCE()[cause.code] || cause.code,
              SKIPPED_SENTENCE()[cause.subject] || cause.subject,
            ].filter(Boolean).join(" "),
          }));
        }
      }
    },
  };

  /** One sentence per named cause, so a refusal explains itself. */
  const SKIPPED_SENTENCE = () => ({
    UNKNOWN_ENGINE: t("skipUnknownEngine", "A ticked search engine is no longer known."),
    REGEX_UNSUPPORTED: t("skipRegexUnsupported", "The browser refused the pattern for this rule."),
    UNIT_INCOMPLETE: t("skipUnitIncomplete", "This rule was dropped with the group it belongs to."),
    CONSTRUCTION_REFUSED: t("skipConstructionRefused", "The rules could not be built."),
    RUN_OVER_BUDGET: t("skipRunOverBudget", "The reserved-prefix guard is too long for the browser."),
    ENVELOPE_OVER_BUDGET: t("skipEnvelopeOverBudget", "This search engine's address leaves no room for a rule."),
    KEY_LENGTH_OVER_BUDGET: t("skipKeyLengthOverBudget", "The catch-all claims longer keys than the browser can match."),
  });

  /** Lazy and translated, like DIAGNOSIS: these four never went through t(). */
  /** The catch-all's own bounds, asked of the objects that hold them. */
  const catchAllNote = () => {
    const shortest = 2;
    // The CONSTANT, never `CatchAllKey.only()`: this file must not mint a
    // catch-all key, and a structure test holds that line.
    const longest = CatchAllKey.CLAIMS_KEYS_UP_TO;
    // The fallback carries the SAME placeholders as the catalogue, so the English
    // and the French are filled by one substitution rather than two spellings of
    // the bound. A template literal here would also hide the call from the i18n
    // scan, which only reads double-quoted pairs.
    return t("catchAllNote", "Any {min}-to-{max}-character key followed by a hyphen and a number goes to this destination, on the engines you ticked. A short reserved list is held back.")
      .replace("{min}", String(shortest))
      .replace("{max}", String(longest));
  };

  const PREVIEW_MISS = () => ({
    NOT_A_URL: t("previewNotAUrl", "That is not a URL."),
    // A configuration answer, never a verdict on the text: with nothing ticked
    // the preview used to blame the input for a problem it did not have.
    NO_ENGINES: t("previewNoEngines", "Tick a search engine first: nothing is intercepted yet."),
    NOT_A_SEARCH_URL: t("previewNotASearchUrl", "That is not a search URL."),
    NO_MATCH: t("previewNoMatch", "This search would go through untouched."),
    INPUT_TOO_LONG: t("previewTooLong", "That is too long to be a search URL."),
    RESERVED_PREFIX: t("previewNoMatch", "This search would go through untouched."),
    // NON_DETERMINISTIC is an assertion canary and must stay unreachable, so it
    // deliberately has no sentence of its own: translating something nobody can
    // see would be a stage set.
    NON_DETERMINISTIC: t("previewNoMatch", "This search would go through untouched."),
  });

  // -------------------------------------------------------------- Transfer

  const Transfer = {
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

    proposal: undefined,

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
      if (file.size > global.ShortcutAdmission.MAX_TRANSFER_BYTES) {
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

  // ------------------------------------------------------------- Quarantine

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

  // ---------------------------------------------------------------- Storage

  const Storage = {
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

  global.OptionsSections = [Status, Shortcuts, Engines, Access, Preview, Transfer, Quarantine, Storage];
})(globalThis);
