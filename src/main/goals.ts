import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AgentService } from './agent'
import type { GoalPreferences, ChatGoal } from '../shared/types'

export const goalPreferencesSchema = z.object({ mode: z.enum(['auto', 'manual', 'off']).default('auto'), maxTurns: z.number().int().min(1).max(1000).nullable().default(10) })

const AUTO_GOAL_POLICY = 'Default to doing the task directly without a goal. A goal schedules automatic follow-up agent turns after your response ends; it is not a task plan or progress tracker. Call set_goal only when the user explicitly requests a goal, or concrete evidence shows the authorized work will require multiple agent turns and automatic continuation. Inspect the task first before creating an implicit goal. Several tool calls, multiple steps or files, tests, a verifiable outcome, or a task taking time do not by themselves justify a goal: these can all fit within one agent turn. Do not create goals for routine fixes or features, edits, renames, commands, questions, explanations, brainstorming, plan-only discussion, or requests to wait unless the continuation requirement is established. You may create a goal at the start or later only when that requirement is clear. When in doubt, continue the task normally without a goal.'

export function goalInstructions(preferences: GoalPreferences, goal: ChatGoal | null): string {
  if (preferences.mode === 'off') return 'Ramu goals are disabled. Do not start a native provider goal or an automatic continuation loop.'
  return `Ramu owns goals and continuation for this chat. Do not start the provider's native /goal or another continuation loop.
${preferences.mode === 'auto' ? AUTO_GOAL_POLICY : 'Only create a goal when the user explicitly requests one.'}
Keep the goal within the user-authorized scope. Later instructions refine that scope; questions do not cancel unfinished work. If the user changes the task, update the objective accordingly.
Before ending each turn with an active goal, audit ALL requirements against files, tests, tool results or produced artifacts. Call update_goal with active and the remaining work, completed and concrete evidence only when everything requested is done, or blocked and the missing input or obstacle when no useful independent work remains. A finished turn, a proposed plan, or an exhausted budget does not establish completion. Pending required approvals/answers prevent completion.
The user controls pause, resume, clear and turn limits. Ramu starts follow-up turns only while the chat is idle. Do not keep working on a paused goal unless the user requests it.
Current goal: ${goal ? JSON.stringify(goal) : 'none'}`
}

export function goalContinuation(goal: ChatGoal): string {
  return `Ramu goal continuation: ${JSON.stringify({ objective: goal.objective, progress: goal.reason })}
Audit the latest user instructions and actual evidence first. Finish remaining authorized work; do not repeat completed actions. If already done, call update_goal with completed and verification evidence. If work remains, continue and report active with the next concrete step before ending. If a required answer, permission or external change prevents progress, report blocked. Use Ramu's goal tools, not the provider's native goals.`
}

export function registerGoalTools(server: McpServer, agents: AgentService, sessionId: string): void {
  const result = (operation: () => unknown) => {
    try { return { content: [{ type: 'text' as const, text: JSON.stringify(operation()) }] } }
    catch (error) { return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }] } }
  }
  server.registerTool('set_goal', {
    description: `Set or refine this chat’s Ramu goal from the user’s requested outcome. ${AUTO_GOAL_POLICY} Include continuationReason explaining why the inspected task is likely to require multiple agent turns and automatic continuation after this turn ends. A routine fix or verification that fits in this turn must be done directly. Manual mode requires an explicit user goal request. Never expand scope or resume a paused goal.`,
    inputSchema: {
      objective: z.string().trim().min(1).max(8000),
      continuationReason: z.string().trim().min(1).max(8000).describe('Concrete inspected evidence that the task is likely to require multiple agent turns and automatic continuation. For an explicit user goal request, quote that request. For an active goal refinement, explain the remaining continuation need.'),
    },
  }, ({ objective, continuationReason }) => result(() => {
    if (!continuationReason?.trim()) throw new Error('Do the task directly without a goal unless it is likely to require multiple agent turns and automatic continuation. Provide continuationReason based on inspected evidence, or quote an explicit user goal request.')
    return agents.setGoal(sessionId, objective)
  }))
  server.registerTool('get_goal', { description: 'Read this chat’s goal and continuation count.', inputSchema: {} }, () => result(() => agents.getGoal(sessionId)))
  server.registerTool('update_goal', {
    description: 'Audit goal completion before ending a turn. Report active with unfinished work, completed with concrete verification evidence, or blocked with the missing input/obstacle. User controls pause/resume/clear.',
    inputSchema: { status: z.enum(['active', 'completed', 'blocked']), reason: z.string().trim().min(1).max(8000) },
  }, ({ status, reason }) => result(() => agents.updateGoal(sessionId, status, reason)))
}
