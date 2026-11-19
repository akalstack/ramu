import { describe, expect, it } from 'vitest'

describe('file paths in inline code', () => {
  it('links what agents write as a file and leaves commands, URLs and words alone', async () => {
    const { inlineCodeFileLink } = await import('../src/workspace/fileLinks')
    for (const path of ['src/app.ts', 'apps/web/src/App.tsx:42', './x.ts', '/Users/a/b.ts', 'app.ts:12', '~/x/y'])
      expect(inlineCodeFileLink(path)).toBe(path)
    for (const text of ['npm install', 'http://a.com/x.ts', 'foo', 'v1.2', 'e.g.'])
      expect(inlineCodeFileLink(text)).toBeNull()
  })
})
