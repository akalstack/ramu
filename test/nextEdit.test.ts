import { expect, it } from 'vitest'
import { buildPrompt, parseEdit, reindent, predictNextEdit, windowOf, NEXT_EDIT_SCHEMA, type EditRecord, type NextEditInput } from '../src/main/nextEdit'

const input = (lines: string[], edits: EditRecord[], cursorLine = 1): NextEditInput => ({ path: 'a.ts', lines, cursorLine, edits })
const edit = (line: number, before: string[], after: string[]): EditRecord => ({ line, before, after })

it('shows the model the recent edits and the numbered code around the cursor', () => {
  const p = buildPrompt(input(['function area(width, height) {', '  return w * h', '}'], [edit(1, ['function area(w, h) {'], ['function area(width, height) {'])], 1))
  expect(p.user).toContain('Edit 1 (near line 1):\n- function area(w, h) {\n+ function area(width, height) {')
  expect(p.user).toContain('   2 |   return w * h'); expect(p.user).toContain('cursor is on line 1'); expect([p.start, p.end]).toEqual([1, 3])
})

it('keeps the prompt small for large files, centred on the cursor and the edits', () => {
  const lines = Array.from({ length: 1000 }, (_, i) => `line ${i + 1}`)
  const w = windowOf(lines, 500, [edit(470, [], ['x'])])
  expect(w.start).toBeLessThanOrEqual(450); expect(w.end).toBeGreaterThanOrEqual(540); expect(w.end - w.start + 1).toBeLessThanOrEqual(120)
  expect(windowOf(lines, 3, [])).toEqual({ start: 1, end: 61 })
  const p = buildPrompt(input(Array.from({ length: 5 }, () => 'x'.repeat(1000)), [edit(1, ['y'.repeat(1000)], ['z'])]))
  expect(p.user.length).toBeLessThan(2500)
})

const lines = ['const a = 1', 'const b = 2', 'const c = 3']
const win = { start: 1, end: 3 }
it('accepts a valid edit, strips code fences and trailing newlines, and rejects everything else', () => {
  const ok = (replacement: string, extra = {}) => JSON.stringify({ edit: true, startLine: 2, endLine: 2, replacement, ...extra })
  expect(parseEdit(ok("const b = 'two'"), input(lines, []), win)).toEqual({ startLine: 2, endLine: 2, text: "const b = 'two'" })
  expect(parseEdit(ok("```ts\nconst b = 'two'\n```"), input(lines, []), win)!.text).toBe("const b = 'two'")
  expect(parseEdit(ok("const b = 'two'\n"), input(lines, []), win)!.text).toBe("const b = 'two'")
  for (const bad of [JSON.stringify({ edit: false }), 'not json', ok('const b = 2'), ok(''), ok('x', { startLine: 0 }), ok('x', { endLine: 9 }), ok('x', { startLine: 3, endLine: 2 }), JSON.stringify({ edit: true, startLine: 1 })]) expect(parseEdit(bad, input(lines, []), win), bad).toBeNull()
})

it('asks the model only when the user has edited something, and only trusts a well-formed answer', async () => {
  const controller = new AbortController(); let asked = 0
  const deps = { chat: async () => { asked++; return JSON.stringify({ edit: true, startLine: 3, endLine: 3, replacement: 'const c = 30' }) } }
  expect(await predictNextEdit(deps, input(lines, []), controller.signal)).toBeNull(); expect(asked).toBe(0)
  expect(await predictNextEdit(deps, input(lines, [edit(1, ['const a = 1'], ['const a = 10'])]), controller.signal)).toEqual({ startLine: 3, endLine: 3, text: 'const c = 30' })
  expect(NEXT_EDIT_SCHEMA.required).toEqual(['edit'])
})

it('strips line numbers a model copied from the numbered listing', () => {
  const answer = JSON.stringify({ edit: true, startLine: 3, endLine: 3, replacement: "   3 | const c = 'three'" })
  expect(parseEdit(answer, input(lines, []), win)!.text).toBe("const c = 'three'")
})

it('keeps the indentation of the lines it replaces when the model gets it wrong', () => {
  expect(reindent('   const data = await load()', '  const data = load()')).toBe('  const data = await load()')
  expect(reindent('if (x) {\n  y()\n}', '    if (x) {')).toBe('    if (x) {\n      y()\n    }')
  expect(reindent('x', '')).toBe('x'); expect(reindent('  x', '  y')).toBe('  x')
})
