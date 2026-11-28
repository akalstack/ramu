import { ArrowDown } from 'lucide-react'
import { Button } from '@/components/desktop-button'
import { LoadingDots } from '@/components/loading-dots'
import { t, useLanguage } from '../../../i18n'

/**
 * Floats over the bottom of the transcript while the reader is away from the latest output, and slides away once they
 * are back. Opaque in every interaction state, so transcript text never shows through the floating control. It matches
 * the send button's size and arrow, with the same faint edge as other floating surfaces.
 */
export function ScrollToLatestButton({
  working,
  active,
  onClick,
}: {
  working: boolean
  active: boolean
  onClick: () => void
}) {
  useLanguage()
  return (
    <Button
      variant="secondary"
      size="icon"
      data-active={active}
      inert={!active}
      tabIndex={active ? undefined : -1}
      onClick={(event) => {
        event.currentTarget.blur()
        onClick()
      }}
      className="absolute inset-s-1/2 bottom-4 -translate-x-1/2 rtl:translate-x-1/2 size-[30px] rounded-full border border-(--edge) bg-raised text-foreground shadow-none [&:hover:not(:disabled)]:bg-[color-mix(in_srgb,var(--raised),var(--text)_5%)] hover:text-foreground active:bg-raised active:translate-y-0 transition-[translate,scale,opacity] duration-200 motion-safe:transition-[opacity,translate,scale,background-color] data-[active=false]:pointer-events-none data-[active=false]:translate-y-full data-[active=false]:scale-95 data-[active=false]:opacity-0 data-[active=false]:duration-400 data-[active=false]:ease-[cubic-bezier(0.7,0,0.84,0)] data-[active=true]:translate-y-0 data-[active=true]:scale-100 data-[active=true]:opacity-100 data-[active=true]:ease-[cubic-bezier(0.23,1,0.32,1)]"
      aria-label={working ? t('Agent is working. Scroll to latest') : t('Scroll to latest')}
      title={t('Scroll to latest')}
    >
      {working ? <LoadingDots /> : <ArrowDown size={16} strokeWidth={2.25} />}
    </Button>
  )
}
