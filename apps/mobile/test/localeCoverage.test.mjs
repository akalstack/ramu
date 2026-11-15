import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const catalog = readFileSync(join(root, '../../packages/shared/src/locales/id.ts'), 'utf8')
const unescape = (text) => text.replace(/\\(['"\\])/g, '$1')
const keys = new Set([
  ...[...catalog.matchAll(/^\s*(['"])((?:\\.|(?!\1).)*)\1:/gm)].map((match) => unescape(match[2])),
  ...[...catalog.matchAll(/^\s*([A-Za-z_]\w*):/gm)].map((match) => match[1]),
])

function sources(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? sources(path) : /\.tsx?$/.test(name) ? [path] : []
  })
}

test('every literal passed to say() or t(), and every host setting label, has an Indonesian entry', () => {
  const missing = new Set()
  for (const file of sources(join(root, 'src'))) {
    const source = readFileSync(file, 'utf8')
    const patterns = [/(?<![\w.$])(?:say|t)\(\s*(['"])((?:\\.|(?!\1).)*)\1\s*[,)]/g]
    // Host setting rows are written in English in the model and translated where they are drawn.
    if (file.endsWith('settingsModel.ts'))
      patterns.push(/\b(?:title|help|emptyLabel|label):\s*(['"])((?:\\.|(?!\1).)*)\1/g)
    for (const pattern of patterns)
      for (const match of source.matchAll(pattern)) {
        const key = unescape(match[2]).trim()
        if (key && /[A-Za-z]/.test(key) && !keys.has(key)) missing.add(key)
      }
  }
  assert.deepEqual([...missing].sort(), [])
})
