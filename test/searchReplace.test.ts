import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { replacementPlan, searchText } from '../src/main/files'
import type { SearchOptions } from '../src/shared/types'
let root: string
beforeEach(async () => { root = await realpath(await mkdtemp(join(tmpdir(), 'ramu-replace-'))) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })
const options = (query: string, regex = false): SearchOptions => ({ query, regex, caseSensitive: true, wholeWord: false, include: '', exclude: '' })
async function replace(content: string, query: SearchOptions, replacement: string) {
  await writeFile(join(root, 'file.txt'), content)
  const found = await searchText(root, 'repo', query, 500)
  const plans = await replacementPlan(root, 'repo', query, replacement, found.matches)
  expect(plans).toHaveLength(1)
  return plans[0]!.content
}
it('replaces literal Unicode matches and accepts an empty replacement', async () => {
  expect(await replace('é cat cat\r\ncat\r\n', options('cat'), '')).toBe('é  \r\n\r\n')
})
it('preserves surrounding text for word boundaries and capture groups', async () => {
  expect(await replace('cat-12 cat-34\n', options('\\bcat-(\\d+)\\b', true), 'dog-$1')).toBe('dog-12 dog-34\n')
})
it('expands replacements with contextual regex anchors', async () => {
  expect(await replace('cat dog\ncat fox\n', options('^cat', true), 'pet')).toBe('pet dog\npet fox\n')
})

it('expands contextual replacement tokens from the original line', async () => {
  expect(await replace('left cat right\n', options('cat', true), "$`<$&>$'")).toBe('left left <cat> right right\n')
})

it('distinguishes an exact display limit from truncated results', async () => {
  await writeFile(join(root, 'file.txt'), 'view\n'.repeat(500))
  expect((await searchText(root, 'repo', options('view'), 500)).limited).toBe(false)
  await writeFile(join(root, 'file.txt'), 'view\n'.repeat(501))
  const found = await searchText(root, 'repo', options('view'), 500)
  expect(found.matches).toHaveLength(500)
  expect(found.limited).toBe(true)
})
it('reviews every replacement beyond the display limit', async () => {
  await writeFile(join(root, 'file.txt'), 'view\n'.repeat(650))
  const found = await searchText(root, 'repo', options('view'), 20_000)
  expect(found.limited).toBe(false)
  const plans = await replacementPlan(root, 'repo', options('view'), 'viaw', found.matches)
  expect(plans[0]!.preview.count).toBe(650)
  expect(plans[0]!.content).toBe('viaw\n'.repeat(650))
})
it('rejects excessively expanded content before building the replacement output', async () => {
  await writeFile(join(root, 'file.txt'), 'view\n'.repeat(650))
  const found = await searchText(root, 'repo', options('view'), 20_000)
  await expect(replacementPlan(root, 'repo', options('view'), 'x'.repeat(100_000), found.matches)).rejects.toThrow('produces too much content')
})
