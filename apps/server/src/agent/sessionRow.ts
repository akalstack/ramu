import type { AgentEvent, AgentSessionInfo, AgentSessionState, AgentProvider } from '@ramu/shared/types'
import { DEFAULT_AGENT_SETTINGS } from '@ramu/shared/types'
import { LEGACY_ACCOUNT_PROVIDERS } from './settings'
import { truncate } from './text'

/** A joined agent_sessions row as stored in the database. */
export interface SessionRow {
  id: string
  task_id: string
  repo_id: string | null
  provider: AgentProvider
  settings: string
  cwd: string
  additional_dirs: string
  covers: string
  state: AgentSessionState
  provider_session_id: string | null
  created_at: number
  parent_session_id?: string | null
  first_event: string | null
}

/** The session's first recorded event (its opening prompt). */
export const TITLE_SQL = `(SELECT event FROM agent_events e WHERE e.session_id = s.id ORDER BY seq LIMIT 1) AS first_event`

/** Maps a stored session row to the shape the API returns. */
export function toInfo(r: SessionRow): AgentSessionInfo {
  return {
    id: r.id,
    taskId: r.task_id,
    repoId: r.repo_id,
    provider: r.provider,
    settings: {
      ...DEFAULT_AGENT_SETTINGS,
      ...(LEGACY_ACCOUNT_PROVIDERS.has(r.provider) ? { accountId: 'default' } : {}),
      ...JSON.parse(r.settings),
      provider: r.provider,
    },
    cwd: r.cwd,
    additionalDirs: JSON.parse(r.additional_dirs) as string[],
    covers: JSON.parse(r.covers) as string[],
    state: r.state,
    providerSessionId: r.provider_session_id,
    parentId: r.parent_session_id ?? null,
    createdAt: r.created_at,
    title: titleOf(r.first_event),
  }
}

function titleOf(firstEvent: string | null): string {
  const e = firstEvent ? (JSON.parse(firstEvent) as AgentEvent) : null
  const prompt = e?.kind === 'user' ? e.text : e?.kind === 'queue' ? e.messages[0]?.text : ''
  const text = prompt?.split('\n\n<ramu-context>')[0]!.replace(/\s+/g, ' ').trim() ?? ''
  return text ? truncate(text, 60) : 'New thread'
}
