import { beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '@ramu/shared/types'

const calls = vi.hoisted(() => [] as { host: string; method: string; args: unknown[] }[])
const failing = vi.hoisted(() => new Set<string>())
vi.mock('../src/ipc', () => ({
  invokeOn: vi.fn(async (host: string, method: string, ...args: unknown[]) => {
    calls.push({ host, method, args })
    if (failing.has(host)) throw new Error('Host is offline')
    const input = args[0] as { threads: { title: string }[] }
    return input.threads.map((thread, index) => ({ taskId: `${host}-${index}`, title: thread.title, projectName: 'p' }))
  }),
}))
vi.mock('../src/i18n', () => ({ useLanguage: () => {}, t: (text: string) => text }))
vi.mock('../src/workspace/computers', () => ({ useComputers: () => null }))
vi.mock('../src/workspace/workspace', () => ({ useWorkspacesOf: () => [] }))

const { startSplit } = await import('../src/SplitReview')

const draft = {
  original: 'Add dueDate everywhere',
  contract: 'Field dueDate, ISO date',
  settings: DEFAULT_AGENT_SETTINGS,
  rows: [
    { key: 'a', hostId: 'laptop', projectId: 'api', label: 'api', title: 'Store dueDate', brief: 'API part' },
    { key: 'b', hostId: 'laptop', projectId: 'web', label: 'web', title: 'Show dueDate', brief: 'Web part' },
    { key: 'c', hostId: 'vps', projectId: 'jobs', label: 'jobs · vps', title: 'Backfill dueDate', brief: 'Jobs part' },
  ],
}

beforeEach(() => {
  calls.length = 0
  failing.clear()
})

it('starts each host’s rows on that host as one group that names every thread', async () => {
  const started = await startSplit(draft)
  expect(calls.map((call) => call.host)).toEqual(['laptop', 'vps'])
  const [laptop, vps] = calls.map((call) => call.args[0] as Record<string, unknown>)
  expect(laptop!.groupId).toBe(vps!.groupId)
  expect(laptop!.together).toEqual(['Store dueDate', 'Show dueDate', 'Backfill dueDate'])
  const threads = laptop!.threads as { projectId: string; prompt: string }[]
  expect(threads.map((thread) => thread.projectId)).toEqual(['api', 'web'])
  expect(threads[0]!.prompt).toContain('API part')
  expect(threads[0]!.prompt).toContain('Field dueDate, ISO date')
  expect(threads[0]!.prompt).toContain('Add dueDate everywhere')
  expect(started.map((entry) => entry.taskId)).toEqual(['laptop-0', 'laptop-1', 'vps-0'])
})

it('reports a host that fails on its own rows and still starts the others', async () => {
  failing.add('vps')
  const started = await startSplit(draft)
  expect(started.filter((entry) => !entry.error).map((entry) => entry.taskId)).toEqual(['laptop-0', 'laptop-1'])
  expect(started.find((entry) => entry.hostId === 'vps')).toMatchObject({
    title: 'Backfill dueDate',
    error: 'Host is offline',
  })
})
