const { withDangerousMod } = require('expo/config-plugins')
const { readFile, writeFile } = require('node:fs/promises')
const { join } = require('node:path')

// WebRTC 155.0.1 ships an orphan Dav1dDecoderJni class without Dav1dDecoder or
// its Natives interface. Its software decoder factory uses the native factory
// instead. R8's generated missing_rules.txt recommends this exact exclusion;
// keep all other missing-class diagnostics enabled.
const rule = '-dontwarn org.webrtc.Dav1dDecoder$Natives'
module.exports = (config) =>
  withDangerousMod(config, [
    'android',
    async (config) => {
      const file = join(config.modRequest.platformProjectRoot, 'app', 'proguard-rules.pro')
      const source = await readFile(file, 'utf8')
      if (!source.split(/\r?\n/).some((line) => line.trim() === rule))
        await writeFile(file, `${source}\n# Orphan JNI stub in org.jitsi:webrtc:155.0.1.\n${rule}\n`)
      return config
    },
  ])
