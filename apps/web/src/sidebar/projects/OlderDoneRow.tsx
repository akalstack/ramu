import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/desktop-button'
import { t, useLanguage } from '../../i18n'

/** Reads the next page of older finished threads from each host that has some, under a Done list. */
export function OlderDoneRow({ hosts }: { hosts: { doneRemaining: number; loadOlderDone(): Promise<void> }[] }) {
  useLanguage()
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const waiting = hosts.filter((host) => host.doneRemaining > 0)
  const remaining = waiting.reduce((sum, host) => sum + host.doneRemaining, 0)
  if (!remaining) return null
  return (
    <Button
      variant="tree"
      disabled={loading}
      onClick={() => {
        setLoading(true)
        setFailed(false)
        void Promise.all(waiting.map((host) => host.loadOlderDone()))
          .catch(() => setFailed(true))
          .finally(() => setLoading(false))
      }}
      className="h-[30px] min-h-[30px] gap-2 pl-[31px] pr-2 text-body leading-5 hover:bg-accent"
    >
      {loading
        ? t('Loading…')
        : failed
          ? t('Could not load older threads. Try again')
          : t('Show {0} more', { '0': remaining })}
      {!loading && <ChevronDown className="size-3.5 flex-none" />}
    </Button>
  )
}
