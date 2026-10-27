import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentSetupSnapshot, SetupItem } from '@ramu/shared/agentSetup'
import { estimatedTokens } from '@ramu/shared/rules'
import { useHost } from '../../../workspace/HostProvider'
import { t, useLanguage } from '../../../i18n'
import { errorText } from '../../../lib/errors'
import { Button } from '@/components/ui/button'

const stateLabel = (state: SetupItem['state']) => {
  switch (state) {
    case 'configured':
      return t('Configured')
    case 'delivered':
      return t('Delivered')
    case 'runtime-confirmed':
      return t('Runtime confirmed')
    case 'not-observable':
      return t('Not observable')
    case 'needs-refresh':
      return t('Needs refresh')
    case 'omitted':
      return t('Not sent')
  }
}

const kindLabel = (kind: SetupItem['kind']) => {
  switch (kind) {
    case 'rule':
      return t('Rule')
    case 'native-mcp':
      return t('MCP server')
    case 'shared-mcp':
      return t('Shared MCP')
    case 'skill':
      return t('Skill')
  }
}

/**
 * What this thread has from Ramu's agent setup, resolved on the host. A desired configuration is not proof the runtime
 * loaded it, so each item says how far it got and why; names only, never rule text or credentials.
 */
const requirementLabels = {
  available: 'Tool server ready',
  'sign-in-required': 'Sign in to use it',
  'approval-needed': 'Needs your approval first',
  'not-connected': 'Not connected',
  missing: 'Not set up for this thread',
} as const

export function AgentSetupSection({ sessionId }: { sessionId: string }) {
  useLanguage()
  const { invoke } = useHost()
  const [snapshot, setSnapshot] = useState<AgentSetupSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const request = useRef(0)
  const refresh = useCallback(() => {
    const current = ++request.current
    return invoke('agent.setup', sessionId)
      .then((next) => {
        if (request.current === current) setSnapshot(next)
      })
      .catch((reason: unknown) => {
        if (request.current === current) setError(errorText(reason))
      })
  }, [invoke, sessionId])
  useEffect(() => {
    void refresh()
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- a counter that invalidates in-flight work; it is not a DOM ref
      request.current++
    }
  }, [refresh])
  return (
    <section className="mt-4 flex flex-col gap-2" aria-label={t('Agent setup for this thread')}>
      <h3 className="m-0 text-sm font-medium">{t('Agent setup')}</h3>
      {error && <p className="m-0 break-words text-bad">{error}</p>}
      {!snapshot && !error && <p role="status">{t('Checking agent setup…')}</p>}
      {snapshot && (
        <>
          <p className="m-0 text-caption text-muted-foreground">
            {t('Change these in Settings → Agent setup. A running thread keeps what it started with.')}
            {snapshot.rulesCharacters > 0 &&
              ` ${t('Rules: about {0} tokens ({1} of {2} characters).', {
                '0': estimatedTokens(snapshot.rulesCharacters).toLocaleString(),
                '1': snapshot.rulesCharacters.toLocaleString(),
                '2': snapshot.rulesLimit.toLocaleString(),
              })}`}
          </p>
          {!snapshot.items.length && <p className="m-0">{t('Nothing from Agent setup applies to this thread.')}</p>}
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {snapshot.items.map((item) => (
              <li key={`${item.kind}:${item.name}`} className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <strong className="min-w-0 flex-1 break-words">{item.name}</strong>
                  <span className="text-caption text-muted-foreground">{kindLabel(item.kind)}</span>
                  <span>{stateLabel(item.state)}</span>
                </div>
                <span className="text-caption text-muted-foreground">{t(item.reason)}</span>
                {item.requires?.map((need) => (
                  <span key={need.tool} className="text-caption text-muted-foreground">
                    {need.server} · {t(requirementLabels[need.status])}
                  </span>
                ))}
                {item.duplicate && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="self-start"
                    onClick={() => {
                      const { connectionId, use } = item.duplicate!
                      void invoke(
                        'agent.chooseDuplicate',
                        sessionId,
                        connectionId,
                        use === 'native' ? 'both' : 'native',
                      )
                        .then(refresh)
                        .catch((reason: unknown) => setError(errorText(reason)))
                    }}
                  >
                    {t(item.duplicate.use === 'native' ? 'Use both copies' : "Use the provider's copy only")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
