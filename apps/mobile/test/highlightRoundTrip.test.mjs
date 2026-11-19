import { test } from 'node:test'
import assert from 'node:assert/strict'

// The file editor colours text inside the field only when the tokens spell out the exact text; otherwise the cursor jumps.
test('highlighted tokens spell out the exact source, entities and tabs included', async () => {
  const { grammarFor, highlightLines } = await import('../src/runtime/highlight.ts')
  const samples = [
    ['a.ts', `const x = a < b && c > d ? "q'" : '&amp;'\n// note <tag>\n\tif (x) {\n  return \`\${y}\`\n}\n`],
    ['a.py', 'def f(a, b):\n    return a <= b  # x & y\n'],
    ['a.html', '<div class="a">&nbsp;&lt;</div>\n'],
  ]
  for (const [path, source] of samples) {
    const lines = highlightLines(source, grammarFor(source, path))
    assert.ok(lines, path)
    assert.equal(lines.map((tokens) => tokens.map((token) => token.text).join('')).join('\n'), source, path)
  }
})
