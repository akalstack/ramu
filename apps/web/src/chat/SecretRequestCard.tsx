import { useId, useState } from 'react'
import { KeyRound } from 'lucide-react'
import type { AgentEvent } from '@ramu/shared/types'
import { PRIMARY_ACTION_CLASS } from '@/components/button-classes'
import { Button } from '@/components/desktop-button'
import { Checkbox } from '@/components/desktop-checkbox'
import { Input } from '@/components/desktop-input'
import { t, useLanguage } from '../i18n'
import { useHost } from '../workspace/HostProvider'
import { errorText } from '../workspace/TaskPane'
import { useViewOnly } from '../composer/useViewOnly'

type SecretRequest = Extract<AgentEvent, { kind: 'secret-request' }>

function secretOutcomeLabel(outcome: string | undefined, envName?: string): string {
  switch (outcome) {
    case 'saved':
      return t('Saved for this thread')
    case 'saved-env':
      return t('Saved and kept as {0}', { 0: envName ?? '' })
    case 'declined':
      return t('Declined')
    case 'timed_out':
      return t('Timed out')
    default:
      return t('Cancelled')
  }
}

/** A masked card for one secret. The value goes straight to the host, which hands the agent only a file path. */
export function SecretRequestCard({
  sessionId,
  request,
  pending,
  outcome,
}: {
  sessionId: string
  request: SecretRequest
  pending: boolean
  outcome: string | undefined
}) {
  useLanguage()
  const { invoke, isLocal } = useHost()
  const viewOnly = useViewOnly()
  const inputId = useId()
  const [secret, setSecret] = useState(''),
    [remember, setRemember] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null)
  const answer = async (save: boolean) => {
    setBusy(true)
    setError(null)
    try {
      await invoke(
        'agent.answerSecret',
        sessionId,
        request.requestId,
        save ? { type: 'save', secret, remember: remember && !!request.envName } : { type: 'decline' },
      )
      setSecret('')
    } catch (error) {
      setError(errorText(error))
    } finally {
      setBusy(false)
    }
  }
  const open = pending && !viewOnly
  return (
    <div
      className={`card [&.pending]:[border-color:color-mix(in_srgb,_var(--warn)_50%,_transparent)] [&.pending]:[box-shadow:0_0_0_3px_var(--warn-wash)] rounded-(--radius-m) bg-card [border:1px_solid_var(--line-strong)] p-[12px_14px] flex flex-col gap-2${pending ? ' pending' : ''}`}
      data-question-request={request.requestId}
    >
      <div className="flex items-center justify-between gap-3">
        <strong className="flex items-center gap-1.5">
          <KeyRound size={14} aria-hidden />
          {request.label}
        </strong>
        <span className="text-muted-foreground text-caption">
          {pending ? t('Waiting for your input') : secretOutcomeLabel(outcome, request.envName)}
        </span>
      </div>
      <p className="whitespace-pre-wrap">{request.reason}</p>
      {open && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (secret.trim() && !busy) void answer(true)
          }}
        >
          <Input
            id={inputId}
            type="password"
            autoComplete="off"
            spellCheck={false}
            aria-label={request.label}
            placeholder={request.placeholder}
            value={secret}
            maxLength={64 * 1024}
            disabled={busy}
            onChange={(event) => setSecret(event.target.value)}
          />
          {request.envName && isLocal && (
            <label className="flex items-center gap-2 text-caption">
              <Checkbox
                checked={remember}
                disabled={busy}
                onCheckedChange={(checked) => setRemember(checked === true)}
              />
              {t('Keep as {0} for later threads', { 0: request.envName })}
            </label>
          )}
          <p className="text-muted-foreground text-caption">
            {t(
              'The agent gets a private file with the value, never the value itself. The file is deleted after a day.',
            )}
          </p>
          {error && (
            <p className="text-bad" role="alert">
              {error}
            </p>
          )}
          <div className="flex gap-1.5">
            <Button type="submit" variant="default" className={PRIMARY_ACTION_CLASS} disabled={busy || !secret.trim()}>
              {t('Save')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="bg-fill hover:bg-fill-hover"
              disabled={busy}
              onClick={() => void answer(false)}
            >
              {t('Decline')}
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
