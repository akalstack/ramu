import { expect, it } from 'vitest'
import { DEFAULT_THEME } from '../src/theme'
import { parseThemeEditorUpdate } from '../src/themePreview'
const update = () => ({
  ramuThemePreview: 1,
  type: 'update',
  instance: 'one',
  request: 1,
  appearance: 'light',
  view: 'diff',
  split: false,
  variant: DEFAULT_THEME.light,
})
it('accepts only palette and view data and drops executable-looking extensions', () => {
  const parsed = parseThemeEditorUpdate({
    ...update(),
    source: 'run()',
    path: '/private',
    command: 'do something',
    variant: { ...DEFAULT_THEME.light, script: 'run()' },
  })
  expect(parsed).toEqual(update())
  expect(parsed).not.toHaveProperty('source')
  expect(parsed?.variant).not.toHaveProperty('script')
})
it('rejects invalid appearance, view, color and request data before it reaches the renderer', () => {
  for (const patch of [
    { appearance: 'system' },
    { view: 'browser' },
    { request: 0 },
    { request: Infinity },
    { request: 1.5 },
    { split: 'yes' },
    { instance: 'a'.repeat(161) },
    { instance: '' },
    { variant: { overlay: 'white', colors: {} } },
  ])
    expect(parseThemeEditorUpdate({ ...update(), ...patch })).toBeNull()
  expect(
    parseThemeEditorUpdate({
      ...update(),
      variant: { ...DEFAULT_THEME.light, colors: { ...DEFAULT_THEME.light.colors, canvas: 'red;script()' } },
    }),
  ).toBeNull()
})
