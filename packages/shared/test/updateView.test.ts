import { describe, expect, it } from 'vitest'
import type { AppUpdateStatus } from '../src/updates'
import { appUpdateView, updateErrorText } from '../src/updateView'

const release = {
  version: '2.1.0',
  notesUrl: 'https://example.invalid/notes',
  publishedAt: '2026-11-20T00:00:00Z',
  assetUrl: 'https://example.invalid/asset',
  assetName: 'Ramu.zip',
  size: 120_000_000,
  checksumsUrl: 'https://example.invalid/sums',
}
const state = (patch: Partial<AppUpdateStatus>): AppUpdateStatus => ({
  currentVersion: '2.0.0',
  phase: 'idle',
  release: null,
  checkedAt: null,
  error: null,
  downloadedBytes: 0,
  ...patch,
})

describe('appUpdateView', () => {
  it('says the app is current, when it was checked, and offers a check', () => {
    const view = appUpdateView(state({ checkedAt: '2026-11-26T11:55:00Z' }))
    expect(view).toMatchObject({
      tone: 'current',
      title: 'Ramu {0} is up to date',
      detail: 'Checked {1}.',
      action: 'check',
    })
    expect(view).toMatchObject({ values: { 0: '2.0.0' }, checkedAt: Date.parse('2026-11-26T11:55:00Z') })
    expect(appUpdateView(state({})).detail).toBe('Not checked yet.')
  })
  it('walks one row through available, downloading and ready', () => {
    expect(appUpdateView(state({ phase: 'available', release }))).toMatchObject({
      tone: 'offer',
      action: 'download',
    })
    const downloading = appUpdateView(state({ phase: 'downloading', release, downloadedBytes: 60_000_000 }))
    expect(downloading).toMatchObject({ tone: 'busy', action: null, values: { 0: '2.1.0', 1: 60, 2: 120 } })
    expect(appUpdateView(state({ phase: 'ready', release, nativeReady: true }))).toMatchObject({
      tone: 'ready',
      action: 'restart',
    })
    expect(appUpdateView(state({ phase: 'ready', release, nativeReady: false })).action).toBeNull()
    expect(appUpdateView(state({ phase: 'ready', release, supported: false })).action).toBe('installer')
  })
  it('turns a failure into a problem with a retry and readable words', () => {
    const view = appUpdateView(state({ phase: 'error', error: 'TypeError: fetch failed' }))
    expect(view).toMatchObject({ tone: 'problem', title: 'Could not check for updates', action: 'retry' })
    expect(view.detail).toBe('GitHub could not be reached. Check your connection, then try again.')
  })
})

describe('updateErrorText', () => {
  it('names the usual causes and keeps anything else without the Error prefix', () => {
    expect(updateErrorText('Error: GitHub API rate limit exceeded')).toMatch(/limiting/)
    expect(updateErrorText('Error: Update checksum or size did not match the release')).toMatch(/thrown away/)
    expect(updateErrorText('Error: ENOSPC: no space left on device')).toMatch(/disk space/)
    expect(updateErrorText('Error: Release has no asset for this platform')).toBe(
      'Release has no asset for this platform',
    )
    expect(updateErrorText(null)).toBe('Something went wrong. Try again.')
  })
})
