import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { DEFAULT_AGENT_SETTINGS, type AgentEvent } from '@ramu/shared/types'
import { resultStopped } from '@ramu/shared/chat/turnResult'
import { AgentService, type QueryFn } from '../src/agent'
import type { AgentRunnerFactory, ProviderRunners } from '../src/agent/agentRunner'
import { openDb, type Db } from '../src/db'

let db: Db
let cwd: string
let service: AgentService | undefined
beforeEach(() => {
  db = openDb(':memory:')
  cwd = realpathSync(mkdtempSync(join(tmpdir(), 'ramu-stopped-turn-')))
  db.exec(`INSERT INTO projects (id,name,created_at) VALUES ('p','P',0);
    INSERT INTO tasks (id,project_id,title,mode,status,created_at) VALUES ('t','p','T','current','idle',0);`)
})
afterEach(() => {
  service?.stopAll()
  service = undefined
  db.close()
  rmSync(cwd, { recursive: true, force: true })
})

const until = async (cond: () => boolean, ms = 5000) => {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timed out')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

/** A provider that works until stopped, then ends the turn as Claude Code does: with an error result. */
const stoppable: AgentRunnerFactory = (_scope, _settings, emit) => ({
  start: async () => {
    emit({ kind: 'text', text: 'Working on it' })
  },
  send: async () => {},
  steer: async () => {},
  interrupt: async () => {
    emit({ kind: 'result', isError: true, text: 'error_during_execution', costUsd: null })
  },
  stop: async () => {},
  replyPermission() {},
  replyQuestion() {},
})

const noQuery: QueryFn = () => {
  throw new Error('Unexpected provider query')
}
const lastResult = (events: AgentEvent[]) => events.findLast((event) => event.kind === 'result')

it('a turn the person stops ends stopped, not failed, and the thread rests ready for the next message', async () => {
  service = new AgentService(db, () => {}, noQuery, { codex: stoppable } satisfies ProviderRunners)
  const session = service.start('t', { cwd, additionalDirs: [], covers: [cwd] }, 'Do the thing', {
    ...DEFAULT_AGENT_SETTINGS,
    provider: 'codex',
  })
  await until(() => service!.events(session.id).some((event) => event.kind === 'text'))
  await service.interrupt(session.id)
  await until(() => !!lastResult(service!.events(session.id)))
  const result = lastResult(service.events(session.id))!
  expect(result).toMatchObject({ kind: 'result', isError: false, text: 'interrupted' })
  // Every view reads it as stopped: "Stopped after", no "Agent failed".
  expect(result.kind === 'result' && resultStopped(result)).toBe(true)
  expect(service.get(session.id).state).toBe('idle')
  expect(service.stoppedByPerson(session.id)).toBe(true)
})

it('a turn that fails on its own still fails', async () => {
  const failing: AgentRunnerFactory = (scope, settings, emit) => ({
    ...stoppable(scope, settings, emit, undefined as never),
    start: async () => {
      emit({ kind: 'result', isError: true, text: 'error_during_execution', costUsd: null })
    },
  })
  service = new AgentService(db, () => {}, noQuery, { codex: failing } satisfies ProviderRunners)
  const session = service.start('t', { cwd, additionalDirs: [], covers: [cwd] }, 'Do the thing', {
    ...DEFAULT_AGENT_SETTINGS,
    provider: 'codex',
  })
  await until(() => !!lastResult(service!.events(session.id)))
  expect(lastResult(service.events(session.id))).toMatchObject({ isError: true })
  await until(() => service!.get(session.id).state === 'failed')
  expect(service.stoppedByPerson(session.id)).toBe(false)
})
