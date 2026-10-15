import { useEffect, useState } from 'react'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/ui/input'
import { ExternalLink } from 'lucide-react'
import type { AgentElicitation, ElicitationAction } from '@ramu/shared/types'
import type { QuestionState } from '@ramu/shared/questions'
import { t, useLanguage } from '../i18n'
import { invoke } from '../ipc'
import { errorText } from '../workspace/TaskPane'

export function ElicitationCard({
  sessionId,
  request,
  status,
  pending,
}: {
  sessionId: string
  request: AgentElicitation
  status: QuestionState
  pending: boolean
}) {
  useLanguage()
  const [values, setValues] = useState<Record<string, string>>(() => ({
    ...Object.fromEntries(
      request.fields
        .filter((field) => field.defaultValue !== undefined)
        .map((field) => [field.id, field.defaultValue!]),
    ),
    ...status.drafts,
    ...status.answers,
  }))
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!pending) return
    const timer = setTimeout(() => {
      void invoke('agent.elicitationDraft', sessionId, request.requestId, values).catch(() => {})
    }, 250)
    return () => clearTimeout(timer)
  }, [values, pending, sessionId, request.requestId])
  const submit = async (action: ElicitationAction) => {
    setBusy(true)
    setError(null)
    try {
      await invoke('agent.replyElicitation', sessionId, request.requestId, action, action === 'accept' ? values : {})
    } catch (error) {
      setError(errorText(error))
    } finally {
      setBusy(false)
    }
  }
  const outcome =
    status.outcome === 'answered' ? t('Submitted') : status.outcome === 'declined' ? t('Declined') : t('Cancelled')
  return (
    <div
      className={`card [&.pending]:[border-color:color-mix(in_srgb,_var(--warn)_50%,_transparent)] [&.pending]:[box-shadow:0_0_0_3px_var(--warn-wash)] [&_pre]:text-soft [border:1px_solid_transparent] rounded-(--radius-m) bg-card [border-color:var(--line-strong)] p-[12px_14px] elicitation-card${pending ? ' pending' : ''}`}
      data-elicitation-request={request.requestId}
      data-question-request={request.requestId}
    >
      <div className="elicitation-heading flex items-center justify-between gap-3">
        <strong>{request.serverName}</strong>
        <span className="muted text-muted-foreground small text-caption">
          {pending ? t('Waiting for your input') : outcome}
        </span>
      </div>
      <p>{request.message}</p>
      {request.mode === 'url' ? (
        <div className="elicitation-link">
          <a href={request.url} target="_blank" rel="noreferrer">
            <ExternalLink size={13} />
            {t('Open link')}
          </a>
          <span className="muted text-muted-foreground small text-caption">
            {request.url && new URL(request.url).host}
          </span>
          <p className="muted text-muted-foreground small text-caption">
            {t('Complete the request in your browser, then continue here.')}
          </p>
        </div>
      ) : (
        request.fields.map((field) => {
          const value = values[field.id] ?? ''
          const choices =
            field.type === 'boolean'
              ? [
                  { value: 'true', label: t('Yes') },
                  { value: 'false', label: t('No') },
                ]
              : field.options
          const update = (value: string) => setValues((old) => ({ ...old, [field.id]: value }))
          const selected: string[] =
            field.type === 'array' && value
              ? (() => {
                  try {
                    return JSON.parse(value)
                  } catch {
                    return []
                  }
                })()
              : []
          return (
            <fieldset key={field.id} disabled={!pending || busy}>
              <legend>
                {field.label}{' '}
                {!field.required && (
                  <span className="muted text-muted-foreground small text-caption">{t('(optional)')}</span>
                )}
              </legend>
              {field.description && (
                <p className="muted text-muted-foreground small text-caption">{field.description}</p>
              )}
              {choices.length ? (
                <>
                  {choices.map((choice) => (
                    <label
                      className="option [.question-card_&]:items-center [.question-card_&_input]:w-4 [.question-card_&_input]:h-4 [.question-card_&_input]:flex-none [.question-card_&_input]:p-0 [.question-card_&_input]:m-0 [.question-card_&_>_span]:min-w-0 [.elicitation-card_&]:flex [.elicitation-card_&]:items-center [.elicitation-card_&]:gap-2 [.elicitation-card_&]:m-[8px_0] p-[4px_0]"
                      key={choice.value}
                    >
                      <input
                        type={field.type === 'array' ? 'checkbox' : 'radio'}
                        name={`${request.requestId}:${field.id}`}
                        checked={field.type === 'array' ? selected.includes(choice.value) : value === choice.value}
                        onChange={() =>
                          update(
                            field.type === 'array'
                              ? JSON.stringify(
                                  selected.includes(choice.value)
                                    ? selected.filter((entry) => entry !== choice.value)
                                    : [...selected, choice.value],
                                )
                              : choice.value,
                          )
                        }
                      />
                      <span>{choice.label}</span>
                    </label>
                  ))}
                  {!field.required && value && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover small text-caption"
                      onClick={() => update('')}
                    >
                      {t('Clear')}
                    </Button>
                  )}
                </>
              ) : (
                <Input
                  aria-label={t('Answer: {0}', { '0': field.label })}
                  type={field.type === 'number' || field.type === 'integer' ? 'number' : 'text'}
                  step={field.type === 'integer' ? 1 : 'any'}
                  value={value}
                  maxLength={10000}
                  onChange={(event) => update(event.target.value)}
                />
              )}
            </fieldset>
          )
        })
      )}
      {error && (
        <p className="error text-bad" role="alert">
          {error}
        </p>
      )}
      {pending && (
        <div className="row flex gap-1.5 mt-2">
          <Button
            variant="default"
            className="primary bg-primary text-primary-foreground border-transparent font-semibold justify-center hover:bg-primary-hover disabled:bg-raised disabled:text-muted-foreground disabled:opacity-100"
            disabled={
              busy ||
              request.fields.some(
                (field) =>
                  field.required &&
                  (!Object.hasOwn(values, field.id) ||
                    (['number', 'integer', 'boolean'].includes(field.type) && !(values[field.id] ?? '').length)),
              )
            }
            onClick={() => void submit('accept')}
          >
            {request.mode === 'url' ? t('Continue') : t('Submit')}
          </Button>
          <Button
            variant="secondary"
            className="bg-fill hover:bg-fill-hover"
            disabled={busy}
            onClick={() => void submit('decline')}
          >
            {t('Decline')}
          </Button>
          <Button
            variant="ghost"
            className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover"
            disabled={busy}
            onClick={() => void submit('cancel')}
          >
            {t('Cancel')}
          </Button>
        </div>
      )}
    </div>
  )
}
