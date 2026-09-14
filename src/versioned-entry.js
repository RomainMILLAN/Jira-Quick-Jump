/**
 * A compare-and-set over one storage entry.
 *
 * IT COMPARES AN IDENTITY, NOT A COUNT -- and it did not always.
 *
 * The check used to be `after.rev === current.rev + 1`, which asks "did the
 * number go up by one?" when the question is "is MY write the one in place?".
 * Two writers produce the same number; that IS the lost update. Measured: A reads
 * 5, B reads 5, A writes 6, B writes 6 over it, B re-reads 6 == 5+1 -> ok, and A
 * re-reads 6 == 6 -> ok TOO. Both reported success, one write was gone, and the
 * entry that vanished is the one carrying the evidence.
 *
 * So each attempt stamps a token nobody else can produce, and asks for it back.
 * The token is a fact of the ENVELOPE, never of the domain: no aggregate reads
 * it, it survives nothing, and it is written by the only module allowed to spell
 * the envelope literal. put() stamps one too, though it has nothing to compare:
 * a field that is present "sometimes" would be the second envelope shape this
 * file spends three paragraphs forbidding its clients.
 *
 * THE WINDOW IS NARROWED, NOT CLOSED, and the limit is worth writing: if the
 * other write lands AFTER our re-read rather than between our set and it, we
 * report ok on a value that is already gone. chrome.storage offers no atomic
 * compare-and-set, so no amount of re-reading fixes that -- which is exactly why
 * the next paragraph is a requirement and not a nicety.
 *
 * The loser of a conflict REPLAYS ITS INTENTION on the winner's value. That is
 * safe only because every intention here is absolute and idempotent -- withOrder
 * takes the whole order, never "move up by one". This check does not make that
 * requirement obsolete; it makes it NECESSARY rather than decorative.
 *
 * Two clients: the policy and the destination journal. The journal must not be
 * the only unprotected write path in the project -- especially since it is the
 * one carrying the evidence. Two interleaved read-modify-writes lose an entry,
 * and losing a journal entry is not losing a log line: it is losing the only
 * signal the change detector exists to produce.
 */
(function (global) {
  "use strict";

  const ATTEMPTS = 3;

  /** Unforgeable-by-accident, and never reused: it only has to be different from
   *  what any other writer is minting at the same instant. */
  const token = () => global.crypto.randomUUID();

  const VersionedEntry = {
    // `writer` is carried out unvalidated ON PURPOSE: it is only ever compared for
    // strict equality against a token minted moments ago, so an absent one (an
    // envelope written before this field existed) or a forged one simply never
    // matches. The default is the conflict, which is the replay. Fail-closed, at
    // no cost, and no migration to write.
    async read(area, name) {
      const stored = await area.get(name);
      const envelope = stored[name];
      return envelope && typeof envelope === "object"
        ? { rev: Number(envelope.rev) || 0, writer: envelope.writer, value: envelope.value }
        : { rev: 0, writer: undefined, value: undefined };
    },

    /**
     * A BARE set of the same envelope, for an entry that has nothing to
     * compare-and-set.
     *
     * It exists so the envelope literal `{ rev, value }` stays with its only
     * author. A client that wrote it by hand would pierce this membrane from one
     * side while believing in it from the other -- and the format would then have
     * two owners, which is how the two of them drift.
     *
     * It THROWS when the area refuses, where update() converts a rejection into
     * { ok: false, code: "QUOTA_EXCEEDED" }. That difference is load-bearing:
     * a caller with no compare-and-set has no !ok branch to reach, so an
     * invented one would be dead code with a live-looking guard over it.
     *
     * The `rev` policy belongs to the CALLER: this entry has no accumulation to
     * protect, so `rev` here exists for one reason only -- to guarantee that
     * storage.onChanged fires. See install-outcome.js.
     */
    async put(area, name, value, rev) {
      await area.set({ [name]: { rev, writer: token(), value } });
    },

    /**
     * `mutate` receives the freshly re-read value and returns a MutationResult.
     * A refusal it hands back is ADOPTED rather than forwarded, so what leaves
     * here always carries `events` -- see MutationResult. It is REPLAYED on
     * conflict, which is why every intention must be idempotent and absolute.
     */
    async update(area, name, mutate) {
      for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
        const current = await this.read(area, name);
        const result = mutate(current.value);
        // ADOPTED, so the shape this module promises is kept AT THE DOOR. Passing
        // a mutate's refusal through unchanged is how an events-less shape used to
        // escape into a channel that guarantees one -- the very leak
        // MutationResult.adopting exists to close.
        if (!result.ok) return global.MutationResult.adopting(result);
        const mine = token();
        try {
          await area.set({ [name]: { rev: current.rev + 1, writer: mine, value: result.value } });
        } catch (error) {
          return { ok: false, code: "QUOTA_EXCEEDED", message: String(error), events: [] };
        }
        const after = await this.read(area, name);
        // BOTH terms. The revision alone cannot tell two writers apart; the token
        // alone would accept a write that landed on a stale base.
        if (after.rev === current.rev + 1 && after.writer === mine) {
          // Only the WINNING attempt's events are kept, never the accumulation
          // of all three.
          // `writer` TRAVELS OUT with the revision. A caller that must later
          // prove "this commit was mine" needs the identity, not the height: a
          // height is a number the next writer also produces, and a hostile one
          // chooses.
          // No `?? []`. The shape promises `events`, and it now keeps that
          // promise at the door -- MutationResult.adopting -- rather than here,
          // where a presence test both contradicted the invariant and hid the
          // places that broke it.
          return { ok: true, value: result.value, events: result.events, rev: after.rev, writer: mine };
        }
      }
      return {
        ok: false,
        code: "CONFLICT_EXHAUSTED",
        message: "Another window changed the configuration at the same time.",
        events: [],
      };
    },
  };

  VersionedEntry.ATTEMPTS = ATTEMPTS;
  global.VersionedEntry = VersionedEntry;
})(globalThis);
