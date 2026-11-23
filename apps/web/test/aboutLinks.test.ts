import { expect, it } from 'vitest'
import { bugReportUrl, releaseNotesUrl } from '../src/settings/aboutLinks'

it('opens a bug report with the version and system filled in, and the release notes for that version', () => {
  const report = new URL(bugReportUrl('0.1.0-alpha.17', 'macOS'))
  expect(report.pathname).toBe('/akalstack/ramu/issues/new')
  expect(report.searchParams.get('template')).toBe('bug_report.yml')
  expect(report.searchParams.get('environment')).toBe('Ramu 0.1.0-alpha.17 on macOS')
  expect(releaseNotesUrl('0.1.0-alpha.17')).toBe('https://github.com/akalstack/ramu/releases/tag/v0.1.0-alpha.17')
  expect(releaseNotesUrl(null)).toBe('https://github.com/akalstack/ramu/releases')
})
