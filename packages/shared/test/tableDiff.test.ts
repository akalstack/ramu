import { describe, expect, it } from 'vitest'
import { foldTableRows, MAX_TABLE_ROWS, parseDelimited, tableDiff } from '../src/review/tableDiff'

describe('parseDelimited', () => {
  it('reads quoted cells with delimiters, doubled quotes, line breaks and CRLF', () => {
    expect(parseDelimited('a,"b,c","say ""hi""","two\nlines"\r\nx,y,z,w\n')).toEqual([
      ['a', 'b,c', 'say "hi"', 'two\nlines'],
      ['x', 'y', 'z', 'w'],
    ])
  })
  it('splits tab-separated text and keeps empty cells', () => {
    expect(parseDelimited('a\t\tc', '\t')).toEqual([['a', '', 'c']])
  })
  it('rejects a quote that never closes', () => {
    expect(() => parseDelimited('a,"b')).toThrow()
  })
})

describe('tableDiff', () => {
  it('marks added and removed rows and pairs edits as changed cells', () => {
    const diff = tableDiff('id,name\n1,Ann\n2,Bo\n3,Cy\n', 'id,name\n1,Ann\n2,Bob\n4,Di\n5,Ed\n')
    expect(diff.columns).toEqual([
      { name: 'id', status: 'same' },
      { name: 'name', status: 'same' },
    ])
    expect(diff.rows.map((row) => row.kind)).toEqual(['same', 'changed', 'changed', 'added'])
    expect(diff.rows[1]!.cells).toEqual([
      { before: '2', after: '2' },
      { before: 'Bo', after: 'Bob' },
    ])
  })
  it('keeps rows matched when a column is added or removed', () => {
    const diff = tableDiff('id,old,name\n1,x,Ann\n', 'id,name,age\n1,Ann,30\n')
    expect(diff.columns.map((column) => `${column.name}:${column.status}`)).toEqual([
      'id:same',
      'old:removed',
      'name:same',
      'age:added',
    ])
    expect(diff.rows).toEqual([
      {
        kind: 'same',
        cells: [{ before: '1', after: '1' }, { before: 'x' }, { before: 'Ann', after: 'Ann' }, { after: '30' }],
      },
    ])
  })
  it('shows an added file as all added', () => {
    const diff = tableDiff('', 'a\n1\n')
    expect(diff.columns).toEqual([{ name: 'a', status: 'added' }])
    expect(diff.rows).toEqual([{ kind: 'added', cells: [{ after: '1' }] }])
  })
  it('compares at most the row cap and says it stopped', () => {
    const big = ['n', ...Array.from({ length: MAX_TABLE_ROWS + 5 }, (_, i) => String(i))].join('\n')
    const diff = tableDiff(big, big)
    expect(diff.truncated).toBe(true)
    expect(diff.rows).toHaveLength(MAX_TABLE_ROWS)
  })
})

describe('foldTableRows', () => {
  it('folds long unchanged runs but keeps context beside each change', () => {
    const same = { kind: 'same' as const, cells: [] }
    const added = { kind: 'added' as const, cells: [] }
    const segments = foldTableRows([...Array(10).fill(same), added, ...Array(10).fill(same)], 2)
    expect(segments.map((segment) => `${segment.kind}:${segment.rows.length}`)).toEqual(['fold:8', 'rows:5', 'fold:8'])
  })
})
