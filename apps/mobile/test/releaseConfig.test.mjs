import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'

const require = createRequire(import.meta.url)
test('Android prebuild retains custom shrinker rules and adds only the orphan WebRTC JNI exclusion once', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ramu-proguard-'))
  try {
    await mkdir(join(directory, 'app'))
    const file = join(directory, 'app', 'proguard-rules.pro')
    await writeFile(file, '# Existing application rules\n-keep class dev.ramu.Example { *; }\n')
    let apply
    const module = { exports: {} }
    runInNewContext(await readFile(new URL('../plugins/withWebRtcProguard.cjs', import.meta.url), 'utf8'), {
      module,
      require: (name) =>
        name === 'expo/config-plugins'
          ? {
              withDangerousMod: (config, [platform, callback]) => {
                assert.equal(platform, 'android')
                apply = callback
                return config
              },
            }
          : require(name),
    })
    const config = { modRequest: { platformProjectRoot: directory } }
    module.exports(config)
    await apply(config)
    await apply(config)
    const source = await readFile(file, 'utf8')
    assert.ok(source.includes('-keep class dev.ramu.Example { *; }'))
    assert.deepEqual(
      source.split('\n').filter((line) => line.startsWith('-dontwarn')),
      ['-dontwarn org.webrtc.Dav1dDecoder$Natives'],
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
