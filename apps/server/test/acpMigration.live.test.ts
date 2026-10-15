// Opt-in inference in disposable workspaces. Never resumes a user's existing chat.
import { expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createAcpRunner } from '../src/providers/acp'
import { DEFAULT_AGENT_SETTINGS, type AgentEvent } from '@ramu/shared/types'

const enabled = process.env.RAMU_ACP_MIGRATION_LIVE === '1'
for (const provider of ['codex', 'claude-code', 'opencode'] as const) {
  it.skipIf(!enabled)(
    `${provider} completes background analysis through the ACP host`,
    async () => {
      const cwd = mkdtempSync(join(tmpdir(), `ramu-acp-${provider}-live-`)),
        events: AgentEvent[] = []
      let finish!: () => void
      const done = new Promise<void>((resolve) => {
        finish = resolve
      })
      const runner = createAcpRunner(
        { cwd, additionalDirs: [], covers: [] },
        { ...DEFAULT_AGENT_SETTINGS, provider, accountId: 'default', access: 'edits' },
        (event) => {
          events.push(event)
          if (event.kind === 'result' || event.kind === 'error') finish()
        },
        true,
      )
      const timer = setTimeout(finish, 70_000)
      try {
        await runner.start('Reply exactly RAMU_ACP_OK. Do not use tools.', null)
        await done
        expect(
          events.some((event) => event.kind === 'result' && !event.isError),
          JSON.stringify(events.filter((event) => event.kind === 'error' || event.kind === 'result')),
        ).toBe(true)
        expect(events.filter((event) => event.kind === 'text').at(-1)).toMatchObject({
          text: expect.stringContaining('RAMU_ACP_OK'),
        })
        expect(events.some((event) => event.kind === 'permission-request')).toBe(false)
      } finally {
        clearTimeout(timer)
        await runner.stop()
        rmSync(cwd, { recursive: true, force: true })
      }
    },
    90_000,
  )
}
for (const provider of ['codex', 'claude-code'] as const)
  it.skipIf(!enabled)(
    `${provider} takes a steering message into the running turn without cancelling it`,
    async () => {
      const cwd = mkdtempSync(join(tmpdir(), 'ramu-acp-codex-steer-live-')),
        events: AgentEvent[] = []
      let finish!: () => void
      const done = new Promise<void>((resolve) => {
        finish = resolve
      })
      let steered: Promise<void> | undefined
      const runner = createAcpRunner(
        { cwd, additionalDirs: [], covers: [] },
        { ...DEFAULT_AGENT_SETTINGS, provider, accountId: 'default', access: 'full' },
        (event) => {
          events.push(event)
          if (event.kind === 'tool-use' && !steered)
            steered = runner.steer('New instruction from the user: stop the earlier task and reply with only the word STEERED_OK.')
          if (event.kind === 'result' || event.kind === 'error') finish()
        },
      )
      const timer = setTimeout(finish, 100_000)
      try {
        await runner.start('Run `sleep 6` in the shell, then reply with the word DONE.', null)
        await done
        await steered
        expect(runner.steerInterrupts).toBe(false)
        expect(events.filter((event) => event.kind === 'result')).toHaveLength(1)
        expect(events.filter((event) => event.kind === 'text').at(-1)).toMatchObject({
          text: expect.stringContaining('STEERED_OK'),
        })
      } finally {
        clearTimeout(timer)
        await runner.stop()
        rmSync(cwd, { recursive: true, force: true })
      }
    },
    120_000,
  )
