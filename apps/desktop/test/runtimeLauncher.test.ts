import { expect, it } from 'vitest'
import { pinnedRuntime } from '../src/main/runtimeLauncher'

it('does not snapshot a development Electron.app with a daemon outside its bundle', () => {
  const dir = '/tmp/ramu-user-data'
  const daemonPath = '/project/out/main/daemon.js',
    executable = '/project/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
  expect(pinnedRuntime(dir, daemonPath, executable)).toEqual({ daemonPath, executable })
})
