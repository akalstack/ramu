import { describe, expect, it } from 'vitest'
import type { PullRequestSummary } from '@ramu/shared/types'
import { enrichOpen } from '../src/workspace/forge/enrich'

const pr = (number: number, updatedAt: number, state: PullRequestSummary['state'] = 'open') =>
  ({ number, url: `u/${number}`, state, updatedAt, checks: null, openThreads: null }) as PullRequestSummary

describe('list details', () => {
  it('reads details for the newest open pull requests only, and keeps a row whose read fails', async () => {
    const rows = [...Array.from({ length: 25 }, (_, i) => pr(i + 1, i)), pr(99, 1000, 'merged')]
    const read: number[] = []
    const out = await enrichOpen(rows, async (row) => {
      read.push(row.number)
      if (row.number === 25) throw new Error('forbidden')
      return { checks: 'success', openThreads: row.number }
    })
    expect(read.sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 6))
    expect(out.find((row) => row.number === 24)).toMatchObject({ checks: 'success', openThreads: 24 })
    expect(out.find((row) => row.number === 25)).toMatchObject({ checks: null })
    expect(out.find((row) => row.number === 1)).toMatchObject({ checks: null })
    expect(out).toHaveLength(26)
  })
})
