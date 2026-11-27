import { z } from 'zod'
import { resolveWorkModel, withWorkModel } from '@ramu/shared/providers/workModel'
import type { AppPreferences, ModelPreferences } from '@ramu/shared/types'
import {
  nextMessagePoint,
  nextMessagePrompt,
  parseNextMessages,
  type NextMessageFacts,
} from '@ramu/shared/chat/nextMessage'
import { status as gitStatus } from '../../workspace/git'
import { id } from '../schemas'
import type { RegisterHandlers } from '../types'

/**
 * A predicted next message for a thread whose turn just ended. It is made when a device asks, so only threads someone
 * has open spend a request, and once per turn: every device that asks gets the same answer.
 */
export const registerNextMessageHandlers: RegisterHandlers = ({ workspace, agents }) => {
  const made = new Map<string, { at: number; answer: Promise<string[]> }>()

  const facts = async (sessionId: string, cwd: string): Promise<NextMessageFacts> => {
    const goal = agents.getGoal(sessionId)
    const changed = await gitStatus(cwd).then(
      (status) => status.entries.length,
      () => 0,
    )
    return {
      ...(goal && goal.status !== 'completed' ? { goal: goal.objective.slice(0, 500) } : {}),
      ...(changed ? { uncommittedFiles: changed } : {}),
    }
  }

  const predict = async (sessionId: string): Promise<string[]> => {
    const session = agents.get(sessionId)
    const known = await facts(sessionId, session.cwd)
    try {
      // The thread's own session knows everything the conversation does, and its prompt is already cached.
      const forked = await agents.forkAnswer(sessionId, nextMessagePrompt(known))
      if (forked) return parseNextMessages(forked.text)
      // A provider that cannot fork: the maintenance model reads the end of the visible conversation instead.
      const preferences = workspace.getAppState<Partial<AppPreferences>>('app-preferences', {})
      const settings = withWorkModel(
        session.settings,
        resolveWorkModel(preferences.intelligence?.maintenanceModel ?? null, {
          thread: session.settings,
          models: workspace.getAppState<ModelPreferences | null>('model-preferences', null),
        }),
      )
      const reply = await agents.analyze(
        nextMessagePrompt(known, agents.asideContext(sessionId).slice(-12_000)),
        settings,
        2000,
        { timeoutMs: 20_000, defer: false },
      )
      return parseNextMessages(reply.message)
    } catch {
      // A suggestion is a convenience: a failed or refused request shows nothing rather than an error.
      return []
    }
  }

  return {
    'agent.nextMessages': {
      args: z.tuple([id]),
      run: async (sessionId: string): Promise<string[]> => {
        const session = agents.get(sessionId)
        const preferences = workspace.getAppState<Partial<AppPreferences>>('app-preferences', {})
        if (preferences.suggestNextMessage === false || session.parentId) return []
        const point = nextMessagePoint(agents.events(sessionId), session.state)
        if (!point) {
          made.delete(sessionId)
          return []
        }
        const existing = made.get(sessionId)
        if (existing?.at === point.at) return existing.answer
        const answer = predict(sessionId)
        made.set(sessionId, { at: point.at, answer })
        const suggestions = await answer
        // The person may have sent something while it was being made; an answer for an older point is dropped.
        return nextMessagePoint(agents.events(sessionId), agents.get(sessionId).state)?.at === point.at
          ? suggestions
          : []
      },
    },
  }
}
