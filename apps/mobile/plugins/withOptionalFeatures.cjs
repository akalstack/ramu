// Google Play treats a feature implied by a permission or a portrait-locked activity as required, which hides the app
// from devices without it. Ramu works without either: Wi-Fi permissions only find hosts nearby (a host can still be
// reached by address or the account), and the portrait lock comes from ML Kit's scanner screens, not Ramu's own.
const { withAndroidManifest } = require('expo/config-plugins')

const OPTIONAL = ['android.hardware.wifi', 'android.hardware.screen.portrait']

module.exports = (config) =>
  withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest
    const features = (manifest['uses-feature'] ??= [])
    for (const name of OPTIONAL) {
      const declared = features.find((feature) => feature.$['android:name'] === name)
      if (declared) declared.$['android:required'] = 'false'
      else features.push({ $: { 'android:name': name, 'android:required': 'false' } })
    }
    return config
  })
