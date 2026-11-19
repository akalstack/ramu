import { beforeEach, describe, expect, it, vi } from 'vitest'

const add = vi.fn()
vi.mock('@/components/app-toaster', () => ({ notify: { add: (...args: unknown[]) => add(...args) } }))

import { reportGitJob } from '../src/git/reportGitJob'
import { notices } from '../src/chat/notificationCenter'

const options = (toastSuccess?: boolean) => ({
  id: 'git-job:t:r',
  success: (subject: string) => `Committed “${subject}”`,
  failure: { description: 'Commit', message: (reason: unknown) => String(reason) },
  toastSuccess,
})

describe('reportGitJob', () => {
  beforeEach(() => {
    add.mockClear()
    notices.clear()
  })

  it('records success in the bell without a toast', async () => {
    await reportGitJob(Promise.resolve('fix'), options())
    expect(add).not.toHaveBeenCalled()
    expect(notices.list()).toMatchObject([{ id: 'git-job:t:r', title: 'Committed “fix”', type: 'success' }])
  })

  it('adds a short toast on success when asked', async () => {
    await reportGitJob(Promise.resolve('fix'), options(true))
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ type: 'success', timeout: 3000 }))
  })

  it('keeps a failure on screen and in the bell, replacing the earlier entry', async () => {
    await reportGitJob(Promise.resolve('fix'), options())
    await reportGitJob(Promise.reject('push rejected'), options())
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', timeout: 0, title: 'push rejected' }))
    expect(notices.list()).toMatchObject([{ type: 'error', description: 'Commit' }])
    expect(notices.list()).toHaveLength(1)
  })
})
