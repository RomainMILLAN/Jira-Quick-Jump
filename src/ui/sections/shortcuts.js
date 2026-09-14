/**
 * The list, and the only place a shortcut is created, edited, reordered or
 * removed.
 *
 * The biggest section by far, and the one that carries the evaluation order --
 * the datum that decides who intercepts what. Every gesture leaves as an
 * INTENTION, never a snapshot, because the compare-and-set replays it.
 */
(function (global) {
  "use strict";

  const { FocusMemory, Dom, MutationResult, ProjectKey, JiraInstance, ShortcutWarning, RowReorder, CatchAllKey, RefusalPresentation } = global;
  const { el, t, icon, gripIcon, destination, label, toggle, TRASH, CHEVRON_UP, CHEVRON_DOWN } = global.SectionParts;
  const { WARNING_MESSAGE, sentenceFor, catchAllNote } = global.SectionSentences;

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

    /**
     * SAYING THE SAME THING TWICE MUST BE HEARD TWICE.
     *
     * A live region announces a MUTATION, not a value: writing the identical
     * string changes nothing in the DOM, so the reader stays silent. Press "move
     * up" twice at the top of the list and the second press produced no feedback
     * at all -- on the one path a keyboard user has, and precisely when they need
     * to be told nothing happened.
     *
     * The region is cleared first, then filled on the next frame: two mutations,
     * so two announcements, with no visible text either way (.sr-only).
     */
    announce(sentence) {
      if (!this.announcer) return;
      this.announcer.textContent = "";
      const announcer = this.announcer;
      // A macrotask, not a microtask: assistive technology needs the empty state
      // to reach the accessibility tree before the next value does.
      setTimeout(() => {
        if (announcer === this.announcer) announcer.textContent = sentence;
      }, 0);
    },

    /**
     * A PURE READ of the optimistic order. It used to reconcile as well -- a
     * getter with a side effect on the very state it reported, called from render
     * AND from move. Reconciling belongs to reconcile, and it has a name.
     */
    orderToShow(stored) {
      return this.order || stored.policy().orderedIds();
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

    /**
     * MOVING TO AN END, in one gesture.
     *
     * The arrows were the ONLY keyboard path, and they move by one: taking a row
     * from position 20 to the top cost nineteen presses and nineteen
     * announcements. WCAG 2.5.7 is satisfied by having a keyboard path at all;
     * this is about it being usable. Home and End are what a list has meant for
     * thirty years, and the pointer path already offers the equivalent by drag.
     */
    moveToEnd(id, toStart, stored, ctx) {
      const shown = this.orderToShow(stored);
      this.moveTo(id, toStart ? 0 : shown.length - 1, ctx, { id, delta: toStart ? -1 : 1 });
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
      // WHERE THE FOCUS WAS, before the list is destroyed.
      //
      // Dom.clear removes every node, so the focus falls to <body>. Only the
      // arrows were restored -- so a change arriving from the other surface while
      // the user was on the arm switch, the bin or an acknowledgement checkbox
      // refused them out of the list entirely, mid-task, with no way back but the
      // Tab key. The host already defers a repaint under a CARET; this is the same
      // rule for everything that is not a text field.
      const held = FocusMemory.capture(this.rows);
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
          onMoveToEnd: (toStart) => this.moveToEnd(id, toStart, ctx.stored(), ctx),
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
      // Restored by (row, control), never by a stored node reference: the node the
      // user was on no longer exists.
      if (!toFocus && held) toFocus = () => FocusMemory.restore(this.rows, held);
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
          // THE DRAFTS COUNT TOO. This guard only asked the policy, so a second
          // catch-all draft could always be opened: two rows, two nodes carrying
          // id="catch-all-note", invalid HTML, and the second field's
          // aria-describedby resolving to the FIRST note.
          if (policy.catchAllShortcut() || this.drafts.some((d) => d.catchAll)) {
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

    savedRow(shortcut, ctx, { policy, index, total, onMove, onMoveToEnd }) {
      const id = shortcut.id();
      const pending = shortcut.unacknowledgedWarnings();
      // statusOf is the SOLE judge of a row, so the row's vocabulary is the one
      // diagnose() speaks and two places never qualify the same line.
      const status = policy.statusOf(id);
      const isCatchAll = shortcut.isCatchAll();

      const orderArrow = (path, delta, ariaLabel, atEdge) =>
        el("button", {
          class: "btn icon move", "aria-label": ariaLabel,
          // aria-disabled, never disabled: a disabled button is not focusable, so
          // moving a row to the top would drop focus to <body>.
          "aria-disabled": atEdge,
          "data-field": delta < 0 ? "move-up" : "move-down",
          onClick: () => onMove(delta),
          // Home and End on either arrow: the row goes to the end it points at,
          // in one press instead of one per position.
          onKeyDown: (event) => {
            if (event.key !== "Home" && event.key !== "End") return;
            event.preventDefault();
            onMoveToEnd(event.key === "Home");
          },
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
        el("div", { class: "f-key" }, [el("label", { class: "field-label", "for": `key-${shortcut.id()}`, text: t("key", "Key") }),
          isCatchAll
            ? el("div", { class: "f key is-static" }, [
                el("span", { text: t("catchAllKey", "Any short key") }),
                el("code", { text: shortcut.keyText() }),
              ])
            : el("input", {
                // A REAL `label for`, so clicking the word focuses the field and a
                // screen reader announces it as this field's name. The aria-label
                // stays as the fallback for the compact surface, where the label is
                // hidden by CSS: an aria-label wins over a <label>, and both saying
                // the same thing is what makes that safe.
                id: `key-${id}`, "data-field": "key",
                class: "f key", value: shortcut.keyText(),
                "aria-label": t("key", "Key"),
                onInput: (event) => this.editKey(event.target, id, ctx),
              }),
        ]),
        el("div", { class: "f-url" }, [
          el("label", { class: "field-label", "for": `url-${shortcut.id()}`, text: t("destination", "Destination") }),
          el("input", {
            id: `url-${id}`, "data-field": "url",
            class: "f", value: shortcut.destination(),
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
          "arm",
        )]),
        el("div", { class: "f-del" }, [el("button", {
          class: "btn icon", "data-field": "remove", "aria-label": t("remove", "Remove this shortcut"),
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
              // NAMED, so the focus survives the re-render. FocusMemory keys on
              // data-field and the row's data-id; without a name it returned
              // undefined and the focus fell back to <body> -- on the one control
              // a keyboard user must tick to arm anything.
              "data-field": `ack:${warning.kind}`,
              class: "ack-box",
              onChange: () => ctx.applyToPolicy((p) => p.acknowledge(id, warning.kind)),
            }),
            // NO FALLBACK TO THE CORE ANY MORE: the core no longer carries English.
            // A missing sentence would print the kind, which is a developer-visible
            // failure -- and a structure test makes it impossible to ship.
            WARNING_MESSAGE()[warning.kind] || warning.kind,
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
      // The saved row shows it, from shortcut.keyText().
      const keyCell = draft.catchAll
        ? el("div", { class: "f key is-static" }, [
            el("span", { text: t("catchAllKey", "Any short key") }),
          ])
        : el("input", {
            id: `key-${draft.rowId}`,
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
          el("label", { class: "field-label", "for": `key-${draft.rowId}`, text: t("key", "Key") }),
          keyCell,
        ]),
        el("div", { class: "f-url" }, [
          el("label", { class: "field-label", "for": `url-${draft.rowId}`, text: t("destination", "Destination") }),
          el("input", {
            id: `url-${draft.rowId}`,
            class: "f", placeholder: "example.atlassian.net", value: draft.url,
            "aria-label": t("destination", "Destination"),
            "aria-describedby": draft.catchAll ? "catch-all-note" : undefined,
            onInput: (event) => { draft.url = event.target.value; this.tryRegister(draft, row, message, ctx); },
          }),
        ]),
        el("div", { class: "f-arm" }, [toggle(false, () => {}, t("armThis", "Arm this shortcut"), true)]),
        el("div", { class: "f-del" }, [el("button", {
          class: "btn icon", "data-field": "remove", "aria-label": t("remove", "Remove this shortcut"),
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

    async editKey(input, id, ctx) {
      // ProjectKey.parse, deliberately: the typed field is NOT the storage door,
      // and the only door that turns a string into a catch-all key must stay out
      // of this file. A structure test greps for it literally, comments included.
      const parsed = ProjectKey.parse(input.value);
      input.setAttribute("aria-invalid", String(!parsed.ok));
      if (!parsed.ok) return;
      // AND THE DOMAIN'S ANSWER TOO. The local parse says the shape is fine; only
      // the aggregate knows about DUPLICATE_KEY or KEY_NATURE_IMMUTABLE. Throwing
      // that away left aria-invalid="false" on the very field that was refused --
      // the draft path already shows its refusal, this one lied.
      const written = await ctx.applyToPolicy(
        (policy) => policy.withKeyFor(id, parsed.value), `shortcut:${id}:key`);
      if (written && !written.ok) input.setAttribute("aria-invalid", "true");
    },

    async editUrl(input, id, ctx) {
      const parsed = JiraInstance.parse(input.value);
      input.setAttribute("aria-invalid", String(!parsed.ok));
      if (!parsed.ok) return;
      ctx.applyToPolicy((policy) => policy.withBaseUrlFor(id, parsed.value), `shortcut:${id}:baseUrl`);
    },
  };

  global.SectionShortcuts = Shortcuts;
})(globalThis);
