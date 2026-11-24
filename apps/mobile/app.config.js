// A fork can point at its own Expo project and Firebase app without editing app.json; no credentials are committed.
// react-native-screens compiles its experimental ScrollViewMarker (native scroll-edge effect) only when this
// is set while pods install. Prebuild and EAS evaluate this file first, so it defaults on; set it to 0 to opt out.
process.env.RNS_GAMMA_ENABLED ??= '1'

// The release this build comes from, such as 0.1.0-alpha.25. The stores only take plain numbers as the app version,
// so `version` stays the store's; the phone shows this one, which matches the desktop and the host.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Expo loads this file as CommonJS.
const releaseVersion = require('../../package.json').version

module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    releaseVersion,
    ...(process.env.EXPO_PUBLIC_EAS_PROJECT_ID ? { eas: { projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID } } : {}),
  },
  android: {
    ...config.android,
    ...(process.env.RAMU_GOOGLE_SERVICES_FILE ? { googleServicesFile: process.env.RAMU_GOOGLE_SERVICES_FILE } : {}),
  },
})
