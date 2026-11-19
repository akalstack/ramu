// The public skills directory at skills.sh, searched from the host so Customize can offer skills to install the way it
// offers plugins. Results name a GitHub repository and a skill in it, which `skills.stage` installs after review.
import { z } from 'zod'
import type { DirectorySkill } from '@ramu/shared/types'

const API = 'https://skills.sh/api/search'
const LIMIT = 30
/** Broad searches whose most-installed results stand in for a "popular" list, which skills.sh does not publish. */
const RECOMMENDED_QUERIES = ['react', 'testing', 'docs', 'design', 'git', 'python', 'debug', 'deploy']
const RECOMMENDED_TTL_MS = 24 * 60 * 60_000

const answer = z.object({
  skills: z
    .array(
      z.object({
        id: z.string().max(300),
        source: z.string().max(200),
        skillId: z.string().max(200),
        name: z.string().max(200),
        installs: z.number().nonnegative().optional(),
      }),
    )
    .max(200),
})

export class SkillDirectory {
  private recommended: { at: number; skills: DirectorySkill[] } | null = null

  constructor(
    private readonly get: (url: string, signal: AbortSignal) => Promise<Response> = (url, signal) =>
      fetch(url, { signal }),
  ) {}

  /** Skills whose name or repository match, most installed first. */
  async search(query: string): Promise<DirectorySkill[]> {
    const response = await this.get(`${API}?q=${encodeURIComponent(query)}`, AbortSignal.timeout(10_000))
    if (!response.ok) throw new Error(`skills.sh did not answer (HTTP ${response.status}). Try again shortly.`)
    const parsed = answer.safeParse(await response.json().catch(() => null))
    if (!parsed.success) throw new Error('skills.sh answered in a shape Ramu does not know. Update Ramu.')
    return (
      parsed.data.skills
        // Only a GitHub owner/repo source can be installed by its name; anything else is left out.
        .filter((skill) => /^[\w.-]+\/[\w.-]+$/.test(skill.source))
        .map((skill) => ({
          id: skill.id,
          source: skill.source,
          skill: skill.skillId,
          name: skill.name,
          installs: skill.installs ?? 0,
        }))
        .sort((a, b) => b.installs - a.installs)
        .slice(0, LIMIT)
    )
  }

  /** The most installed skills across a few broad searches, kept for a day. */
  async popular(): Promise<DirectorySkill[]> {
    if (this.recommended && Date.now() - this.recommended.at < RECOMMENDED_TTL_MS) return this.recommended.skills
    const results = await Promise.allSettled(RECOMMENDED_QUERIES.map((query) => this.search(query)))
    const seen = new Map<string, DirectorySkill>()
    for (const result of results)
      if (result.status === 'fulfilled') for (const skill of result.value) seen.set(skill.id, skill)
    if (!seen.size) {
      const failure = results.find((result) => result.status === 'rejected')
      throw failure?.status === 'rejected' ? failure.reason : new Error('skills.sh returned no skills.')
    }
    const skills = [...seen.values()].sort((a, b) => b.installs - a.installs).slice(0, 12)
    this.recommended = { at: Date.now(), skills }
    return skills
  }
}
