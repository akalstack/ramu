import { expect, it } from 'vitest'
import { OperationInProgressError, OperationLog, runOnce } from '../src/ipc/operationLog'

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

it('runOnce executes a keyed mutation once per scope, even for concurrent retries', async () => {
  const log = new OperationLog<string>(1000, 10)
  let runs = 0
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  const work = async () => {
    runs++
    await gate
    return 'sent'
  }
  const first = runOnce(log, 'phone', 'key-12345', 'agent.send', ['hi'], work)
  await expect(runOnce(log, 'phone', 'key-12345', 'agent.send', ['hi'], work)).rejects.toBeInstanceOf(
    OperationInProgressError,
  )
  release()
  expect(await first).toBe('sent')
  expect(await runOnce(log, 'phone', 'key-12345', 'agent.send', ['hi'], work)).toBe('sent')
  expect(runs).toBe(1)
  // Another device with the same key is independent.
  expect(await runOnce(log, 'tablet', 'key-12345', 'agent.send', ['hi'], async () => 'other')).toBe('other')
})

it('runOnce refuses a reused key with other arguments and frees the key after a failure', async () => {
  const log = new OperationLog<string>(1000, 10)
  await runOnce(log, 'phone', 'key-abcdef', 'agent.send', ['a'], () => 'ok')
  await expect(runOnce(log, 'phone', 'key-abcdef', 'agent.send', ['b'], () => 'x')).rejects.toThrow(/different request/)
  await expect(
    runOnce(log, 'phone', 'key-failing', 'agent.send', ['a'], () => {
      throw new Error('boom')
    }),
  ).rejects.toThrow('boom')
  expect(await runOnce(log, 'phone', 'key-failing', 'agent.send', ['a'], () => 'retried')).toBe('retried')
})
