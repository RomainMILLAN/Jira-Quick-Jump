/**
 * The popup bootstrap. Interchangeable with the options page: same sections, same
 * order. It only adds the link out to the full page.
 */
(function (global) {
  "use strict";
  const { Platform, SectionHost, OptionsSections } = global;

  document.getElementById("version").textContent = Platform.api.runtime.getManifest().version;
  document.getElementById("popup-sub").textContent = Platform.t("popupSub", "Address bar to issue.");

  const open = document.getElementById("open-options");
  open.textContent = Platform.t("openSettings", "Open settings");
  open.addEventListener("click", () => Platform.api.runtime.openOptionsPage());

  SectionHost.start({ root: document.getElementById("sections"), sections: OptionsSections });
})(globalThis);
