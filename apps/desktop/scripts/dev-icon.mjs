// `pnpm dev` runs the stock Electron.app, whose icon is Electron's. Give it Ramu's Liquid Glass icon (macOS 26+) the same way a
// packaged build gets it: Assets.car beside the app's resources and CFBundleIconName in its Info.plist. Never fails the dev start.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'darwin') process.exit(0)
try {
  const electron = dirname(createRequire(import.meta.url).resolve('electron/package.json'))
  const app = join(electron, 'dist', 'Electron.app')
  const car = join(dirname(fileURLToPath(import.meta.url)), '../../../assets/Assets.car')
  const plist = join(app, 'Contents', 'Info.plist')
  if (!existsSync(app) || !existsSync(car)) process.exit(0)
  const target = join(app, 'Contents', 'Resources', 'Assets.car')
  const done = join(app, 'Contents', 'Resources', '.ramu-icon')
  const stamp = String(readFileSync(car).length)
  if (existsSync(done) && readFileSync(done, 'utf8') === stamp) process.exit(0)
  copyFileSync(car, target)
  const edit = (command) => execFileSync('/usr/libexec/PlistBuddy', ['-c', command, plist], { stdio: 'ignore' })
  try { edit('Set :CFBundleIconName Ramu') } catch { edit('Add :CFBundleIconName string Ramu') }
  // Changing the bundle invalidates its signature; ad-hoc signing keeps it launchable.
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'ignore' })
  writeFileSync(done, stamp)
  console.log('Ramu Liquid Glass icon applied to the dev Electron app (restart the Dock if the old icon lingers: killall Dock).')
} catch (error) { console.warn(`Could not apply the dev icon: ${error instanceof Error ? error.message : error}`) }
