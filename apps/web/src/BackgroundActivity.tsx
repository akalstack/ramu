import { readBackgroundActivity } from './backgroundActivityState'
import { useEffect, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import type { BackgroundActivity as Activity } from '@ramu/shared/activity'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { invoke, ramu } from './ipc'
import { t, useLanguage } from './i18n'

/** Global activity remains visible on Home and in every checkout. */
export function BackgroundActivity() {
  useLanguage()
  const [activities, setActivities] = useState<Activity[]>([])
  const [connected, setConnected] = useState(true)
  useEffect(() => {
    let disposed = false, revision = 0
    const refresh = async () => {
      const request = ++revision
      const state = await readBackgroundActivity(() => invoke('activity.status'), () => invoke('background.status'))
      if (!disposed && request === revision) { setActivities(state.activities); setConnected(state.connected) }
    }
    const offs = [
      ramu.on('activity:changed', () => { void refresh() }),
      ramu.on('updates:changed', () => { void refresh() }),
      ramu.on('memory:changed', () => { void refresh() }),
      ramu.on('automation:changed', () => { void refresh() }),
      ramu.on('background:connection', ({ connected }) => {
        ++revision; setConnected(connected)
        if (connected) void refresh(); else setActivities([])
      }),
    ]
    void refresh()
    // Reconcile activity when reconnecting or an older service misses a push.
    const timer = setInterval(() => { void refresh() }, 3000)
    return () => { disposed = true; clearInterval(timer); offs.forEach((off) => off()) }
  }, [])
  return <BackgroundActivityIndicator items={activities} connected={connected} />
}

export function BackgroundActivityIndicator({ items, connected = true }: { items: Activity[]; connected?: boolean }) {
  useLanguage()
  if (!items.length && connected) return null
  const label = connected ? t(items[0]!.label) : t('Reconnecting to background service')
  return <Popover>
    <PopoverTrigger render={<Button variant="ghost" className="status-activity min-w-0 flex-none h-[22px] min-h-[22px] border-0 rounded-(--radius-s) bg-transparent p-[0_6px] has-data-[icon=inline-start]:pl-[6px] has-data-[icon=inline-end]:pr-[6px] gap-[5px] text-[length:var(--font-caption)] leading-[18px] text-muted-foreground hover:bg-hover hover:text-muted-foreground aria-expanded:text-muted-foreground aria-expanded:bg-hover [&_svg]:size-3.5" />} aria-label={t('Background activity')} title={label}>
      <LoaderCircle data-icon="inline-start" className="animate-spin motion-reduce:animate-none" />
      {items.length > 0 && <span className="tabular-nums">{items.length}</span>}
    </PopoverTrigger>
    <PopoverContent side="top" align="end" className="w-80 max-w-[calc(100vw-24px)]">
      <PopoverHeader><PopoverTitle>{t('Background activity')}</PopoverTitle></PopoverHeader>
      <div role="status" aria-live="polite" className="flex flex-col gap-2 max-h-64 overflow-y-auto">
        {!connected ? <p>{label}</p> : items.length ? items.map((item) => <div key={item.id} className="flex items-start gap-2">
          <LoaderCircle size={14} className="shrink-0 mt-0.5 animate-spin motion-reduce:animate-none" />
          <div className="min-w-0"><div>{t(item.label)}</div>{item.detail && <div className="truncate text-muted-foreground" title={item.detail}>{item.detail}</div>}</div>
        </div>) : <p>{t('No background activity')}</p>}
      </div>
    </PopoverContent>
  </Popover>
}
