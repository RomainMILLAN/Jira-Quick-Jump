/**
 * The lifecycle both surfaces share.
 *
 * This is not a loop over sections -- it owns seven things that must exist
 * exactly once: the debounce and its queue, the flush on page hide, the change
 * subscription AND its teardown, the rule that a re-render must not tread on WHAT
 * THE USER IS MANIPULATING (the field being typed in, the row being dragged), the
 * single write path, the refusal of a file dropped anywhere on the document, and
 * the banner shown when a configuration cannot be read back. Duplicating a
 * lifecycle guarantees one of the two copies forgets to close the tap, and it is
 * always the copy the tests do not visit.
 */
(function (global) {
  "use strict";

  const { Platform, PolicyRepository, DestinationJournal, RuleInstaller, MutationResult, Dom } = global;

  const DEBOUNCE_MS = 500;

  const SectionHost = {
    async start({ root, sections }) {
      const pending = new Map();
      let stored = null;
      let disposed = false;

      const ctx = {
        stored: () => stored,
        apply,
        /**
         * The ten-times-copied idiom, named once. It also removes the chance of
         * forgetting next.events -- which used to be what fed the trust banner,
         * and is now computed by PolicyDiff at the commit instead.
         */
        applyToPolicy: (mutate, coalesceKey) =>
          apply((s) => {
            const next = mutate(s.policy());
            return next.ok ? MutationResult.ok(s.withPolicy(next.value)) : next;
          }, coalesceKey),
        cancel,
        report: () => report(),
        journal: DestinationJournal,
        // For the rare write that lands OUTSIDE the policy — a journal entry, an
        // acknowledgement of it — since only a policy write triggers a redraw.
        refresh: () => render(),
      };

      /**
       * Sections hand over an INTENTION, never a snapshot: `(stored) => stored`.
       * The compare-and-set replays it, so it must be idempotent and absolute --
       * `disarm(id)` replayed three times still means disarmed, whereas a relative
       * toggle would come back armed.
       */
      async function commit(intention) {
        const result = await PolicyRepository.apply(intention);
        if (result.ok && result.events && result.events.length > 0) {
          // Written AFTER the commit and never inside the mutator: the retry would
          // otherwise log the same change up to three times.
          await DestinationJournal.record(result.events, result.rev, "MANUAL", Date.now());
        }
        if (!result.ok) {
          // A refused mutation changed nothing, so there is nothing to redraw —
          // and redrawing would throw away the correction the user is in the
          // middle of typing, which is the one thing they must not lose after
          // being told their input was refused.
          //
          // ORDER_STALE is the exception: the section is holding an optimistic
          // order the storage does not have, and showFailure alone would leave
          // that wrong order on screen indefinitely.
          showFailure(result);
          if (result.code === "ORDER_STALE") await reload();
          return result;
        }
        await reload();
        return result;
      }

      /**
       * Memoised per render, refreshed on every reload and after each install --
       * NEVER per keystroke. The preview consumes the rules AS INSTALLED, and
       * asking the platform on each character would make it asynchronous and
       * collide head-on with the ReDoS budget.
       */
      /**
       * The section whose subtree the user is physically holding, or null.
       *
       * Same family as isEditing, and a re-render there does not merely look
       * wrong -- it DESTROYS the gesture: removing the source node can suppress
       * dragend entirely. Held here and derived from the DOM, so no section owns a
       * flag and this host still knows nothing about what any section contains.
       */
      let heldSection = null;

      const sectionAt = (node) =>
        sections.find((section) => section.root && section.root.contains(node)) ?? null;

      const isHeldByUser = (section) =>
        Boolean(section.root) && (section === heldSection || isEditing(section.root));

      /**
       * Releases the latch and replays whatever was deferred.
       *
       * onBlur used to do the second half alone. It cannot any more: pointerdown
       * PRECEDES the focus change it causes, so a replay there would redraw the
       * subtree between the press and dragstart, detach the node under the
       * pointer, and -- because sectionAt tests contains() -- leave the latch
       * unarmed for the whole gesture.
       */
      function resume() {
        heldSection = null;
        if (sections.some((s) => s.dirty)) render();
      }

      let lastReport = null;
      async function report() {
        if (!lastReport) {
          lastReport = await RuleInstaller.report(stored.policy(), [], stored.quarantinedCount());
        }
        return lastReport;
      }

      /**
       * Cancels a pending coalesced write.
       *
       * Needed when a foreign change alters the SET of ids: the queued write
       * still carries the now-stale absolute order and would leave only to
       * collect ORDER_STALE.
       */
      function cancel(coalesceKey) {
        const existing = pending.get(coalesceKey);
        if (!existing) return;
        clearTimeout(existing.timer);
        pending.delete(coalesceKey);
      }

      function apply(intention, coalesceKey) {
        if (!coalesceKey) return commit(intention);
        const existing = pending.get(coalesceKey);
        if (existing) clearTimeout(existing.timer);
        // Coalescing by field: a keystroke replaces the previous keystroke in the
        // SAME field, and never the toggle next to it.
        pending.set(coalesceKey, {
          intention,
          timer: setTimeout(() => {
            pending.delete(coalesceKey);
            commit(intention);
          }, DEBOUNCE_MS),
        });
        return Promise.resolve({ ok: true, events: [] });
      }

      function flush() {
        const queued = [...pending.values()];
        pending.clear();
        for (const entry of queued) {
          clearTimeout(entry.timer);
          // The same verified path: on a conflict this keystroke is lost rather
          // than overwriting what the other surface just saved.
          commit(entry.intention);
        }
      }

      async function reload() {
        const loaded = await PolicyRepository.load();
        if (!loaded.ok) {
          showFailure(loaded);
          return;
        }
        stored = loaded.stored;
        lastReport = null;
        render();
      }

      /**
       * Renders are SERIALISED and bursts are coalesced into one extra pass.
       *
       * Several sections await before they write (the rule count, the journal), so
       * two overlapping renders would otherwise land out of order and leave the
       * older state on screen while storage holds the newer one.
       *
       * Abandoning a superseded render mid-loop looks like the obvious fix and is
       * wrong: the first section is the slow one, so a burst of writes makes every
       * pass give up before reaching the later sections, which then never redraw
       * at all. Finishing the pass and repeating it once is what avoids starving
       * them.
       */
      let rendering = false;
      let again = false;
      async function render() {
        if (rendering) {
          again = true;
          return;
        }
        rendering = true;
        do {
          again = false;
          await renderOnce();
        } while (again);
        rendering = false;
      }

      async function renderOnce() {
        for (const section of sections) {
          // Never re-render the subtree holding the field being TYPED IN: doing so
          // replaces the value and sends the caret back to the start. Replayed on
          // blur instead.
          //
          // Only a field, though. Clicking a switch or a button focuses it too,
          // and skipping the redraw there means the storage changes while the
          // control keeps showing the old state until the user happens to click
          // elsewhere — which reads as "the button does nothing". A button has no
          // typed-in value to protect.
          // The write state reconciles even when the read view is frozen. This is
          // the CQRS line of this file: a section's pending command leaves by a
          // timer, not by the render, so a deferred render must not be able to
          // strand it. reconcile never redraws; it may speak.
          section.reconcile(stored, ctx);
          if (isHeldByUser(section)) {
            section.dirty = true;
            continue;
          }
          section.dirty = false;
          await section.render(stored, ctx);
        }
      }

      function isEditing(root) {
        const active = document.activeElement;
        if (!active || !root.contains(active)) return false;
        const tag = active.tagName;
        return tag === "INPUT" || tag === "TEXTAREA" || active.isContentEditable;
      }

      function showFailure(result) {
        const banner = document.getElementById("host-banner");
        if (!banner) return;
        banner.hidden = false;
        banner.textContent = result.message || String(result.code || "");
      }

      const loaded = await PolicyRepository.load();
      if (!loaded.ok) {
        showFailure(loaded);
        return { stop() {} };
      }
      stored = loaded.stored;

      for (const section of sections) {
        const node = document.createElement("div");
        node.className = "section";
        root.appendChild(node);
        section.root = node;
        section.mount(node, ctx);
        section.render(stored, ctx);
      }

      const onChanged = () => reload();
      PolicyRepository.onPolicyChanged(onChanged);

      /**
       * Three states that cannot overlap: FREE, HELD BY THE POINTER (a few
       * milliseconds, from pointerdown to pointerup), HELD BY A DRAG (from
       * dragstart to dragend).
       *
       * pointerdown ACQUIRES rather than releases, and that ordering is the whole
       * fix: it lands before the focus change that mousedown causes, so the
       * focusout below finds the latch already set and leaves the node under the
       * pointer alone.
       *
       * And during an HTML5 drag no pointerup is delivered at all -- the browser
       * emits pointercancel -- so the second state cannot release from under the
       * third, and dragend is its only releaser.
       *
       * Reassigning beats accumulating: a pointerup released outside the window,
       * or a press on another section, leaves or moves the latch, and the next
       * press heals it. Strictly shorter than the isEditing freeze already in
       * production, which lasts as long as a caret sleeps in a field.
       */
      const onPointerDown = (event) => { heldSection = sectionAt(event.target); };
      const onPointerUp = () => resume();
      const onDragStart = (event) => { heldSection = sectionAt(event.target); };
      const onDragEnd = () => resume();
      // focusin covers the keyboard user, who emits no pointer event and would
      // otherwise have no floor at all if a dragend went missing. It also fires
      // when a field is clicked, in which case renderOnce simply skips that
      // section again through isEditing and leaves it dirty -- harmless.
      const onFocusIn = () => resume();
      // Replaces the former onBlur, and must respect the latch: a debounced write
      // very often leaves the section dirty, so an unconditional replay here is
      // what used to destroy the row under the pointer.
      const onFocusOut = () => { if (!heldSection) resume(); };

      document.addEventListener("pointerdown", onPointerDown);
      document.addEventListener("pointerup", onPointerUp);
      document.addEventListener("dragstart", onDragStart);
      document.addEventListener("dragend", onDragEnd);
      root.addEventListener("focusin", onFocusIn);
      root.addEventListener("focusout", onFocusOut);

      // The one refusal of a navigating drop, per surface. Not in the HTML: an
      // inline script there is killed by script-src 'self', in silence, so the
      // guard would exist in the repository and not in the browser.
      const allowFileDrops = Dom.refuseFileDrops(document);

      const onHide = () => {
        if (document.visibilityState === "hidden") flush();
      };
      document.addEventListener("visibilitychange", onHide);
      window.addEventListener("pagehide", flush);

      return {
        stop() {
          if (disposed) return;
          disposed = true;
          flush();
          document.removeEventListener("pointerdown", onPointerDown);
          document.removeEventListener("pointerup", onPointerUp);
          document.removeEventListener("dragstart", onDragStart);
          document.removeEventListener("dragend", onDragEnd);
          root.removeEventListener("focusin", onFocusIn);
          root.removeEventListener("focusout", onFocusOut);
          allowFileDrops();
          document.removeEventListener("visibilitychange", onHide);
          window.removeEventListener("pagehide", flush);
        },
      };
    },
  };

  SectionHost.DEBOUNCE_MS = DEBOUNCE_MS;
  global.SectionHost = SectionHost;
})(globalThis);
