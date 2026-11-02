import { expect, it } from 'vitest'
import { launchAgent, systemdUnit } from '../src/userService'

it('quotes every word of the systemd command so paths with spaces and percent signs survive', () => {
  const unit = systemdUnit('/opt/node 24/bin/node', '/srv/ramu/cli.js', '/home/me/100% data')
  expect(unit).toContain(
    'ExecStart="/opt/node 24/bin/node" "/srv/ramu/cli.js" "serve" "--data-dir" "/home/me/100%% data"',
  )
})

it('escapes launchd arguments as XML and omits the data directory when it is the default', () => {
  const plist = launchAgent('/usr/local/bin/node', '/Apps/R&D/cli.js', undefined)
  expect(plist).toContain('<string>/Apps/R&amp;D/cli.js</string>')
  expect(plist).not.toContain('--data-dir')
})
