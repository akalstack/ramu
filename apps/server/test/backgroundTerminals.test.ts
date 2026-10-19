import { afterEach, expect, it } from 'vitest'
import { tmpdir } from 'node:os'
import { TerminalService } from '../src/workspace/pty'

const posix = process.platform !== 'win32'
const services: TerminalService[] = []
const make = () => {
  const changes: string[] = []
  const service = new TerminalService(
    () => {},
    () => {},
    (taskId) => changes.push(taskId),
  )
  services.push(service)
  return { service, changes }
}
afterEach(() => {
  for (const service of services.splice(0)) service.closeAll()
})
const until = async (check: () => boolean, ms = 8000) => {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 25))
  }
}
const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

it.skipIf(!posix)('launches once, lists across idle time, and keeps other threads separate', async () => {
  const { service } = make()
  const first = service.launchBackground('a', null, tmpdir(), 'echo ready; sleep 300')
  expect(service.launchBackground('a', null, tmpdir(), 'echo ready; sleep 300').id).toBe(first.id)
  const other = service.launchBackground('b', null, tmpdir(), 'echo ready; sleep 300')
  expect(other.id).not.toBe(first.id)
  expect(first).toMatchObject({ state: 'running', command: 'echo ready; sleep 300', exitCode: null, endedAt: null })
  expect(service.listBackground('a').map((t) => t.id)).toEqual([first.id])
  await until(() => service.inspectBackground('a', first.id).output.includes('ready'))
  // The ordinary list marks it so terminal panels never adopt it as a shell on their own.
  expect(service.list('a')[0]).toMatchObject({ id: first.id, background: true })
})

it.skipIf(!posix)('rejects another thread, ordinary shells and unknown ids', () => {
  const { service } = make()
  const cmd = service.launchBackground('a', null, tmpdir(), 'sleep 300')
  const shell = service.open('a', null, tmpdir())
  expect(() => service.inspectBackground('b', cmd.id)).toThrow(/Unknown background terminal/)
  expect(() => service.stopBackground('b', cmd.id)).toThrow(/Unknown background terminal/)
  expect(() => service.stopBackground('a', shell.id)).toThrow(/Unknown background terminal/)
  expect(() => service.stopBackground('a', 'missing')).toThrow(/Unknown background terminal/)
  expect(service.listBackground('a')[0]!.state).toBe('running')
})

it.skipIf(!posix)('stop ends the whole process group, is repeatable, and keeps final output', async () => {
  const { service, changes } = make()
  const cmd = service.launchBackground('a', null, tmpdir(), 'sleep 300 & echo child:$!; wait')
  await until(() => /child:\d+/.test(service.inspectBackground('a', cmd.id).output))
  const child = Number(/child:(\d+)/.exec(service.inspectBackground('a', cmd.id).output)![1])
  expect(alive(child)).toBe(true)

  expect(service.stopBackground('a', cmd.id).state).toBe('stopping')
  expect(service.stopBackground('a', cmd.id).state).toBe('stopping')
  await until(() => service.listBackground('a')[0]!.state === 'exited')
  await until(() => !alive(child))
  const done = service.stopBackground('a', cmd.id)
  expect(done).toMatchObject({ state: 'exited' })
  expect(done.endedAt).not.toBeNull()
  expect(service.inspectBackground('a', cmd.id).output).toContain('child:')
  expect(changes).toContain('a')
})

it.skipIf(!posix)('force stop ends a command that ignores the graceful signal', async () => {
  const { service } = make()
  const cmd = service.launchBackground('a', null, tmpdir(), "trap '' TERM; echo armed; while true; do sleep 1; done")
  await until(() => service.inspectBackground('a', cmd.id).output.includes('armed'))
  service.stopBackground('a', cmd.id)
  await new Promise((r) => setTimeout(r, 300))
  expect(service.listBackground('a')[0]!.state).toBe('stopping')
  service.stopBackground('a', cmd.id, true)
  await until(() => service.listBackground('a')[0]!.state === 'exited')
})

it.skipIf(!posix)('reports a failed exit, and closing a viewer leaves a running command alone', async () => {
  const { service } = make()
  const failing = service.launchBackground('a', null, tmpdir(), 'exit 3')
  await until(() => service.listBackground('a').find((t) => t.id === failing.id)!.state === 'failed')
  expect(service.listBackground('a')[0]).toMatchObject({ state: 'failed', exitCode: 3 })
  const running = service.launchBackground('a', null, tmpdir(), 'sleep 300')
  service.close(running.id)
  expect(service.listBackground('a').find((t) => t.id === running.id)!.state).toBe('running')
  service.closeTask('a')
  expect(service.listBackground('a')).toEqual([])
})
