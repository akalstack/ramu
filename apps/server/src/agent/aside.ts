import type { Options } from '@anthropic-ai/claude-agent-sdk'
import type { AgentProvider, AgentSessionInfo } from '@ramu/shared/types'
import { acpAside } from '../acp'
import { codexAside } from '../codex'
import { claudeReplyText } from './claudeReply'
import { InputQueue } from './inputQueue'
import type { QueryFn } from './types'
import { timeout } from './util'

/** What a side question needs from the service. */
export interface AsideHost {
  shutdown(): boolean
  /** Cancel callbacks of running background inferences, called when the service stops. */
  analysisStops: Set<() => void>
  providerQuery: QueryFn
}

/**
 * Answers a side question on a throwaway fork of the chat's own provider session, so it has the whole conversation
 * (files read, tool results, reasoning) and changes nothing. Null when there is nothing to fork or the fork failed.
 */
export async function answerOnFork(
  host: AsideHost,
  s: AgentSessionInfo,
  prompt: string,
): Promise<{ text: string; provider: AgentProvider; model: string } | null> {
  if (!s.providerSessionId || host.shutdown()) return null
  if (s.provider === 'codex' && process.env.RAMU_FAKE_AGENT !== '1') {
    const controller = new AbortController()
    const stop = () => controller.abort()
    host.analysisStops.add(stop)
    try {
      return {
        text: await codexAside({
          accountId: s.settings.accountId ?? 'default',
          threadId: s.providerSessionId,
          cwd: s.cwd,
          model: s.settings.model,
          effort: s.settings.effort,
          prompt,
          signal: controller.signal,
        }),
        provider: 'codex',
        model: s.settings.model,
      }
    } catch {
      return null
    } finally {
      host.analysisStops.delete(stop)
    }
  }
  if (s.provider === 'opencode' && process.env.RAMU_FAKE_AGENT !== '1') {
    const controller = new AbortController()
    const stop = () => controller.abort()
    host.analysisStops.add(stop)
    try {
      const text = await acpAside({
        provider: 'opencode',
        accountId: s.settings.accountId ?? 'default',
        cwd: s.cwd,
        sessionId: s.providerSessionId,
        prompt,
        signal: controller.signal,
      })
      return text ? { text, provider: 'opencode', model: s.settings.model } : null
    } catch {
      return null
    } finally {
      host.analysisStops.delete(stop)
    }
  }
  if (s.provider !== 'claude-code') return null
  const input = new InputQueue()
  const abort = new AbortController()
  const query = host.providerQuery({
    prompt: input,
    options: {
      cwd: s.cwd,
      resume: s.providerSessionId,
      forkSession: true,
      tools: [],
      maxTurns: 1,
      abortController: abort,
      permissionMode: 'default',
      canUseTool: async () => ({ behavior: 'deny', message: 'A side question cannot use tools' }),
      ...(s.settings.model ? { model: s.settings.model } : {}),
      ...(s.settings.effort ? { effort: s.settings.effort as Options['effort'] } : {}),
    },
  })
  input.push(prompt)
  input.close()
  const cancel = () => {
    abort.abort()
    query.close?.()
  }
  host.analysisStops.add(cancel)
  let text = ''
  try {
    text = await timeout(claudeReplyText(query), 120_000, 'The side question timed out')
    return text.trim() ? { text: text.trim(), provider: 'claude-code', model: s.settings.model } : null
  } catch {
    return null
  } finally {
    host.analysisStops.delete(cancel)
    abort.abort()
    query.close?.()
  }
}
