import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AgentService } from '../agent'
import type { QuestionRequest, QuestionState } from '@ramu/shared/questions'

export const questionInputSchema = z.object({
  questions: z
    .array(
      z.object({
        id: z.string().min(1).max(100).optional(),
        question: z.string().min(1).max(10000),
        header: z.string().max(100).default('Question'),
        multiSelect: z.boolean().default(false),
        options: z
          .array(z.object({ label: z.string().min(1).max(1000), description: z.string().max(2000).default('') }))
          .max(20)
          .default([]),
      }),
    )
    .min(1)
    .max(10),
  grouping: z.enum(['together', 'independent']).default('together'),
  dependsOn: z.string().max(2000).optional(),
  blocking: z.boolean().default(false),
})

export function registerQuestionTools(server: McpServer, agents: AgentService, sessionId: string): void {
  // Unsent drafts are UI state, not answers available to the agent.
  const report = ({ drafts: _drafts, ...state }: QuestionState & { request: QuestionRequest }) => state
  const result = async (operation: () => unknown) => {
    try {
      return { content: [{ type: 'text' as const, text: JSON.stringify((await operation()) ?? null) }] }
    } catch (error) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
      }
    }
  }
  server.registerTool(
    'ask_user',
    {
      description:
        'Ask the user structured questions. Returns immediately while you continue independent work, unless blocking=true or the user disabled async questions. Related questions must use grouping=together and are answered together. Use independent only for separately useful answers. Explain the dependent decision in dependsOn. Before dependent work, check question_status and use wait_for_answer if needed. Never assume an unanswered decision.',
      inputSchema: questionInputSchema.shape,
    },
    (input, extra) => result(async () => report(await agents.askQuestion(sessionId, input, extra.signal))),
  )
  server.registerTool(
    'question_status',
    {
      description:
        'Read answers and status of a question you previously asked. Reuse pending IDs after restart; do not ask duplicates.',
      inputSchema: { requestId: z.string().min(1).max(300) },
    },
    ({ requestId }) => result(() => report(agents.questionStatus(sessionId, requestId))),
  )
  server.registerTool(
    'wait_for_answer',
    {
      description:
        'Wait for all remaining answers only when the next work depends on them. Returns answers or a closed status; a dismissed or obsolete question supplies no assumed answer.',
      inputSchema: { requestId: z.string().min(1).max(300) },
    },
    ({ requestId }, extra) =>
      result(async () => report(await agents.waitForAnswer(sessionId, requestId, extra.signal))),
  )
  server.registerTool(
    'close_question',
    {
      description:
        'Mark an unanswered async question no longer needed when it no longer affects the outcome. Supply the reason. Do not close a question to bypass a required decision or permission.',
      inputSchema: { requestId: z.string().min(1).max(300), reason: z.string().min(1).max(2000) },
    },
    ({ requestId, reason }) =>
      result(() => {
        agents.closeQuestion(sessionId, requestId, 'obsolete', reason)
        return report(agents.questionStatus(sessionId, requestId))
      }),
  )
}
