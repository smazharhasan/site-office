// Metro, Expo's bundler, with package "exports" resolution kept off as the app has always been built.
const { getDefaultConfig } = require("expo/metro-config");
const config = getDefaultConfig(__dirname);
config.resolver.unstable_enablePackageExports = false;
module.exports = config;
