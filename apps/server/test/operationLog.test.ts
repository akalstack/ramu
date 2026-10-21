import { expect, it } from 'vitest'
import { OperationLog } from '../src/ipc/operationLog'

it('runs once, returns the recorded result on retry and refuses a different payload under the same key', () => {
  const log = new OperationLog<string>(1000, 10)
  expect(log.begin('k', 'agent.send', ['hi'], 0)).toEqual({ kind: 'run' })
  expect(log.begin('k', 'agent.send', ['hi'], 1)).toEqual({ kind: 'running' })
  log.finish('k', 'ok', 2)
  expect(log.begin('k', 'agent.send', ['hi'], 3)).toEqual({ kind: 'done', result: 'ok' })
  expect(log.begin('k', 'agent.send', ['different'], 3)).toEqual({ kind: 'conflict' })
  expect(log.begin('k', 'agent.stop', ['hi'], 3)).toEqual({ kind: 'conflict' })
})

it('forgets finished keys after retention, frees an abandoned one, and stays bounded', () => {
  const log = new OperationLog<string>(100, 2)
  log.begin('a', 'm', [], 0)
  log.finish('a', 'ok', 1)
  expect(log.begin('a', 'm', [], 500)).toEqual({ kind: 'run' })
  log.abandon('a')
  expect(log.begin('a', 'm', [], 501)).toEqual({ kind: 'run' })
  log.begin('b', 'm', [], 502)
  log.begin('c', 'm', [], 503)
  expect(log.begin('a', 'm', [], 504)).toEqual({ kind: 'run' })
})
