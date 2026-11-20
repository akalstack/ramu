import { describe, expect, it } from 'vitest'
import {
  extractTerminalLinks,
  terminalLinkAt,
  terminalLinksAround,
  terminalPathTargets,
  type TerminalBufferLine,
} from '../src/workspace/terminalLinks'

const texts = (line: string) => extractTerminalLinks(line).map((link) => `${link.kind}:${link.text}`)

describe('extractTerminalLinks', () => {
  it('finds web addresses and trims the punctuation around them', () => {
    expect(texts('Local: http://localhost:5173/ (ready).')).toEqual(['url:http://localhost:5173/'])
    expect(texts('see (https://example.com/a_(b)) now')).toEqual(['url:https://example.com/a_(b)'])
    expect(extractTerminalLinks('open https://x.dev/p?q=1, then')[0]).toMatchObject({ start: 5, end: 24 })
  })

  it('finds paths with positions as compilers and tools print them', () => {
    expect(texts('src/app.ts:12:3 - error TS2322')).toEqual(['path:src/app.ts:12:3'])
    expect(texts('  at run (/home/me/app/index.js:40:7)')).toEqual(['path:/home/me/app/index.js:40:7'])
    expect(texts('error: ./build/out.js:3: missing')).toEqual(['path:./build/out.js:3'])
    expect(texts('main.go:8:2: undefined: x')).toEqual(['path:main.go:8:2'])
    expect(texts('C:\\work\\app.ts:4 failed')).toEqual(['path:C:\\work\\app.ts:4'])
    expect(texts('written to ~/logs/run.txt.')).toEqual(['path:~/logs/run.txt'])
    expect(texts('--outfile=dist/main.js')).toEqual(['path:dist/main.js'])
  })

  it('turns TypeScript locations into line and column', () => {
    const [link] = extractTerminalLinks('src/a.ts(12,5): error TS2304: Cannot find name')
    expect(link).toEqual({ kind: 'path', text: 'src/a.ts:12:5', start: 0, end: 14 })
  })

  it('links the file a diff header names, without its a/ or b/ side', () => {
    expect(texts('+++ b/src/x.ts')).toEqual(['path:src/x.ts'])
    expect(texts('diff --git a/README.md b/README.md')).toEqual(['path:README.md', 'path:README.md'])
  })

  it('leaves prose, numbers, hosts, remotes and routes as text', () => {
    expect(texts('Compiled 12/40 modules in 1.2s')).toEqual([])
    expect(texts('listening on localhost:3000/api')).toEqual([])
    expect(texts('origin git@github.com:acme/widgets.git (fetch)')).toEqual([])
    expect(texts('GET /api/items?page=2 200')).toEqual([])
    expect(texts('see example.com and v1.2.3')).toEqual([])
    expect(texts('redis://cache/0')).toEqual([])
  })
})

function buffer(rows: string[], wrapped: number[] = []): (row: number) => TerminalBufferLine | undefined {
  return (row) =>
    row < rows.length
      ? { isWrapped: wrapped.includes(row), translateToString: (trim) => (trim ? rows[row]!.trimEnd() : rows[row]!) }
      : undefined
}

describe('terminalLinksAround', () => {
  it('joins a link that wrapped onto the next row', () => {
    const lines = buffer(['see https://exa', 'mple.com/docs  '], [1])
    const expected = {
      kind: 'url',
      text: 'https://example.com/docs',
      start: { row: 0, column: 4 },
      end: { row: 1, column: 12 },
    }
    expect(terminalLinksAround(1, lines)).toEqual([expected])
    expect(terminalLinksAround(0, lines)).toEqual([expected])
    expect(terminalLinkAt({ row: 1, column: 2 }, lines)?.text).toBe('https://example.com/docs')
    expect(terminalLinkAt({ row: 1, column: 14 }, lines)).toBeNull()
  })

  it('keeps separate lines apart', () => {
    const lines = buffer(['src/a.ts:1', 'src/b.ts:2'])
    expect(terminalLinksAround(1, lines).map((link) => link.text)).toEqual(['src/b.ts:2'])
  })
})

describe('terminalPathTargets', () => {
  it('tries the shell folder first, then the path as written', () => {
    expect(terminalPathTargets('./src/a.ts:3', '/repo/')).toEqual(['/repo/src/a.ts:3', './src/a.ts:3'])
    expect(terminalPathTargets('src/a.ts', 'C:\\repo')).toEqual(['C:\\repo\\src\\a.ts', 'src/a.ts'])
    expect(terminalPathTargets('/etc/hosts', '/repo')).toEqual(['/etc/hosts'])
    expect(terminalPathTargets('src/a.ts', null)).toEqual(['src/a.ts'])
  })
})
