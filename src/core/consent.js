/**
 * What the user has consented to for one shortcut: armed, plus the destination
 * warnings they acknowledged.
 *
 * Consent was the only one of ProjectShortcut's four attributes without a parse
 * of its own -- and that hole, not the number of construction doors, is what
 * made rebuilding from storage look like it needed a second entry point. With a
 * parse, register(id, key, instance, consent = Consent.fresh()) is enough and
 * there is literally one way into the registry.
 *
 * Criterion for future cases: a parameter is a mode flag if the body branches on
 * it; it is a carried value if it is merely stored. Consent is stored.
 */
(function (global) {
  "use strict";

  class Consent {
    constructor(armed, acknowledged) {
      this._armed = armed;
      this._acknowledged = acknowledged; // Set of warning kinds
    }

    armed() {
      return this._armed;
    }

    acknowledged(kind) {
      return this._acknowledged.has(kind);
    }

    acknowledgedKinds() {
      return [...this._acknowledged];
    }

    armedWith(armed) {
      return new Consent(armed, new Set(this._acknowledged));
    }

    acknowledging(kind) {
      const next = new Set(this._acknowledged);
      next.add(kind);
      return new Consent(this._armed, next);
    }

    /**
     * A consent is given to a destination, never to a shortcut -- so changing the
     * destination forgets the DESTINATION acknowledgements, and only those.
     *
     * NO SCOPE PARAMETER, by the criterion written above: the body would branch
     * on it. The scope stays with its owner, ShortcutWarning.kindsInScope, and
     * this method reads like a sentence at its call site.
     *
     * FAIL CLOSED: a kind whose scope cannot be placed is FORGOTTEN, never kept.
     * A future kind must not silently survive a change of destination.
     */
    forgettingDestinationAcknowledgements() {
      const kept = global.ShortcutWarning.kindsInScope("key");
      return new Consent(this._armed, new Set(this.acknowledgedKinds().filter((k) => kept.includes(k))));
    }

    /**
     * THE ARMING IS KEPT, THE ATTESTATIONS ARE NOT.
     *
     * For a door that has no reason to believe what the document claims to have
     * been shown to somebody -- which is every door except a read from the area
     * the user's own browser writes locally. See JumpPolicy.restore.
     *
     * NOT `Consent.fresh()`: that would also disarm, and disarming is a
     * DIFFERENT decision made by a different door for a different reason
     * (proposeImport disarms because a file must not arm; a synced document's
     * `armed` is already read through the kill-switch guard in readDocument).
     * Collapsing the two would make one door silently do the other's job, and
     * the shortcut would then need re-arming as well as re-acknowledging.
     *
     * A shortcut left armed with an unacknowledged warning cannot fire --
     * JumpPolicy._isLive excludes it -- so this is fail-closed without being
     * destructive: the user acknowledges once, on this machine, looking at the
     * destination, and the arming they see on screen is the one that was saved.
     */
    withoutAcknowledgements() {
      return new Consent(this._armed, new Set());
    }

    /**
     * NO ACKNOWLEDGEMENT IS PERSISTED HERE ANY MORE. NOT ONE.
     *
     * This used to write the destination-scoped ones and hold back the key-scoped
     * one, on this argument: "a key-scoped acknowledgement never travels with the
     * configuration: it would let a compromised sync account write
     * acknowledged:['CATCH_ALL'] and install a universal redirector without a
     * single screen or click. Same argument as the journal -- A CONTROL THAT
     * TRAVELS BY THE CHANNEL IT IS MEANT TO WATCH IS WORTHLESS."
     *
     * THE ARGUMENT WAS RIGHT AND WAS APPLIED TO ONE SCOPE OUT OF TWO. The
     * configuration lives in storage.sync as soon as the user ticks "Sync across
     * devices", so INSECURE_SCHEME, PUNYCODE, LITERAL_IP and INTERNAL_HOST
     * travelled by exactly the channel the sentence above forbids. Measured, on
     * a document a compromised sync account can write:
     *
     *   { armed: true, shortcuts: [{ id: …, key: "ABC",
     *     baseUrl: "http://jira.attacker.example",
     *     consent: { armed: true, acknowledged: ["INSECURE_SCHEME", …] } }] }
     *
     *   -> restore ok, quarantine 0, refused 0
     *   -> unacknowledged warnings: []   status: ACTIVE   active bindings: 1
     *
     * No screen, no click. INSECURE_SCHEME is a HIGH-severity warning, and
     * project-shortcut.js justified accepting `http:` at all on the sentence "the
     * traffic never leaves in clear text without someone having said so" -- which
     * that document falsifies. What still bounded it was the host permission (the
     * rule installs inert) and the change journal (the banner fires); neither is
     * this control, and neither was the one being claimed.
     *
     * So every acknowledgement now lives where the catch-all's already did: a
     * storage.local entry that never syncs (see local-acknowledgements.js),
     * merged back in at reconstitution.
     *
     * WHAT THIS DOES NOT DO, said plainly: it does not separate a LOCAL attacker,
     * who writes that entry as easily as this one. Same limit as the journal, and
     * the same reason it is still worth doing -- it separates the SYNC CHANNEL.
     */
    toJSON() {
      return { armed: this._armed };
    }
  }

  Consent.fresh = function () {
    return new Consent(false, new Set());
  };

  Consent.parse = function (raw) {
    // `undefined` ONLY. `null` was accepted here as a second spelling of absence,
    // in a project that bans it and whose admission door refuses it for every
    // other field -- two representations of the same nothing, admitted at the one
    // gate whose job is to reduce them to one.
    if (raw === undefined) return { ok: true, value: Consent.fresh() };
    // `raw === null` FIRST, because typeof null is "object": without it, null
    // walked past this guard and threw on `raw.armed` -- a TypeError instead of a
    // refusal, on the storage read path.
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, code: "CONSENT_NOT_AN_OBJECT", message: "Consent must be an object." };
    }
    if (typeof raw.armed !== "boolean") {
      return { ok: false, code: "CONSENT_ARMED_NOT_BOOLEAN", message: "`armed` must be a boolean." };
    }
    const kinds = raw.acknowledged === undefined ? [] : raw.acknowledged;
    if (!Array.isArray(kinds)) {
      return { ok: false, code: "CONSENT_NOT_A_LIST", message: "`acknowledged` must be a list." };
    }
    // What a document may say about acknowledgements, as a table -- because the
    // two halves ("refuse a scope" and "admit the entry anyway") read in
    // opposite directions, and the wrong direction is a self-quarantine loop:
    // the user acknowledges, toJSON writes, storage.onChanged wakes sync(),
    // restore refuses, and the entry the user just authorised lands in
    // quarantine seconds later -- on every device, every time, unrepairable.
    //
    //   known kind    -> CARRIED, and it is the DOOR that decides whether to
    //                    believe it (see JumpPolicy.restore's `trustsSavedConsent`)
    //   key scope     -> DROPPED HERE, unconditionally: no door has ever had a
    //                    reason to believe a document about the catch-all
    //   unknown       -> HARD REFUSAL (a misspelled acknowledgement stays a
    //                    silent failure of a security control)
    //
    // WHY THE DESTINATION SCOPE IS NO LONGER DROPPED *HERE* while toJSON has
    // stopped writing it: a document written by an OLDER build still carries it,
    // and on a profile stored locally that record is genuinely ours. Dropping it
    // in this parse would make every existing user re-tick every destination
    // warning on upgrade. Carrying it lets the door decide -- trusted when the
    // area is local, refused when it is sync -- and the first write afterwards
    // promotes it into the local entry, where it belongs from now on. A named
    // migration, not a permission.
    //
    // Quarantine is for what we cannot READ. Here we read perfectly well; the
    // question of whether to BELIEVE belongs one layer up, because it depends on
    // WHERE the document came from -- which the core must not know.
    // Two sets, because they answer two questions: `declared` is what the
    // document claimed (so a repeat is a malformed document), `seen` is what we
    // agree to carry.
    const declared = new Set();
    const seen = new Set();
    for (const kind of kinds) {
      // PARSED, not merely tested: the kind is the published language of a
      // context boundary, and an unknown one deserves a coded refusal.
      if (!global.ShortcutWarning.parse(kind).ok) {
        return { ok: false, code: "UNKNOWN_WARNING_KIND", message: `Unknown warning kind "${kind}".` };
      }
      // THE DUPLICATE CHECK COMES FIRST, over ALL kinds.
      //
      // The `continue` for key-scoped kinds sat ABOVE `seen.add`, so those kinds
      // never entered the set and ["CATCH_ALL","CATCH_ALL","CATCH_ALL"] passed
      // without a word -- the control was dead on the one scope that arms a
      // universal redirector. Harmless in effect, since key-scoped
      // acknowledgements are dropped anyway, and that is exactly why it had to be
      // either repaired or removed: a named control that controls nothing teaches
      // the next reader to trust the name.
      if (declared.has(kind)) {
        return { ok: false, code: "DUPLICATE_ACKNOWLEDGEMENT", message: `"${kind}" acknowledged twice.` };
      }
      declared.add(kind);
      // Key-scoped acknowledgements are READ and then DROPPED: a document cannot
      // pre-approve the warning that guards the catch-all. See the header.
      if (global.ShortcutWarning.scopeOf(kind) === "key") continue;
      seen.add(kind);
    }
    return { ok: true, value: new Consent(raw.armed, seen) };
  };

  global.Consent = Consent;
})(globalThis);
