// Two Android apps from one code base, side by side on the phone:
//   "Mimaar"      pk.siteoffice.app  the current Mimaar app (app.json as it is)
//   "Mimaar ERP"  pk.siteoffice.erp  opens a Mimaar ERP (ERPNext) site
// The build picks one with APP_VARIANT=erp.
const fs = require("fs");
const path = require("path");
const { withAndroidManifest } = require("expo/config-plugins");

// Mimaar ERP also opens the laptop test set-up on the Wi-Fi (http://192.168.x.x:8081),
// so plain http must be allowed; the cloud site itself is always https.
const allowHttp = (cfg) => withAndroidManifest(cfg, (c) => {
  const app = c.modResults.manifest.application[0];
  app.$["android:usesCleartextTraffic"] = "true";
  return c;
});

// "Buildiary"  app.buildiary  the Buildiary cloud app (internal variant name "mabni"): opens the customer's workspace (<name>.buildiary.app)
const mabni = (config) => {
  const version = fs.readFileSync(path.join(__dirname, "..", "MABNI_VERSION"), "utf8").trim();
  const [a, b, c] = version.split(".").map(Number);
  const blue = "#1E3A5F";
  return allowHttp({
    ...config,
    name: "Buildiary",
    slug: "buildiary",
    scheme: "buildiary",
    version,
    icon: "./assets/buildiary-icon.png",
    android: {
      ...config.android,
      package: "app.buildiary",
      versionCode: a * 10000 + b * 100 + c,
      adaptiveIcon: { foregroundImage: "./assets/buildiary-adaptive.png", backgroundColor: blue },
    },
    ios: {
      bundleIdentifier: "app.buildiary",
      buildNumber: String(a * 10000 + b * 100 + c),
      supportsTablet: true,
      infoPlist: {
        NSCameraUsageDescription: "The camera takes photos of materials, bills, site cards and progress on site.",
        NSLocationWhenInUseUsageDescription: "Your location is stamped on site photos and attendance to show they were taken on site.",
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    splash: { image: "./assets/buildiary-splash.png", resizeMode: "contain", backgroundColor: blue },
    extra: { ...config.extra, variant: "mabni", baseDomain: process.env.BUILDIARY_BASE_DOMAIN || process.env.MABNI_BASE_DOMAIN || "buildiary.app" },
  });
};

module.exports = ({ config }) => {
  if (process.env.APP_VARIANT === "mabni") return mabni(config);
  if (process.env.APP_VARIANT !== "erp") return { ...config, extra: { ...config.extra, variant: "classic" } };
  const version = fs.readFileSync(path.join(__dirname, "..", "ERP_VERSION"), "utf8").trim();
  const [a, b, c] = version.split(".").map(Number);
  const blue = "#1d3b6e";
  return allowHttp({
    ...config,
    name: "Mimaar ERP",
    scheme: "mimaarerp",
    version,
    android: {
      ...config.android,
      package: "pk.siteoffice.erp",
      versionCode: a * 10000 + b * 100 + c,
      adaptiveIcon: { ...config.android.adaptiveIcon, backgroundColor: blue },
    },
    splash: { ...config.splash, backgroundColor: blue },
    extra: { ...config.extra, variant: "erp" },
  });
};
