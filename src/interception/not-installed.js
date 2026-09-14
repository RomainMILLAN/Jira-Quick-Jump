/**
 * "We did not install this", as ONE shape.
 *
 * There were three: `{ binding: <Binding> }` from the factory, `{ binding:
 * <number> }` from the rule set, `{ code, reason }` with no binding at all from
 * the installer -- an undiscriminated union under a field whose TYPE changed with
 * the producer. The only consumer read `.length`, so nothing ever noticed, and
 * the six named causes of Re2Budget.REASONS -- whose existence this project
 * justifies by "it reaches skipped" -- reached a counter.
 *
 * `code` says WHAT was refused; `subject` says WHICH ONE, in words the user can
 * be shown. Both always present: a field that appears for some producers only is
 * the meaningful absence this project bans everywhere else.
 */
(function (global) {
  "use strict";

  const NotInstalled = {
    of(code, subject) {
      return { code: String(code), subject: String(subject) };
    },
  };

  global.NotInstalled = NotInstalled;
})(globalThis);
