import { expect, it, vi } from 'vitest'
import type { AgentSettings, Aside, AsideAskOptions, Attachment } from '@ramu/shared/types'
import { DEFAULT_AGENT_SETTINGS } from '@ramu/shared/types'
import { registerAsideHandlers } from '../src/ipc/handlers/aside'

const SESSION = '11111111-1111-4111-8111-111111111111'
const SHOT: Attachment = { id: '', name: 'shot.png', size: 10, mimeType: 'image/png', path: '/tmp/shot.png' }
const own: AgentSettings = { ...DEFAULT_AGENT_SETTINGS, provider: 'claude-code', model: 'opus' }

function asides(asideModel: { provider: 'codex'; model: string; effort: null } | null = null) {
  const state = new Map<string, unknown>()
  const forkAnswer = vi.fn(async () => ({ text: 'forked', provider: 'claude-code', model: 'opus' }))
  const analyze = vi.fn(async (_prompt: string, settings: AgentSettings, _max?: number, _options?: object) => ({
    message: 'read',
    provider: settings.provider,
    model: settings.model,
  }))
  const handlers = registerAsideHandlers({
    host: { send: () => {} },
    workspace: {
      getAppState: (key: string, fallback: unknown) => state.get(key) ?? fallback,
      setAppState: (key: string, value: unknown) => void state.set(key, value),
    },
    agents: { get: () => ({ settings: own }), forkAnswer, analyze, asideContext: () => '' },
    storedPreferences: () => ({ asideModel }),
    attachmentStore: { resolve: (ids: string[]) => ids.map((id) => ({ ...SHOT, id })) },
  } as never)
  const ask = async (settings?: AgentSettings, options?: AsideAskOptions) => {
    ;(handlers['aside.ask']!.run as (...args: unknown[]) => Aside)(
      SESSION,
      null,
      '',
      'assistant',
      'Why?',
      settings,
      options,
    )
    await vi.waitFor(() =>
      expect((state.get(`asides:${SESSION}`) as Aside[])[0]!.messages.at(-1)!.role).toBe('assistant'),
    )
    return (state.get(`asides:${SESSION}`) as Aside[])[0]!.messages.at(-1)!
  }
  const question = () => (state.get(`asides:${SESSION}`) as Aside[])[0]!.messages[0]!
  return { ask, forkAnswer, analyze, question }
}

it('answers on the thread’s own session while the thread keeps its model', async () => {
  const { ask, forkAnswer, analyze } = asides()
  expect((await ask(own)).text).toBe('forked')
  expect(forkAnswer).toHaveBeenCalledTimes(1)
  expect(analyze).not.toHaveBeenCalled()
})

it('follows a model chosen in the thread’s composer before the thread has taken it', async () => {
  const { ask, forkAnswer } = asides()
  expect(await ask({ ...own, model: 'fable' })).toMatchObject({ text: 'read', model: 'fable' })
  expect(forkAnswer).not.toHaveBeenCalled()
})

it('uses the one model Settings names for asides, whatever the thread runs on', async () => {
  const { ask, analyze } = asides({ provider: 'codex', model: 'gpt-mini', effort: null })
  expect(await ask(own)).toMatchObject({ provider: 'codex', model: 'gpt-mini' })
  expect(analyze.mock.calls[0]![1]).not.toHaveProperty('accountId')
})

it('answers with the model picked in the aside, over the one Settings names', async () => {
  const { ask, analyze } = asides({ provider: 'codex', model: 'gpt-mini', effort: null })
  expect(await ask(own, { model: { provider: 'claude-code', model: 'sonnet', effort: 'low' } })).toMatchObject({
    provider: 'claude-code',
    model: 'sonnet',
  })
  expect(analyze.mock.calls[0]![1]).toMatchObject({ effort: 'low' })
})

it('reads the files sent with a question and keeps them on the question', async () => {
  const id = '22222222-2222-4222-8222-222222222222'
  const { ask, forkAnswer, analyze, question } = asides()
  expect((await ask(own, { attachmentIds: [id] })).text).toBe('read')
  expect(forkAnswer).not.toHaveBeenCalled()
  expect(analyze.mock.calls[0]![3]).toEqual({ attachments: [{ ...SHOT, id }] })
  expect(question().attachments).toEqual([{ ...SHOT, id }])
})
