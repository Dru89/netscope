// electron-builder config for nightly builds. Extends the base config from
// package.json and overrides the publish channel so electron-builder emits
// nightly-mac.yml / nightly.yml / nightly-linux.yml instead of the default
// latest-* manifests. Nightly apps are configured (via __BUILD_CHANNEL__) to
// check these manifests, so stable users are never offered nightly updates.

/** @type {import('electron-builder').Configuration} */
const base = require("./package.json").build;

module.exports = {
  ...base,
  publish: base.publish.map((p) => ({ ...p, channel: "nightly" })),
};
