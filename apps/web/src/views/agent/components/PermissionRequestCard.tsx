import { t as translate, useLanguage } from '../../../i18n'
import { Button } from '@/components/desktop-button'
import { ShieldQuestion } from 'lucide-react'
import type { AgentEvent } from '@ramu/shared/types'
import { invoke } from '../../../ipc'
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
  return (
    <div className={pending ? `${CARD_CLASS} pending` : CARD_CLASS}>
      <div className="card-title flex items-center gap-[7px] font-semibold">
        <ShieldQuestion size={15} /> {e.title}
      </div>
      {e.detail && <pre>{e.detail}</pre>}
      {pending ? (
        <div className="row flex gap-1.5 mt-2">
          <Button
            variant="default"
            className="primary bg-primary text-primary-foreground border-transparent font-semibold justify-center hover:bg-primary-hover disabled:bg-raised disabled:text-muted-foreground disabled:opacity-100"
            onClick={() => void invoke('agent.replyPermission', sessionId, e.requestId, true)}
          >
            {translate('Allow')}
          </Button>
          <Button
            variant="secondary"
            className="bg-fill hover:bg-fill-hover"
            onClick={() => void invoke('agent.replyPermission', sessionId, e.requestId, false)}
          >
            {translate('Deny')}
          </Button>
        </div>
      ) : (
        <Outcome outcome={outcome} />
      )}
    </div>
  )
}
