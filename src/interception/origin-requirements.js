/**
 * Which host permissions the policy needs.
 *
 * A DNR redirect requires host access to BOTH the intercepted URL and the
 * destination, so the set is a function of the policy. This collaborator is the
 * one that speaks both languages -- the policy itself only holds opaque engine
 * ids.
 */
(function (global) {
  "use strict";

  const OriginRequirements = {
    /**
     * Includes the origins of ALL shortcuts, disarmed ones too: one permission
     * prompt rather than a fresh one every time a shortcut is re-armed.
     */
    requiredOrigins(policy, catalog) {
      const origins = new Set();
      for (const engineId of policy.engineIds()) {
        const engine = catalog.find(engineId);
        if (engine) for (const origin of engine.permissionOrigins) origins.add(origin);
      }
      for (const shortcut of policy.shortcuts()) {
        origins.add(shortcut.instance().permissionOrigin());
      }
      return [...origins];
    },
  };

  global.OriginRequirements = OriginRequirements;
})(globalThis);
