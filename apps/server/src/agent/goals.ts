import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AgentService } from '../agent'
import type { GoalPreferences, ChatGoal } from '@ramu/shared/types'

export const goalPreferencesSchema = z.object({
  mode: z
    .enum(['auto', 'manual', 'off'])
    .default('auto')
    .transform((mode) => (mode === 'off' ? 'manual' : mode)),
  maxTurns: z.number().int().min(1).max(1000).nullable().default(10),
})

const AUTO_GOAL_POLICY = `A goal schedules automatic follow-up agent turns after your response ends; it is not a task plan or progress tracker. Decide in this order:
1. Respect an explicit request not to create a goal or automatically continue. Questions, explanations, brainstorming and plan-only discussion do not authorize implementation or an implicit goal.
2. When the user explicitly requests a Ramu goal, call set_goal even for a small task. Quote that request in continuationReason.
3. Otherwise, default to doing the task directly. Inspect the task first before creating an implicit goal. Ask: what authorized work is likely to need another agent turn after this one, and what inspected evidence supports that? If you cannot name both, continue without a goal. Several tool calls, multiple steps or files, tests, a verifiable outcome, or elapsed time alone do not by themselves justify a goal. Routine fixes, features, edits, renames and commands normally need no goal.
4. If inspected evidence makes multiple agent turns and automatic continuation likely, call set_goal before substantial implementation. Include the inspected facts AND the work likely to remain for a later turn in continuationReason. Do not require certainty that the current turn will run out. Examples include an app-wide migration with staged implementation and UI verification, a broad refactor across subsystems, or a batch service that only unlocks the next batch in another agent turn. Task size or slow validation alone is insufficient without a concrete continuation need.
Reassess at the start or later when the scope grows or substantial work remains. A goal does not replace doing the work now or justify ending a turn early. Do all useful authorized work available in this turn; do not finish with only a progress report when that work is still possible. Keep a goal active for work requiring a later turn, completed only with verification evidence, or blocked when required input or an external obstacle leaves no useful independent work.`

export function goalInstructions(preferences: GoalPreferences, goal: ChatGoal | null): string {
  return `Ramu owns goals and continuation for this thread. Do not start the provider's native /goal or another continuation loop.
Use Ramu's MCP tools set_goal, get_goal and update_goal. When a goal is warranted, use set_goal rather than merely describing a goal in your response. If your runtime defers tool discovery, discover the Ramu goal tools before concluding they are unavailable.
${preferences.mode === 'auto' ? AUTO_GOAL_POLICY : 'Only create a goal when the user explicitly requests one.'}
Keep the goal within the user-authorized scope. Later instructions refine that scope; questions do not cancel unfinished work. If the user changes the task, update the objective accordingly.
Before ending each turn with an active goal, audit ALL requirements against files, tests, tool results or produced artifacts. Call update_goal with active and the remaining work, completed and concrete evidence only when everything requested is done, or blocked and the missing input or obstacle when no useful independent work remains. A finished turn, a proposed plan, or an exhausted budget does not establish completion. Pending required approvals/answers prevent completion.
The user controls pause, resume, clear and turn limits. Ramu starts follow-up turns only while the thread is idle. Do not keep working on a paused goal unless the user requests it.
Current goal: ${goal ? JSON.stringify(goal) : 'none'}`
}

export function goalContinuation(goal: ChatGoal): string {
  return `Ramu goal continuation: ${JSON.stringify({ objective: goal.objective, progress: goal.reason })}
Audit the latest user instructions and actual evidence first. Finish remaining authorized work; do not repeat completed actions. If already done, call update_goal with completed and verification evidence. If work remains, continue and report active with the next concrete step before ending. If a required answer, permission or external change prevents progress, report blocked. Use Ramu's goal tools, not the provider's native goals.`
}

export function registerGoalTools(server: McpServer, agents: AgentService, sessionId: string): void {
  const result = (operation: () => unknown) => {
    try {
      return { content: [{ type: 'text' as const, text: JSON.stringify(operation()) }] }
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
      description: `Set or refine this thread’s Ramu goal from the user’s requested outcome. The thread's goal mode takes precedence: Off prohibits goals; Manual requires an explicit user goal request; Auto uses the following decision rule. ${AUTO_GOAL_POLICY} Never expand scope or resume a paused goal.`,
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
        'Audit goal completion before ending a turn. Report active with unfinished work, completed with concrete verification evidence, or blocked with the missing input/obstacle. User controls pause/resume/clear.',
      inputSchema: { status: z.enum(['active', 'completed', 'blocked']), reason: z.string().trim().min(1).max(8000) },
    },
    ({ status, reason }) => result(() => agents.updateGoal(sessionId, status, reason)),
  )
}
