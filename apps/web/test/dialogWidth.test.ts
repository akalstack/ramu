import { expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const SRC = join(import.meta.dirname, '../src')

function* sources(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (relative(SRC, path) !== 'components/ui') yield* sources(path)
    } else if (entry.name.endsWith('.tsx')) yield path
  }
}

// The upstream dialog caps its width with `sm:max-w-sm`. A plain `max-w-*` loses to it on any normal window, so a dialog
// that asks for more room silently stays 384px wide; only an `sm:` override (or a selector that outranks it) works.
it('widens a dialog with an sm: max-width, which is the only kind that beats the upstream cap', () => {
  const offenders: string[] = []
  for (const path of sources(SRC))
    for (const match of readFileSync(path, 'utf8').matchAll(/<(?:Alert)?DialogContent\b[^>]*>/g))
      if (/(?<![:\w-])max-w-(?:none|\[)/.test(match[0]))
        offenders.push(`${relative(SRC, path)}: ${match[0].slice(0, 90)}`)
  expect(offenders).toEqual([])
})
