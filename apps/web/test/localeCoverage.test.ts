import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { indonesian } from '@ramu/shared/locales/id'

const SRC = join(import.meta.dirname, '../src')

/** Copy that reads the same in Indonesian (names, acronyms, placeholders); everything else needs a catalog entry. */
const SAME_IN_INDONESIAN = new Set(['AI', 'OK', 'review-checklist'])

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? sources(path) : /\.tsx?$/.test(name) ? [path] : []
  })
}

describe('Indonesian catalog coverage', () => {
  it('has an entry for every literal passed to t(), so new copy is not shipped untranslated', () => {
    const missing = new Set<string>()
    for (const file of sources(SRC))
      for (const match of readFileSync(file, 'utf8').matchAll(/(?<![\w.$])t\(\s*(['"])((?:\\.|(?!\1).)*)\1\s*[,)]/g)) {
        // `translate` looks the trimmed text up, so spacing around icons or values is not part of the key.
        const key = match[2]!.replace(/\\(['"\\])/g, '$1').trim()
        if (key && /[A-Za-z]/.test(key) && !Object.hasOwn(indonesian, key) && !SAME_IN_INDONESIAN.has(key))
          missing.add(key)
      }
    expect([...missing].sort()).toEqual([])
  })
})
