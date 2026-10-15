import { expect, it, vi } from 'vitest'
import { animatePanelChange, cancelPanelMotion } from '../src/panelMotion'

it('applies every panel change at once, exactly once: panes animate their own size', () => {
  for (const scope of ['tools', 'workspace', 'terminal', 'editor', 'sidebar', 'right', 'chat'] as const) {
    const update = vi.fn()
    animatePanelChange(update, scope)
    animatePanelChange(update, scope, true)
    expect(update).toHaveBeenCalledTimes(2)
  }
  expect(() => cancelPanelMotion()).not.toThrow()
})
