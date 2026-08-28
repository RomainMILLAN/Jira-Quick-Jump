/**
 * The lifecycle both surfaces share.
 *
 * This is not a loop over sections -- it owns six things that must exist exactly
 * once: the debounce and its queue, the flush on page hide, the change
 * subscription AND its teardown, the rule that a re-render must not tread on the
 * field being typed in, the single write path, and the banner shown when a
 * configuration cannot be read back. Duplicating a lifecycle guarantees one of
 * the two copies forgets to close the tap, and it is always the copy the tests
 * do not visit.
 */
(function (global) {
  "use strict";

  const { Platform, PolicyRepository, DestinationJournal, RuleInstaller } = global;

  const DEBOUNCE_MS = 500;

  const SectionHost = {
    async start({ root, sections }) {
      const pending = new Map();
      let stored = null;
      let disposed = false;

      const ctx = {
        stored: () => stored,
        apply,
        report: () => RuleInstaller.report(stored.policy(), [], stored.quarantinedCount()),
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
          showFailure(result);
          return result;
        }
        await reload();
        return result;
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
          if (section.root && isEditing(section.root)) {
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

      const onBlur = () => {
        if (sections.some((s) => s.dirty)) render();
      };
      root.addEventListener("focusout", onBlur);

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
          root.removeEventListener("focusout", onBlur);
          document.removeEventListener("visibilitychange", onHide);
          window.removeEventListener("pagehide", flush);
        },
      };
    },
  };

  SectionHost.DEBOUNCE_MS = DEBOUNCE_MS;
  global.SectionHost = SectionHost;
})(globalThis);
