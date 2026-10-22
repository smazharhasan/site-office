// Two Android apps from one code base, side by side on the phone:
//   "Mimaar"      pk.siteoffice.app  the current Mimaar app (app.json as it is)
//   "Mimaar ERP"  pk.siteoffice.erp  opens a Mimaar ERP (ERPNext) site
// The build picks one with APP_VARIANT=erp.
const fs = require("fs");
const path = require("path");

module.exports = ({ config }) => {
  if (process.env.APP_VARIANT !== "erp") return { ...config, extra: { ...config.extra, variant: "classic" } };
  const version = fs.readFileSync(path.join(__dirname, "..", "ERP_VERSION"), "utf8").trim();
  const [a, b, c] = version.split(".").map(Number);
  const blue = "#1d3b6e";
  return {
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
  };
};
