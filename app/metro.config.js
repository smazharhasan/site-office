// Supabase's realtime client pulls in Node's "ws" through package exports;
// turning package exports off makes Metro use the React Native build.
const { getDefaultConfig } = require("expo/metro-config");
const config = getDefaultConfig(__dirname);
config.resolver.unstable_enablePackageExports = false;
module.exports = config;
