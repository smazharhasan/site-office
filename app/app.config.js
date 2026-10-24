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

// "Mabni"  app.mabni  the Mabni Cloud app: opens the customer's workspace (<name>.mabni.app)
const mabni = (config) => {
  const version = fs.readFileSync(path.join(__dirname, "..", "MABNI_VERSION"), "utf8").trim();
  const [a, b, c] = version.split(".").map(Number);
  const blue = "#1E3A5F";
  return allowHttp({
    ...config,
    name: "Mabni",
    slug: "mabni",
    scheme: "mabni",
    version,
    icon: "./assets/mabni-icon.png",
    android: {
      ...config.android,
      package: "app.mabni",
      versionCode: a * 10000 + b * 100 + c,
      adaptiveIcon: { foregroundImage: "./assets/mabni-adaptive.png", backgroundColor: blue },
    },
    ios: {
      bundleIdentifier: "app.mabni",
      buildNumber: String(a * 10000 + b * 100 + c),
      supportsTablet: true,
      infoPlist: {
        NSCameraUsageDescription: "The camera takes photos of materials, bills, site cards and progress on site.",
        NSLocationWhenInUseUsageDescription: "Your location is stamped on site photos and attendance to show they were taken on site.",
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    splash: { image: "./assets/mabni-splash.png", resizeMode: "contain", backgroundColor: blue },
    extra: { ...config.extra, variant: "mabni", baseDomain: process.env.MABNI_BASE_DOMAIN || "mabni.app" },
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
