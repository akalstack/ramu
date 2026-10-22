import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChildProcess } from 'node:child_process'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { HostFolders } from '../src/remote/hostFolders'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ramu-clone-'))
  process.env.RAMU_BROWSE_ROOTS = root
})
afterEach(() => {
  delete process.env.RAMU_BROWSE_ROOTS
  rmSync(root, { recursive: true, force: true })
  vi.useRealTimers()
})

/** A stand-in for `git clone`: tests drive its progress output and its exit. */
function fakeGit() {
  const child = Object.assign(new EventEmitter(), {
    stderr: new EventEmitter(),
    kill: vi.fn((_signal?: string) => {
      queueMicrotask(() => child.emit('close', null))
      return true
    }),
  })
  return { child, spawn: () => child as unknown as ChildProcess }
}

it('reports Git progress while cloning and returns the folder when it finishes', async () => {
  const git = fakeGit()
  const folders = new HostFolders(() => [], git.spawn)
  const done = folders.clone(root, 'repo', 'https://github.com/o/r.git', 'clone-0001')
  await vi.waitFor(() => expect(folders.cloneProgress('clone-0001')).not.toBeNull())
  git.child.stderr.emit('data', Buffer.from('Receiving objects:  45% (45/100)\rReceiving objects:  60% (60/100)\r'))
  expect(folders.cloneProgress('clone-0001')).toEqual({ phase: 'Receiving objects', percent: 60, running: true })
  git.child.emit('close', 0)
  expect(await done).toBe(join(realpathSync(root), 'repo'))
  expect(folders.cloneProgress('clone-0001')).toBeNull()
})

it('cancels a running clone and removes the folder it was filling', async () => {
  const git = fakeGit()
  const folders = new HostFolders(() => [], git.spawn)
  const done = folders.clone(root, 'repo', 'https://github.com/o/r.git', 'clone-0002')
  const outcome = expect(done).rejects.toThrow('Clone cancelled')
  await vi.waitFor(() => expect(existsSync(join(root, 'repo'))).toBe(true))
  expect(folders.cancelClone('clone-0002')).toBe(true)
  await outcome
  expect(existsSync(join(root, 'repo'))).toBe(false)
  expect(folders.cancelClone('clone-0002')).toBe(false)
})

it('keeps the folder of a clone that failed on its own, and refuses a reused id', async () => {
  const git = fakeGit()
  const folders = new HostFolders(() => [], git.spawn)
  const done = folders.clone(root, 'repo', 'https://github.com/o/r.git', 'clone-0003')
  const outcome = expect(done).rejects.toThrow('Clone failed')
  await vi.waitFor(() => expect(folders.cloneProgress('clone-0003')).not.toBeNull())
  await expect(folders.clone(root, 'other', 'https://github.com/o/r.git', 'clone-0003')).rejects.toThrow(
    'already running',
  )
  git.child.emit('close', 128)
  await outcome
  expect(existsSync(join(root, 'repo'))).toBe(true)
})

it('abandons a clone that stops reporting', async () => {
  const git = fakeGit()
  const folders = new HostFolders(() => [], git.spawn, 50)
  const outcome = expect(folders.clone(root, 'repo', 'https://github.com/o/r.git')).rejects.toThrow('Clone failed')
  await new Promise((resolve) => setTimeout(resolve, 120))
  await outcome
  expect(git.child.kill).toHaveBeenCalledWith('SIGTERM')
})

it('still refuses unsafe addresses before starting Git', async () => {
  const spawn = vi.fn()
  const folders = new HostFolders(() => [], spawn)
  await expect(folders.clone(root, 'r', 'file:///etc')).rejects.toThrow('HTTPS or SSH')
  await expect(folders.clone(root, 'r', 'https://u:p@github.com/o/r.git')).rejects.toThrow('credentials')
  expect(spawn).not.toHaveBeenCalled()
})
