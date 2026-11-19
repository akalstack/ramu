import { test } from 'node:test'
import assert from 'node:assert/strict'
import { contentSearchOptions, groupSearchMatches } from '../src/runtime/contentSearch.ts'

const match = (repoId, path, line) => ({ repoId, path, line, column: 1, endColumn: 2, text: 'x', start: 0, end: 1 })

test('matches group by repository and file in the order the host found them', () => {
  const groups = groupSearchMatches([
    match('web', 'src/a.ts', 4),
    match('api', 'src/a.ts', 2),
    match('web', 'src/a.ts', 10),
    match('web', 'README.md', 1),
  ])
  assert.deepEqual(
    groups.map((group) => [group.repoId, group.path, group.matches.map((entry) => entry.line)]),
    [
      ['web', 'src/a.ts', [4, 10]],
      ['api', 'src/a.ts', [2]],
      ['web', 'README.md', [1]],
    ],
  )
  assert.deepEqual(groupSearchMatches([]), [])
})

test('a phone search is plain text over the whole checkout and keeps the query as typed', () => {
  assert.deepEqual(contentSearchOptions(' useState('), {
    query: ' useState(',
    caseSensitive: false,
    wholeWord: false,
    regex: false,
    include: '',
    exclude: '',
  })
})
