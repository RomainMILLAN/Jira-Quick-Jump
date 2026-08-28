/**
 * A search domain the user added themselves.
 *
 * Only the HOST is user-supplied. The path and the query parameter — the parts
 * the regex is actually built from — come from a closed set of shapes in the
 * interception catalogue, because a user-supplied path or parameter means a
 * user-supplied regex, and that is a validation surface this project refuses.
 *
 * The shape is carried here as an opaque string. The core does not know what
 * shapes exist; the airlock filters an unknown one exactly as it filters an
 * unknown engine id.
 */
(function (global) {
  "use strict";

  // A plain host name. No scheme, no path, no port, no wildcard, no credentials:
  // this value is concatenated into a regex and turned into a permission origin,
  // so anything clever in it is a bug or an attack.
  const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

  class CustomEngine {
    constructor(host, shape) {
      this._host = host;
      this._shape = shape;
    }
    id() { return `custom:${this._host}`; }
    host() { return this._host; }
    shape() { return this._shape; }
    label() { return this._host; }
    toJSON() { return { host: this._host, shape: this._shape }; }
  }

  CustomEngine.parse = function (raw) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return { ok: false, code: "ENGINE_NOT_AN_OBJECT", message: "A search domain must be an object." };
    }
    for (const field of Object.keys(raw)) {
      if (field !== "host" && field !== "shape") {
        return { ok: false, code: "UNKNOWN_FIELD", message: `Unknown field "${field}" on a search domain.` };
      }
    }
    if (typeof raw.host !== "string") {
      return { ok: false, code: "HOST_NOT_A_STRING", message: "Enter a domain such as google.it." };
    }
    const host = raw.host.trim().toLowerCase();
    if (host.length > 100) {
      return { ok: false, code: "HOST_TOO_LONG", message: "That domain is too long." };
    }
    if (!HOST.test(host)) {
      return {
        ok: false,
        code: "HOST_SHAPE",
        message: "Enter the domain alone, like google.it — no https://, no path, no wildcard.",
      };
    }
    if (typeof raw.shape !== "string" || !/^[a-z-]{1,32}$/.test(raw.shape)) {
      return { ok: false, code: "SHAPE_SHAPE", message: "Pick how that engine builds its search URL." };
    }
    return { ok: true, value: new CustomEngine(host, raw.shape) };
  };

  global.CustomEngine = CustomEngine;
})(globalThis);
