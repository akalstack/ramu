// `pnpm dev` runs the stock Electron.app, whose icon is Electron's. Give it Ramu's Liquid Glass icon (macOS 26+) the same way a
// packaged build gets it: Assets.car beside the app's resources and CFBundleIconName in its Info.plist. LaunchServices keeps
// the Info.plist it first saw, so the patched bundle is registered again or the Dock keeps showing the old icon.
import { copyFileSync, existsSync, readFileSync, realpathSync, utimesSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const LSREGISTER =
  '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'

function runningFrom(app) {
  try {
    return execFileSync('/usr/bin/pgrep', ['-f', join(app, 'Contents', '')], { encoding: 'utf8' }).trim() !== ''
  } catch {
    // pgrep exits 1 when nothing matches.
    return false
  }
}

/** Never fails the dev start. */
export function applyDevIcon() {
  if (process.platform !== 'darwin') return
  try {
    const electron = dirname(createRequire(import.meta.url).resolve('electron/package.json'))
    const app = realpathSync(join(electron, 'dist', 'Electron.app'))
    const car = join(dirname(fileURLToPath(import.meta.url)), '../../../assets/Assets.car')
    if (!existsSync(car)) return
    // Outside the bundle, so writing it after signing leaves the signature intact.
    const done = join(dirname(app), '.ramu-icon')
    // The stamp changes with the icon and with how it is applied, so an older patch is redone.
    const stamp = `2:${readFileSync(car).length}`
    if (existsSync(done) && readFileSync(done, 'utf8') === stamp) return
    // Re-signing under a running process (such as the background service) leaves its code no longer matching the disk,
    // and macOS then refuses it the keychain, so every saved credential reads as locked until it restarts.
    if (runningFrom(app)) {
      console.log(
        'Ramu dev icon not applied while Ramu runs from this Electron; quit Ramu and its background service first.',
      )
      return
    }
    copyFileSync(car, join(app, 'Contents', 'Resources', 'Assets.car'))
    const plist = join(app, 'Contents', 'Info.plist')
    const edit = (command) => execFileSync('/usr/libexec/PlistBuddy', ['-c', command, plist], { stdio: 'ignore' })
    try {
      edit('Set :CFBundleIconName Ramu')
    } catch {
      edit('Add :CFBundleIconName string Ramu')
    }
    // Changing the bundle invalidates its signature; ad-hoc signing keeps it launchable.
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'ignore' })
    // Electron ships its files dated 1980; a fresh date stops LaunchServices treating the bundle as unchanged.
    const now = new Date()
    utimesSync(app, now, now)
    execFileSync(LSREGISTER, ['-f', app], { stdio: 'ignore' })
    writeFileSync(done, stamp)
    console.log(
      'Ramu Liquid Glass icon applied to the dev Electron app (if the Dock still shows the old one: killall Dock).',
    )
  } catch (error) {
    console.warn(`Could not apply the dev icon: ${error instanceof Error ? error.message : error}`)
  }
}
