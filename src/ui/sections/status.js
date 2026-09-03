/**
 * The one line that answers "will typing ABC-1 work?".
 *
 * It owns the banner too: the journal's unseen evidence, and the acknowledgement
 * that clears it. A rule counter is not an answer to that question, which is why
 * the sentence comes from Diagnosis and never from a number.
 */
(function (global) {
  "use strict";

  const { DiagnosisPresentation, Dom, MutationResult } = global;
  const { el, t, label, destination, toggle } = global.SectionParts;
  const { FACT_SENTENCE, SKIPPED_SENTENCE } = global.SectionSentences;

  const Status = {

    mount(root, ctx) {
      this.node = el("div", { class: "status" });
      this.banner = el("div", { class: "alert", hidden: true });
      // The reasons behind the verdict, beside the verdict.
      this.causes = el("ul", { class: "causes", hidden: true });
      root.appendChild(this.banner);
      root.appendChild(this.node);
      root.appendChild(this.causes);
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
        // A LIVE REGION, because this line CHANGES ASYNCHRONOUSLY. It paints
        // "Checking rules…" and is replaced by a verdict once the platform has
        // answered -- so a screen-reader user never learned that the install had
        // failed, or that everything was ready. They read the placeholder and
        // moved on. `polite`, not `assertive`: it is a status, not an alarm.
        el("div", {
          class: "status-s", role: "status", "aria-live": "polite",
          text: t("statusCounting", "Checking rules…"),
        }),
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

      /**
       * AND WHY, WHERE THE VERDICT IS ANNOUNCED.
       *
       * "The catch-all could not be installed" was said HERE while the reasons --
       * RUN_OVER_BUDGET, REGEX_UNSUPPORTED, UNKNOWN_ENGINE -- were rendered only in
       * the preview, three sections down, and only once the user had typed
       * something into it. A user reading a failure has no reason to go and type a
       * URL to find out what happened.
       *
       * The receipt carries the causes on both surfaces (install-outcome.js), so
       * the sentence and its reason can finally stand together.
       */
      Dom.clear(this.causes);
      for (const cause of report.skipped) {
        this.causes.appendChild(el("li", {
          class: "row-msg pending",
          text: [SKIPPED_SENTENCE()[cause.code] || cause.code,
                 SKIPPED_SENTENCE()[cause.subject] || cause.subject].join(" "),
        }));
      }
      this.causes.hidden = report.skipped.length === 0;
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

  global.SectionStatus = Status;
})(globalThis);
