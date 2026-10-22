import { describe, expect, it } from 'vitest'
import { parseRepositories } from '../src/workspace/forge'

describe('parseRepositories', () => {
  it('reads both gh list and search shapes into HTTPS clone URLs', () => {
    expect(
      parseRepositories([
        { nameWithOwner: 'a/one', url: 'https://github.com/a/one', isPrivate: true, updatedAt: '2026-10-01T00:00:00Z' },
        { fullName: 'b/two', url: 'https://github.com/b/two/', description: 'Two' },
      ]),
    ).toEqual([
      {
        fullName: 'a/one',
        description: null,
        private: true,
        cloneUrl: 'https://github.com/a/one.git',
        updatedAt: Date.parse('2026-10-01T00:00:00Z'),
      },
      { fullName: 'b/two', description: 'Two', private: false, cloneUrl: 'https://github.com/b/two.git', updatedAt: 0 },
    ])
  })

  it('drops entries with odd names or hosts so a clone URL is always a plain github.com one', () => {
    expect(
      parseRepositories([
        { fullName: 'x/y z', url: 'https://github.com/x/y' },
        { fullName: 'x/y', url: 'https://evil.example/x/y' },
        { fullName: 'x/y', url: 'git@github.com:x/y' },
        { url: 'https://github.com/x/y' },
      ]),
    ).toEqual([])
  })
})
