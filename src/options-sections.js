/**
 * The sections, shared verbatim by the options page and the popup.
 *
 * Both surfaces show the SAME sections in the same order; only the density
 * differs, and that difference lives entirely in sections.css. Nothing here
 * branches on which surface it is running in.
 *
 * THIS FILE IS NOW THE ASSEMBLY, and nothing else. It used to be 1667 lines
 * holding eight sections, four sentence catalogues, two policy comparators, the
 * validation, the persistence and the SVG rendering -- so no section could be
 * loaded alone, none could be reused, and every merge on this screen was a merge
 * on all of it. The audit called it out, and it kept growing under
 * the corrections rather than shrinking.
 *
 * What lives where now:
 *
 *   ui/sections/parts.js      -- the bricks: a node, an icon, a switch, a label
 *   ui/sections/sentences.js  -- the catalogues a translator touches
 *   ui/sections/<section>.js  -- one section, one file, one reason to change
 *
 * The ORDER below is the order on screen, and it is the only thing this file
 * decides. Every section still hands the host an INTENTION -- `(stored) => stored`
 * -- never a snapshot, and the intention only ever carries the field the user
 * just touched.
 */
(function (global) {
  "use strict";

  const {
    SectionStatus,
    SectionShortcuts,
    SectionEngines,
    SectionAccess,
    SectionPreview,
    SectionTransfer,
    SectionQuarantine,
    SectionStorage,
  } = global;

  global.OptionsSections = [
    SectionStatus,
    SectionShortcuts,
    SectionEngines,
    SectionAccess,
    SectionPreview,
    SectionTransfer,
    SectionQuarantine,
    SectionStorage,
  ];
})(globalThis);
