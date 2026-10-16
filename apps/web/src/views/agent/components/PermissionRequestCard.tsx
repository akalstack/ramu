import { t as translate, useLanguage } from '../../../i18n'
import { Button } from '@/components/desktop-button'
import { ShieldQuestion } from 'lucide-react'
import { useState } from 'react'
import type { AgentEvent, PermissionScope } from '@ramu/shared/types'
import { errorText } from '../../../lib/errors'
import { invoke } from '../../../ipc'
import { Dropdown } from '../../../Menu'
import { Outcome } from './Outcome'

const CARD_CLASS =
  'card [&.pending]:[border-color:color-mix(in_srgb,_var(--warn)_50%,_transparent)] [&.pending]:[box-shadow:0_0_0_3px_var(--warn-wash)] [&_pre]:text-soft [border:1px_solid_transparent] rounded-(--radius-m) bg-card [border-color:var(--line-strong)] p-[12px_14px]'

/** A tool permission request: Allow or Deny while it waits, the outcome afterwards. */
export function PermissionRequestCard({
  event: e,
  sessionId,
  pending,
  outcome,
}: {
  event: Extract<AgentEvent, { kind: 'permission-request' }>
  sessionId: string
  pending: boolean
  outcome: string | undefined
}) {
  useLanguage()
  const [pattern, setPattern] = useState(e.approvalPatterns?.[0] ?? 'exact')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const act = async (allow: boolean, scope: PermissionScope = 'once') => {
    setBusy(true)
    setError(null)
    try {
      await invoke(
        'agent.replyPermission',
        sessionId,
        e.requestId,
        allow,
        undefined,
        scope,
        scope !== 'once' && pattern !== 'exact' ? pattern : undefined,
      )
    } catch (error) {
      setError(errorText(error))
    } finally {
      setBusy(false)
    }
  }
  const savedScope = outcome === 'allowed-project' ? 'project' : outcome === 'allowed-user' ? 'user' : null
  const forget = async () => {
    if (!savedScope) return
    setBusy(true)
    setError(null)
    try {
      await invoke('agent.forgetPermission', sessionId, e.requestId, savedScope)
    } catch (error) {
      setError(errorText(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={pending ? `${CARD_CLASS} pending` : CARD_CLASS}>
      <div className="card-title flex items-center gap-[7px] font-semibold">
        <ShieldQuestion size={15} /> {e.title}
      </div>
      {e.detail && <pre>{e.detail}</pre>}
      {e.approvalReviewRule && (
        <p className="m-0 mt-2 text-caption text-muted-foreground">
          {translate('Always ask')}: {e.approvalReviewRule}
        </p>
      )}
      {pending ? (
        <div className="mt-2 space-y-2">
          {!!e.approvalPatterns?.length && (
            <div className="flex flex-wrap items-center gap-2 text-caption">
              <span>{translate('Don’t ask again for')}</span>
              <Dropdown
                label={translate('Approval rule')}
                value={pattern}
                onChange={setPattern}
                options={[
                  { value: 'exact', label: translate('This exact request') },
                  ...e.approvalPatterns.map((value) => ({ value, label: value })),
                ]}
              />
            </div>
          )}
          <div className="row flex flex-wrap gap-1.5">
            <Button
              variant="default"
              className="primary bg-primary text-primary-foreground border-transparent font-semibold justify-center hover:bg-primary-hover disabled:bg-raised disabled:text-muted-foreground disabled:opacity-100"
              disabled={busy}
              onClick={() => void act(true)}
            >
              {translate('Allow once')}
            </Button>
            {e.approvalKey && e.approvalProjectId && (
              <Button variant="secondary" disabled={busy} onClick={() => void act(true, 'project')}>
                {translate('Allow for this project')}
              </Button>
            )}
            {e.approvalKey && (
              <Button variant="secondary" disabled={busy} onClick={() => void act(true, 'user')}>
                {translate('Allow for this user')}
              </Button>
            )}
            <Button
              variant="secondary"
              className="bg-fill hover:bg-fill-hover"
              disabled={busy}
              onClick={() => void act(false)}
            >
              {translate('Deny')}
            </Button>
          </div>
          <p className="m-0 text-caption text-muted-foreground">
            {translate(
              e.approvalKey
                ? 'Saved approvals apply to the selected rule. Allow once applies only to this request.'
                : 'Applies to this request only.',
            )}
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Outcome outcome={outcome} />
          {savedScope && (
            <>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void forget()}>
                {translate('Forget approval')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  window.dispatchEvent(new CustomEvent('ramu:settings', { detail: { section: 'access' } }))
                }
              >
                {translate('Manage approvals')}
              </Button>
            </>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="m-0 mt-2 text-caption text-bad">
          {error}
        </p>
      )}
    </div>
  )
}
