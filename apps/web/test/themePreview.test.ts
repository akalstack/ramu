import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { DEFAULT_THEME } from '@ramu/shared/theme'
import { SettingsFieldContext } from '../src/settings/settingsField'

vi.mock('../src/i18n', () => ({
  t: (text: string) => text,
  useLanguage: () => {},
}))
const { ThemePreview, previewVariables } = await import('../src/theme/ThemePreview')

it('renders production transcript and form surfaces in each appearance', () => {
  for (const variant of [DEFAULT_THEME.light, DEFAULT_THEME.dark]) {
    const html = renderToStaticMarkup(createElement(ThemePreview, { variant }))
    expect(html).toContain('role="group" aria-label="Preview of the theme"')
    expect(html).toContain('data-slot="bubble-content"')
    expect(html).toContain('data-question-request="theme-preview"')
    expect(html).toContain('Verified')
    expect(html).toContain('pnpm test')
    expect(html).toContain('Limit reached')
    expect(html).toContain('aria-label="Message"')
    expect(html).toContain('aria-label="Enabled"')
    expect(html).toContain('Saving…')
  }
})

it('keeps the preview interactive even inside an unavailable settings field', () => {
  const html = renderToStaticMarkup(
    createElement(
      SettingsFieldContext.Provider,
      {
        value: { path: 'example', disabled: true, mixed: false, mark: vi.fn() },
      },
      createElement(ThemePreview, { variant: DEFAULT_THEME.dark }),
    ),
  )
  const input = html.match(/<input[^>]*aria-label="Message"[^>]*>/)?.[0]
  expect(input).toBeDefined()
  expect(input).not.toMatch(/\s(?:disabled|aria-disabled)=/)
  const switchTag = html.match(/<[^>]+role="switch"[^>]*>/)?.[0]
  expect(switchTag).toBeDefined()
  expect(switchTag).not.toMatch(/\s(?:disabled|aria-disabled)=/)
})

it('uses the candidate palette and overlay even when the surrounding app uses another appearance', () => {
  for (const variant of [DEFAULT_THEME.light, DEFAULT_THEME.dark]) {
    const variables = previewVariables(variant) as Record<string, unknown>
    expect(variables['--canvas']).toBe(variant.colors.canvas)
    expect(variables['--primary']).toBe(variant.colors.primary)
    expect(variables.colorScheme).toBe(variant.overlay === 'white' ? 'dark' : 'light')
    expect(variables['--hover']).toContain(variant.overlay === 'white' ? '255 255 255' : '0 0 0')
  }
})

it('uses the selected appearance for native controls even when a candidate chooses another overlay ink', () => {
  expect(previewVariables(DEFAULT_THEME.dark, 'light').colorScheme).toBe('light')
  expect(previewVariables(DEFAULT_THEME.light, 'dark').colorScheme).toBe('dark')
})

it('keeps candidate thumbnails noninteractive', () => {
  const html = renderToStaticMarkup(createElement(ThemePreview, { variant: DEFAULT_THEME.light, compact: true }))
  expect(html).toContain('role="img"')
  expect(html).not.toContain('<button')
  expect(html).not.toContain('<input')
})
