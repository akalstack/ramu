import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Settings2 } from 'lucide-react'
import { SETTINGS_MENU } from '@ramu/shared/settingsMenu'
import { readableSettingValue, type SettingsChangeCard as Card } from '@ramu/shared/settingsChanges'
import { Button } from '@/components/desktop-button'
import { t, useLanguage } from '../i18n'
import { ipcQueryKeyOn } from '../dataQueries'
import { errorText } from '../workspace/TaskPane'
import { useHost } from '../workspace/HostProvider'
import { useHostRuntime } from '../workspace/workspace'
import { queryInvokerFor } from '../git/hostQuery'

const STATE_LABEL = {
  waiting: () => t('Waiting for you'),
  applied: () => t('Applied'),
  dismissed: () => t('Dismissed'),
  undone: () => t('Undone'),
}

const pageLabel = (section: string) => t(SETTINGS_MENU.find((entry) => entry.id === section)?.label ?? section)

/** Settings an agent asked to change: each row's old and new value and its page, with Apply or Undo. */
export function SettingsChangeCard({ cardId }: { cardId: string }) {
  useLanguage()
  const host = useHost()
  const call = queryInvokerFor(host.id)
  const { on } = useHostRuntime()
  const query = useQuery({
    queryKey: ipcQueryKeyOn(host.id, 'settings.changeCard.get', cardId),
    queryFn: () => call('settings.changeCard.get', cardId),
  })
  const { refetch } = query
  useEffect(() => on('workspace:changed', () => void refetch()), [on, refetch])
  if (query.isPending) return null
  if (!query.data)
    return <p className="m-[12px_0] text-caption text-muted-foreground">{t('This settings card is gone.')}</p>
  return <ChangeCard card={query.data} onChange={() => void refetch()} />
}

function ChangeCard({ card, onChange }: { card: Card; onChange: () => void }) {
  const { id: hostId, invoke } = useHost()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await work()
      onChange()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const first = card.rows[0]
  const openSettings = () =>
    first &&
    window.dispatchEvent(
      new CustomEvent('ramu:settings', { detail: { section: first.section, target: first.title, host: hostId } }),
    )
  const problem = error ?? card.error
  return (
    <section
      className="m-[12px_0] flex flex-col gap-2 rounded-(--radius-m) bg-fill p-[15px]"
      aria-label={t('Settings changes')}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Settings2 size={16} className="flex-none" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate font-semibold text-foreground">
          {card.rows.length === 1 ? t('Change a setting') : t('Change {0} settings', { '0': card.rows.length })}
        </span>
        <span className="flex-none text-caption text-muted-foreground">{STATE_LABEL[card.state]()}</span>
      </div>
      <p className="m-0 text-caption text-muted-foreground [overflow-wrap:anywhere]">{card.reason}</p>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {card.rows.map((row) => (
          <li key={row.path} className="flex min-w-0 flex-col">
            <span className="text-control text-foreground">
              {t(row.title)} <span className="text-caption text-muted-foreground">· {pageLabel(row.section)}</span>
            </span>
            <span className="text-caption text-muted-foreground [overflow-wrap:anywhere]">
              {readableSettingValue(row.before, t)} →{' '}
              <span className="text-foreground">{readableSettingValue(row.value, t)}</span>
            </span>
          </li>
        ))}
      </ul>
      {problem && (
        <p role="alert" className="m-0 text-caption text-bad [overflow-wrap:anywhere] whitespace-pre-wrap">
          {problem}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-1.5">
        {card.state === 'waiting' && (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void run(() => invoke('settings.changeCard.dismiss', card.id))}
          >
            {t('Dismiss')}
          </Button>
        )}
        {(card.state === 'waiting' || problem) && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={openSettings}>
            {t('Open in Settings')}
          </Button>
        )}
        {card.state === 'applied' && (
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => void run(() => invoke('settings.changeCard.undo', card.id))}
          >
            {t('Undo')}
          </Button>
        )}
        {card.state === 'waiting' && (
          <Button
            size="sm"
            variant="default"
            disabled={busy}
            onClick={() => void run(() => invoke('settings.changeCard.apply', card.id))}
          >
            {t('Apply')}
          </Button>
        )}
      </div>
    </section>
  )
}
