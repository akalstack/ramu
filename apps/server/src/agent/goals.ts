import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AgentService } from '../agent'
import type { GoalPreferences, ChatGoal, GoalCheck } from '@ramu/shared/types'
import { goalEvidenceSchema } from './goalEvidence'

export const goalPreferencesSchema = z.object({
  mode: z
    .enum(['auto', 'manual', 'off'])
    .default('auto')
    .transform((mode) => (mode === 'off' ? 'manual' : mode))
    // The transform hides the default from the advertised schema; Settings reads it there to offer Reset.
    .meta({ default: 'auto' }),
  maxTurns: z.number().int().min(1).max(1000).nullable().default(10),
})

const AUTO_GOAL_POLICY = `A goal schedules automatic follow-up agent turns after your response ends; it is not a task plan or progress tracker. Decide in this order:
1. Respect an explicit request not to create a goal or automatically continue. Questions, explanations, brainstorming and plan-only discussion do not authorize implementation or an implicit goal.
2. Only /goal, or a message that asks in words for a Ramu goal, is an explicit request; then call set_goal and quote that request in continuationReason. A greeting, a test message, a question or a single action (such as opening an app) is never a goal request: answer it or do it directly.
3. Otherwise, default to doing the task directly. Inspect the task first before creating an implicit goal. Ask: what authorized work is likely to need another agent turn after this one, and what inspected evidence supports that? If you cannot name both, continue without a goal. Several tool calls, multiple steps or files, tests, a verifiable outcome, or elapsed time alone do not by themselves justify a goal. Routine fixes, features, edits, renames and commands normally need no goal.
4. If inspected evidence makes multiple agent turns and automatic continuation likely, call set_goal before substantial implementation. Include the inspected facts AND the work likely to remain for a later turn in continuationReason. Do not require certainty that the current turn will run out. Examples include an app-wide migration with staged implementation and UI verification, a broad refactor across subsystems, or a batch service that only unlocks the next batch in another agent turn. Task size or slow validation alone is insufficient without a concrete continuation need.
Reassess at the start or later when the scope grows or substantial work remains. A goal does not replace doing the work now or justify ending a turn early. Do all useful authorized work available in this turn; do not finish with only a progress report when that work is still possible. Keep a goal active for work requiring a later turn, completed only with verification evidence, or blocked when required input or an external obstacle leaves no useful independent work.`

/** The part of a goal worth repeating in every prompt; evidence, check output and stall bookkeeping stay out of it. */
function promptGoal(goal: ChatGoal) {
  const { id, objective, status, turns, reason, updatedAt, verify } = goal
  return { id, objective, status, turns, reason, updatedAt, ...(verify ? { verify } : {}) }
}

/**
 * The goal an agent still has to act on. A completed goal is history: repeating it in every prompt reads as an
 * invitation to start the next one, so it counts as none.
 */
export function openGoal(goal: ChatGoal | null): ChatGoal | null {
  return goal && goal.status !== 'completed' ? goal : null
}

/** Per-turn goal state for a session whose system instructions already carry the goal policy. */
export function goalState(goal: ChatGoal | null): string {
  const open = openGoal(goal)
  return `Current goal: ${open ? JSON.stringify(promptGoal(open)) : 'none'}`
}

export function goalInstructions(preferences: GoalPreferences, goal: ChatGoal | null): string {
  return `Ramu owns goals and continuation for this thread. Do not start the provider's native /goal or another continuation loop.
Use Ramu's MCP tools set_goal, get_goal and update_goal. When a goal is warranted, use set_goal rather than merely describing a goal in your response. If your runtime defers tool discovery, discover the Ramu goal tools before concluding they are unavailable.
${preferences.mode === 'auto' ? AUTO_GOAL_POLICY : 'Only create a goal when the user explicitly requests one.'}
Keep the goal within the user-authorized scope. Later instructions refine that scope; questions do not cancel unfinished work. If the user changes the task, update the objective accordingly.
Before ending each turn with an active goal, audit ALL requirements against files, tests, tool results or produced artifacts. Call update_goal with active and the remaining work, completed only when everything requested is done, or blocked and the missing input or obstacle when no useful independent work remains. Completed needs structured evidence: the checks you ran with whether each passed (evidence.checks), and every file you changed (evidence.changedFiles). Ramu rejects completion with no checks, with a failed check, or while the workspace has uncommitted changes made during the goal that the evidence does not mention (list files you did not change in evidence.otherChanges). If the user set a verification command, Ramu runs it after your turn ends and only a pass completes the goal. A finished turn, a proposed plan, or an exhausted budget does not establish completion. Pending required approvals/answers prevent completion. Ramu blocks a goal whose continuations repeat the same tool calls and change nothing.
The user controls pause, resume, clear and turn limits. Ramu starts follow-up turns only while the thread is idle. Do not keep working on a paused goal unless the user requests it.
${goalState(goal)}`
}

export function goalContinuation(goal: ChatGoal, failedCheck?: GoalCheck): string {
  const verification = failedCheck && !failedCheck.ok && !failedCheck.delivered
  return `Ramu goal continuation: ${JSON.stringify({ objective: goal.objective, progress: goal.reason })}${
    verification
      ? `\nRamu ran this goal's verification command after you reported completion and it failed. Fix the cause, then report completion again. Command: ${failedCheck.command}\nOutput:\n${failedCheck.output}`
      : ''
  }
Audit the latest user instructions and actual evidence first. Finish remaining authorized work; do not repeat completed actions. If already done, call update_goal with completed and evidence (checks you ran with results, and files you changed). If work remains, continue and report active with the next concrete step before ending. If a required answer, permission or external change prevents progress, report blocked. Use Ramu's goal tools, not the provider's native goals.`
}

export function registerGoalTools(server: McpServer, agents: AgentService, sessionId: string): void {
  const result = async (operation: () => unknown) => {
    try {
      return { content: [{ type: 'text' as const, text: JSON.stringify(await operation()) }] }
    } catch (error) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
      }
    }
  }
  server.registerTool(
    'set_goal',
    {
      // Automatic goals off: the long decision rule would only cost tokens on every request.
      description:
        agents.launchSettings(sessionId).goalMode === 'manual'
          ? 'Set or refine this thread’s Ramu goal. Automatic goals are off: call this only when the user explicitly requests a goal, and quote that request in continuationReason. Never expand scope or resume a paused goal.'
          : `Set or refine this thread’s Ramu goal from the user’s requested outcome. The thread's goal mode takes precedence: Off prohibits goals; Manual requires an explicit user goal request; Auto uses the following decision rule. ${AUTO_GOAL_POLICY} Never expand scope or resume a paused goal.`,
      inputSchema: {
        objective: z.string().trim().min(1).max(8000),
        continuationReason: z
          .string()
          .trim()
          .min(1)
          .max(8000)
          .describe(
            'Name the inspected facts and the authorized work likely to need a later agent turn. Task size, steps, files or tests alone are insufficient. For an explicit user goal request, quote that request instead. For an active goal refinement, explain the remaining continuation need.',
          ),
      },
    },
    ({ objective, continuationReason }) =>
      result(() => {
        if (!continuationReason?.trim())
          throw new Error(
            'Do the task directly without a goal unless it is likely to require multiple agent turns and automatic continuation. Provide continuationReason based on inspected evidence, or quote an explicit user goal request.',
          )
        return agents.setGoal(sessionId, objective)
      }),
  )
  server.registerTool(
    'get_goal',
    { description: 'Read this thread’s goal and continuation count.', inputSchema: {} },
    () => result(() => agents.getGoal(sessionId)),
  )
  server.registerTool(
    'update_goal',
    {
      description:
        'Audit goal completion before ending a turn. Report active with unfinished work, completed with evidence, or blocked with the missing input/obstacle. Completed requires evidence: the checks you ran with their results (evidence.checks) and the files you changed (evidence.changedFiles; evidence.otherChanges for uncommitted files you did not change). Completion is rejected with no checks, a failed check, or uncommitted changes the evidence does not mention. If the user set a verification command, it runs after your turn and only a pass completes the goal. User controls pause/resume/clear.',
      inputSchema: {
        status: z.enum(['active', 'completed', 'blocked']),
        reason: z.string().trim().min(1).max(8000),
        evidence: goalEvidenceSchema.optional(),
      },
    },
    ({ status, reason, evidence }) => result(() => agents.updateGoal(sessionId, status, reason, evidence)),
  )
}
