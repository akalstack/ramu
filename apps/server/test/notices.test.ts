import { expect, it } from 'vitest'
import { NoticeInbox } from '../src/background/notices'

const session = { id: 's1', taskId: 't1' }
const make = () => {
  const seen: number[] = []
  const inbox = new NoticeInbox(
    (items) => seen.push(items.length),
    () => 'Fix login',
  )
  return { inbox, seen }
}

it('keeps one notice per thread until it is acted on or the thread moves on', () => {
  const { inbox, seen } = make()
  inbox.observe(session, { kind: 'state', state: 'idle' })
  expect(inbox.list()).toHaveLength(0)
  inbox.observe(session, { kind: 'state', state: 'running' })
  inbox.observe(session, { kind: 'state', state: 'idle' })
  expect(inbox.list()).toMatchObject([{ id: 'agent:s1', kind: 'done', title: 'Fix login', body: 'Finished' }])
  inbox.observe(session, { kind: 'state', state: 'running' })
  expect(inbox.list()).toHaveLength(0)
  inbox.observe(session, { kind: 'state', state: 'needs-input' })
  inbox.observe(session, { kind: 'state', state: 'needs-input' })
  expect(inbox.list()).toHaveLength(1)
  expect(inbox.list()[0]).toMatchObject({ kind: 'input' })
  inbox.dismiss('agent:s1')
  expect(inbox.list()).toHaveLength(0)
  expect(seen.at(-1)).toBe(0)
})

it('ignores helpers, and clears a deleted thread', () => {
  const { inbox } = make()
  inbox.observe({ ...session, parentId: 'root' }, { kind: 'state', state: 'failed' })
  expect(inbox.list()).toHaveLength(0)
  inbox.observe(session, { kind: 'state', state: 'failed' })
  expect(inbox.list()).toHaveLength(1)
  inbox.forgetTask('t1')
  expect(inbox.list()).toHaveLength(0)
})
