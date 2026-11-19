// Live typing on the host: editors join one shared copy, their typing merges, and a version is saved once nobody has
// typed for a minute, naming who typed; nothing is saved when the text did not change.
import { expect, it } from 'vitest'
import { LiveTextEditor, syncLiveText } from '@ramu/shared/liveText'
import { LiveEditing } from '../src/interactive/liveEditing'

it('merges two editors’ typing and saves one version after a quiet minute, naming both', async () => {
  let now = 0
  let version = 1
  let text = 'Open daily\n'
  const saves: { base: number; text: string; by: string }[] = []
  const live = new LiveEditing(
    {
      current: () => ({ version, text }),
      save: async (_id, base, next, by) => {
        saves.push({ base, text: next, by })
        text = next
        return ++version
      },
    },
    () => now,
  )
  const ana = new LiveTextEditor(live.join('a1').state)
  const bo = new LiveTextEditor(live.join('a1').state)
  let anaBox = 'Open daily, 7 to 5\n'
  let boBox = 'We are open daily\n'
  const sync = (editor: LiveTextEditor, who: string, read: () => string, write: (value: string) => void) =>
    syncLiveText(editor, read, async (update, vector) => live.sync('a1', who, update, vector)).then((merged) => {
      if (merged !== null) write(merged)
    })
  await sync(
    ana,
    'you on MacBook',
    () => anaBox,
    (value) => (anaBox = value),
  )
  await sync(
    bo,
    'Bo',
    () => boBox,
    (value) => (boBox = value),
  )
  await sync(
    ana,
    'you on MacBook',
    () => anaBox,
    (value) => (anaBox = value),
  )
  expect(anaBox).toBe(boBox)
  // Still typing within the minute: nothing saved yet.
  now = 30_000
  await live.flush()
  expect(saves).toEqual([])
  now = 61_000
  await live.flush()
  expect(saves).toEqual([{ base: 1, text: anaBox, by: 'Edited live by you on MacBook and Bo' }])
  // Unchanged since that save: no second version, and the copy is dropped once nobody syncs.
  now = 400_000
  await live.flush()
  expect(saves).toHaveLength(1)
  expect(() => live.sync('a1', 'Bo', null, '')).toThrow('ended')
})

it('refuses a kind that is not edited as text', () => {
  const live = new LiveEditing({ current: () => null, save: async () => 1 })
  expect(() => live.join('a1')).toThrow('Only a doc')
})

/** A host whose versions are kept in order; `save` merges nothing and just stacks the text. */
const versions = (first: string) => {
  const texts = [first]
  return {
    texts,
    host: {
      current: () => ({ version: texts.length, text: texts[texts.length - 1]! }),
      save: async (_id: string, _base: number, next: string) => texts.push(next),
    },
  }
}
const typeInto = async (live: LiveEditing, editor: LiveTextEditor, box: string, who = 'you') => {
  let version: number | undefined
  await syncLiveText(
    editor,
    () => box,
    async (update, vector) => {
      const reply = live.sync('a1', who, update, vector)
      version = reply.version
      return reply
    },
  )
  return version
}

it('tells editors the version a quiet minute saved, so their Save builds on it', async () => {
  let now = 0
  const { host } = versions('Open daily\n')
  const live = new LiveEditing(host, () => now)
  const editor = new LiveTextEditor(live.join('a1').state)
  expect(await typeInto(live, editor, 'Open daily, 9 to 5\n')).toBe(1)
  now = 61_000
  await live.flush()
  expect(await typeInto(live, editor, 'Open daily, 9 to 6\n')).toBe(2)
})

it('takes a version Save made, so the copy is not saved again or joined stale', async () => {
  let now = 0
  const { host, texts } = versions('Open daily\n')
  const live = new LiveEditing(host, () => now)
  const editor = new LiveTextEditor(live.join('a1').state)
  // The last keystrokes never reached the host before Save.
  await typeInto(live, editor, 'Open daily, 9\n')
  texts.push('Open daily, 9 to 5\n')
  live.saved('a1', 2, 'Open daily, 9 to 5\n')
  now = 61_000
  await live.flush()
  expect(texts).toHaveLength(2)
  const joined = live.join('a1')
  expect(joined.version).toBe(2)
  expect(new LiveTextEditor(joined.state).text).toBe('Open daily, 9 to 5\n')
})

it('joins a version an agent published while nothing typed was waiting', () => {
  const { host, texts } = versions('Open daily\n')
  const live = new LiveEditing(host)
  live.join('a1')
  texts.push('Open weekdays\n')
  const joined = live.join('a1')
  expect(joined.version).toBe(2)
  expect(new LiveTextEditor(joined.state).text).toBe('Open weekdays\n')
})

it('discards what Cancel leaves, unless someone else typed too', async () => {
  let now = 0
  const { host, texts } = versions('Open daily\n')
  const live = new LiveEditing(host, () => now)
  const editor = new LiveTextEditor(live.join('a1').state)
  await typeInto(live, editor, 'Open never\n')
  live.discard('a1', 'you')
  now = 61_000
  await live.flush()
  expect(texts).toHaveLength(1)
  expect(new LiveTextEditor(live.join('a1').state).text).toBe('Open daily\n')
  // Bo typed too: Cancel on this device keeps both.
  const bo = new LiveTextEditor(live.join('a1').state)
  await typeInto(live, bo, 'Open daily, says Bo\n', 'Bo')
  live.discard('a1', 'you')
  expect(new LiveTextEditor(live.join('a1').state).text).toBe('Open daily, says Bo\n')
})
