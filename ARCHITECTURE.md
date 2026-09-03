# Architecture

Two decisions in this repository look, from the outside, like defects a reviewer
should raise. Both are deliberate, both were argued, and both are written down
here so the next reader does not spend an afternoon rediscovering the argument —
or, worse, "fixes" them.

## Why every file is an IIFE hanging off `globalThis`

Thirty-two files open with `(function (global) { "use strict";` and close by
assigning one object to `globalThis`. No `import`, no `export`, no bundler.

This is not a style preference. **The same source files must run in three
loaders that do not agree on modules:**

| Context | Loader |
|---|---|
| Chrome MV3 | `importScripts()` inside a service worker |
| Firefox MV3 | an event page's `scripts` array |
| Options and popup pages | `<script src>` |

An ES module cannot be handed to `importScripts()`. A `type="module"` service
worker exists in Chrome but not in the Firefox event page this extension also
ships to, and adding a bundler would mean the published package is no longer the
reviewed source — which the store review and `SECURITY.md` both lean on.

So the mechanism is imposed. What is *not* imposed is what those files put on
the global, and that is where the real design rule lives:

> **A global name is an address, never a bag of state.**

Anything that holds state is a class you can instantiate twice — `SingleSlot`,
`WriteQueue`, `HoldWatch`, `FocusMemory`, `JournalState`, `EngineId`. What sits
on `globalThis` beside it is either a stateless catalogue of rules
(`ShortcutWarning`, `ReservedPrefix`, `Diagnosis`) or a thin door that names the
one instance this extension has (`RuleInstaller.install`).

The distinction is measured, not merely stated: a test holds module-level
mutable state to a closed list of four, each argued where it lives, and it
rougit in both directions — a fifth cannot appear quietly, and an entry that
outlives what it describes fails too. That pin exists because writing the rule
down was not enough the first time. `rule-installer.js` used to keep
`pending`, `queued` and `deferred` as module variables: two installers were
impossible, and a test that jammed the queue poisoned every test after it. That
is the shape to refuse. The lazy `theSlot` that replaced it is a *singleton of
the application*, not of the code — the class beside it is constructed fresh in
every test that needs one.

**The load order is the price.** Four hand-written lists (`manifest.json`,
`background.js`, `options.html`, `popup.html`) plus `test/load-core.js` must
agree, and a drift produces an `undefined` at load time in a context where the
stack trace is hard to obtain. `structure.test.js` pins all five against each
other; that pin is not optional.

## Why the aggregate answers instead of exposing

`JumpPolicy` publishes `orderedIds()`, `shortcutFor(id)`, `shadowedIds()`,
`isShadowed(id)`, `shortcutCount()`, `hasShortcuts()` — six questions where one
`registry()` would do.

`registry()` did do, and the cost was measurable: four callers reached through
the root to the catalogue behind it, one of them writing
`after.registry().find(id).key().toString()` — three hops from an aggregate that
already published the second one. Every such caller froze the catalogue's shape
into a file that had no business knowing it, and the pair introduced to close the
traversal did not close it while the door beside it stayed open.

The door is gone. A test measures that no file — source or test — reopens it.

The same hop had a second, quieter form, and it was thirty-three places wide:
`s.key().toString()`, `s.instance().baseUrl()`, `s.key().isCatchAll()`. Each one
made a file know that a `ProjectShortcut` is built from a key and a destination,
and that a key is the thing that knows its own nature — so renaming a method on
either value object meant editing a dozen files that only ever wanted a word to
print. The entity now answers `keyText()`, `destination()`, `isCatchAll()` and
`permissionOrigin()`, and a test bans the hops.

The accessors themselves stay. A caller that needs the value object **whole**
still gets it — `rule-factory` builds a regex fragment from the key,
`shortcut-warning` reads a host's shape from the destination. What is banned is
reaching through one part to pull a string out the other side.

The rule generalises: **when something outside needs a fact, name the question on
the root; do not hand out the part that knows the answer.** Adding a question is
cheap and local. Handing out the part is a coupling that spreads silently, and
the next reader will read it as permission.
