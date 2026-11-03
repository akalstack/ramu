import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { expect, it, vi } from 'vitest'
import type { AgentSettings } from '@ramu/shared/types'
import { AgentControls } from '../src/chat/AgentControls'
import { ModelBar } from '../src/models/ModelBar'

vi.mock('../src/i18n', () => ({ t: (text: string) => text, useLanguage: () => 'en' }))
vi.mock('../src/models/ModelBar', () => ({ ModelBar: () => null }))
vi.mock('../src/models/AccountPicker', () => ({ AccountPicker: () => null }))
vi.mock('../src/Menu', () => ({ Menu: () => null }))

const elements = (node: ReactNode): ReactElement<Record<string, unknown>>[] => {
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [node, ...[node.props.children].flat(Infinity).flatMap((child) => elements(child as ReactNode))]
}
const settings: AgentSettings = {
  provider: 'claude-code',
  accountId: 'work',
  model: '',
  effort: null,
  access: 'auto',
  autoFallback: true,
}
const modelBarChange = (onChange: (next: AgentSettings) => void) =>
  elements(AgentControls({ settings, onChange })).find((node) => node.type === ModelBar)!.props.onChange as (
    next: AgentSettings,
  ) => void

it('drops the login when the model bar moves to another provider, since logins belong to one provider', () => {
  const onChange = vi.fn()
  modelBarChange(onChange)({ ...settings, provider: 'codex', model: 'gpt' })
  const { accountId: _work, ...rest } = settings
  expect(onChange.mock.calls[0]![0]).toStrictEqual({ ...rest, provider: 'codex', model: 'gpt' })
})

it('keeps the login for a model change on the same provider', () => {
  const onChange = vi.fn()
  modelBarChange(onChange)({ ...settings, model: 'opus' })
  expect(onChange).toHaveBeenCalledWith({ ...settings, model: 'opus' })
})
