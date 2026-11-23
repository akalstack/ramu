import { describe, expect, it } from 'vitest'
import {
  isEmptyCommand,
  terminalBlockAt,
  terminalBlockRanges,
  terminalRowsText,
  trackTerminalBlocks,
  type BlockTerminal,
} from '../src/workspace/terminalBlocks'

type Row = { text: string; wrapped?: boolean }

/** Just enough of xterm: rows of text, a cursor, markers that follow the cursor and an OSC hook. */
function fakeTerminal(rows: Row[] = []) {
  const lines = rows
  let osc: ((data: string) => boolean) | undefined
  const buffer = {
    baseY: 0,
    cursorY: 0,
    getLine: (y: number) =>
      lines[y] && {
        isWrapped: !!lines[y]!.wrapped,
        translateToString: (trim?: boolean) => (trim ? lines[y]!.text.trimEnd() : lines[y]!.text),
      },
  }
  const term = {
    buffer: { active: { type: 'normal' }, normal: buffer },
    registerMarker: () => {
      const marker = { line: buffer.cursorY, isDisposed: false, dispose: () => (marker.isDisposed = true) }
      return marker
    },
    parser: {
      registerOscHandler: (_ident: number, callback: (data: string) => boolean) => {
        osc = callback
        return { dispose: () => (osc = undefined) }
      },
    },
  } satisfies BlockTerminal
  return {
    term,
    /** Prints a row and leaves the cursor on it. */
    print(text: string, wrapped = false) {
      lines.push({ text, wrapped })
      buffer.cursorY = lines.length - 1
    },
    osc: (data: string) => osc?.(data),
  }
}

describe('terminalRowsText', () => {
  it('joins rows a long line wrapped onto and drops blank rows at the end', () => {
    const { term } = fakeTerminal([
      { text: '$ echo aaa' },
      { text: 'aaaa ' },
      { text: 'bbbb', wrapped: true },
      { text: '   ' },
    ])
    expect(terminalRowsText(term.buffer.normal, { start: 0, end: 3 })).toBe('$ echo aaa\naaaa bbbb')
  })
})

describe('terminalBlockRanges', () => {
  it('runs each block to the row before the next and the newest to the given end', () => {
    expect(terminalBlockRanges([5, 0, 5, 3], 8)).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 4 },
      { start: 5, end: 8 },
    ])
  })

  it('keeps a block that printed nothing as its one row', () => {
    expect(terminalBlockRanges([4], 3)).toEqual([{ start: 4, end: 4 }])
  })

  it('finds the block a row is in, and nothing above the first', () => {
    const blocks = terminalBlockRanges([2, 6], 9)
    expect(terminalBlockAt(blocks, 4)).toEqual({ start: 2, end: 5 })
    expect(terminalBlockAt(blocks, 12)).toEqual({ start: 6, end: 9 })
    expect(terminalBlockAt(blocks, 1)).toBeNull()
  })
})

describe('isEmptyCommand', () => {
  it('treats a bare prompt or a blank row as running nothing', () => {
    expect(isEmptyCommand('~/app $ ', '~/app $ ls')).toBe(true)
    expect(isEmptyCommand('   ', undefined)).toBe(true)
  })

  it('treats a typed command as a command, even one the previous command starts with', () => {
    expect(isEmptyCommand('~/app $ l', '~/app $ ls')).toBe(false)
    expect(isEmptyCommand('~/app $ ', undefined)).toBe(false)
  })
})

describe('trackTerminalBlocks', () => {
  it('starts a block at each command typed and leaves the waiting prompt out of the last', () => {
    const t = fakeTerminal()
    const blocks = trackTerminalBlocks(t.term)
    t.print('$ ls')
    blocks.input('\r')
    t.print('a.txt')
    t.print('b.txt')
    t.print('$ pwd')
    blocks.input('\r')
    t.print('/home')
    t.print('$ ')
    // Enter at an empty prompt, and a paste, start nothing.
    blocks.input('\r')
    blocks.input('\x1b[200~echo\r\x1b[201~')
    const found = blocks.blocks()
    expect(found.map((range) => blocks.text(range))).toEqual(['$ ls\na.txt\nb.txt', '$ pwd\n/home'])
  })

  it('uses the prompts a shell marks instead of guessing from Enter', () => {
    const t = fakeTerminal()
    const blocks = trackTerminalBlocks(t.term)
    t.print('$ guessed')
    blocks.input('\r')
    t.print('╭─ ~/app')
    t.osc('A')
    t.print('╰─ ❯ make')
    t.osc('C')
    t.print('built')
    t.print('╭─ ~/app')
    t.osc('A')
    t.print('╰─ ❯ ')
    blocks.input('\r')
    // A two-line prompt stays with its command, and the prompt waiting for input is not a block yet.
    expect(blocks.blocks().map((range) => blocks.text(range))).toEqual(['╭─ ~/app\n╰─ ❯ make\nbuilt'])
    t.osc('C')
    t.print('compiling')
    expect(blocks.blocks().map((range) => blocks.text(range))).toEqual([
      '╭─ ~/app\n╰─ ❯ make\nbuilt',
      '╭─ ~/app\n╰─ ❯\ncompiling',
    ])
  })

  it('offers nothing while a full-screen program is open', () => {
    const t = fakeTerminal()
    const blocks = trackTerminalBlocks(t.term)
    t.print('$ vim')
    blocks.input('\r')
    t.term.buffer.active.type = 'alternate'
    expect(blocks.blocks()).toEqual([])
  })
})
