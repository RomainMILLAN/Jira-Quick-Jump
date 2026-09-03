/**
 * What could not be read back, kept rather than deleted.
 *
 * An entry we refuse is MOVED aside: otherwise the first apply would rewrite
 * storage from an amputated policy and erase a configuration the user created.
 */
(function (global) {
  "use strict";

  const { Dom, ProjectKey, JiraInstance, RefusalPresentation } = global;
  const { el, t, label } = global.SectionParts;
  const { UNREADABLE_SENTENCE } = global.SectionSentences;

  const Quarantine = {

    mount(root, ctx) {
      this.root = root;
      this.body = el("div");
      root.appendChild(this.body);
    },

    render(stored, ctx) {
      const entries = stored.quarantined();
      /**
       * TWO KINDS OF "COULD NOT BE READ BACK", AND THIS SECTION IS THE HOME OF BOTH.
       *
       * An ENTRY that was refused has a row, a value to repair and a decision to
       * make -- that is the list below. A FIELD of the document that could not be
       * read has none of those: there is nothing to repair, only something to be
       * told. `unreadable` carried exactly those facts and had NO READER ANYWHERE:
       * admission.js computed them and called the absent reader "named debt, not an
       * oversight", and the list of producers reached three while it stayed absent.
       *
       * They belong here rather than in the status line because this section is
       * already titled with the question they answer, and because the status line
       * says ONE thing (the worst diagnosis) where this says as many as happened.
       */
      const unreadable = ctx.unreadable();
      // A section with nothing to say says nothing -- and now it has two ways of
      // having something to say.
      this.root.hidden = entries.length === 0 && unreadable.length === 0;
      Dom.clear(this.body);
      if (this.root.hidden) return;

      this.body.appendChild(label(t("quarantine", "Could not be read back"),
        t("quarantineNote", "Kept, never deleted on your behalf.")));

      if (unreadable.length > 0) {
        this.body.appendChild(el("ul", { class: "causes" }, unreadable.map((fact) => el("li", {
          class: "row-msg pending",
          // The sentence, or the code. NEVER the message that travelled with the
          // fact: it is English written in the domain, and this surface is
          // translated -- the same rule RefusalPresentation follows for a refusal.
          text: UNREADABLE_SENTENCE()[fact.code] || String(fact.code),
        }))));
      }
      if (entries.length === 0) return;
      entries.forEach(({ entry: raw, fingerprint }) => {
        const message = el("div", { class: "row-msg refused", hidden: true });
        // Fixing means EDITING what could not be read, then sending it back
        // through the one door — re-submitting the same rejected bytes would just
        // reproduce the same refusal, which is honest and useless.
        //
        // `Dom.visibleText` IS THE CONTROL. `ltr-isolate` IS NOT, AND USED TO BE
        // BELIEVED TO BE.
        //
        // These two fields display a string the parser REFUSED. They were called
        // "THE ONLY SURFACE IN THE PROJECT" that does, on the reasoning that
        // "everywhere else a host on screen has survived JiraInstance.parse, hence
        // /^[\x21-\x7e]+$/, so no bidi override can be in it" -- and that was FALSE
        // of the change banner, whose facts come back from storage.local through a
        // door that bounds their length and nothing else. Both surfaces go through
        // Dom.visibleText now; see its docstring, which names the two.
        // Here the entry is in quarantine BECAUSE the parser refused it, and
        // BASE_CONTROL_CHARS is precisely the code that refuses those overrides —
        // so an RTL override arrives, unopposed, on the screen where the user reads
        // the value to decide whether to readmit it. structure.test.js already says
        // why that matters: "what the user checks is not where the traffic goes".
        //
        // AND `unicode-bidi: isolate` DID NOT STOP IT. The class was cut for this
        // surface, with eighteen lines in sections.css calling itself a security
        // control -- and it isolates a sequence from its NEIGHBOURS without
        // annulling the overrides INSIDE it. Measured in Chromium: with the class
        // applied, `"https://jira." + U+202E + "moc.live/"` still displays as
        // `https://jira./evil.com`, exactly as with no rule at all. See
        // Dom.visibleText, which removes the characters instead.
        //
        // THE CLASS STAYS, demoted to what it actually does: isolating the value
        // from the labels around it. It is deliberately NOT widened to `input.f`
        // in the CSS -- the other selectors are there for a DIFFERENT reason
        // ("this selector prints a validated host"), and blurring the two is how
        // the wrong control got trusted here in the first place.
        const key = el("input", { class: "f key ltr-isolate", value: Dom.visibleText(raw && raw.key),
          "aria-label": t("key", "Key") });
        const url = el("input", { class: "f ltr-isolate", value: Dom.visibleText(raw && raw.baseUrl),
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
        message.textContent = RefusalPresentation.sentence(instance);
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
      // COMPARED AGAINST WHAT THE USER WAS SHOWN, not against the stored bytes.
      //
      // The field is filled through Dom.visibleText, so an entry whose key holds
      // a bidi control is DISPLAYED with a U+FFFD in its place. Comparing to the
      // raw string would then read "the user edited it" for a field nobody
      // touched, and send the untouched value down the typed-key path -- where
      // ProjectKey.parse refuses the replacement character as KEY_SHAPE. The
      // readmit path re-parses the ORIGINAL key instead, and refuses it as
      // KEY_CONTROL_CHARS: the same refusal, naming the actual fault.
      const untouched = Dom.visibleText(raw && raw.key) === rawKey;
      if (untouched) {
        const result = await ctx.apply((s) => s.readmit(fingerprint, instance.value, freshId));
        this.showOutcome(result, message);
        return;
      }
      const key = ProjectKey.parse(rawKey);
      if (!key.ok) {
        message.hidden = false;
        message.textContent = RefusalPresentation.sentence(key);
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
