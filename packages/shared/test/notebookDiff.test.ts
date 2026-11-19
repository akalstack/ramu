import { expect, it } from 'vitest'
import { diffNotebook, parseNotebook } from '../src/review/notebookDiff'
import { textDiffRows } from '../src/review/lineDiff'

const notebook = (cells: object[]) => JSON.stringify({ nbformat: 4, cells })
const code = (source: string | string[], outputs: object[] = []) => ({ cell_type: 'code', source, outputs })
const md = (source: string) => ({ cell_type: 'markdown', source })

it('reads sources split into lines, streams, errors and the richest output of each result', () => {
  const cells = parseNotebook(
    notebook([
      code(
        ['import a\n', 'a.run()'],
        [
          { output_type: 'stream', text: ['ok\n'] },
          { output_type: 'error', ename: 'ValueError', evalue: 'bad' },
          { output_type: 'display_data', data: { 'image/png': 'AAAA\n', 'text/plain': '<Figure>' } },
          { output_type: 'execute_result', data: { 'text/plain': ['42'] } },
        ],
      ),
      md('# Title'),
    ]),
  )
  expect(cells).toEqual([
    {
      type: 'code',
      source: 'import a\na.run()',
      outputs: [
        { kind: 'text', text: 'ok\n' },
        { kind: 'text', text: 'ValueError: bad', error: true },
        { kind: 'image', uri: 'data:image/png;base64,AAAA' },
        { kind: 'text', text: '42' },
      ],
    },
    { type: 'markdown', source: '# Title', outputs: [] },
  ])
  expect(parseNotebook('not json')).toBeNull()
  expect(parseNotebook('')).toEqual([])
})

it('matches cells by source, pairs a replaced cell as modified and marks output-only changes', () => {
  const before = notebook([
    md('# Intro'),
    code('x = 1\nprint(x)'),
    code('y = 2', [{ output_type: 'stream', text: '2' }]),
  ])
  const after = notebook([
    md('# Intro'),
    code('x = 3\nprint(x)'),
    code('y = 2', [{ output_type: 'stream', text: '3' }]),
    md('Done'),
  ])
  const changes = diffNotebook(before, after)!
  expect(changes.map((change) => change.kind)).toEqual(['same', 'modified', 'modified', 'added'])
  const edited = changes[1]!
  expect(edited.kind === 'modified' && edited.source).toEqual([
    { type: 'del', text: 'x = 1' },
    { type: 'add', text: 'x = 3' },
    { type: 'ctx', text: 'print(x)' },
  ])
  expect(changes[2]!.kind === 'modified' && changes[2]!.outputsChanged).toBe(true)
  expect(diffNotebook(before, '')!.every((change) => change.kind === 'removed')).toBe(true)
  expect(diffNotebook('{', after)).toBeNull()
})

it('diffs lines with shared head and tail', () => {
  expect(textDiffRows('a\nb\nc\n', 'a\nB\nc\n')).toEqual([
    { type: 'ctx', text: 'a' },
    { type: 'del', text: 'b' },
    { type: 'add', text: 'B' },
    { type: 'ctx', text: 'c' },
  ])
})
