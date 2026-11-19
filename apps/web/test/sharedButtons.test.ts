import { expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const SRC = join(import.meta.dirname, '../src')

// Ordinary actions use app controls. Recovery is intentionally native so a candidate palette
// or unavailable host field cannot hide or disable the person's way back to their previous theme.
const NATIVE_EXCEPTIONS: Record<string, number> = { 'components/theme-recovery-button.tsx': 1 }

function* sources(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (relative(SRC, path) !== 'components/ui') yield* sources(path)
    } else if (entry.name.endsWith('.tsx')) yield path
  }
}

it('routes new buttons through the shared app control', () => {
  const found: Record<string, number> = {}
  for (const path of sources(SRC)) {
    const count = (readFileSync(path, 'utf8').match(/<button\b/g) ?? []).length
    if (count) found[relative(SRC, path)] = count
  }
  // Exact equality also requires removing an allowance after a migration.
  expect(found).toEqual(NATIVE_EXCEPTIONS)
})

it('keeps reorder gesture states in the shared activator, with image panning separate', () => {
  const handles = [...sources(SRC)]
    .filter((path) => /\bcursor-grab\b/.test(readFileSync(path, 'utf8')))
    .map((path) => relative(SRC, path))
    .filter((path) => path !== 'composer/Attachments.tsx') // Panning an image is not a reorder handle.
    .filter((path) => path !== 'liveView/LiveView.tsx') // Moving the floating live view is not a reorder either.
  expect(handles).toEqual(['components/drag-handle.tsx'])
})
