// The Buildiary Android app. The version comes from the VERSION file at the top of the repository;
// the Android version code is made from it (1.1.0 -> 10100), so each new version installs over the last.
const fs = require("fs");
const path = require("path");

module.exports = ({ config }) => {
  const version = fs.readFileSync(path.join(__dirname, "..", "VERSION"), "utf8").trim();
  const [a, b, c] = version.split(".").map(Number);
  const code = a * 10000 + b * 100 + c;
  return {
    ...config,
    version,
    android: { ...config.android, versionCode: code },
    ios: { ...config.ios, buildNumber: String(code) },
    extra: { ...config.extra, baseDomain: process.env.BUILDIARY_BASE_DOMAIN || config.extra.baseDomain },
  };
};
