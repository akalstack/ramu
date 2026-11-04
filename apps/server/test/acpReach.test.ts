import { describe, expect, it } from 'vitest'
import { reachableDirectories } from '../src/providers/acp'

describe('folders an ACP agent may use', () => {
  it('gives Antigravity the home folder in Auto and Full, as Claude and Codex read beyond the workspace', () => {
    for (const access of ['auto', 'full'] as const)
      expect(reachableDirectories({ provider: 'antigravity', access }, ['/repo/b'], false, '/Users/me')).toEqual([
        '/repo/b',
        '/Users/me',
      ])
  })

  it('keeps Edits, read-only chats and other providers to the thread’s folders', () => {
    expect(reachableDirectories({ provider: 'antigravity', access: 'edits' }, ['/repo/b'], false, '/Users/me')).toEqual(
      ['/repo/b'],
    )
    expect(reachableDirectories({ provider: 'antigravity', access: 'full' }, [], true, '/Users/me')).toEqual([])
    expect(reachableDirectories({ provider: 'opencode', access: 'full' }, [], false, '/Users/me')).toEqual([])
  })
})
