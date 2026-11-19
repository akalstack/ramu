import { beforeEach, expect, it, vi } from 'vitest'

const add = vi.fn()
vi.mock('@/components/app-toaster', () => ({ notify: { add } }))
vi.mock('../src/chat/Notifications', () => ({ notifyError: vi.fn() }))
vi.mock('../src/workspace/TaskPane', () => ({ errorText: (error: unknown) => String(error) }))

const { offerThreadUndo } = await import('../src/sidebar/projects/threadUndo')
const { notifyError } = await import('../src/chat/Notifications')

beforeEach(() => {
  add.mockClear()
  vi.mocked(notifyError).mockClear()
})

it('names what happened to one or several threads', () => {
  offerThreadUndo('done', 1, async () => {})
  offerThreadUndo('archived', 3, async () => {})
  expect(add.mock.calls.map(([toast]) => toast.title)).toEqual(['Marked done', 'Archived 3 threads'])
})

it('runs the undo from the toast button and reports a failure instead of dropping it', async () => {
  const undo = vi.fn(async () => {
    throw new Error('offline')
  })
  offerThreadUndo('archived', 1, undo)
  add.mock.calls[0]![0].actionProps.onClick()
  await Promise.resolve()
  await Promise.resolve()
  expect(undo).toHaveBeenCalledOnce()
  expect(notifyError).toHaveBeenCalledWith('Error: offline')
})
