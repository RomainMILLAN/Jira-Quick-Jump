/**
 * The debounced write queue: one slot per field, and every waiter told the truth.
 *
 * Extracted from the 442-line closure in section-host.js, which held nine
 * captured variables and fifteen inner functions -- so none of this could be
 * built twice, reached from outside, or tested at all. What a keystroke does
 * before it reaches storage is a mechanism with its own rules, and it now has its
 * own object.
 *
 * COALESCING IS BY FIELD, never global: a keystroke replaces the previous
 * keystroke in the SAME field and never the toggle next to it. That is why the
 * key is the caller's, not ours.
 */
(function (global) {
  "use strict";

  class WriteQueue {
    /** `commit` is how a queued intention actually reaches storage. */
    constructor(commit, delay) {
      this._commit = commit;
      this._delay = delay;
      this._pending = new Map();
    }

    /**
     * A DEBOUNCED apply RESOLVES WITH ITS REAL OUTCOME, not with a fabricated ok.
     *
     * It used to return `{ ok: true, events: [] }` before any write had been
     * attempted -- a success invented for a commit that had not happened. Nobody
     * awaited it yet, which made it a trap rather than a bug: the first caller to
     * believe that value would believe a lie.
     */
    apply(intention, coalesceKey) {
      if (!coalesceKey) return this._commit(intention);
      const existing = this._pending.get(coalesceKey);
      if (existing) {
        clearTimeout(existing.timer);
        // The keystroke this one replaces never reaches storage. Its waiters are
        // told so rather than left hanging for the life of the page.
        existing.settle({ ok: false, code: "SUPERSEDED", message: "", events: [] });
      }
      let settle;
      const settled = new Promise((resolve) => { settle = resolve; });
      this._pending.set(coalesceKey, {
        intention,
        settle,
        timer: setTimeout(() => {
          this._pending.delete(coalesceKey);
          this._commit(intention).then(settle, settle);
        }, this._delay),
      });
      return settled;
    }

    /**
     * Cancels a pending coalesced write.
     *
     * Needed when a foreign change alters the SET of ids: the queued write still
     * carries the now-stale absolute order and would leave only to collect
     * ORDER_STALE.
     */
    cancel(coalesceKey) {
      const existing = this._pending.get(coalesceKey);
      if (!existing) return;
      clearTimeout(existing.timer);
      existing.settle({ ok: false, code: "CANCELLED", message: "", events: [] });
      this._pending.delete(coalesceKey);
    }

    /**
     * IT RETURNS ITS WORK, so a caller that can wait does.
     *
     * `pagehide` cannot be held open, and that limit is real -- but it was not the
     * only caller: stop() flushed too and dropped the promises on the floor.
     * Handing the work back lets the one caller that CAN await it do so, and makes
     * the remaining loss the browser's rather than ours.
     */
    flush() {
      const queued = [...this._pending.values()];
      this._pending.clear();
      return Promise.allSettled(queued.map((entry) => {
        clearTimeout(entry.timer);
        // The same verified path: on a conflict this keystroke is lost rather than
        // overwriting what the other surface just saved.
        const done = this._commit(entry.intention);
        done.then(entry.settle, entry.settle);
        return done;
      }));
    }

    /** Whether anything is waiting. A count, never the queue itself. */
    size() {
      return this._pending.size;
    }
  }

  global.WriteQueue = WriteQueue;
})(globalThis);
