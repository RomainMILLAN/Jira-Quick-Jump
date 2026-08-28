/**
 * The options page bootstrap. Ten lines, because everything that has a lifecycle
 * lives in SectionHost and everything that has a shape lives in the sections.
 */
(function (global) {
  "use strict";
  const { Platform, SectionHost, OptionsSections } = global;

  document.getElementById("version").textContent = Platform.api.runtime.getManifest().version;
  SectionHost.start({ root: document.getElementById("sections"), sections: OptionsSections });
})(globalThis);
