import { mkdtempSync, readFileSync, statSync, utimesSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { UserRequests, type UserRequestsHost } from '../src/agent/userRequests'
import { SECRET_FILE_TTL_MS, SecretFiles } from '../src/agent/secretFiles'
import type { Db } from '../src/db'
import type { AgentEvent, AgentSessionState } from '@ramu/shared/types'
import { inputSummary } from '@ramu/shared/chat/inputSummary'

afterEach(() => vi.useRealTimers())

function setup() {
  let state: AgentSessionState = 'running'
  const events: AgentEvent[] = []
  const host = {
    get: () => ({ state }),
    events: () => events,
    record: (_id: string, event: AgentEvent) => events.push(event),
    setState: (_id: string, next: AgentSessionState) => {
      state = next
    },
    shutdown: () => false,
    live: new Map(),
    runners: new Map(),
  } as unknown as UserRequestsHost
  const requests = new UserRequests(host, {} as Db)
  const directory = mkdtempSync(join(tmpdir(), 'ramu-secrets-'))
  requests.secretFiles = new SecretFiles(join(directory, 'secret-files'))
  const card = () =>
    events.findLast((e) => e.kind === 'secret-request') as Extract<AgentEvent, { kind: 'secret-request' }>
  const outcome = () => events.findLast((e) => e.kind === 'request-resolved')
  const ask = (signal?: AbortSignal, timeoutMs = 60_000) =>
    requests.requestSecret(
      'session',
      {
        label: 'Vercel token',
        reason: 'To deploy',
        envName: 'VERCEL_TOKEN',
        url: 'https://vercel.com/account/tokens',
        timeoutMs,
      },
      signal,
    )
  return { requests, events, card, outcome, ask, state: () => state, directory }
}

it('hands the agent an owner-only file and keeps the value out of every event', async () => {
  const s = setup()
  const waiting = s.ask()
  expect(s.state()).toBe('needs-input')
  expect(s.card()).toMatchObject({
    label: 'Vercel token',
    envName: 'VERCEL_TOKEN',
    url: 'https://vercel.com/account/tokens',
  })
  expect(inputSummary(s.events, 'session')?.requests[0]).toMatchObject({ kind: 'question', title: 'Vercel token' })
  await s.requests.answerSecret('session', s.card().requestId, { secret: '  tok_123\n', savedAs: 'VERCEL_TOKEN' })
  const result = await waiting
  expect(result).toMatchObject({ status: 'saved', savedAs: 'VERCEL_TOKEN' })
  const file = (result as { file: string }).file
  expect(readFileSync(file, 'utf8')).toBe('tok_123')
  expect(statSync(file).mode & 0o777).toBe(0o600)
  expect(statSync(join(file, '..')).mode & 0o777).toBe(0o700)
  expect(JSON.stringify(s.events)).not.toContain('tok_123')
  expect(s.outcome()).toMatchObject({ outcome: 'saved-env' })
  expect(s.state()).toBe('running')
  await expect(s.requests.answerSecret('session', s.card().requestId, { secret: 'again' })).rejects.toThrow(
    'no longer active',
  )
})

it('declines, times out, and cancels with the run or the tool call', async () => {
  const s = setup()
  const declined = s.ask()
  await s.requests.answerSecret('session', s.card().requestId, null)
  expect(await declined).toEqual({ status: 'declined' })

  vi.useFakeTimers()
  const timed = s.ask(undefined, 5_000)
  vi.advanceTimersByTime(5_000)
  expect(await timed).toEqual({ status: 'timed_out' })
  vi.useRealTimers()

  const stopped = s.ask()
  s.requests.cancelWaiters('session')
  expect(await stopped).toEqual({ status: 'cancelled' })

  const controller = new AbortController()
  const aborted = s.ask(controller.signal)
  controller.abort()
  expect(await aborted).toEqual({ status: 'cancelled' })
  expect(s.requests.hasBlockingQuestions('session')).toBe(false)
  expect(() => s.requests.pendingSecret('session', s.card().requestId)).toThrow('no longer active')
})

it('refuses another thread and an empty value', async () => {
  const s = setup()
  void s.ask()
  expect(() => s.requests.pendingSecret('other', s.card().requestId)).toThrow('no longer active')
  await expect(s.requests.answerSecret('session', s.card().requestId, { secret: '   ' })).rejects.toThrow(
    'Enter the secret',
  )
  s.requests.cancelWaiters('session')
})

it('sweeps files older than a day', async () => {
  const s = setup()
  const files = s.requests.secretFiles!
  const old = await files.write('old')
  const fresh = await files.write('fresh')
  const past = (Date.now() - SECRET_FILE_TTL_MS - 60_000) / 1000
  utimesSync(old, past, past)
  expect(await files.sweep()).toBe(1)
  expect(existsSync(old)).toBe(false)
  expect(existsSync(fresh)).toBe(true)
  expect(readdirSync(files.directory)).toHaveLength(1)
})
