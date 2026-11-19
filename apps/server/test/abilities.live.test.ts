import { query } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'
import { abilityRunner } from '../src/agent/abilityRuns'
import { providerAdapter } from '../src/providers/adapters'
import { providerBinary } from '../src/providers/providerBinaries'

// Against the signed-in Codex and Claude CLIs on this machine; each case spends one small request:
//   RAMU_LIVE_ABILITIES=1 pnpm vitest run test/abilities.live.test.ts
// Image generation depends on the Codex login and model; add RAMU_LIVE_IMAGES=1 where the login offers it.
const run = abilityRunner((args) =>
  query({ ...args, options: { ...args.options, pathToClaudeCodeExecutable: providerBinary('claude-code') } }),
)
const declared = (provider: 'codex' | 'claude-code', ability: string) =>
  providerAdapter(provider).native!.abilities!.find((entry) => entry.ability === ability)!
const search = {
  ability: 'web_search' as const,
  prompt:
    'Search the web: what is the official website of the Node.js project? Answer in one line, then the source as a Markdown link.',
  images: [],
}

describe.runIf(process.env.RAMU_LIVE_ABILITIES === '1')('abilities (real providers)', () => {
  it('Codex searches the web with only its search tool', { timeout: 180_000 }, async () => {
    const out = await run(
      { provider: 'codex', model: '', accountId: 'default' },
      declared('codex', 'web_search'),
      search,
      new AbortController().signal,
      150_000,
    )
    expect(out.sources.length).toBeGreaterThan(0)
  })

  it('Claude searches the web with only WebSearch', { timeout: 180_000 }, async () => {
    const out = await run(
      { provider: 'claude-code', model: 'haiku', accountId: 'default' },
      declared('claude-code', 'web_search'),
      search,
      new AbortController().signal,
      150_000,
    )
    expect(out.sources.length).toBeGreaterThan(0)
  })

  it.runIf(process.env.RAMU_LIVE_IMAGES === '1')(
    'Codex makes an image with its built-in tool',
    { timeout: 240_000 },
    async () => {
      const out = await run(
        { provider: 'codex', model: '', accountId: 'default' },
        declared('codex', 'image_generation'),
        {
          ability: 'image_generation',
          prompt:
            'Make one image with your built-in image generation tool: a small, simple flat illustration of a red apple.',
          images: [],
        },
        new AbortController().signal,
        200_000,
      )
      expect(out.images.length).toBeGreaterThan(0)
    },
  )
})
