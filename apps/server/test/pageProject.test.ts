import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { makePageProject } from '../src/interactive/pageProject'
import type { HandlerContext } from '../src/ipc/types'

const home = process.env.HOME
afterEach(() => {
  process.env.HOME = home
})

it('starts a project from a design with its frames as the reference, and asks for screens that match', async () => {
  process.env.HOME = mkdtempSync(join(tmpdir(), 'ramu-home-'))
  const startInProject = vi.fn(async () => ({ taskId: 't1', sessionId: 's1' }))
  const ctx = {
    pages: {
      get: () => ({ id: 'a', title: 'Pricing', version: 2, kind: 'design', grants: {}, capabilities: {} }),
      document: () => ({
        reference: { id: 'a', version: 2, kind: 'design', title: 'Pricing', network: { resources: [], connect: [] } },
        html: '<div class="ramu-canvas">frames</div>',
        preview: null,
        files: [{ path: 'design.json', content: '{"frames":[]}' }],
      }),
      markGrewInto: vi.fn(),
    },
    pageAi: { settingsFor: () => ({ provider: 'codex' }) },
    agents: { validateSettings: async () => {} },
    agentThreads: { startInProject },
    workspace: { addProjectFromFolder: async () => ({ project: { id: 'p1' } }) },
  } as unknown as HandlerContext
  const made = await makePageProject(ctx, 'a')
  expect(readFileSync(join(made.folder, 'design', 'design.json'), 'utf8')).toBe('{"frames":[]}')
  expect(readFileSync(join(made.folder, 'design', 'frames.html'), 'utf8')).toContain('frames')
  expect(existsSync(join(made.folder, 'index.html'))).toBe(false)
  const [brief] = startInProject.mock.calls[0] as unknown as [{ title: string; prompt: string }]
  expect(brief.title).toBe('Build Pricing')
  expect(brief.prompt).toContain('keep design/ as the design reference')
})
