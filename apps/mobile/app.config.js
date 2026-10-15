// Optional deployment configuration, supplied by the build owner without committing credentials.
// react-native-screens compiles its experimental ScrollViewMarker (native scroll-edge effect) only when this
// is set while pods install. Prebuild and EAS evaluate this file first, so it defaults on; set it to 0 to opt out.
process.env.RNS_GAMMA_ENABLED ??= '1'

module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    ...(process.env.EXPO_PUBLIC_EAS_PROJECT_ID ? { eas: { projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID } } : {}),
  },
  android: {
    ...config.android,
    ...(process.env.RAMU_GOOGLE_SERVICES_FILE ? { googleServicesFile: process.env.RAMU_GOOGLE_SERVICES_FILE } : {}),
  },
})
