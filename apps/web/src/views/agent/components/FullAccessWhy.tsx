import { useId, useState } from 'react'
import { Button } from '@/components/desktop-button'
import { t as translate, useLanguage } from '../../../i18n'

/**
 * Under a permission request that Full access still asks about: the plain note, and a Why? that opens the specific
 * reason and what Full access does and does not skip, so the person can decide without looking anything up.
 */
export function FullAccessWhy({ reason }: { reason?: string }) {
  useLanguage()
  const [open, setOpen] = useState(false)
  const panel = useId()
  return (
    <div className="mt-2 text-caption text-muted-foreground">
      <div className="flex flex-wrap items-center gap-x-1">
        <span>{translate('Full access still asks before this.')}</span>
        <Button
          variant="link"
          size="sm"
          className="h-auto p-0 text-caption"
          aria-expanded={open}
          aria-controls={panel}
          onClick={() => setOpen((value) => !value)}
        >
          {translate('Why?')}
        </Button>
      </div>
      {open && (
        <div id={panel} className="mt-1 space-y-1">
          {reason && <p className="m-0 text-soft">{reason}</p>}
          <p className="m-0">
            {translate(
              'Full access skips most approvals, but a short list of actions always asks: ones that can destroy work for good, change the computer itself, act in your name or deploy to production.',
            )}
          </p>
          <p className="m-0">{translate('Allow once covers only this request; the next one asks again.')}</p>
        </div>
      )}
    </div>
  )
}
