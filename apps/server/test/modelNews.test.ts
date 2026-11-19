import { expect, it } from 'vitest'
import type { AgentModel, ModelNotice, ProviderCatalog } from '@ramu/shared/types'
import { ModelNews } from '../src/providers/modelNews'

const model = (id: string, extra: Partial<AgentModel> = {}) =>
  ({ id, name: id.toUpperCase(), efforts: [], defaultEffort: null, isDefault: false, ...extra }) as AgentModel
const catalog = (provider: ProviderCatalog['provider'], models: AgentModel[]): ProviderCatalog => ({ provider, models })

function setup(enabled = true) {
  const store = new Map<string, unknown>()
  const sent: ModelNotice[][] = []
  let now = 1_000
  const news = new ModelNews(
    {
      get: (key, fallback) => (store.has(key) ? (store.get(key) as typeof fallback) : fallback),
      set: (key, value) => store.set(key, value),
    },
    () => enabled,
    (notices) => sent.push(notices),
    () => now,
  )
  return { news, sent, advance: (ms: number) => (now += ms) }
}

it('learns a provider quietly, then announces a model it starts offering, once', () => {
  const { news, sent } = setup()
  news.observe([catalog('claude-code', [model('opus'), model('sonnet')])])
  expect(sent).toEqual([])
  news.observe([catalog('claude-code', [model('opus'), model('sonnet'), model('opus-6')])])
  expect(news.notices().map((notice) => notice.model)).toEqual(['opus-6'])
  news.observe([catalog('claude-code', [model('opus'), model('sonnet'), model('opus-6')])])
  expect(sent).toHaveLength(1)
  // Turning a provider on does not announce everything it offers.
  news.observe([catalog('codex', [model('gpt-6')])])
  expect(news.notices()).toHaveLength(1)
  news.dismiss('claude-code', 'opus-6')
  expect(news.notices()).toEqual([])
})

it('tags an announced model New for two weeks when no release date says otherwise, and stays quiet when off', () => {
  const { news, advance } = setup()
  news.observe([catalog('claude-code', [model('opus')])])
  news.observe([catalog('claude-code', [model('opus'), model('opus-6'), model('dated', { releasedAt: '2026-01-01' })])])
  const tagged = news.tag(
    catalog('claude-code', [model('opus'), model('opus-6'), model('dated', { releasedAt: '2026-01-01' })]),
  )
  expect(tagged.models.map((entry) => entry.releasedAt)).toEqual([undefined, '1970-01-01', '2026-01-01'])
  advance(15 * 24 * 60 * 60_000)
  expect(news.tag(catalog('claude-code', [model('opus-6')])).models[0]!.releasedAt).toBeUndefined()
  const off = setup(false)
  off.news.observe([catalog('claude-code', [model('opus')])])
  off.news.observe([catalog('claude-code', [model('opus'), model('opus-6')])])
  expect(off.sent).toEqual([])
  expect(off.news.notices()).toEqual([])
})
