/**
 * "Type it and see where it goes."
 *
 * It simulates THE RULES AS INSTALLED, never the policy as intended: it is the
 * one organ where the user can check the extension against itself, so it must
 * answer about the delivered programme or it is worse than nothing.
 */
(function (global) {
  "use strict";

  const { Dom, JumpPreview, SearchEngineCatalog } = global;
  const { el, t, label } = global.SectionParts;
  const { PREVIEW_MISS, SKIPPED_SENTENCE } = global.SectionSentences;

  const Preview = {

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
      // NO PRESENCE TEST. `report.skipped` is total: both factories of `reality`
      // guarantee an array, so a `&&` here would be the hedge this project bans
      // (structure.test.js bans `section.blank?.()` for the same reason -- "the
      // member is TOTAL, not optional"). It is also the WITNESS of that guarantee:
      // with the guard back, nothing goes red the day a factory forgets the field.
      if (report.skipped.length > 0) {
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

  global.SectionPreview = Preview;
})(globalThis);
