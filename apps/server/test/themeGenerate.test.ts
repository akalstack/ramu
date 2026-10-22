import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME } from '@ramu/shared/theme'
import { registerThemeHandlers } from '../src/ipc/handlers/theme'

const draft = (text: string) =>
  JSON.stringify({
    name: 'Calm',
    light: DEFAULT_THEME.light,
    dark: { ...DEFAULT_THEME.dark, colors: { ...DEFAULT_THEME.dark.colors, text } },
  })

const files = [
  { id: 'img1', name: 'a.png', mimeType: 'image/png', path: '/x/a.png' },
  { id: 'doc1', name: 'a.pdf', mimeType: 'application/pdf', path: '/x/a.pdf' },
]
const attachmentStore = { resolve: (ids: string[] = []) => files.filter((file) => ids.includes(file.id)) }

function handler(replies: string[]) {
  const prompts: string[] = []
  const options: unknown[] = []
  const methods = registerThemeHandlers({
    workspace: { getAppState: (_key: string, fallback: unknown) => fallback },
    storedPreferences: () => ({}),
    attachmentStore,
    agents: {
      analyze: async (prompt: string, _model: unknown, _max: unknown, extra: unknown) => {
        prompts.push(prompt)
        options.push(extra)
        return { message: replies[Math.min(prompts.length - 1, replies.length - 1)]!, provider: 'claude', model: 'm' }
      },
    },
  } as never)
  const run = methods['theme.generate']!.run as (...args: unknown[]) => Promise<{
    theme: typeof DEFAULT_THEME
    issues: unknown[]
  }>
  return { run, prompts, options }
}

describe('theme.generate', () => {
  it('asks again with the failures and returns the repaired draft', async () => {
    const { run, prompts } = handler([draft('#25252a'), draft('#f5f5f7')])
    const result = await run('calmer', DEFAULT_THEME)
    expect(result.issues).toEqual([])
    expect(prompts).toHaveLength(2)
    expect(prompts[1]).toContain('<failures>')
    expect(result.theme.id).toMatch(/^ai-/)
  })

  it('stops after the repair budget and returns the draft with its failures', async () => {
    const { run, prompts } = handler([draft('#25252a')])
    const result = await run('calmer', DEFAULT_THEME)
    expect(prompts).toHaveLength(3)
    expect(result.issues.length).toBeGreaterThan(0)
  })

  it('keeps locked roles and refuses an invalid seed', async () => {
    const { run } = handler([draft('#f5f5f7')])
    const kept = await run('x', DEFAULT_THEME, { light: [], dark: ['text'] })
    expect(kept.theme.dark.colors.text).toBe(DEFAULT_THEME.dark.colors.text)
    await expect(run('x', { schema: 9 })).rejects.toThrow()
  })

  it('returns one draft per direction and drops a direction that failed', async () => {
    let calls = 0
    const methods = registerThemeHandlers({
      workspace: { getAppState: (_key: string, fallback: unknown) => fallback },
      storedPreferences: () => ({}),
      attachmentStore,
      agents: {
        analyze: async (prompt: string) => {
          calls++
          if (prompt.includes('bolder')) return { message: 'no', provider: 'claude', model: 'm' }
          return { message: draft('#f5f5f7'), provider: 'claude', model: 'm' }
        },
      },
    } as never)
    const run = methods['theme.candidates']!.run as (...args: unknown[]) => Promise<{ theme: { id: string } }[]>
    const candidates = await run('calmer', DEFAULT_THEME)
    expect(candidates).toHaveLength(2)
    expect(new Set(candidates.map((candidate) => candidate.theme.id)).size).toBe(2)
    expect(calls).toBeGreaterThanOrEqual(3)
  })

  it('sends only image references to the model and says so in the prompt', async () => {
    const { run, prompts, options } = handler([draft('#f5f5f7')])
    await run('like this photo', DEFAULT_THEME, undefined, undefined, ['img1', 'doc1'])
    expect((options[0] as { attachments: { id: string }[] }).attachments.map((file) => file.id)).toEqual(['img1'])
    expect(prompts[0]).toContain('An image is attached')
    await run('plain', DEFAULT_THEME)
    expect(options.at(-1)).not.toHaveProperty('attachments')
  })

  it('reports a reply that is not a theme', async () => {
    const { run } = handler(['I cannot do that'])
    await expect(run('x', DEFAULT_THEME)).rejects.toThrow(/did not return a theme/)
  })
})
