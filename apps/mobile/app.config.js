// Optional deployment configuration, supplied by the build owner without committing credentials.
module.exports = ({ config }) => ({
  ...config,
  extra: { ...config.extra, ...(process.env.EXPO_PUBLIC_EAS_PROJECT_ID ? { eas: { projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID } } : {}) },
  android: { ...config.android, ...(process.env.RAMU_GOOGLE_SERVICES_FILE ? { googleServicesFile: process.env.RAMU_GOOGLE_SERVICES_FILE } : {}) },
})
