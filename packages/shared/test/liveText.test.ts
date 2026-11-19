import { describe, expect, it } from 'vitest'
import { joinedText, LiveTextEditor, LiveTextHost } from '../src/liveText'

/** One round between an editor and the host, as the editor's sync does it. */
const sync = (editor: LiveTextEditor, host: LiveTextHost) => {
  const { update, stateVector } = editor.outgoing()
  return editor.incoming(host.exchange(update, stateVector))
}

describe('live text', () => {
  it('sends keystrokes typed while a sync was on its way at the next one', () => {
    const host = new LiveTextHost('Hi\n')
    const ana = new LiveTextEditor(host.state())
    ana.edit('Hi there\n')
    const first = ana.outgoing()
    const reply = host.exchange(first.update, first.stateVector)
    // Typed after the request left, before its reply came back.
    ana.edit('Hi there, Bo\n')
    ana.incoming(reply)
    expect(sync(ana, host)).toBe('Hi there, Bo\n')
    expect(host.text).toBe('Hi there, Bo\n')
  })

  it('keeps both people’s typing in the same line, and both editors end with the same text', () => {
    const host = new LiveTextHost('Open daily\n')
    const ana = new LiveTextEditor(host.state())
    const bo = new LiveTextEditor(host.state())
    ana.edit('Open daily, 7 to 5\n')
    bo.edit('We are open daily\n')
    sync(ana, host)
    sync(bo, host)
    const settled = sync(ana, host)
    expect(settled).toBe(bo.text)
    expect(settled).toContain('7 to 5')
    expect(settled).toContain('We are')
    expect(host.text).toBe(settled)
  })

  it('sends nothing when nothing was typed, and passes deletions on', () => {
    const host = new LiveTextHost('a\nb\nc\n')
    const ana = new LiveTextEditor(host.state())
    const bo = new LiveTextEditor(host.state())
    expect(ana.outgoing().update).toBeNull()
    ana.edit('a\nc\n')
    sync(ana, host)
    expect(sync(bo, host)).toBe('a\nc\n')
  })

  it('keeps what the person typed before the join answered', () => {
    const opened = '# Plan\n\nShip it.\n\nNotes\n'
    // Another device typed in the last paragraph, not saved yet; this one typed in the first while joining.
    const joined = '# Plan\n\nShip it.\n\nNotes from Bo\n'
    expect(joinedText(opened, joined, '# Plan v2\n\nShip it.\n\nNotes\n')).toBe(
      '# Plan v2\n\nShip it.\n\nNotes from Bo\n',
    )
    expect(joinedText(opened, joined, opened)).toBe(joined)
    expect(joinedText(opened, joined, '# Plan\n\nShip it.\n\nNotes by me\n')).toBe(
      '# Plan\n\nShip it.\n\nNotes by me\n',
    )
  })
})
