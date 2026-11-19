import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import * as forge from '../src/workspace/forge'
import { createDispatcher, type Services } from '../src/ipc'

it('lists no issues for a folder that is not a Git repository, without running gh', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ramu-issues-'))
  const plain = join(tmp, 'plain')
  const repo = join(tmp, 'repo')
  mkdirSync(plain)
  mkdirSync(join(repo, '.git'), { recursive: true })
  const list = vi.spyOn(forge, 'listIssues').mockResolvedValue([])
  const dispatcher = createDispatcher({ userData: join(tmp, 'profile'), send: () => {}, native: async () => null }, {
    workspace: {
      getAppState: (_key: string, fallback: unknown) => fallback,
      setAppState: () => {},
      getRepository: (id: string) => ({ root: id === 'plain' ? plain : repo }),
    },
  } as unknown as Services)
  try {
    expect(await dispatcher.invoke('forge.issues', ['plain', ''])).toEqual([])
    expect(list).not.toHaveBeenCalled()
    await dispatcher.invoke('forge.issues', ['repo', ''])
    expect(list).toHaveBeenCalledWith(repo, '')
  } finally {
    dispatcher.close()
    list.mockRestore()
    rmSync(tmp, { recursive: true, force: true })
  }
})

it('lists no issues, rather than failing, when the repository has no GitHub remote', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ramu-issues-remote-'))
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir })
    execFileSync('git', ['remote', 'add', 'origin', 'https://example.invalid/team/repo.git'], { cwd: dir })
    await expect(forge.listIssues(dir, '')).resolves.toEqual([])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
