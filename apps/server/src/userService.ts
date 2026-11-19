// `ramu up` keeps a command-line host running as a per-user service: a systemd user unit on Linux, a LaunchAgent on
// macOS. Each runs the same `ramu serve` this process was started as, with no shell in between.
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const LABEL = 'app.ramu.server'

export type ServiceOutcome = { installed: true; path: string } | { installed: false; reason: string }

const xml = (text: string) =>
  text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!)
/** systemd splits ExecStart on spaces; quote each word and escape what it treats specially. */
const unitWord = (text: string) => `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%')}"`

export function systemdUnit(node: string, cli: string, dataDir: string | undefined): string {
  const words = [node, cli, 'serve', ...(dataDir ? ['--data-dir', dataDir] : [])]
  return `[Unit]
Description=Ramu workspace server
After=network-online.target

[Service]
ExecStart=${words.map(unitWord).join(' ')}
Restart=on-failure

[Install]
WantedBy=default.target
`
}

export function launchAgent(node: string, cli: string, dataDir: string | undefined): string {
  const args = [node, cli, 'serve', ...(dataDir ? ['--data-dir', dataDir] : [])]
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((arg) => `    <string>${xml(arg)}</string>`).join('\n')}
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
</dict>
</plist>
`
}

export function installUserService(cli: string, dataDir: string | undefined): ServiceOutcome {
  const node = process.execPath
  if (process.platform === 'linux') {
    const dir = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'systemd', 'user')
    mkdirSync(dir, { recursive: true })
    const path = join(dir, 'ramu.service')
    writeFileSync(path, systemdUnit(node, cli, dataDir))
    const reload = spawnSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' })
    const enable = spawnSync('systemctl', ['--user', 'enable', '--now', 'ramu.service'], { stdio: 'ignore' })
    if (reload.status !== 0 || enable.status !== 0)
      return { installed: false, reason: `Wrote ${path}, but systemctl --user could not start it.` }
    return { installed: true, path }
  }
  if (process.platform === 'darwin') {
    const dir = join(homedir(), 'Library', 'LaunchAgents')
    mkdirSync(dir, { recursive: true })
    const path = join(dir, `${LABEL}.plist`)
    writeFileSync(path, launchAgent(node, cli, dataDir))
    const domain = `gui/${process.getuid?.() ?? 0}`
    spawnSync('launchctl', ['bootout', `${domain}/${LABEL}`], { stdio: 'ignore' })
    const loaded = spawnSync('launchctl', ['bootstrap', domain, path], { stdio: 'ignore' })
    if (loaded.status !== 0) return { installed: false, reason: `Wrote ${path}, but launchctl could not load it.` }
    return { installed: true, path }
  }
  return { installed: false, reason: 'Keep `ramu serve` running in a terminal on this computer.' }
}
