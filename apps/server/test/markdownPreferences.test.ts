import { expect, it } from 'vitest'
import { DEFAULT_APP_PREFERENCES } from '@ramu/shared/types'
import { appPreferences } from '../src/ipc/preferences'

it('defaults older preferences to Markdown Preview and accepts every opening mode', () => {
  expect(appPreferences.parse({ ...DEFAULT_APP_PREFERENCES, defaultMarkdownView: undefined }).defaultMarkdownView).toBe(
    'preview',
  )
  for (const mode of ['source', 'edit', 'preview'] as const)
    expect(appPreferences.parse({ ...DEFAULT_APP_PREFERENCES, defaultMarkdownView: mode }).defaultMarkdownView).toBe(
      mode,
    )
  expect(() => appPreferences.parse({ ...DEFAULT_APP_PREFERENCES, defaultMarkdownView: 'locked' })).toThrow()
})
