import { execFileSync } from 'node:child_process'
// node-pty 1.1.0 publishes its macOS/Linux spawn-helper prebuilds without the
// executable bit, which makes every pty.spawn fail with "posix_spawnp failed".
import { chmodSync, existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const ptyRoot = dirname(require.resolve('node-pty/package.json'))
const candidates = [join(ptyRoot, 'build', 'Release', 'spawn-helper')]
const prebuilds = join(ptyRoot, 'prebuilds')
if (existsSync(prebuilds)) {
  for (const dir of readdirSync(prebuilds)) candidates.push(join(prebuilds, dir, 'spawn-helper'))
}
for (const file of candidates) {
  if (existsSync(file)) chmodSync(file, 0o755)
}

// macOS reads the development host's bundle identity for the Dock and app switcher.
// Only patch the local Electron host; Forge sets these values in release bundles.
if (process.platform === 'darwin') {
  const electronRoot = dirname(require.resolve('electron/package.json'))
  const plist = join(electronRoot, 'dist', 'Electron.app', 'Contents', 'Info.plist')
  if (existsSync(plist)) for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
    execFileSync('/usr/bin/plutil', ['-replace', key, '-string', 'Ramu', plist])
  }
}
