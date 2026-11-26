import { useId, useState } from 'react'
import { LocalInlineAction } from '../../../components/inline-action'
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
        <LocalInlineAction aria-expanded={open} aria-controls={panel} onClick={() => setOpen((value) => !value)}>
          {translate('Why?')}
        </LocalInlineAction>
      </div>
      {open && (
        <div id={panel} className="mt-1 space-y-1">
          {reason && <p className="m-0 text-soft">{reason}</p>}
          <p className="m-0">
            {translate(
              'Always asks: deleting work for good, changing the computer, acting as you, deploying to production.',
            )}
          </p>
          <p className="m-0">{translate('Allow once approves just this one.')}</p>
        </div>
      )}
    </div>
  )
}
