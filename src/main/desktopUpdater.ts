import { app, autoUpdater } from 'electron'
import { createServer, type Server } from 'node:http'
import { createReadStream, existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import type { AppUpdateStatus } from '../shared/updates'

/** The detached service stages GitHub assets; Electron verifies and installs them.
 * This object never restarts the daemon and never calls quitAndInstall automatically. */
export class DesktopUpdater {
  private server?: Server
  private preparing?: Promise<void>
  private preparedVersion = ''
  ready = false
  error: string | null = null
  readonly supported: boolean
  constructor(private userData: string, private changed: () => void) {
    const bundle = process.execPath.slice(0, process.execPath.indexOf('.app/Contents/MacOS/') + 4)
    const signature = app.isPackaged && process.platform === 'darwin' ? spawnSync('/usr/bin/codesign', ['-dv', '--verbose=4', bundle], { encoding: 'utf8' }) : null
    this.supported = !!signature && signature.status === 0 && /TeamIdentifier=[A-Z0-9]{10}\b/.test(signature.stderr)
    autoUpdater.on('update-downloaded', () => { this.ready = true; this.changed() })
    autoUpdater.on('error', (error) => { this.error = error.message; this.preparedVersion = ''; this.changed() })
  }
  prepare(status: AppUpdateStatus): Promise<void> {
    if (!this.supported || status.phase !== 'ready' || !status.release || status.release.version === app.getVersion()) return Promise.resolve()
    if (this.preparing) return this.preparing
    if (this.preparedVersion === status.release.version) return Promise.resolve()
    this.preparing = (async () => {
      const release = status.release!
      const path = join(this.userData, 'app-updates', release.assetName)
      if (!/^[\w.-]+\.zip$/.test(release.assetName) || !existsSync(path)) throw new Error('Downloaded update is missing')
      this.server?.close()
      const token = randomBytes(24).toString('hex')
      const server = createServer((request, response) => {
        if (request.method !== 'GET') { response.writeHead(405).end(); return }
        if (request.url === `/${token}/feed`) {
          const address = server.address()
          if (!address || typeof address === 'string') { response.writeHead(503).end(); return }
          response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ url: `http://127.0.0.1:${address.port}/${token}/update.zip`, name: `Ramu ${release.version}`, notes: `Update from ${release.notesUrl}`, pub_date: release.publishedAt }))
        } else if (request.url === `/${token}/update.zip`) {
          response.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': release.size })
          const stream = createReadStream(path); stream.on('error', () => response.destroy()); stream.pipe(response)
        } else response.writeHead(404).end()
      })
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve() }) })
      this.server = server
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Could not start local update feed')
      this.error = null; this.ready = false; this.preparedVersion = release.version
      autoUpdater.setFeedURL({ url: `http://127.0.0.1:${address.port}/${token}/feed` })
      autoUpdater.checkForUpdates()
    })().catch((error) => { this.error = String(error); this.changed() }).finally(() => { this.preparing = undefined })
    return this.preparing
  }
  install() { if (!this.ready) throw new Error(this.error ?? 'The native app update is not ready yet'); autoUpdater.quitAndInstall() }
  close() { this.server?.close() }
}
