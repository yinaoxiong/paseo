const path = require("node:path");

module.exports = {
  extends: path.join(__dirname, "electron-builder.yml"),
  afterPack: path.join(__dirname, "scripts/after-pack.js"),
  afterSign: path.join(__dirname, "scripts/after-sign.js"),
  // Personal builds are installed manually. Runtime update checks are disabled.
  publish: [{ provider: "github", owner: "yinaoxiong", repo: "paseo", publishAutoUpdate: false }],
  forceCodeSigning: false,
  mac: { notarize: false, identity: null },
  nsis: { runAfterFinish: false, allowElevation: false },
};
