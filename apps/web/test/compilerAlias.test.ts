import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sources(join(dir, entry.name)) : entry.name.endsWith('.tsx') ? [join(dir, entry.name)] : [],
  )

// The React Compiler, which only the built app runs, folds `const current = active` into a read of `active` after it
// was cleared, so the dialog's answer was never delivered and the action waiting on it never ended.
it('no component keeps a module variable in an alias, clears the variable, then uses the alias', () => {
  const root = join(import.meta.dirname, '../src')
  const found = sources(root).flatMap((file) => {
    const text = readFileSync(file, 'utf8')
    const modules = [...text.matchAll(/^let (\w+)\b/gm)].map((match) => match[1]!)
    return modules
      .filter((name) =>
        new RegExp(`const (\\w+) = ${name}\\n\\s*${name} = (null|undefined)\\n[^}]*?\\b\\1\\b`).test(text),
      )
      .map((name) => `${file.slice(root.length + 1)}: ${name}`)
  })
  expect(found).toEqual([])
})
