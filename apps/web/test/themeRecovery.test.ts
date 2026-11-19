import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'
import { contrastRatio } from '@ramu/shared/theme'
import { ThemeRecoveryButton } from '../src/components/theme-recovery-button'
import { SettingsFieldContext } from '../src/settings/settingsField'
it('keeps recovery independent of host-field disabling while refusing an invalid candidate Keep', () => {
  const click = vi.fn(),
    ref = vi.fn()
  const revert = ThemeRecoveryButton({ onClick: click, ref, children: 'Revert' })
  expect(revert.props.onClick).toBe(click)
  expect(revert.props.ref).toBe(ref)
  const html = renderToStaticMarkup(
    createElement(SettingsFieldContext.Provider, {
      value: { path: 'host', disabled: true, mixed: false, mark() {} },
      children: revert,
    }),
  )
  expect(html).not.toMatch(/\sdisabled=""/)
  expect(html).toContain('type="button"')
  expect(
    renderToStaticMarkup(createElement(ThemeRecoveryButton, { variant: 'solid', disabled: true }, 'Keep theme')),
  ).toMatch(/\sdisabled=""/)
})
it('keeps normal, hover and focus recovery colors independent of candidate tokens and readable', () => {
  const css = readFileSync(new URL('../src/components/theme-recovery-button.css', import.meta.url), 'utf8')
  const rule = (selector: string) => css.slice(css.indexOf(selector)).split('}')[0]!
  const color = (block: string, name: string) => block.match(new RegExp('^\\s*' + name + ':\\s*(#[a-f0-9]+)', 'm'))![1]!
  const bar = rule('.theme-recovery-bar {'),
    button = rule('.theme-recovery-button {'),
    solid = rule(".theme-recovery-button[data-variant='solid'] {")
  expect(contrastRatio(color(button, 'color'), color(bar, 'background'))).toBeGreaterThan(4.5)
  expect(contrastRatio(color(solid, 'color'), color(solid, 'background'))).toBeGreaterThan(4.5)
  const hover = rule('.theme-recovery-button:hover:not(:disabled) {')
  const solidHover = rule(".theme-recovery-button[data-variant='solid']:hover:not(:disabled) {")
  expect(contrastRatio(color(button, 'color'), color(hover, 'background'))).toBeGreaterThan(4.5)
  expect(contrastRatio(color(solid, 'color'), color(solidHover, 'background'))).toBeGreaterThan(4.5)
  const focus = rule('.theme-recovery-button:focus-visible {').match(/outline:\s*2px solid (#[a-f0-9]+)/)![1]!
  expect(contrastRatio(focus, color(bar, 'background'))).toBeGreaterThan(3)
  expect(css).not.toMatch(/(?:color|background|border):[^;]*var\(/)
})
