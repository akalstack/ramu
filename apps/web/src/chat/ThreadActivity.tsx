import { Button } from '@/components/desktop-button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { ActivityKind, threadActivity } from '@ramu/shared/chat/threadActivity'
import { t, useLanguage } from '../i18n'
export function ThreadActivitySummary({
  model,
  onOpen,
  goalLabel,
  workingLabel,
}: {
  model: ReturnType<typeof threadActivity>
  onOpen: (kind: ActivityKind) => void
  goalLabel: string
  workingLabel?: string
}) {
  useLanguage()
  if (!model.primary) return null
  // The transcript already shows the working status; the dock lists only other activity.
  const label = (kind: ActivityKind) =>
    ({
      connection: t('Offline · last-known activity'),
      input: model.permissionCount ? t('Approval needed') : t('{0} input requests', { 0: model.requestIds.length }),
      provider: t('Waiting for limit reset'),
      working: workingLabel ?? t('Working'),
      helpers: t('{0} active agents', { 0: model.counts.active }),
      advisor: t('Advisor reviewing'),
      goal: goalLabel,
      queue: t('{0} queued', { 0: model.queueCount }),
    })[kind]
  const kinds = [model.primary, ...model.secondary].filter((kind) => kind !== 'working')
  if (!kinds.length) return null
  return (
    <div aria-label={t('Thread activity')} className="flex min-w-0 flex-wrap items-center gap-1 px-1 py-0.5">
      {kinds.slice(0, 3).map((kind, index) => (
        <Button
          key={kind}
          variant="ghost"
          size="sm"
          className="h-auto min-h-7 whitespace-normal text-caption"
          onClick={() => onOpen(kind)}
        >
          <span className={index === 0 ? 'font-medium' : 'text-muted-foreground'}>{label(kind)}</span>
        </Button>
      ))}
      {kinds.length > 3 && (
        <Popover>
          <PopoverTrigger render={<Button variant="ghost" size="sm" />}>{t('More activity')}</PopoverTrigger>
          <PopoverContent className="flex w-60 flex-col gap-1 p-2">
            {kinds.slice(3).map((kind) => (
              <Button
                key={kind}
                variant="ghost"
                className="justify-start whitespace-normal"
                onClick={() => onOpen(kind)}
              >
                {label(kind)}
              </Button>
            ))}
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}
