import { expect, it } from 'vitest'
import { modelDisplayName, modelLabel, modelSearchText } from '../src/providers/modelLabel'
import { matchesWords } from '../src/search/matchWords'

const opencode = (id: string, name: string) => ({ provider: 'opencode' as const, id, name })

it('drops a provider prefix only when the name repeats it, and keeps one that tells routes apart', () => {
  expect(modelDisplayName('9router/9Router Auto')).toBe('9Router Auto')
  expect(modelDisplayName('opencode/Tidepool Alpha')).toBe('opencode/Tidepool Alpha')
  expect(modelDisplayName('gpt-6-luna')).toBe('GPT-6 Luna')
})

it("moves an OpenCode route out of the model's name and reads an id-like name as words", () => {
  expect(modelLabel(opencode('openrouter/nex-agi/nex-n2.5-pro', 'openrouter/Nex-N2.5-Pro'))).toEqual({
    name: 'Nex N2.5 Pro',
    route: 'OpenRouter',
  })
  expect(modelLabel(opencode('openrouter/nvidia/nemotron-3-ultra:free', 'openrouter/Nemotron 3 Ultra (free)'))).toEqual(
    { name: 'Nemotron 3 Ultra (free)', route: 'OpenRouter' },
  )
  expect(modelLabel(opencode('opencode/tidepool-alpha', 'opencode/Tidepool Alpha'))).toEqual({
    name: 'Tidepool Alpha',
    route: 'OpenCode Zen',
  })
  expect(modelLabel(opencode('9router/auto', '9router/9Router Auto'))).toEqual({
    name: '9Router Auto',
    route: '9router',
  })
  expect(modelLabel(opencode('my-gateway/gpt-5.1-codex', 'gpt-5.1-codex'))).toEqual({
    name: 'GPT-5.1 Codex',
    route: 'My Gateway',
  })
  expect(modelLabel(opencode('anthropic/claude-sonnet-4-5', 'claude-sonnet-4-5')).name).toBe('Claude Sonnet 4-5')
})

it('leaves models of providers that do not route as they are', () => {
  expect(modelLabel({ provider: 'claude-code', id: 'claude-opus-4-5', name: 'Opus 4.5' })).toEqual({
    name: 'Opus 4.5',
    route: null,
  })
  expect(modelLabel({ provider: 'codex', id: 'gpt-5.1-codex-max', name: 'gpt-5.1-codex-max' })).toEqual({
    name: 'GPT-5.1-codex-max',
    route: null,
  })
  expect(modelLabel(opencode('big-pickle', 'Big Pickle'))).toEqual({ name: 'Big Pickle', route: null })
})

it('finds a model by any of its words, in any order, across its name, route, provider and id', () => {
  const text = modelSearchText(opencode('openrouter/nex-agi/nex-n2.5-pro', 'openrouter/Nex-N2.5-Pro'))
  expect(matchesWords(text, 'pro nex')).toBe(true)
  expect(matchesWords(text, 'openrouter n2.5')).toBe(true)
  expect(matchesWords(text, 'OpenCode nex-agi')).toBe(true)
  expect(matchesWords(text, 'nexn2')).toBe(true)
  expect(matchesWords(text, 'claude')).toBe(false)
})

it('matches words regardless of case, accents and joining punctuation', () => {
  expect(matchesWords('GPT-5 Codex', 'gpt5')).toBe(true)
  expect(matchesWords('Café Model', 'cafe')).toBe(true)
  expect(matchesWords('main', '  ')).toBe(true)
  expect(matchesWords('feature/login-form', 'form login')).toBe(true)
  expect(matchesWords('feature/login-form', 'logout')).toBe(false)
})
