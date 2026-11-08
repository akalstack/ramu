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
