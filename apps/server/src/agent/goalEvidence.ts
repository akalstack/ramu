import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { z } from 'zod'
import type { AgentEvent, GoalEvidence } from '@ramu/shared/types'
import type { WorkspaceSnapshot } from './goalProbes'
import { clipText } from '@ramu/shared/text'

const paths = z.array(z.string().trim().min(1).max(1000)).max(500)
/** The `evidence` argument of `update_goal(completed)`. */
export const goalEvidenceSchema = z.object({
  checks: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(500).describe('The command you ran, or what you inspected.'),
        passed: z.boolean(),
        output: z.string().trim().max(2000).optional().describe('The result in a line or two.'),
      }),
    )
    .max(50),
  changedFiles: paths.describe('Files you changed or created. Use an empty list when you changed none.'),
  otherChanges: paths
    .optional()
    .describe(
      'Uncommitted files you did not change (the user’s or another thread’s), so they are not blamed on this goal.',
    ),
})

/** Paths whose content differs from the baseline, or that did not exist there: what happened since the goal began. */
export function changedSince(
  baseline: Record<string, string> | null,
  snapshot: WorkspaceSnapshot,
): Record<string, string> {
  if (!baseline) return {}
  return Object.fromEntries(Object.entries(snapshot.files).filter(([path, hash]) => baseline[path] !== hash))
}

/** The path with symlinks resolved (on macOS `/var` is `/private/var`), as git reports it; unchanged if it does not exist. */
function real(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

/** Whether `path` (relative to the root) is covered by a path the agent wrote, in any of the forms it may have used. */
function mentioned(path: string, mentions: readonly string[], root: string, cwd: string): boolean {
  return mentions.some((raw) => {
    const forms = new Set<string>()
    const clean = raw.trim().replace(/^\.\//, '')
    if (isAbsolute(clean)) forms.add(relative(real(root), real(clean)))
    else {
      forms.add(clean)
      forms.add(relative(real(root), real(resolve(cwd, clean))))
    }
    return [...forms].some((form) => {
      const bare = form.replace(/\/+$/, '')
      return bare === path || path.startsWith(`${bare}/`)
    })
  })
}

/** What blocks a completion claim, or null. Deterministic: it reads the evidence, never a model. */
export function evidenceProblem(evidence: GoalEvidence | undefined): string | null {
  if (!evidence || !evidence.checks.length)
    return 'Completion needs evidence. Call update_goal with status "completed", a reason, and evidence: the checks you ran with their results (evidence.checks, each with name and passed) and the files you changed (evidence.changedFiles).'
  const failed = evidence.checks.filter((check) => !check.passed)
  if (failed.length)
    return `A failing check cannot support completion: ${failed.map((check) => check.name).join('; ')}. Fix it and run it again, or report the goal as active or blocked.`
  return null
}

/**
 * Files changed in the checkout since the goal began that the evidence names in neither list, sorted and bounded. Kept
 * with the completion for the person to see, never a reason to refuse it: other threads edit the same checkout.
 */
export function unlistedChanges(
  evidence: GoalEvidence,
  changes: { snapshot: WorkspaceSnapshot; changed: Record<string, string>; cwd: string } | null,
): string[] {
  if (!changes) return []
  const listed = [...evidence.changedFiles, ...(evidence.otherChanges ?? [])]
  return Object.keys(changes.changed)
    .filter((path) => path !== '*overflow' && !mentioned(path, listed, changes.snapshot.root, changes.cwd))
    .sort()
    .slice(0, 50)
}

/** Parent calls and their bounded results, without volatile IDs or unrelated helper output. */
export function turnActivity(events: readonly AgentEvent[]): { tools: string; user: boolean } {
  const tools: string[] = []
  const calls = new Map<string, number>()
  let user = false
  for (const event of events) {
    if (event.kind === 'user' && !event.agentId) user = true
    else if (event.kind === 'tool-use' && !event.agentId) {
      calls.set(event.toolUseId, tools.length)
      tools.push(`${event.name}:${clipText(event.summary ?? '', 200)}`)
    } else if (event.kind === 'tool-result' && !event.agentId) {
      const call = calls.get(event.toolUseId)
      if (call !== undefined) {
        const content = event.content?.slice(0, 20).map((item) => {
          if (item.type === 'text' || item.type === 'resource') return [item.type, clipText(item.text ?? '', 4000)]
          if (item.type === 'terminal') return [item.type, clipText(item.output ?? '', 4000)]
          if (item.type === 'diff') return [item.type, item.path, clipText(item.newText ?? '', 4000)]
          return item.type
        })
        tools[call] += `\nresult:${JSON.stringify([
          event.isError,
          event.running ?? false,
          clipText(event.summary, 4000),
          clipText(JSON.stringify(content) ?? '', 8000),
        ])}`
      }
    }
  }
  return { tools: tools.join('\n'), user }
}

/** One short value for "what this continuation left behind": the files it changed and the tools it ran. */
export function fingerprintOf(changed: Record<string, string> | null, tools: string): string {
  return createHash('sha1')
    .update(JSON.stringify([changed ? Object.entries(changed).sort(([a], [b]) => a.localeCompare(b)) : null, tools]))
    .digest('hex')
    .slice(0, 16)
}
