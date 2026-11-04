// `pnpm dev`: electron-vite ends with the app it started, so a relaunch would leave the new app on a dev server that is
// gone. The app exits with RELAUNCH instead, and this starts electron-vite again: a real restart, server and all.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const RELAUNCH = 75
const require = createRequire(import.meta.url)
const cli = join(dirname(require.resolve('electron-vite/package.json')), 'bin', 'electron-vite.js')

const run = () => {
  const child = spawn(process.execPath, [cli, 'dev', ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, RAMU_DEV_RELAUNCH: String(RELAUNCH) },
  })
  child.on('exit', (code, signal) => {
    if (code === RELAUNCH) return run()
    process.exit(signal ? 1 : (code ?? 0))
  })
}
run()
