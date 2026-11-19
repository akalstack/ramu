import { finishedSince, briefRows } from '@ramu/shared/hostInbox'
import { t, useLanguage } from './i18n'
import { Button } from '@/components/desktop-button'
import { ChevronRight, Inbox } from 'lucide-react'
import { useWorkspace } from './workspace/workspace'
import { BackgroundControls } from './Automation'
import { useAgentOverview } from './HomeAgents'
import { openInbox } from './inbox/navigation'
import { useInboxModel } from './inbox/useBrief'
import { useHost } from './workspace/HostProvider'
import { errorText } from './lib/errors'

/** What sits under the start box on Home and New thread: one line that opens the Inbox when something needs the person. */
export function HomeFeed() {
  useLanguage()
  const ws = useWorkspace()
  const host = useHost()
  const { error } = useAgentOverview()
  const { model, visit } = useInboxModel()
  const needs = briefRows(model).length
  const finished = finishedSince(model, visit)
  return (
    <div className="home-feed home-agents m-[0_auto] flex w-full max-w-[760px] flex-col gap-6 pb-6">
      <nav className="-mt-3 flex min-h-8 items-center justify-center gap-3" aria-label={t('Inbox')}>
        <BackgroundControls compact />
        {needs > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="home-inbox-link text-muted-foreground small text-caption"
            onClick={() => openInbox(ws, 'brief')}
          >
            <Inbox size={13} />
            {[t('{0} need you', { 0: needs }), finished && t('{0} finished', { 0: finished })]
              .filter(Boolean)
              .join(' · ')}
            <ChevronRight size={12} />
          </Button>
        )}
      </nav>
      {/* A host that is offline or rejected says so in the status bar; its failed read adds nothing but noise. */}
      {error && (host.status === 'connected' || host.status === null) && (
        <p role="alert" className="text-bad small text-caption">
          {errorText(error)}
        </p>
      )}
    </div>
  )
}
