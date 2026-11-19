import { describe, expect, it, vi } from 'vitest'
import { SkillDirectory } from '../src/memory/skillDirectory'

const answer = (skills: unknown[]) => new Response(JSON.stringify({ skills }), { status: 200 })

describe('skills.sh directory', () => {
  it('lists installable GitHub skills, most installed first', async () => {
    const get = vi.fn(async (_url: string) =>
      answer([
        { id: 'a/b/one', source: 'a/b', skillId: 'one', name: 'one', installs: 10 },
        { id: 'a/b/two', source: 'a/b', skillId: 'two', name: 'two', installs: 900 },
        { id: 'x/weird', source: 'https://example.com/x', skillId: 'x', name: 'x', installs: 5000 },
      ]),
    )
    const found = await new SkillDirectory(get).search('react docs')
    expect(get.mock.calls[0]![0]).toBe('https://skills.sh/api/search?q=react%20docs')
    expect(found).toEqual([
      { id: 'a/b/two', source: 'a/b', skill: 'two', name: 'two', installs: 900 },
      { id: 'a/b/one', source: 'a/b', skill: 'one', name: 'one', installs: 10 },
    ])
  })

  it('merges broad searches into a popular list kept for a day, and says when the directory is down', async () => {
    let n = 0
    const get = vi.fn(async () =>
      answer([{ id: `o/r/s${n}`, source: 'o/r', skillId: `s${n}`, name: `s${n}`, installs: n++ }]),
    )
    const directory = new SkillDirectory(get)
    const popular = await directory.popular()
    expect(popular[0]!.installs).toBeGreaterThan(popular.at(-1)!.installs)
    const calls = get.mock.calls.length
    await directory.popular()
    expect(get.mock.calls.length).toBe(calls)
    await expect(new SkillDirectory(async () => new Response('', { status: 503 })).search('react')).rejects.toThrow(
      'skills.sh did not answer (HTTP 503)',
    )
  })
})
