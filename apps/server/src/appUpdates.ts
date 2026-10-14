import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { newerVersion } from '@ramu/shared/version'
import { APP_AUTO_UPDATE, type AppRelease, type AppUpdateStatus } from '@ramu/shared/updates'
import type { AppPreferences } from '@ramu/shared/types'

export const RAMU_RELEASES = 'https://github.com/ahxar/ramu/releases'
const assetSchema = z.object({ name: z.string(), size: z.number().int().positive(), browser_download_url: z.string().url() })
const releaseSchema = z.object({ tag_name: z.string(), draft: z.boolean(), prerelease: z.boolean(), html_url: z.string().url(), published_at: z.string(), assets: z.array(assetSchema) })
export function releaseAssetUrl(url: string): boolean {
  try { const parsed = new URL(url); return parsed.origin === 'https://github.com' && parsed.pathname.startsWith('/ahxar/ramu/releases/download/') } catch { return false }
}
export function parseAppRelease(data: unknown, platform = process.platform, arch = process.arch): AppRelease | null {
  const release = releaseSchema.parse(data)
  if (release.draft || release.prerelease || !/^v\d+\.\d+\.\d+$/.test(release.tag_name)) return null
  const prefix = `${platform}-${arch}-`
  const asset = release.assets.find((item) => item.name.startsWith(prefix) && /^[\w.-]+\.zip$/.test(item.name))
  const sums = release.assets.find((item) => item.name === `SHA256SUMS-${platform}-${arch}.txt`)
  if (!asset || !sums || !releaseAssetUrl(asset.browser_download_url) || !releaseAssetUrl(sums.browser_download_url)) return null
  if (!release.html_url.startsWith(`${RAMU_RELEASES}/tag/`)) throw new Error('Invalid release URL')
  return { version: release.tag_name.slice(1), notesUrl: release.html_url, publishedAt: release.published_at, assetUrl: asset.browser_download_url, assetName: asset.name, size: asset.size, checksumsUrl: sums.browser_download_url }
}
export function assetChecksum(text: string, name: string): string {
  const entries = text.split('\n').map((line) => /^([a-f0-9]{64})\s+\*?(.+)$/.exec(line.trim())).filter((entry) => entry?.[2] === name)
  if (entries.length !== 1) throw new Error('The release must contain exactly one checksum for this update')
  return entries[0]![1]!
}

/** Checks and checksum-verified staging live in the daemon, not the window.
 * Applying an update belongs to Electron and always requires a user's restart choice. */
export class AppUpdateService {
  private timer?: NodeJS.Timeout
  private running?: Promise<AppUpdateStatus>
  private downloading?: Promise<AppUpdateStatus>
  private closed = false
  private generation = 0
  private abort = new AbortController()
  private state: AppUpdateStatus
  readonly directory: string
  constructor(userData: string, currentVersion: string, private preferences: () => Pick<AppPreferences, 'appUpdateChecks' | 'appAutoUpdate'>, private emit: (state: AppUpdateStatus) => void) {
    this.directory = join(userData, 'app-updates')
    this.state = { currentVersion, phase: 'idle', release: null, checkedAt: null, error: null, downloadedBytes: 0 }
    try {
      const saved = JSON.parse(readFileSync(join(this.directory, 'ready.json'), 'utf8')) as { release: AppRelease; checksum: string }
      const parsed = z.object({ release: z.object({ version: z.string().regex(/^\d+\.\d+\.\d+$/), assetName: z.string().regex(/^[\w.-]+\.zip$/), assetUrl: z.string().refine(releaseAssetUrl), size: z.number().positive(), checksumsUrl: z.string().refine(releaseAssetUrl), notesUrl: z.string(), publishedAt: z.string() }), checksum: z.string().regex(/^[a-f0-9]{64}$/) }).parse(saved)
      const path = join(this.directory, parsed.release.assetName)
      if (existsSync(path) && newerVersion(parsed.release.version, currentVersion) && createHash('sha256').update(readFileSync(path)).digest('hex') === parsed.checksum) this.state = { ...this.state, phase: 'ready', release: parsed.release, downloadedBytes: parsed.release.size }
    } catch {}
    this.settingsChanged()
  }
  status() { return structuredClone(this.state) }
  private change(patch: Partial<AppUpdateStatus>) { this.state = { ...this.state, ...patch }; this.emit(this.status()) }
  settingsChanged() {
    this.generation++; clearTimeout(this.timer)
    if (!this.closed && (this.preferences().appUpdateChecks || this.preferences().appAutoUpdate)) { this.timer = setTimeout(() => void this.automatic(), 45_000); this.timer.unref() }
  }
  private async automatic() {
    const generation = this.generation
    try { const status = await this.check(); if (!this.closed && generation === this.generation && APP_AUTO_UPDATE && this.preferences().appAutoUpdate && status.phase === 'available') await this.download() } catch {}
    if (!this.closed && (this.preferences().appUpdateChecks || this.preferences().appAutoUpdate)) { this.timer = setTimeout(() => void this.automatic(), 6 * 60 * 60_000); this.timer.unref() }
  }
  check(): Promise<AppUpdateStatus> {
    if (this.closed) return Promise.reject(new Error('Update service is stopping'))
    if (this.running) return this.running
    if (this.downloading) return this.downloading
    this.running = (async () => {
      const ready = this.state.phase === 'ready'
      this.change({ phase: 'checking', error: null })
      try {
        const response = await fetch('https://api.github.com/repos/ahxar/ramu/releases/latest', { signal: AbortSignal.any([AbortSignal.timeout(20_000), this.abort.signal]), headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Ramu-updates', 'X-GitHub-Api-Version': '2022-11-28' } })
        if (response.status === 404) { this.change({ phase: ready ? 'ready' : 'idle', checkedAt: new Date().toISOString() }); return this.status() }
        if (!response.ok) throw new Error(`GitHub update check failed (HTTP ${response.status})`)
        const text = await response.text(); if (text.length > 2_000_000) throw new Error('Release response too large')
        const release = parseAppRelease(JSON.parse(text))
        if (release && newerVersion(release.version, this.state.currentVersion)) this.change({ phase: ready && release.version === this.state.release?.version ? 'ready' : 'available', release, checkedAt: new Date().toISOString() })
        else this.change({ phase: ready ? 'ready' : 'idle', checkedAt: new Date().toISOString(), ...(ready ? {} : { release: null }) })
      } catch (error) { this.change({ phase: ready ? 'ready' : 'error', error: String(error) }) }
      return this.status()
    })().finally(() => { this.running = undefined })
    return this.running
  }
  download(): Promise<AppUpdateStatus> {
    if (this.downloading) return this.downloading
    if (this.closed) return Promise.reject(new Error('Update service is stopping'))
    const release = this.state.release
    if (!release) return Promise.reject(new Error('Check for an update first'))
    if (this.state.phase === 'ready') return Promise.resolve(this.status())
    this.downloading = (async () => {
      const temporary = join(this.directory, `${randomUUID()}.partial`)
      mkdirSync(this.directory, { recursive: true, mode: 0o700 })
      this.change({ phase: 'downloading', downloadedBytes: 0, error: null })
      const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(15 * 60_000)])
      let file: Awaited<ReturnType<typeof open>> | undefined
      try {
        const checksumResponse = await fetch(release.checksumsUrl, { signal })
        if (!checksumResponse.ok) throw new Error('Could not download release checksums')
        const text = await checksumResponse.text(); if (text.length > 64_000) throw new Error('Checksum response too large')
        const checksum = assetChecksum(text, release.assetName)
        const response = await fetch(release.assetUrl, { signal })
        if (!response.ok || !response.body) throw new Error('Could not download app update')
        file = await open(temporary, 'wx', 0o600)
        const hash = createHash('sha256'); let size = 0, lastProgress = 0
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
          size += chunk.byteLength; if (size > release.size || size > 2_000_000_000) throw new Error('Update size exceeded release metadata')
          hash.update(chunk); await file.writeFile(chunk)
          if (Date.now() - lastProgress > 1000) { this.change({ downloadedBytes: size }); lastProgress = Date.now() }
        }
        if (size !== release.size || hash.digest('hex') !== checksum) throw new Error('Update checksum or size did not match the release')
        await file.close(); file = undefined
        renameSync(temporary, join(this.directory, release.assetName))
        writeFileSync(join(this.directory, 'ready.json'), JSON.stringify({ release, checksum }), { mode: 0o600 })
        this.change({ phase: 'ready', downloadedBytes: size })
      } catch (error) { this.change({ phase: 'error', error: String(error) }) }
      finally { await file?.close(); rmSync(temporary, { force: true }) }
      return this.status()
    })().finally(() => { this.downloading = undefined })
    return this.downloading
  }
  close() { this.closed = true; clearTimeout(this.timer); this.abort.abort() }
}
