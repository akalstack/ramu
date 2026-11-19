import { test } from 'node:test'
import assert from 'node:assert/strict'
import { patchRows } from '@ramu/shared/pullRequests'
import { patchDiffLines } from '../src/runtime/diff.ts'

test("a pull request's patch draws as the thread's diff lines, numbered on each side", () => {
  const lines = patchDiffLines(patchRows('@@ -1,2 +1,2 @@\n keep\n-old\n+new\n\\ No newline at end of file'))
  assert.deepEqual(
    lines.map((line) => [line.type, line.old ?? null, line.new ?? null]),
    [
      ['hunk', null, null],
      ['ctx', 1, 1],
      ['del', 2, null],
      ['add', null, 2],
      ['hunk', null, null],
    ],
  )
})
