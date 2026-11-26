import { expect, it } from 'vitest'
import type { AgentEvent } from '@ramu/shared/types'
import { WriteLedger, writtenPaths } from '../src/review/writeLedger'

const edit = (toolUseId: string, file: string): AgentEvent => ({
  kind: 'tool-use',
  toolUseId,
  name: 'Edit',
  summary: file,
  input: JSON.stringify({ file_path: file }),
})
const bash = (toolUseId: string): AgentEvent => ({ kind: 'tool-use', toolUseId, name: 'Bash', summary: 'pnpm format' })
const done = (toolUseId: string): AgentEvent => ({ kind: 'tool-result', toolUseId, isError: false, summary: '' })

function ledger() {
  let now = 1_000
  const watched: string[] = []
  const clashes: [string, string, string][] = []
  const writes = new WriteLedger({
    now: () => now,
    watch: (root) => {
      watched.push(root)
      return { close: () => watched.splice(watched.indexOf(root), 1) } as never
    },
    clash: (a, b, path) => clashes.push([a, b, path]),
  })
  return { writes, watched, clashes, at: (time: number) => (now = time) }
}

it('reads the files a tool says it writes, whatever the provider', () => {
  expect(writtenPaths(edit('1', 'src/a.ts') as never, '/repo')).toEqual(['/repo/src/a.ts'])
  expect(
    writtenPaths({ kind: 'tool-use', toolUseId: '2', name: 'Edit', summary: 'src/a.ts, /repo/b.ts' } as never, '/repo'),
  ).toEqual(['/repo/src/a.ts', '/repo/b.ts'])
  expect(
    writtenPaths(
      {
        kind: 'tool-use',
        toolUseId: '3',
        name: 'apply_patch',
        summary: '',
        input: '*** Begin Patch\n*** Update File: src/c.ts\n*** Add File: d.md\n*** End Patch',
      } as never,
      '/repo',
    ),
  ).toEqual(['/repo/src/c.ts', '/repo/d.md'])
  expect(writtenPaths(bash('4') as never, '/repo')).toEqual([])
})

it('leaves a turn that had the checkout to itself as it was, and watches nothing', () => {
  const { writes, watched } = ledger()
  writes.begin('r1', 'a', ['/repo'])
  writes.end('r1')
  expect(watched).toEqual([])
  expect(writes.authorship('r1', ['/repo/x.ts'])).toEqual(new Map([['/repo/x.ts', { kind: 'mine' }]]))
})

it('gives each overlapping thread only the files it wrote, by edit or by its own command', () => {
  const { writes, watched, at } = ledger()
  writes.begin('ra', 'a', ['/repo'], 1_000)
  at(2_000)
  writes.begin('rb', 'b', ['/repo'], 2_000)
  expect(watched).toEqual(['/repo'])
  at(3_000)
  writes.observe('a', '/repo', edit('e1', 'src/a.ts'))
  writes.changed('/repo/src/a.ts')
  at(4_000)
  writes.observe('b', '/repo', bash('s1'))
  at(5_000)
  // The formatter run by b rewrote a file nobody edited by hand.
  writes.changed('/repo/package.json')
  at(6_000)
  writes.observe('b', '/repo', done('s1'))
  at(20_000)
  // A write while no command ran and both turns were open: nobody can say whose it is.
  writes.changed('/repo/notes.md')
  at(30_000)
  writes.end('ra')
  writes.end('rb')
  expect(watched).toEqual([])
  const paths = ['/repo/src/a.ts', '/repo/package.json', '/repo/notes.md', '/repo/early.ts']
  expect(Object.fromEntries(writes.authorship('ra', paths))).toEqual({
    '/repo/src/a.ts': { kind: 'mine' },
    '/repo/package.json': { kind: 'other', by: 'b' },
    '/repo/notes.md': { kind: 'unknown' },
    // Changed before the watcher started, while a's turn was the only one open.
    '/repo/early.ts': { kind: 'mine' },
  })
  expect(Object.fromEntries(writes.authorship('rb', paths.slice(0, 3)))).toEqual({
    '/repo/src/a.ts': { kind: 'other', by: 'a' },
    '/repo/package.json': { kind: 'mine' },
    '/repo/notes.md': { kind: 'unknown' },
  })
})

it('marks a file both threads edited as shared, and says so to both once', () => {
  const { writes, clashes, at } = ledger()
  writes.begin('ra', 'a', ['/repo'], 1_000)
  writes.begin('rb', 'b', ['/repo/packages/web'], 1_000)
  at(2_000)
  writes.observe('a', '/repo', edit('e1', 'packages/web/app.ts'))
  at(3_000)
  writes.observe('b', '/repo/packages/web', edit('e2', 'app.ts'))
  writes.observe('b', '/repo/packages/web', edit('e3', 'app.ts'))
  expect(clashes).toEqual([['b', 'a', '/repo/packages/web/app.ts']])
  writes.end('ra')
  expect(writes.authorship('ra', ['/repo/packages/web/app.ts']).get('/repo/packages/web/app.ts')).toEqual({
    kind: 'shared',
    with: ['b'],
  })
})

it('does not credit a command with a file another thread said it edited', () => {
  const { writes, at } = ledger()
  writes.begin('ra', 'a', ['/repo'], 1_000)
  writes.begin('rb', 'b', ['/repo'], 1_000)
  writes.observe('a', '/repo', bash('s1'))
  at(2_000)
  writes.observe('b', '/repo', edit('e1', 'b.ts'))
  writes.changed('/repo/b.ts')
  writes.end('ra')
  expect(writes.authorship('ra', ['/repo/b.ts']).get('/repo/b.ts')).toEqual({ kind: 'other', by: 'b' })
})

it('keeps what an open turn still needs after another is compared, and drops the rest', () => {
  const { writes, at } = ledger()
  writes.begin('ra', 'a', ['/repo'], 1_000)
  writes.begin('rb', 'b', ['/repo'], 1_000)
  at(2_000)
  writes.observe('a', '/repo', edit('e1', 'a.ts'))
  writes.end('ra', 3_000)
  writes.forget('ra')
  at(4_000)
  writes.end('rb')
  expect(writes.authorship('rb', ['/repo/a.ts']).get('/repo/a.ts')).toEqual({ kind: 'other', by: 'a' })
  writes.forget('rb')
  // With no turn open, nothing is kept: a new turn alone has its checkout to itself.
  writes.begin('rc', 'c', ['/repo'], 5_000)
  writes.end('rc', 6_000)
  expect(writes.authorship('rc', ['/repo/a.ts']).get('/repo/a.ts')).toEqual({ kind: 'mine' })
})

it('holds a command while another thread’s command runs in the shared checkout, and lets it go when that ends', async () => {
  const { writes } = ledger()
  writes.begin('ra', 'a', ['/repo'])
  writes.begin('rb', 'b', ['/repo'])
  writes.observe('a', '/repo', bash('s1'))
  const waitedFor: string[] = []
  let started = false
  const turn = writes
    .commandTurn('b', 's2', undefined, (other) => waitedFor.push(other))
    .then((waited) => {
      started = true
      return waited
    })
  // The hook may run after the call is reported; reporting it must not start it early.
  writes.observe('b', '/repo', bash('s2'))
  await new Promise((resolve) => setTimeout(resolve, 10))
  expect(started).toBe(false)
  writes.observe('a', '/repo', done('s1'))
  expect(await turn).toBe(true)
  expect(waitedFor).toEqual(['a'])
  writes.observe('b', '/repo', done('s2'))
  // With no other command running, a command never waits.
  expect(await writes.commandTurn('a', 's3')).toBe(false)
})

it('never holds a thread behind a command that only reads', async () => {
  const { writes } = ledger()
  writes.begin('ra', 'a', ['/repo'])
  writes.begin('rb', 'b', ['/repo'])
  writes.observe('a', '/repo', {
    ...bash('s1'),
    input: JSON.stringify({ command: 'git status --short' }),
  } as AgentEvent)
  expect(await writes.commandTurn('b', 's2')).toBe(false)
})

it('stops holding a command once the other one moves to the background, or after the longest wait', async () => {
  const { writes } = ledger()
  const quick = new WriteLedger({ watch: () => null, turnWaitMs: 20 })
  quick.begin('ra', 'a', ['/repo'])
  quick.begin('rb', 'b', ['/repo'])
  quick.observe('a', '/repo', bash('s1'))
  expect(await quick.commandTurn('b', 's2')).toBe(true)
  writes.begin('ra', 'a', ['/repo'])
  writes.begin('rb', 'b', ['/repo'])
  writes.observe('a', '/repo', bash('s1'))
  const turn = writes.commandTurn('b', 's2')
  writes.observe('a', '/repo', { kind: 'tool-result', toolUseId: 's1', isError: false, summary: '', running: true })
  expect(await turn).toBe(true)
})

it('reads a command’s changed files before and after it where the checkout can’t be watched', async () => {
  let now = 1_000
  const marks = [
    new Map([['/repo/a.ts', '1:1']]),
    new Map([
      ['/repo/a.ts', '2:5'],
      ['/repo/gen.ts', '9:5'],
    ]),
  ]
  const writes = new WriteLedger({
    now: () => now,
    watch: () => null,
    signature: async () => marks.shift() ?? new Map(),
  })
  writes.begin('ra', 'a', ['/repo'], 1_000)
  writes.begin('rb', 'b', ['/repo'], 1_000)
  now = 2_000
  writes.observe('b', '/repo', bash('s1'))
  now = 3_000
  writes.observe('b', '/repo', done('s1'))
  now = 4_000
  writes.end('ra')
  await writes.settled()
  expect(Object.fromEntries(writes.authorship('ra', ['/repo/a.ts', '/repo/gen.ts']))).toEqual({
    '/repo/a.ts': { kind: 'other', by: 'b' },
    '/repo/gen.ts': { kind: 'other', by: 'b' },
  })
})

it('sets apart what the person saved in Ramu’s editor, and marks a file they share with the turn', () => {
  const { writes, at } = ledger()
  writes.begin('ra', 'a', ['/repo'], 1_000)
  at(2_000)
  writes.personWrote('/repo/notes.md')
  writes.personWrote('/repo/a.ts')
  writes.observe('a', '/repo', edit('e1', 'a.ts'))
  writes.end('ra')
  // Alone, the turn keeps everything; what the person saved stays out of undo.
  expect(Object.fromEntries(writes.authorship('ra', ['/repo/notes.md', '/repo/a.ts']))).toEqual({
    '/repo/notes.md': { kind: 'mine', byYou: true },
    '/repo/a.ts': { kind: 'mine', byYou: true },
  })
  writes.forget('ra')
  writes.begin('rc', 'c', ['/repo'], 3_000)
  writes.begin('rd', 'd', ['/repo'], 3_000)
  at(4_000)
  writes.personWrote('/repo/notes.md')
  writes.changed('/repo/notes.md')
  writes.end('rc')
  expect(writes.authorship('rc', ['/repo/notes.md']).get('/repo/notes.md')).toEqual({ kind: 'you' })
})
