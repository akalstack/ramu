import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { isTerminalAttachmentList, terminalAttachment } from '@ramu/shared/chat/terminalContext'

const data = vi.hoisted(() => new Map<string, string>())
vi.mock('../src/hosts', () => ({ ownHostId: () => 'a' }))
vi.mock('../src/hostStorage', () => ({
  ownHostStore: () => null,
  storeForHost: (host: string) => ({
    getItem: (key: string) => data.get(`${host}:${key}`) ?? null,
    setItem: (key: string, value: string) => void data.set(`${host}:${key}`, value),
    removeItem: (key: string) => void data.delete(`${host}:${key}`),
    key: () => null,
    length: 0,
  }),
}))

const { sendTerminalToChat, terminalAttachmentMarkdown, terminalDraftKey, TERMINAL_CONTEXT_EVENT } =
  await import('../src/chat/terminalToChat')
const { loadJsonDraft } = await import('../src/composer/drafts')
const { captureTerminal } = await import('../src/workspace/terminalCapture')

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget())
  data.clear()
})
afterEach(() => vi.unstubAllGlobals())

const saved = (host: string, session: string) =>
  loadJsonDraft(terminalDraftKey(session), host, isTerminalAttachmentList, [])

it('hands output to the chat on screen and stores nothing behind it', () => {
  const item = terminalAttachment('ramu', [1, 2], 'Error: boom', 'x')!
  const received: unknown[] = []
  window.addEventListener(TERMINAL_CONTEXT_EVENT, (event) => {
    const detail = (event as CustomEvent<{ session: string; attachment: unknown; taken?: boolean }>).detail
    if (detail.session !== 's1') return
    detail.taken = true
    received.push(detail.attachment)
  })
  expect(sendTerminalToChat('a', 's1', item)).toBe(true)
  expect(received).toEqual([item])
  expect(saved('a', 's1')).toEqual([])
})

it('keeps output for a chat that is not on screen in that chat on that host', () => {
  const first = terminalAttachment('ramu', [1, 1], 'one', 'x')!
  const second = terminalAttachment('ramu', [2, 2], 'two', 'y')!
  expect(sendTerminalToChat('a', 's2', first)).toBe(false)
  sendTerminalToChat('a', 's2', second)
  expect(saved('a', 's2')).toEqual([first, second])
  expect(saved('b', 's2')).toEqual([])
})

it('fences output that itself contains a fence', () => {
  const item = terminalAttachment('ramu', [1, 3], 'a\n```\nb', 'x')!
  expect(terminalAttachmentMarkdown(item)).toBe('````text\na\n```\nb\n````')
})

function fakeTerminal(rows: { text: string; wrapped?: boolean }[], visible: number, top = 0, selection?: string) {
  return {
    rows: visible,
    hasSelection: () => selection !== undefined,
    getSelection: () => selection ?? '',
    getSelectionPosition: () => (selection === undefined ? undefined : { start: { y: 4 }, end: { y: 6 } }),
    buffer: {
      active: {
        viewportY: top,
        getLine: (y: number) =>
          rows[y] && { isWrapped: !!rows[y]!.wrapped, translateToString: () => rows[y]!.text.trimEnd() },
      },
    },
  }
}

it('takes the selection with its buffer lines when there is one', () => {
  expect(captureTerminal(fakeTerminal([], 10, 0, 'picked'))).toEqual({ text: 'picked', lines: [5, 7], selection: true })
})

it('otherwise takes the rows on screen, joining wrapped rows and skipping blank ones in the range', () => {
  const rows = [
    { text: 'scrolled away' },
    { text: '' },
    { text: '$ cat /very/long/pa' },
    { text: 'th/name.txt', wrapped: true },
    { text: 'No such file' },
    { text: '' },
  ]
  expect(captureTerminal(fakeTerminal(rows, 5, 1))).toEqual({
    text: '\n$ cat /very/long/path/name.txt\nNo such file\n',
    lines: [3, 5],
    selection: false,
  })
  expect(captureTerminal(fakeTerminal([{ text: '' }, { text: '  ' }], 2))).toBeNull()
})
